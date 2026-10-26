---
format: nyxsis-issue
version: 3
id: m9vfkxzpvl88p5rmwx3ldzgl
zone: NYX
number: 18
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:31:25.063429935Z
modified: 2026-10-26T22:31:25.063429935Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-paint`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not
be rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `tool-paint`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `685c166824aea2c134f59d85cb6b9cbb1c79f919`.
- Its target branch: `nightly`, at `3346d5df92070ae4f438475fc6c8be5dbd896bb0`.

Git's output:

```text
the submodule `tool-paint`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 685c166824aea2c134f59d85cb6b9cbb1c79f919 could not be rebased onto its target branch `nightly` at 3346d5df92070ae4f438475fc6c8be5dbd896bb0, its work past the commit 103a96d8085bb0cd6276a98e0a2c3821c94248ce the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 685c166... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 685c166... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-particle`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-paint` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
