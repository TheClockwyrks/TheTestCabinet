---
format: nyxsis-issue
version: 3
id: dcas2mxoe710x996ba8glh09
zone: NYX
number: 16
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:08:17.329141509Z
modified: 2026-10-26T22:08:17.329141509Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-sfx-sample`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could
not be rebased onto its target branch `nightly`, so the rebase was aborted and
the submodule stands clean on its branch with nothing landed.

- The submodule: `tool-sfx-sample`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `54cff91485d500fa2ec828d7c06064b65a5af067`.
- Its target branch: `nightly`, at `86186bb4fa0e6e1eead29d885ef451717986fe96`.

Git's output:

```text
the submodule `tool-sfx-sample`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 54cff91485d500fa2ec828d7c06064b65a5af067 could not be rebased onto its target branch `nightly` at 86186bb4fa0e6e1eead29d885ef451717986fe96, its work past the commit c6dd21710773cf838acac554c1b5f49434efbf40 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 54cff91... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 54cff91... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-sfx-synth`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-sfx-sample` onto
its target branch `nightly`, resolve each conflict and continue the rebase until
it completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
