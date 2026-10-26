---
format: nyxsis-issue
version: 3
id: z7vnlfsdw0te7st8ir5vjk5z
zone: NYX
number: 22
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:54:04.629416908Z
modified: 2026-10-26T22:54:04.629416908Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-dc`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not be
rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `tool-dc`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `a9f9274dd6bfba27dac7d69a8a59d03cbb5f9f3f`.
- Its target branch: `nightly`, at `416560430be57cd1d02483818261745d1bcdcfae`.

Git's output:

```text
the submodule `tool-dc`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at a9f9274dd6bfba27dac7d69a8a59d03cbb5f9f3f could not be rebased onto its target branch `nightly` at 416560430be57cd1d02483818261745d1bcdcfae, its work past the commit 85f195144ab2cff9e7bd8b280b051d67833fadb1 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply a9f9274... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply a9f9274... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-mc`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-dc` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
