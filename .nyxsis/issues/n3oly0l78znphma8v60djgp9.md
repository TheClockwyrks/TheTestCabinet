---
format: nyxsis-issue
version: 3
id: n3oly0l78znphma8v60djgp9
zone: NYX
number: 35
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T19:16:19.043650592Z
modified: 2026-10-27T19:16:19.043650592Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`console.testcabinet.ai`: the submodule's branch
`issue/o7hwklyhcecnv0j6u9k4aavr` could not be rebased onto its target branch
`nightly`, so the rebase was aborted and the submodule stands clean on its
branch with nothing landed.

- The submodule: `console.testcabinet.ai`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `76e951a1dd046c21a22f015a81a7556f7b3a896c`.
- Its target branch: `nightly`, at `5d3ac3770f500a4e5a0aaf406f271933ab12fe2e`.

Git's output:

```text
the submodule `console.testcabinet.ai`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 76e951a1dd046c21a22f015a81a7556f7b3a896c could not be rebased onto its target branch `nightly` at 5d3ac3770f500a4e5a0aaf406f271933ab12fe2e:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/7)Rebasing (2/7)Rebasing (3/7)error: could not apply f2d6da1... ci: take the kit and the CI images built at ed9c9929f
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply f2d6da1... # ci: take the kit and the CI images built at ed9c9929f
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule
`console.testcabinet.ai` onto its target branch `nightly`, resolve each conflict
and continue the rebase until it completes, then close this issue. Once it is
closed, Nyxsis lands the branch again, the check command included.
