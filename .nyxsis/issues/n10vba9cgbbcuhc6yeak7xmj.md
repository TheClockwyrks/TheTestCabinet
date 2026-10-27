---
format: nyxsis-issue
version: 3
id: n10vba9cgbbcuhc6yeak7xmj
zone: NYX
number: 31
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T18:57:18.20325185Z
modified: 2026-10-27T18:57:18.20325185Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`gg.rocks`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not be
rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `gg.rocks`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `e72fa7589548a20fe498f02b03af347ece8af620`.
- Its target branch: `nightly`, at `8bdce0151c418e71e6bd24684f9909d2ad2374d8`.

Git's output:

```text
the submodule `gg.rocks`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at e72fa7589548a20fe498f02b03af347ece8af620 could not be rebased onto its target branch `nightly` at 8bdce0151c418e71e6bd24684f9909d2ad2374d8, its work past the commit 3f0ea4778f152e23622934a3fb288be91e09ca95 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply e72fa75... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply e72fa75... # ci: take the kit and the CI images built at 6c195c0f2
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `gg.rocks` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
