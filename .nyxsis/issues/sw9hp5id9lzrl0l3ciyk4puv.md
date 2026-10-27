---
format: nyxsis-issue
version: 3
id: sw9hp5id9lzrl0l3ciyk4puv
zone: NYX
number: 38
title: Resolve the conflict landing NYX-37
type: conflict
priority: 0
state: open
branch: issue/pirgps90ev3ruerfcjaeqbwh
created: 2026-10-27T20:44:52.888892276Z
modified: 2026-10-27T20:44:52.888892276Z
---

The landing of NYX-37 stopped at the rebase: rebasing
`issue/pirgps90ev3ruerfcjaeqbwh` onto `nightly` conflicted, so the rebase was
aborted and the worktree stands clean on its branch with nothing landed.

- The worktree's branch: `issue/pirgps90ev3ruerfcjaeqbwh`, at
  `e4398ca7dabad34a509a215047a741aba73851bf`.
- The branch it lands on: `nightly`, at
  `d197d28f93002844ce812fae900cf58d540d5df1`.

Git's conflict output:

```text
Merge conflict in tool-sfx-synth
Failed to merge submodule tool-sn (commits don't follow merge-base)
CONFLICT (submodule): Merge conflict in tool-sn
Failed to merge submodule tool-sprite (commits don't follow merge-base)
CONFLICT (submodule): Merge conflict in tool-sprite
Failed to merge submodule tool-voxel (commits don't follow merge-base)
CONFLICT (submodule): Merge conflict in tool-voxel
Note: Fast-forwarding submodule ui-common to e14cfce8bf64d8f7c34fbeb82a951b995eba40c8
Rebasing (1/3)hint: Recursive merging with submodules currently only supports trivial cases.
hint: Please manually handle the merging of each conflicted submodule.
hint: This can be accomplished with the following steps:
hint:  - go to submodule (tool-voxel), and either merge commit 98a26f1
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-sprite), and either merge commit c076e51
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-sn), and either merge commit 2e290c7
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-sfx-synth), and either merge commit c31514b
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-sfx-sample), and either merge commit 9984de7
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-particle), and either merge commit 0905990
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-paint), and either merge commit f67a788
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-music), and either merge commit 3201d65
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-model-core), and either merge commit 168179c
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-mc), and either merge commit f4660da
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-dc), and either merge commit 312a219
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (tool-audio-core), and either merge commit b82fc0b
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (gg), and either merge commit 60703013
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (gg.rocks), and either merge commit fedcd59
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (console.testcabinet.ai), and either merge commit cd72112
hint:    or update to an existing commit which has merged those changes
hint:  - go to submodule (client-tauri), and either merge commit 2e1b11f
hint:    or update to an existing commit which has merged those changes
hint:  - come back to superproject and run:
hint:
hint:       git add tool-voxel tool-sprite tool-sn tool-sfx-synth tool-sfx-sample tool-particle tool-paint tool-music tool-model-core tool-mc tool-dc tool-audio-core gg gg.rocks console.testcabinet.ai client-tauri
hint:
hint:    to record the above merge or update
hint:  - resolve any other conflicts in the superproject
hint:  - commit the resulting index in the superproject
hint:
hint: Disable this message with "git config set advice.submoduleMergeConflict false"
error: could not apply 9af41dd71... fix(ci): take the CI images built at 2610dc98c in every repository
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 9af41dd71... # fix(ci): take the CI images built at 2610dc98c in every repository
```

Rebase `issue/pirgps90ev3ruerfcjaeqbwh` onto `nightly` in this worktree, resolve
each conflict and continue the rebase until it completes, then close this issue.
Once it is closed, Nyxsis lands the branch again, the check command included.
