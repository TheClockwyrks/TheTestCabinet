---
format: nyxsis-issue
version: 3
id: o28xshw0ject0iipundk0e46
zone: NYX
number: 23
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:58:47.003793867Z
modified: 2026-10-26T23:00:16.270250133Z
done: 2026-10-26T23:00:16.270250133Z
outcome: |
  Rebased `tool-audio-core`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` onto
  `nightly` (0003f4cc9), replaying only the work past e1e0c21e9: the commit "ci:
  take the kit and the CI images built at 6c195c0f2", now b23cdd0. Both conflicts
  were the kit's pins. `.copier-answers.yml`'s `_commit` and
  `azure-pipelines.yml`'s two CI image tags kept the branch's side, the kit at
  9ecc82fe9 and the images at 6c195c0f2. Each is a descendant of the one `nightly`
  held (35ac7aff7 and af509db60), so `nightly`'s intent is kept. The CLAUDE.md
  change applied cleanly. The superrepo records the new submodule commit in
  e2df5924d.

  The submodule's `make gate` passes every gate but `cspell`. That gate fails with
  cspell's usage message, an invocation error in the kit's gate, and it fails the
  same way at `nightly`'s 0003f4cc9 untouched, so it is not caused by this change
  and is left as it was. `nightly` lacks the master commits between it and
  e1e0c21e9 (such as the contracts v0.2.4 pin). This landing does not carry them.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-audio-core`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could
not be rebased onto its target branch `nightly`, so the rebase was aborted and
the submodule stands clean on its branch with nothing landed.

- The submodule: `tool-audio-core`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `2468310416b77336be0499afd732d66c44b50fc3`.
- Its target branch: `nightly`, at `0003f4cc9bd6121704ede803ee90a4d7ba3a588d`.

Git's output:

```text
the submodule `tool-audio-core`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 2468310416b77336be0499afd732d66c44b50fc3 could not be rebased onto its target branch `nightly` at 0003f4cc9bd6121704ede803ee90a4d7ba3a588d, its work past the commit e1e0c21e9bedeba30500252eab8570da037ea84f the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 2468310... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 2468310... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-dc`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-audio-core` onto
its target branch `nightly`, resolve each conflict and continue the rebase until
it completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
