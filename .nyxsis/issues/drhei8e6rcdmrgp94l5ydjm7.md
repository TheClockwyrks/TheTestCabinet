---
format: nyxsis-issue
version: 3
id: drhei8e6rcdmrgp94l5ydjm7
zone: NYX
number: 30
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T18:53:40.020419303Z
modified: 2026-10-27T18:53:40.020419303Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`microservice-arena`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr`
could not be rebased onto its target branch `nightly`, so the rebase was aborted
and the submodule stands clean on its branch with nothing landed.

- The submodule: `microservice-arena`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `21f74456b1e3b4dbb1b9a1da20632d088f518ca7`.
- Its target branch: `nightly`, at `2dbc633a3e22e1fae2a0c0b3a31e4e36857a5938`.

Git's output:

```text
the submodule `microservice-arena`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 21f74456b1e3b4dbb1b9a1da20632d088f518ca7 could not be rebased onto its target branch `nightly` at 2dbc633a3e22e1fae2a0c0b3a31e4e36857a5938:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
warning: skipped previously applied commit def651e
warning: skipped previously applied commit 5f77249
hint: use --reapply-cherry-picks to include skipped commits
hint: Disable this message with "git config set advice.skippedCherryPicks false"
Rebasing (1/1)error: could not apply 21f7445... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 21f7445... # ci: take the kit and the CI images built at 6c195c0f2
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `microservice-arena`
onto its target branch `nightly`, resolve each conflict and continue the rebase
until it completes, then close this issue. Once it is closed, Nyxsis lands the
branch again, the check command included.
