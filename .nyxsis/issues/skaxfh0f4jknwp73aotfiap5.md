---
format: nyxsis-issue
version: 3
id: skaxfh0f4jknwp73aotfiap5
zone: NYX
number: 19
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:36:48.666311616Z
modified: 2026-10-26T22:36:48.666311616Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-music`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not
be rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `tool-music`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `21b7b627cc648d2b0f2b37760098a1d259cb909d`.
- Its target branch: `nightly`, at `412a48fb245770fbd3b5720b7e3cafef0f3b824e`.

Git's output:

```text
the submodule `tool-music`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 21b7b627cc648d2b0f2b37760098a1d259cb909d could not be rebased onto its target branch `nightly` at 412a48fb245770fbd3b5720b7e3cafef0f3b824e, its work past the commit d451f678041d6d411a2ae2ffd78f108674f39145 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 21b7b62... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 21b7b62... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-paint`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-music` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
