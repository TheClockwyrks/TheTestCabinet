---
format: nyxsis-issue
version: 3
id: p4k2srx9r3aeuz7yxfbc5zlq
zone: NYX
number: 34
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T19:12:23.09990997Z
modified: 2026-10-27T19:13:18.986068198Z
done: 2026-10-27T19:13:18.986068198Z
outcome: |
  Rebased the `contracts` submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` onto
  `nightly` at 8f9d640. The branch's only commit, e7cf3ca ("ci: take the kit and
  the CI images built at 6c195c0f2"), conflicted in `.copier-answers.yml` and
  `azure-pipelines.yml` with nightly's ddc37a2, which took the kit and CI images
  built at 2610dc98c. 2610dc98c descends from 6c195c0f2, so its Rust image already
  includes PostgreSQL. The kit's `templates/repository` is identical at both kit
  commits, and the CLAUDE.md change from both sides merged without conflict.
  Taking nightly's side therefore keeps both intents. The commit became empty and
  was dropped, so the branch now stands at nightly's 8f9d640. The superrepo
  records the new pin in 90d0e0b75. No gates were run inside `contracts` because
  its tree is identical to nightly. Nothing is left.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`contracts`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not
be rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `contracts`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `e7cf3ca7cea29c982d244a7f719da204ee3a8b10`.
- Its target branch: `nightly`, at `8f9d640482279624cdb623eaf67fcd309ade801f`.

Git's output:

```text
the submodule `contracts`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at e7cf3ca7cea29c982d244a7f719da204ee3a8b10 could not be rebased onto its target branch `nightly` at 8f9d640482279624cdb623eaf67fcd309ade801f:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply e7cf3ca... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply e7cf3ca... # ci: take the kit and the CI images built at 6c195c0f2
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `contracts` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
