// Builds a test-run record for the tada board's Test trends view from Playwright's JSON report (the `results.json`
// each run writes). Ported from tada's app/shared/test-run-summary.ts, which defines the record; the board checks it
// on upload, so a field it doesn't know is refused.
//
// The report has no record of the machine, the commit, or what narrowed the run, so the caller passes those.

/** The slice of Playwright's JSON report this reads. */
export interface PlaywrightJsonReport {
  config?: { rootDir?: string };
  stats?: { startTime?: string; duration?: number; expected?: number; unexpected?: number; flaky?: number; skipped?: number };
  suites?: PlaywrightJsonSuite[];
}
interface PlaywrightJsonSuite {
  title?: string;
  file?: string;
  specs?: {
    title?: string;
    file?: string;
    line?: number;
    tests?: { status?: string; projectName?: string; results?: { status?: string; duration?: number; error?: { message?: string } }[] }[];
  }[];
  suites?: PlaywrightJsonSuite[];
}

interface Counts {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}
export interface TestRunSpec extends Counts {
  file: string;
  durationMs: number;
}
export interface TestRunProblem {
  file: string;
  line: number;
  title: string;
  project?: string;
  outcome: 'failed' | 'flaky';
  error?: string;
}
export interface TestRunContext {
  machine: string;
  hardwareModel?: string;
  source: 'local' | 'ci';
  sha?: string;
  branch?: string;
  scope?: 'full' | 'partial';
  filter?: string;
}
export interface TestRunRecord extends TestRunContext, Counts {
  startedAt: string;
  durationMs: number;
  suiteSize?: number;
  specs: TestRunSpec[];
  problems: TestRunProblem[];
}

// The board keeps at most this many problem tests per run.
const MAX_PROBLEMS = 200;

const BUCKET: Record<string, keyof Counts> = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' };

/** One row per spec file, in first-seen order. A test counts once per project it ran in, as the run's stats do. */
export function specRows(report: PlaywrightJsonReport): TestRunSpec[] {
  const rows = new Map<string, TestRunSpec>();
  const walk = (suite: PlaywrightJsonSuite) => {
    for (const spec of suite.specs ?? []) {
      const file = spec.file ?? suite.file;
      if (!file) continue;
      const row = rows.get(file) ?? { file, passed: 0, failed: 0, flaky: 0, skipped: 0, durationMs: 0 };
      for (const test of spec.tests ?? []) {
        const bucket = BUCKET[test.status ?? ''];
        if (bucket) row[bucket] += 1;
        row.durationMs += (test.results ?? []).reduce((sum, result) => sum + (result.duration ?? 0), 0);
      }
      rows.set(file, row);
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return [...rows.values()];
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** An error's first non-blank line, without color codes or this machine's checkout path, capped at 300 characters. */
export function errorLine(message: string | undefined, rootDir?: string): string | undefined {
  if (!message) return undefined;
  let line = message
    .replace(ANSI, '')
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return undefined;
  if (rootDir) {
    const root = rootDir.replace(/\/+$/, '');
    const parent = root.slice(0, root.lastIndexOf('/'));
    for (const dir of [root, parent]) if (dir) line = line.split(`${dir}/`).join('');
  }
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

/** The run's failed and flaky tests, failures first, each with the error that decided its outcome. */
export function problemRows(report: PlaywrightJsonReport): TestRunProblem[] {
  const out: TestRunProblem[] = [];
  const rootDir = report.config?.rootDir;
  const walk = (suite: PlaywrightJsonSuite, path: string[]) => {
    for (const spec of suite.specs ?? []) {
      const file = spec.file ?? suite.file;
      if (!file || !spec.title) continue;
      for (const test of spec.tests ?? []) {
        const outcome = test.status === 'unexpected' ? 'failed' : test.status === 'flaky' ? 'flaky' : null;
        if (!outcome) continue;
        const results = test.results ?? [];
        const decisive = outcome === 'failed' ? results.at(-1) : results.find((result) => result.status && result.status !== 'passed');
        const error = errorLine(decisive?.error?.message, rootDir);
        const title = [...path, spec.title].join(' › ');
        out.push({
          file,
          line: spec.line ?? 0,
          title: title.length > 500 ? `${title.slice(0, 499)}…` : title,
          ...(test.projectName ? { project: test.projectName.slice(0, 100) } : {}),
          outcome,
          ...(error ? { error } : {}),
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.title ? [...path, child.title] : path);
  };
  // The top-level suite is the file itself, so its title isn't part of a test's.
  for (const suite of report.suites ?? []) walk(suite, []);
  return out.sort((a, b) => Number(a.outcome === 'flaky') - Number(b.outcome === 'flaky')).slice(0, MAX_PROBLEMS);
}

/** The record for one run. Throws if the report has no start time, as from a run killed before the report was written. */
export function summarizeReport(report: PlaywrightJsonReport, context: TestRunContext): TestRunRecord {
  const stats = report.stats ?? {};
  if (!stats.startTime || stats.duration === undefined) throw new Error('the report has no run stats');
  const counts = { passed: stats.expected ?? 0, failed: stats.unexpected ?? 0, flaky: stats.flaky ?? 0, skipped: stats.skipped ?? 0 };
  return {
    startedAt: new Date(stats.startTime).toISOString(),
    durationMs: stats.duration,
    ...context,
    ...counts,
    // A full run selected every test, so the suite's size is what ran; on any other run it's unknown.
    ...(context.scope === 'full' ? { suiteSize: counts.passed + counts.failed + counts.flaky + counts.skipped } : {}),
    specs: specRows(report),
    problems: problemRows(report),
  };
}
