---
format: nyxsis-issue
version: 3
id: fv1kiqh7dtoh5yi1oyllxtca
zone: CICD
number: 5
title: Run the engines' vitest suites from a worktree under .git
type: bug
priority: 2
state: open
created: 2026-10-27T20:38:43.866590217Z
modified: 2026-10-27T20:38:43.866590217Z
---

`workspace-test` fails every test file of the engines web packages when the
checkout is a Nyxsis worktree, which stands under the repository's `.git`
directory (`.git/nyxsis/worktrees/<id>/`). Each file fails with
`Error: Cannot find module '/src/<name>.test.ts'`, for example in
`engines/packages/simple-2d`. The same suites pass in the main checkout and in
CI, so the failure follows the path and not the code: it reproduces at the
engines pin before and after NYX-37's pin move.

The likely cause is Vite's default `server.fs.deny`, which holds `**/.git/**`.
Under a worktree, every source path matches it, so vite-node refuses to load
the test file. The engines' `vitest.config.ts` files set no `root` or
`server.fs` option.

Make the suites load from a checkout at any path, so that a dispatched session
can run the full gate set. One way is to scope the deny list to the package root
in the engines' vitest configs. Another is to move Nyxsis's worktrees out of
`.git`. Check the other npm workspaces for the same failure.

See the gates in
[`development/building.md`](../../apps/docs/src/content/docs/development/building.md).
