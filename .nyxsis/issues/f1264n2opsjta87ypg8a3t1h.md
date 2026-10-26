---
format: nyxsis-issue
version: 3
id: f1264n2opsjta87ypg8a3t1h
zone: NYX
number: 20
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:42:05.918773019Z
modified: 2026-10-26T22:43:44.076579096Z
done: 2026-10-26T22:43:44.076579096Z
outcome: |
  Rebased `tool-model-core`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` onto
  `nightly` (f9765f3). Its one commit past 69f86d7 was replayed as b43537f "ci:
  take the kit and the CI images built at 6c195c0f2". Both conflicts were resolved
  by taking the branch's newer values. `.copier-answers.yml` now records the kit
  at `v0.6.3-5579-g9ecc82fe9`. `azure-pipelines.yml` pins both CI images at
  `6c195c0f290db7a98daa4bc811ae915cfcfd889c`. The CLAUDE.md change applied
  cleanly. Master's earlier commits (the contracts pins v0.2.3 and v0.2.4 and the
  CI image bumps at ed9c9929f and 32214df70) are not on `nightly` and were left
  out on purpose. They reach `nightly` through master's own flow, as they did for
  `tool-music` in NYX-19. The superrepo records the new submodule commit in
  e55eca6b0.

  Gates run in `tool-model-core` after `npm ci`: ci-tests, dependency-edges,
  format, markdownlint, no-nul-bytes, python-lint and shell-tests pass. cspell
  fails with a usage error from the cspell CLI. It fails the same way at
  `nightly`'s own commit f9765f3, so this change did not cause it, and it is left
  as is. The Rust and typescript gates were not run because the change touches
  neither.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-model-core`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could
not be rebased onto its target branch `nightly`, so the rebase was aborted and
the submodule stands clean on its branch with nothing landed.

- The submodule: `tool-model-core`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `2dc3402da2e6bdcba0d9e75f628fcc3890ecabf7`.
- Its target branch: `nightly`, at `f9765f331b5f8e80d0cc40748059d86f42e05896`.

Git's output:

```text
the submodule `tool-model-core`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 2dc3402da2e6bdcba0d9e75f628fcc3890ecabf7 could not be rebased onto its target branch `nightly` at f9765f331b5f8e80d0cc40748059d86f42e05896, its work past the commit 69f86d7872e83d202a53d79df40230302eb09ec6 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 2dc3402... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 2dc3402... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-music`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-model-core` onto
its target branch `nightly`, resolve each conflict and continue the rebase until
it completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
