---
format: nyxsis-issue
version: 3
id: tekgu6jtrpb74jdbubvy2pmt
zone: NYX
number: 15
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:02:25.341597568Z
modified: 2026-10-26T22:02:25.341597568Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-sfx-synth`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could
not be rebased onto its target branch `nightly`, so the rebase was aborted and
the submodule stands clean on its branch with nothing landed.

- The submodule: `tool-sfx-synth`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `d82c5bbf8e450711c819941fe0317b0a7d049faa`.
- Its target branch: `nightly`, at `13c908f16051914cbb3cefac42d4aa0f9b6a8964`.

Git's output:

```text
the submodule `tool-sfx-synth`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at d82c5bbf8e450711c819941fe0317b0a7d049faa could not be rebased onto its target branch `nightly` at 13c908f16051914cbb3cefac42d4aa0f9b6a8964, its work past the commit f5e7768eb3a9e78cb5a56440f28d39a944aaac0c the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply d82c5bb... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply d82c5bb... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-sn`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-sfx-synth` onto
its target branch `nightly`, resolve each conflict and continue the rebase until
it completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
