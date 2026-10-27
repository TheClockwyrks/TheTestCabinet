---
format: nyxsis-issue
version: 3
id: mtdl44k0mdj9tiahzyxkzobp
zone: NYX
number: 36
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T19:22:55.17511344Z
modified: 2026-10-27T19:22:55.17511344Z
---

The landing of NYX-8 stopped at the rebase: rebasing
`issue/o7hwklyhcecnv0j6u9k4aavr` onto `nightly` conflicted, so the rebase was
aborted and the worktree stands clean on its branch with nothing landed.

- The worktree's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `dcb43311b50b449f8deeb499412d306194dbd8aa`.
- The branch it lands on: `nightly`, at
  `a8d4c5a7d00b0944f2fe2dd9dda8242946fb542c`.

Git's conflict output:

```text
Failed to merge submodule console.testcabinet.ai (commits don't follow merge-base)
CONFLICT (submodule): Merge conflict in console.testcabinet.ai
Failed to merge submodule engines
CONFLICT (submodule): Merge conflict in engines
Failed to merge submodule microservice-arena
CONFLICT (submodule): Merge conflict in microservice-arena
Failed to merge submodule microservice-artifacts
CONFLICT (submodule): Merge conflict in microservice-artifacts
Failed to merge submodule microservice-dispatcher
CONFLICT (submodule): Merge conflict in microservice-dispatcher
Note: Fast-forwarding submodule microservice-repos to c34051bb2237e0b9cc130e5459cd6f224cdbc494
Rebasing (1/154)Rebasing (2/154)Executing: git ls-files -s | while read -r m s t p; do [ "$m" = 160000 ] || continue; n=$(printf '%s\n' "$NYXSIS_REPLACED" | sed -n "s/^$s //p"); [ -z "$n" ] || git update-index --cacheinfo "160000,$n,$p" || exit 1; done && { git diff --cached --quiet --ignore-submodules=none || git -c core.hooksPath=/dev/null commit --amend --no-edit --no-verify --quiet --allow-empty --cleanup=verbatim; }
Rebasing (3/154)hint: Recursive merging with submodules currently only supports trivial cases.
hint: Please manually handle the merging of each conflicted submodule.
hint: This can be accomplished with the following steps:
hint:  - go to submodule (microservice-dispatcher), and either merge commit 3afa9de
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (microservice-artifacts), and either merge commit 9eb3e8b
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (microservice-arena), and either merge commit 21f7445
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (engines), and either merge commit 6a36386
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (console.testcabinet.ai), and either merge commit 76e951a
hint:    or update to an existing commit which has merged those changes
hint:  - come back to superproject and run:
hint:
hint:       git add microservice-dispatcher microservice-artifacts microservice-arena engines console.testcabinet.ai
hint:
hint:    to record the above merge or update
hint:  - resolve any other conflicts in the superproject
hint:  - commit the resulting index in the superproject
hint:
hint: Disable this message with "git config set advice.submoduleMergeConflict false"
error: could not apply 763cafda9... chore(repos): take every repository onto the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 763cafda9... # chore(repos): take every repository onto the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of these submodules to each one's remote, which therefore holds each work no commit on the main checkout's upstream records yet: `console.testcabinet.ai`, `client-tauri`
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` onto `nightly` in this worktree, resolve
each conflict and continue the rebase until it completes, then close this issue.
Once it is closed, Nyxsis lands the branch again, the check command included.
