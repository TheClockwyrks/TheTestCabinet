---
format: nyxsis-issue
version: 3
id: e13r04sghrwfpxmtnhxp0tid
zone: NYX
number: 27
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T18:39:54.934592574Z
modified: 2026-10-27T18:39:54.934592574Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`microservice-driver`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr`
could not be rebased onto its target branch `nightly`, so the rebase was aborted
and the submodule stands clean on its branch with nothing landed.

- The submodule: `microservice-driver`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `3fb0a6ddf56ee64eb60391cf2bdbebbf84c06c92`.
- Its target branch: `nightly`, at `886808fcb3512988093d4cf1d1ad26a509046c6d`.

Git's output:

```text
the submodule `microservice-driver`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 3fb0a6ddf56ee64eb60391cf2bdbebbf84c06c92 could not be rebased onto its target branch `nightly` at 886808fcb3512988093d4cf1d1ad26a509046c6d:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Auto-merging ci/tests/test_wiring.py
CONFLICT (content): Merge conflict in ci/tests/test_wiring.py
Rebasing (1/1)error: could not apply 3fb0a6d... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 3fb0a6d... # ci: take the kit and the CI images built at 6c195c0f2
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `microservice-driver`
onto its target branch `nightly`, resolve each conflict and continue the rebase
until it completes, then close this issue. Once it is closed, Nyxsis lands the
branch again, the check command included.
