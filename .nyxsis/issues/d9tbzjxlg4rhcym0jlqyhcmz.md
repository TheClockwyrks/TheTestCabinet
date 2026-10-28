---
format: nyxsis-issue
version: 3
id: d9tbzjxlg4rhcym0jlqyhcmz
zone: NYX
number: 17
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:13:46.028989415Z
modified: 2026-10-26T22:27:54.218719267Z
done: 2026-10-26T22:27:54.218719267Z
outcome: |
  Cause: `tool-particle`'s `nightly` (9553ce9) had not yet taken master's two
  earlier kit updates, 00a92d8 (ciImageTag ed9c9929f) and 43a556c (32214df70). The
  superrepo's `nightly` records master's 6b70638 for the submodule, so the landing
  replayed 7383b49 on its own onto a `nightly` that was missing the commits it
  builds on, and both `.copier-answers.yml` and `azure-pipelines.yml` conflicted.

  Done:

  - `tool-particle`: `issue/o7hwklyhcecnv0j6u9k4aavr` is now one commit, 140a864,
    on `nightly` 9553ce9. Its tree is identical to 7383b49's, so it carries both
    master's earlier kit updates and NYX-8's update to 6c195c0f2. I tried the
    landing's replay (`rebase --onto nightly 6b70638`) and it applies cleanly. The
    submodule's gates pass except cspell. cspell fails the same way at 7383b49:
    the `spell` script hits a cspell 10 usage error.
  - Superrepo: rebased `issue/o7hwklyhcecnv0j6u9k4aavr` onto `nightly` 3476d1d4b.
    Four gitlinks conflicted: contracts, engines, microservice-arena and
    ui-common. For contracts, engines and microservice-arena I rebased each
    submodule's issue branch onto its `nightly`, to e7cf3ca, 6a36386 and 21f7445.
    Each resulting tree is exactly the old branch plus `nightly`'s own work.
    ui-common takes 276cffd9, its landed commit, which already contains both
    sides. NYX-8's issue file keeps the branch's done state and outcome together
    with `nightly`'s Cause and Repair sections.
  - I also ran the landing's replay for engines, microservice-arena, contracts and
    ui-common, each against the commit `nightly` records, and all four apply
    cleanly.

  Left:

  - Superrepo gates: 18 of 22 pass, including rust-test with 1522 tests. Four
    fail, all for reasons that were already there. `dependency-graph` and two
    ci-tests: `.package-links.json` lacks `@clockwyrks/preview-tags` and
    `@clockwyrks/share-links`, which NYX-8 had already found stale. `markdownlint`
    and one ci-test: long lines of git output in the conflict issue files Nyxsis
    writes. `workspace-test`: 90 engines vitest files can't resolve `/src/...` in
    a checkout under `.git/nyxsis/worktrees/`, as NYX-8 recorded.
  - Nothing is pushed. The submodule branches must reach their remotes before the
    superrepo's push, so that `submodule-remotes` admits it.
  - On `nightly`, NYX-8 is blocked on an operator decision about which branch each
    repository's render lands on. This branch closes it, and the landing that is
    now underway lands that work onto `nightly`.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-particle`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could
not be rebased onto its target branch `nightly`, so the rebase was aborted and
the submodule stands clean on its branch with nothing landed.

- The submodule: `tool-particle`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `7383b49ade15f93e170a7fe12dfd9893660b28e5`.
- Its target branch: `nightly`, at `9553ce97594c3e0ce70d5bd7783d4823e13fdc3c`.

Git's output:

```text
the submodule `tool-particle`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 7383b49ade15f93e170a7fe12dfd9893660b28e5 could not be rebased onto its target branch `nightly` at 9553ce97594c3e0ce70d5bd7783d4823e13fdc3c, its work past the commit 6b70638f341b8247ffbec5d169ae86e5d367066d the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 7383b49... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 7383b49... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-sfx-sample`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-particle` onto
its target branch `nightly`, resolve each conflict and continue the rebase until
it completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
