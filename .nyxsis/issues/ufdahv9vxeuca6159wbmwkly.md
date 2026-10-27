---
format: nyxsis-issue
version: 3
id: ufdahv9vxeuca6159wbmwkly
zone: NYX
number: 26
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T18:35:59.535765917Z
modified: 2026-10-27T18:35:59.535765917Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`microservice-publisher`: the submodule's branch
`issue/o7hwklyhcecnv0j6u9k4aavr` could not be rebased onto its target branch
`nightly`, so the rebase was aborted and the submodule stands clean on its
branch with nothing landed.

- The submodule: `microservice-publisher`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `d19ac790008d32f2bc9386f6f789ea264b20f375`.
- Its target branch: `nightly`, at `e5645c7bcec386a4f3a552a45414b4897f983de0`.

Git's output:

```text
the submodule `microservice-publisher`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at d19ac790008d32f2bc9386f6f789ea264b20f375 could not be rebased onto its target branch `nightly` at e5645c7bcec386a4f3a552a45414b4897f983de0:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply d19ac79... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply d19ac79... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `microservice-repos`
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule
`microservice-publisher` onto its target branch `nightly`, resolve each conflict
and continue the rebase until it completes, then close this issue. Once it is
closed, Nyxsis lands the branch again, the check command included.
