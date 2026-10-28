---
format: nyxsis-issue
version: 3
id: b56dvmjd8rvrbk2zlvxgoom6
zone: NYX
number: 21
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:47:18.350465593Z
modified: 2026-10-26T22:49:53.368390138Z
done: 2026-10-26T22:49:53.368390138Z
outcome: |
  Rebased `tool-mc`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` onto `nightly`
  (44d9f3c): its one commit, "ci: take the kit and the CI images built at
  6c195c0f2", now stands at f6eb343 on top of nightly, and the superrepo records
  it in f04b98a6f. The superrepo branch already contained `nightly`.

  The conflicts in `.copier-answers.yml` and `azure-pipelines.yml` came from
  nightly lacking the two kit renders master took at ed9c9929f and 32214df70 (the
  npm feed credential for image builds, the edge walk leaving out a crate's case
  copies, and their tests). Nightly differs from the original commit only in
  kit-rendered files, so the resolution takes the commit's full kit state at
  9ecc82fe9: the image pins at 6c195c0f2, those earlier renders, and the CLAUDE.md
  change. That way the rendered files agree with the kit version
  `.copier-answers.yml` records. The commit message says so.

  Gates in tool-mc: build-context, ci-tests (311 passed), dependency-edges,
  format, markdownlint, no-nul-bytes, python-lint, shell-tests and rust-fmt pass.
  cspell fails before checking anything, because the `spell` npm script runs
  `cspell lint` with no glob and only prints usage. That comes from nightly: the
  change touches no file it reads. rust-clippy, rust-doc, rust-test and typescript
  were not run because the change touches no Rust or TypeScript.

  Left: the submodule branch is not pushed (the remote has no such branch yet), so
  the landing pushes it.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-mc`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not be
rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `tool-mc`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `8aa011a52196acc458ea46353c9bbc911e5a3e83`.
- Its target branch: `nightly`, at `44d9f3c073a61d14b2ec31739139476bc65e6b15`.

Git's output:

```text
the submodule `tool-mc`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 8aa011a52196acc458ea46353c9bbc911e5a3e83 could not be rebased onto its target branch `nightly` at 44d9f3c073a61d14b2ec31739139476bc65e6b15, its work past the commit c6387a19fc62be635355e28ec75f71ae25f90144 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 8aa011a... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 8aa011a... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-model-core`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-mc` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
