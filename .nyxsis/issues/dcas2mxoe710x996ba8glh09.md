---
format: nyxsis-issue
version: 3
id: dcas2mxoe710x996ba8glh09
zone: NYX
number: 16
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:08:17.329141509Z
modified: 2026-10-26T22:10:08.331196082Z
done: 2026-10-26T22:10:08.331196082Z
outcome: |
  Rebased `tool-sfx-sample`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` onto
  `nightly` (86186bb), replaying its own work past c6dd217 (the commit 54cff91,
  now 1075ef5) alone, and recorded the new commit in the superrepo.

  The two conflicts were the kit commit in `.copier-answers.yml` and the CI image
  pins in `azure-pipelines.yml`. Both take the branch's values: `_commit:
  v0.6.3-5579-g9ecc82fe9`, and the rust and web images at
  `6c195c0f290db7a98daa4bc811ae915cfcfd889c`. Everything else in
  `azure-pipelines.yml` stays as `nightly` has it. The two `npm-feed.sh` steps and
  their comment come from master's kit updates 34dac66 and 508f0b1, which
  `nightly` doesn't hold, so they were not carried over. The CLAUDE.md change
  applied cleanly.

  What was left: master's earlier kit updates (34dac66, 508f0b1: the npm-feed
  steps, the `ci/` edges and wiring tests, and the `scripts/ci` changes) are still
  not on `nightly`. They reach it through master's own flow, not through this
  branch. Note that `.copier-answers.yml` on the branch now records the kit at
  9ecc82fe9 even though those intermediate renders are missing.

  Gates: ci-tests, format, markdownlint, no-nul-bytes, python-lint, shell-tests,
  dependency-edges and build-context passed. cspell fails, but it fails the same
  way on `nightly` itself: `npm run spell` runs `cspell lint` with no globs and
  prints its usage. The Rust gates were not run because the change touches no
  Rust.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-sfx-sample`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could
not be rebased onto its target branch `nightly`, so the rebase was aborted and
the submodule stands clean on its branch with nothing landed.

- The submodule: `tool-sfx-sample`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `54cff91485d500fa2ec828d7c06064b65a5af067`.
- Its target branch: `nightly`, at `86186bb4fa0e6e1eead29d885ef451717986fe96`.

Git's output:

```text
the submodule `tool-sfx-sample`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 54cff91485d500fa2ec828d7c06064b65a5af067 could not be rebased onto its target branch `nightly` at 86186bb4fa0e6e1eead29d885ef451717986fe96, its work past the commit c6dd21710773cf838acac554c1b5f49434efbf40 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 54cff91... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 54cff91... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-sfx-synth`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-sfx-sample` onto
its target branch `nightly`, resolve each conflict and continue the rebase until
it completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
