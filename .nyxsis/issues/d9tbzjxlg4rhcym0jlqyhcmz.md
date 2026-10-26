---
format: nyxsis-issue
version: 3
id: d9tbzjxlg4rhcym0jlqyhcmz
zone: NYX
number: 17
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: open
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:13:46.028989415Z
modified: 2026-10-26T22:13:46.028989415Z
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-particle`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could
not be rebased onto its target branch `nightly`, so the rebase was aborted and
the submodule stands clean on its branch with nothing landed.

- The submodule: `tool-particle`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `7383b49ade15f93e170a7fe12dfd9893660b28e5`.
- Its target branch: `nightly`, at `9553ce97594c3e0ce70d5bd7783d4823e13fdc3c`.

Git's output:

```text
the submodule `tool-particle`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 7383b49ade15f93e170a7fe12dfd9893660b28e5 could not be rebased onto its target branch `nightly` at 9553ce97594c3e0ce70d5bd7783d4823e13fdc3c, its work past the commit 6b70638f341b8247ffbec5d169ae86e5d367066d the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 7383b49... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 7383b49... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-sfx-sample`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-particle` onto
its target branch `nightly`, resolve each conflict and continue the rebase until
it completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
