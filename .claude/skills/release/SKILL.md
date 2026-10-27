---
name: release
description: "Ship open work: commit, push, open/merge the PR, clean up the branch, restart the dev server, confirm the GitHub Pages deploy, move the board ticket. Use when the user says 'release', 'ship it', 'land this'. There is no CI: the checks run locally (`npm run verify`, plus `npm run test:rules` for schema changes) on the branch with main merged in, before merging; the gate for moving the board ticket to done is the merge and the Deploy run publishing that commit."
---

Take one piece of open work from branch to merged and cleaned up. There is no
CI: the checks and tests run here, locally, before the merge, which is much
faster. This is a single-PR flow with no batching.

### 1. Finish, check and push

- If there's uncommitted work, commit it.
- Merge `main` into the branch (`git merge main`) if it has moved on, so the
  checks cover what will land. Resolve any conflict and commit the merge.
- Run the checks on that result. **Never merge known-red** — fix any failure on
  the branch and run them again:
  - `npm run verify` — type check, build (which also validates every data file
    against the schema), internal links and browser tests, in that order.
  - `npm run test:rules` — as well, when the schema or its rules changed. Stop the
    dev server first (`npx astro dev stop`); the script refuses to run otherwise.
  - If another server holds port 4391, run the browser tests with
    `TEST_PORT=<free port>`.
- Push, and open the PR if there isn't one, or refresh the body (`gh pr edit`)
  so it describes everything on the branch and says which checks ran.

### 2. Merge

- Merge with `gh pr merge <PR#> --merge --delete-branch` (merge commits are the
  convention here — see git history).

### 3. Clean up the branch

```
git checkout main && git pull --ff-only
```

`--delete-branch` removes the remote branch and the local one. If a local
branch is left behind, `git branch -d <branch>`; if that *refuses*, stop and
check why instead of forcing `-D`.

### 4. Restart the dev server

Switching branches removes and restores the page files, and a running dev
server is left answering 404 or 500 afterward. Restart it and confirm it serves:

```
npx astro dev stop
rm -rf .astro node_modules/.astro
npm run dev          # detaches into the background
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/
```

Check a couple of other pages too (`/references/`, a brand page). Don't report
the release as done until they return 200.

### 5. Confirm the deploy

Each push to `main` starts the Deploy workflow, which builds that commit and
publishes it to GitHub Pages. Wait for it, then check the live site:

```
gh run list --workflow Deploy --limit 1
gh run watch <id> --exit-status
curl -s -o /dev/null -w '%{http_code}\n' https://www.watchpocket.app/
```

The run's `headSha` (`gh run view <id> --json headSha`) should be the merge
commit. If the deploy fails or the site doesn't return 200, stop and report.
This, not the merge, is the real "done" signal. Releasing several PRs, wait for
each one's deploy before merging the next.

### 6. Move the board ticket

Only after step 5 passes: if the released work corresponds to a story/subtask
on the tada board, move it to `done`: `mcp__tada__set_status` for the whole
story, or `mcp__tada__set_subtask_status` for just the subtask.

---

## After the release

Report what shipped: PR number, checks run, merged, deployed, branch cleaned
up, dev server restarted. Don't claim a branch is done unless it's actually
merged and gone, and don't move the board ticket until step 5's check passes.
