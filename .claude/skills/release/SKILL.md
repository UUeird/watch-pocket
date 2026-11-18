---
name: release
description: "Ship open work: with no args, every open PR; pass a branch or PR number for just that one. Commit, push, check once on an integration branch holding every PR in scope, merge the PRs, clean up the branches, restart the dev server, confirm the GitHub Pages deploy, move the board tickets. Use when the user says 'release', 'ship it', 'land this'. There is no CI: the checks run locally (`npm run verify`, plus `npm run test:rules` for schema changes) once, on main's tip with every PR merged in, before merging anything; the gate for moving the board ticket to done is the merge and the Deploy run publishing that commit."
---

Take open work from branch to merged, deployed and cleaned up. There is no
CI: the checks and tests run here, locally, before the merge, which is much
faster.

### 0. Work out the scope

- **`/release <branch>` or `/release <PR#>`**: just that one.
- **No args**: every open PR (`gh pr list`), oldest first, unless one is
  stacked on another (release its base first). Skip bot PRs unless the user
  names them. Don't ask which one; release them all.
- Also check the current branch (`git status`, `git log main..HEAD`). If it has
  commits but no PR, open one first; it's in scope. If it has uncommitted
  work, commit it before starting.

Release them **together, checked once**: build one integration branch with
every PR in scope merged onto `main`'s tip, run the checks on it once, and only
if they pass merge the PRs in order. Nothing reaches `main` untested, and a
release of several PRs runs the checks once instead of once per PR. Then
confirm one deploy, of the last merge, which holds them all.

### 1. Finish and push each PR

For each PR in scope: commit any uncommitted work, push, and open the PR if
there isn't one, or refresh the body (`gh pr edit`) so it describes everything
on the branch.

### 2. Build the integration branch and check it once

Merge every PR branch onto `main`'s tip, in release order (base before
stacked), on a local scratch branch that is never pushed:

```
git checkout main && git pull --ff-only
git checkout -b release-verify
git merge --no-edit <branch-1>
git merge --no-edit <branch-2>   # …and so on
```

**On a conflict**, abort (`git merge --abort`) and fix it on the later PR's
branch (merge `main` or the earlier PR's branch into it there), push, delete
`release-verify` and rebuild. A resolution made only on the scratch branch
would never land.

Run the checks on `release-verify`. **Never merge known-red**: find which PR a
failure belongs to, fix it on that PR's branch, push, rebuild the integration
branch and run the checks again.
- `npm run verify` — type check, build (which also validates every data file
  against the schema), internal links and browser tests, in that order.
- `npm run test:rules` — as well, when any PR changed the schema or its rules.
  Stop the dev server first (`npx astro dev stop`); the script refuses to run
  otherwise.
- If another server holds port 4391, run the browser tests with
  `TEST_PORT=<free port>`.

Note in each PR's body which checks ran, on the integration branch.

### 3. Merge every PR, in order

Only after step 2 is green. If another open PR is stacked on a branch, retarget
it to `main` first (`gh pr edit <stacked> --base main`), since deleting a PR's
base branch closes that PR. Then, for each PR in release order:
`gh pr merge <PR#> --merge --delete-branch` (merge commits are the convention
here — see git history).

Then confirm that what landed is what was tested:

```
git checkout main && git pull --ff-only
git diff --stat release-verify main   # must print nothing
```

If it isn't empty, `main` moved while you were checking: stop merging, rebuild
the integration branch for the PRs still open and check it again.

### 4. Clean up the branches

```
git checkout main && git pull --ff-only
```

`--delete-branch` removes the remote branch and the local one. If a local
branch is left behind, `git branch -d <branch>`; if that *refuses*, stop and
check why instead of forcing `-D`. The one `-D` is the scratch branch:
`git branch -D release-verify`, once the diff above is empty.

### 5. Restart the dev server

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

### 6. Confirm the deploy

Each push to `main` starts the Deploy workflow, which builds that commit and
publishes it to GitHub Pages. After several merges, the run that matters is the
one for the **last** merge commit, which holds every PR (earlier runs may be
superseded). Wait for it, then check the live site:

```
gh run list --workflow Deploy --limit 1
gh run watch <id> --exit-status
curl -s -o /dev/null -w '%{http_code}\n' https://www.watchpocket.app/
```

The run's `headSha` (`gh run view <id> --json headSha`) should be the last
merge commit. If the deploy fails or the site doesn't return 200, stop and report.
If the Build job passed and only the Deploy step failed (a Pages timeout or
"Deployment cancelled", often during a GitHub outage), retry with a fresh run,
`gh workflow run Deploy --ref main`, once the user agrees. `gh run rerun` reuses
the canceled deployment's ID and gets canceled again.
This, not the merge, is the real "done" signal.

### 7. Move the board tickets

Only after step 6 passes, for each PR: if the released work corresponds to a story/subtask
on the tada board, move it to `done`: `mcp__tada__set_status` for the whole
story, or `mcp__tada__set_subtask_status` for just the subtask.

---

## After the release

Report what shipped: the integration run's checks and their result, once. Then
one line per PR: number, merged, branch cleaned up, board ticket moved. Then
the deploy (the run id and the commit it published). Then say the dev server was restarted,
and list anything left open and why. Don't claim a branch is done unless it's actually
merged and gone, and don't move a board ticket until step 6's check passes.
