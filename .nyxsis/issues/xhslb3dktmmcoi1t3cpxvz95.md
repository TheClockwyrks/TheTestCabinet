---
format: nyxsis-issue
version: 3
id: xhslb3dktmmcoi1t3cpxvz95
zone: NYX
number: 33
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T19:08:03.940581509Z
modified: 2026-10-27T19:08:03.940581509Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`engines`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not be
rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `engines`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `6a36386aacf9140a2851d1e0454850493433e131`.
- Its target branch: `nightly`, at `d47b0440e6fb6b0e4cd962fb690b477b2d1bc45d`.

Git's output:

```text
the submodule `engines`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 6a36386aacf9140a2851d1e0454850493433e131 could not be rebased onto its target branch `nightly` at d47b0440e6fb6b0e4cd962fb690b477b2d1bc45d:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
warning: skipped previously applied commit 45f34c4
warning: skipped previously applied commit 84cdad9
warning: skipped previously applied commit 7d2481f
warning: skipped previously applied commit fac913d
warning: skipped previously applied commit 5efa0db
warning: skipped previously applied commit da02bbb
warning: skipped previously applied commit 4402ad4
warning: skipped previously applied commit 9a8a69e
warning: skipped previously applied commit 2890e5a
warning: skipped previously applied commit be75eaf
warning: skipped previously applied commit c298d8b
warning: skipped previously applied commit 498dccb
warning: skipped previously applied commit 16f22ad
hint: use --reapply-cherry-picks to include skipped commits
hint: Disable this message with "git config set advice.skippedCherryPicks false"
Rebasing (1/1)error: could not apply 6a36386... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 6a36386... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `gg`
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `engines` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
