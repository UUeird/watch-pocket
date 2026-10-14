---
name: release
description: "Ship open work: commit, push, open/merge the PR, clean up the branch, restart the dev server, confirm the GitHub Pages deploy, move the board ticket. Use when the user says 'release', 'ship it', 'land this'. The PR check is the 'Checks and tests' CI job; the gate for moving the board ticket to done is the merge, a green CI run on main, and the Deploy run publishing that commit."
---

Take one piece of open work from branch to merged and cleaned up. The
"Checks and tests" job (`.github/workflows/ci.yml`) runs automatically on every
pull request and on pushes to `main` — nothing to configure, just wait for it.
This is a single-PR flow with no batching.

### 1. Finish and push

- If there's uncommitted or unpushed work, commit it. **Never push known-red** —
  run the checks that cover what changed first, and fix any failure in the same
  commit before pushing:
  - `npm run check` — type check. Run it for any code change.
  - `npm run build` — also validates every data file against the schema.
  - `npm run test:links` and `npm run test:browser` — both run against the
    build, so build first.
  - `npm run test:rules` — only when the schema or its rules changed. Stop the
    dev server first (`npx astro dev stop`); the script refuses to run otherwise.
- Open the PR if there isn't one, or refresh the body (`gh pr edit`) so it
  describes everything on the branch.

### 2. Merge

- Wait for `gh pr checks <PR#>` to go green. Don't merge over a red or
  still-pending one — poll, don't guess.
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
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/watch-pocket/
```

Check a couple of other pages too (`/references/`, a brand page). Don't report
the release as done until they return 200.

### 5. Confirm main is green

Merging to `main` triggers the same CI job on the merge commit. Wait for it:

```
gh run list --branch main --limit 1
```

If it fails, stop and report — don't move the board ticket.

### 6. Confirm the deploy

A green CI run on `main` starts the Deploy workflow, which publishes that commit
to GitHub Pages. Wait for it, then check the live site:

```
gh run list --workflow Deploy --limit 1
curl -s -o /dev/null -w '%{http_code}\n' https://uueird.github.io/watch-pocket/
```

The run's `headSha` (`gh run view <id> --json headSha`) should be the merge
commit. If the deploy fails or the site doesn't return 200, stop and report.
This, not the merge, is the real "done" signal.

### 7. Move the board ticket

Only after step 6 passes: if the released work corresponds to a story/subtask
on the tada board, move it to `done`: `mcp__tada__set_status` for the whole
story, or `mcp__tada__set_subtask_status` for just the subtask.

---

## After the release

Report what shipped: PR number, merged, CI on main, deployed, branch cleaned
up, dev server restarted. Don't claim a branch is done unless it's actually
merged and gone, and don't move the board ticket until step 6's check passes.
