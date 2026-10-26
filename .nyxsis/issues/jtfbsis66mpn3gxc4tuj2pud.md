---
format: nyxsis-issue
version: 3
id: jtfbsis66mpn3gxc4tuj2pud
zone: NYX
number: 13
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T21:40:04.39705979Z
modified: 2026-10-26T21:40:04.39705979Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-sprite`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not
be rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `tool-sprite`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `05f7fa24e3395d908edae5fe1b9c9bf0005b1ee1`.
- Its target branch: `nightly`, at `d784be5f453fe77467df85cc8df62409f5890f29`.

Git's output:

```text
the submodule `tool-sprite`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 05f7fa24e3395d908edae5fe1b9c9bf0005b1ee1 could not be rebased onto its target branch `nightly` at d784be5f453fe77467df85cc8df62409f5890f29, its work past the commit a0659e8da6e06b07737b5a3dd061bf19f8d57ef5 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 05f7fa2... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 05f7fa2... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-voxel`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-sprite` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
