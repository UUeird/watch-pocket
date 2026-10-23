// A Playwright reporter whose only job is to upload each run's summary to the tada board (see test-run-upload.ts,
// which never fails the run). It works in onExit, which Playwright calls once every reporter has finished, so the
// JSON report it reads is this run's; globalTeardown runs before reports are written and would read the last one.
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUITE_PROJECT, uploadRun } from './test-run-upload';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface UploadReporterOptions {
  // This run's JSON report, relative to the repo root.
  resultsFile?: string;
}

class UploadReporter implements Reporter {
  private readonly options: UploadReporterOptions;
  private status = 'unknown';
  // Runs of the docs-media project capture screenshots for the Docs pages; they aren't the test suite.
  private suite = true;

  constructor(options: UploadReporterOptions = {}) {
    this.options = options;
  }

  printsToStdio(): boolean {
    return false;
  }

  // The root suite holds one suite per project that is running.
  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite.suites.some((child) => child.project()?.name === SUITE_PROJECT);
  }

  onEnd(result: FullResult): void {
    this.status = result.status;
  }

  async onExit(): Promise<void> {
    if (!this.options.resultsFile || !this.suite) return;
    await uploadRun({
      resultsFile: path.resolve(ROOT, this.options.resultsFile),
      queueFile: path.join(ROOT, 'playwright-report', 'upload-queue.json'),
      status: this.status,
      envFile: path.join(ROOT, '.env.local'),
      cwd: ROOT,
    });
  }
}

export default UploadReporter;
