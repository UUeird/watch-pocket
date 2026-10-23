// Uploads each browser-test run's summary to the tada board, where its Test trends view charts the suite's health
// across runs and machines. Ported from tada's app/tests/test-run-upload.ts; tada's docs/operations/test-runs.md
// describes the API and how to mint a token.
//
// Opt-in: nothing happens unless TADA_TOKEN (a test-runs:write token) and TADA_TEST_RUNS_BOARD (the board's slug)
// are set, in the shell or in the gitignored .env.local; the shell wins. TADA_API_URL overrides the API host.
//
// An upload failure never fails the run. Each run's record joins a local queue, which is sent oldest first:
// - a network error, timeout, 429 or 5xx stops sending and keeps everything for the next run;
// - a 401, 403 or 404 means the token or slug is wrong, not the record: it stops and keeps everything, so fixing the
//   setup sends the backlog;
// - a 400 or 413 refuses the record itself, for good: it is dropped and the next is sent.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { summarizeReport, type PlaywrightJsonReport, type TestRunRecord } from './test-run-summary';

export const DEFAULT_API_URL = 'https://tada-api.onrender.com';
// The queue keeps at most this many runs, dropping the oldest; the board keeps at most its newest 500 anyway.
export const QUEUE_CAP = 100;
// Per request: long enough for the API host to wake from sleep. Sending stops at the first failure.
const REQUEST_TIMEOUT_MS = 20_000;
const TOKEN_SHAPE = /^tada_([0-9A-Za-z]{8})_[0-9A-Za-z]{32}$/;

export interface UploadConfig {
  token: string;
  // Where the token came from, so a refusal can say which copy to replace.
  tokenFrom: 'the shell' | '.env.local';
  board: string;
  apiUrl: string;
  machine: string;
  hardwareModel?: string;
}
export interface QueuedRun {
  board: string;
  record: TestRunRecord;
}

const quiet = (command: string, args: string[], cwd?: string) => {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const readText = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
};

// The machine a run is recorded under: a hash of the hardware's own id, so it stays the same run after run and the
// raw id never leaves the machine, plus the hardware model the board suggests a name from. The same derivation as
// tada's backend/machine-identity.ts, so a machine reads as one machine on every board.
export function machineIdentity(): { machine: string; hardwareModel?: string } {
  const platform = process.platform;
  const uuid =
    platform === 'darwin'
      ? quiet('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']).match(/"IOPlatformUUID" = "([^"]+)"/)?.[1]
      : platform === 'linux'
        ? readText('/etc/machine-id') || readText('/var/lib/dbus/machine-id')
        : undefined;
  const model = (platform === 'darwin' ? quiet('sysctl', ['-n', 'hw.model']) : platform === 'linux' ? readText('/sys/devices/virtual/dmi/id/product_name') : '').slice(0, 100);
  const prefix = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
  const machine = uuid ? `${prefix}-${createHash('sha256').update(uuid.trim()).digest('hex').slice(0, 12)}` : `host-${hostname().toLowerCase().slice(0, 90) || 'unknown'}`;
  return model ? { machine, hardwareModel: model } : { machine };
}

/** The uploader's settings, or null where this machine hasn't opted in. Reads only the TADA_ keys from `envFile`. */
export function uploadConfig(env: NodeJS.ProcessEnv, envFile?: string, identify = machineIdentity): UploadConfig | null {
  let fromFile: Record<string, string | undefined> = {};
  if (envFile) {
    try {
      fromFile = parseEnv(fs.readFileSync(envFile, 'utf8'));
    } catch {
      // No file: the shell is the only source.
    }
  }
  const get = (key: string) => (env[key] || fromFile[key] || '').trim();
  const token = get('TADA_TOKEN');
  const board = get('TADA_TEST_RUNS_BOARD');
  if (!token || !board) return null;
  return {
    token,
    tokenFrom: env.TADA_TOKEN?.trim() ? 'the shell' : '.env.local',
    board,
    apiUrl: (get('TADA_API_URL') || DEFAULT_API_URL).replace(/\/+$/, ''),
    ...identify(),
  };
}

// Options that take a value, so their value isn't mistaken for a file filter.
const VALUED = new Set([
  '-c', '--config', '-g', '--grep', '-gv', '--grep-invert', '--project', '--shard', '-j', '--workers', '--reporter',
  '--retries', '--repeat-each', '--timeout', '--global-timeout', '--output', '--trace', '--max-failures', '--tsconfig',
  '--test-list', '--test-list-invert', '--ui-host', '--ui-port',
]);
// Options that change which tests run, or how many times each counts.
const NARROWING = new Set([
  '-g', '--grep', '-gv', '--grep-invert', '--project', '--shard', '--last-failed', '--only-changed', '--repeat-each',
  '-x', '--max-failures', '--test-list', '--test-list-invert',
]);
// The project that is the test suite: `--project=chromium`, which `npm run test:browser` passes, selects the whole
// suite rather than narrowing it.
export const SUITE_PROJECT = 'chromium';

/**
 * Whether the run was the whole suite, and if not, what narrowed it, read from the runner's own arguments. Only a
 * full run records the suite's size, so anything that selects fewer tests or repeats them makes it partial, as does
 * a run that didn't finish.
 */
export function runScope(argv: string[], status: string): Pick<TestRunRecord, 'scope' | 'filter'> {
  const at = argv.indexOf('test');
  const args = at === -1 ? [] : argv.slice(at + 1);
  const narrowing: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [flag, value] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const takesValue = VALUED.has(flag) && value === undefined && i + 1 < args.length;
    const given = value ?? (takesValue ? args[i + 1] : undefined);
    const shown = takesValue ? `${arg} ${args[i + 1]}` : arg;
    const isSuite = flag === '--project' && given === SUITE_PROJECT;
    if ((NARROWING.has(flag) && !isSuite) || !arg.startsWith('-')) narrowing.push(shown);
    if (takesValue) i++;
  }
  if (status !== 'passed' && status !== 'failed') narrowing.push(`(run ${status})`);
  if (narrowing.length === 0) return { scope: 'full' };
  return { scope: 'partial', filter: narrowing.join(' ').slice(0, 500) };
}

/** HEAD's commit and branch, each left out where git can't say. A detached HEAD has no branch. */
export function gitContext(cwd: string): Pick<TestRunRecord, 'sha' | 'branch'> {
  const sha = quiet('git', ['rev-parse', 'HEAD'], cwd);
  const branch = quiet('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return {
    ...(/^[0-9a-f]{7,40}$/.test(sha) ? { sha } : {}),
    ...(branch && branch !== 'HEAD' ? { branch: branch.slice(0, 255) } : {}),
  };
}

export function readQueue(file: string): QueuedRun[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Writes through a temporary file and a rename, so a run killed mid-write can't leave half a queue. */
export function writeQueue(file: string, queue: QueuedRun[]): void {
  if (queue.length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(queue));
  fs.renameSync(temporary, file);
}

// How to fix a 401, 403 or 404. The server's 401 is the same for every bad token, so this narrows it down from the
// token held. Tokens are listed and minted with tada's own scripts (its docs/operations/test-runs.md).
export function explainRefusal(status: number, error: string, board: string, config: UploadConfig): string {
  const where = config.tokenFrom === 'the shell' ? 'TADA_TOKEN in your shell' : 'TADA_TOKEN in .env.local';
  const list = 'npm run token:list -- --owner-email <you>';
  const mint = `npm run token:create -- --owner-email <you> --name <this machine> --board ${board} --days 365`;
  const fix = `(in tada's app/ folder, against prod)`;
  if (status === 401) {
    const shape = TOKEN_SHAPE.exec(config.token);
    if (!shape) return `the board rejected the token (401): ${where} isn't shaped like a tada token, so it was likely cut off when copied. Paste it again, or mint a new one ${fix}: ${mint}`;
    return `the board rejected token ${shape[1]} (401): it has expired or been revoked, or its secret doesn't match. Look for ${shape[1]} in ${fix}: ${list}. If it's missing or expired, mint a new one (${mint}) and replace ${where}; if it's live, paste the secret again.`;
  }
  if (status === 403) {
    return error.includes('scope')
      ? `the token lacks test-runs:write (403). Mint one that has it ${fix}: ${mint}, and replace ${where}.`
      : `the token's user can't write '${board}' (403${error ? `: ${error}` : ''}). Mint it as a user who can.`;
  }
  return `there's no board '${board}' this token can reach (404): TADA_TEST_RUNS_BOARD is misspelled, or the token is limited to other boards. Compare with ${fix}: ${list}`;
}

type Outcome = 'stored' | 'drop' | 'stop';

async function post(run: QueuedRun, config: UploadConfig, fetchFn: typeof fetch, log: (message: string) => void): Promise<Outcome> {
  const url = `${config.apiUrl}/api/projects/${encodeURIComponent(run.board)}/test-runs`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(run.record),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    log(`can't reach ${config.apiUrl} (${(error as Error).message}); will retry after the next run`);
    return 'stop';
  }
  if (response.status === 201) return 'stored';
  const detail = await response.text().catch(() => '');
  const said = detail ? `: ${detail.slice(0, 300)}` : '';
  if (response.status === 400 || response.status === 413) {
    log(`'${run.board}' refused the run from ${run.record.startedAt} (${response.status}${said}); dropped it`);
    return 'drop';
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    let error = '';
    try {
      error = String(JSON.parse(detail).error ?? '');
    } catch {
      // Not JSON: explain from the status alone.
    }
    log(explainRefusal(response.status, error, run.board, config));
    return 'stop';
  }
  log(`upload got ${response.status}${said}; will retry after the next run`);
  return 'stop';
}

/** Sends what's queued, oldest first, until one can't go. Returns the runs left and how many were stored. */
export async function drainQueue(queue: QueuedRun[], config: UploadConfig, fetchFn: typeof fetch, log: (message: string) => void) {
  const left = [...queue];
  let stored = 0;
  while (left.length) {
    const outcome = await post(left[0], config, fetchFn, log);
    if (outcome === 'stop') break;
    if (outcome === 'stored') stored += 1;
    left.shift();
  }
  return { left, stored };
}

export interface UploadRunOptions {
  resultsFile: string;
  queueFile: string;
  // The run's overall status, from the reporter's onEnd.
  status: string;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  envFile?: string;
  cwd?: string;
  fetchFn?: typeof fetch;
  log?: (message: string) => void;
  identify?: typeof machineIdentity;
}

/** Queues this run's record and sends the queue. Never throws: a failure is one warning line, and the run's exit code
 *  is untouched. */
export async function uploadRun(options: UploadRunOptions): Promise<void> {
  const log = options.log ?? ((message: string) => console.warn(`tada test-run upload: ${message}`));
  try {
    const config = uploadConfig(options.env ?? process.env, options.envFile, options.identify);
    if (!config) return;
    const queue = readQueue(options.queueFile);
    try {
      const report = JSON.parse(fs.readFileSync(options.resultsFile, 'utf8')) as PlaywrightJsonReport;
      const record = summarizeReport(report, {
        machine: config.machine,
        ...(config.hardwareModel ? { hardwareModel: config.hardwareModel } : {}),
        source: 'local',
        ...gitContext(options.cwd ?? process.cwd()),
        ...runScope(options.argv ?? process.argv, options.status),
      });
      queue.push({ board: config.board, record });
    } catch (error) {
      // No usable report: nothing to add, but still worth sending what earlier runs queued.
      log(`no record for this run (${(error as Error).message.split('\n')[0]})`);
    }
    // Saved before any network call, so a run killed mid-upload keeps its record.
    const capped = queue.slice(-QUEUE_CAP);
    writeQueue(options.queueFile, capped);
    const { left, stored } = await drainQueue(capped, config, options.fetchFn ?? fetch, log);
    writeQueue(options.queueFile, left);
    if (left.length) log(`${left.length} run(s) queued for later`);
    else if (stored > 0) console.log(`Uploaded ${stored === 1 ? 'the run' : `${stored} runs`} to the '${config.board}' board's test trends.`);
  } catch (error) {
    log(`failed (ignored): ${(error as Error).message}`);
  }
}
