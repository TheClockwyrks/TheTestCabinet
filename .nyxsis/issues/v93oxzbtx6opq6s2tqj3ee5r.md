---
format: nyxsis-issue
version: 3
id: v93oxzbtx6opq6s2tqj3ee5r
zone: NYX
number: 32
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T19:02:49.188655975Z
modified: 2026-10-27T19:04:47.100761752Z
done: 2026-10-27T19:04:47.100761752Z
outcome: |
  Rebased gg's `issue/o7hwklyhcecnv0j6u9k4aavr` onto `nightly` (d590c7cd). Once
  the branch's own pin commits came along, nothing conflicted. The rebase replayed
  the three pin commits (ed9c9929f, 32214df70, 6c195c0f2), and the two older ones
  were superseded. I squashed them into one commit, 1635f7a1 "ci: pin the CI
  images built at 6c195c0f2". Its tree is the same as the full rebase's tree. Its
  diff against nightly moves the pipeline's three image pins and the wiring test's
  `rustImage` from af509db6 to 6c195c0f. I pushed the branch to gg's remote and
  recorded it in the superrepo with 8f8c6f041.

  Gates run in gg: ci-tests (302 passed, 1 skipped), format, python-lint and
  no-nul-bytes all passed. cspell failed when run in place, but the failure is in
  the environment, not the code. The Nyxsis worktree path contains `.git/`, so
  cspell.json's `**/.git/**` ignore excludes every file. cspell then finds no
  files and exits with usage. The same gate run over a `git archive` export of
  HEAD checked 105 files and found no issues. That cspell config problem is left
  as it is. The Rust and typescript gates were not run because the change touches
  no code they judge.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule `gg`: the
submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not be rebased onto
its target branch `nightly`, so the rebase was aborted and the submodule stands
clean on its branch with nothing landed.

- The submodule: `gg`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `549fbd44ffc135422591c644a75190fddcca68f6`.
- Its target branch: `nightly`, at `d590c7cd3501d9b2093c07a64d53012e49852cbb`.

Git's output:

```text
the submodule `gg`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 549fbd44ffc135422591c644a75190fddcca68f6 could not be rebased onto its target branch `nightly` at d590c7cd3501d9b2093c07a64d53012e49852cbb, its work past the commit 19a5aed34a5c9c67bb5726065f4e423bffbb8f7d the main checkout's branch records for it replayed alone:
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Auto-merging ci/tests/test_wiring.py
CONFLICT (content): Merge conflict in ci/tests/test_wiring.py
Rebasing (1/1)error: could not apply 549fbd44... ci: pin the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 549fbd44... # ci: pin the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `gg.rocks`
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `gg` onto its target
branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
