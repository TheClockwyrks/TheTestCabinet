---
format: nyxsis-issue
version: 3
id: saa7urrfeqtgdk2hweyr2jch
zone: NYX
number: 11
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T21:27:24.814560052Z
modified: 2026-10-26T21:27:24.814560052Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-voxel`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not
be rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `tool-voxel`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `7d3889140ac1c6c2a70bedd19e0b65f7ae013b30`.
- Its target branch: `nightly`, at `990f19a26a9a5e0b96ceb9b3adaa46185385fbf5`.

Git's output:

```text
the submodule `tool-voxel`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 7d3889140ac1c6c2a70bedd19e0b65f7ae013b30 could not be rebased onto its target branch `nightly` at 990f19a26a9a5e0b96ceb9b3adaa46185385fbf5, its work past the commit 1badff44c62ea5dad9f1b0563f24be44eb3b46c4 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 7d38891... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 7d38891... # ci: take the kit and the CI images built at 6c195c0f2
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-voxel` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
