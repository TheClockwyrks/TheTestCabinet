---
format: nyxsis-issue
version: 3
id: y77kpme6v8zj6psxvkvak9c6
zone: NYX
number: 25
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-27T18:30:20.539738644Z
modified: 2026-10-27T18:31:24.36242631Z
done: 2026-10-27T18:31:24.36242631Z
outcome: |
  There was no content conflict to resolve. In `microservice-repos`, the remote
  `nightly` was stale: it sat at the scaffold commit 783a27e, an ancestor of
  `master`. The superrepo's `nightly` already pins 30f3f78 (`master`) for the
  submodule. Replaying c9efbcf alone onto the scaffold therefore conflicted in
  `.copier-answers.yml` and `azure-pipelines.yml`, because the scaffold lacks
  every `master` commit the change builds on.

  Done: the submodule's `nightly` was fast-forwarded on origin to 30f3f78, the
  commit the superrepo's `nightly` already records for it (a fast-forward, no
  history rewritten). The branch `issue/o7hwklyhcecnv0j6u9k4aavr` (c9efbcf) now
  sits directly on `nightly`. `git rebase origin/nightly` reports it up to date,
  and the branch is pushed. The superrepo branch already contains `nightly`, and
  its pin (c9efbcf) is unchanged, so no submodule-pointer commit was needed.

  Left: nothing for this issue. Other submodules whose remote `nightly` lags their
  `master` may hit the same landing failure.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`microservice-repos`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr`
could not be rebased onto its target branch `nightly`, so the rebase was aborted
and the submodule stands clean on its branch with nothing landed.

- The submodule: `microservice-repos`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `c9efbcf9453d6e4b4fa85dcc65f0c65fb865f76c`.
- Its target branch: `nightly`, at `783a27ea37a26303d0e78cbe1af3f57e70f6e9ff`.

Git's output:

```text
the submodule `microservice-repos`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at c9efbcf9453d6e4b4fa85dcc65f0c65fb865f76c could not be rebased onto its target branch `nightly` at 783a27ea37a26303d0e78cbe1af3f57e70f6e9ff, its work past the commit 30f3f78dd18b614b411689a5659d44fbc4d3565d the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply c9efbcf... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply c9efbcf... # ci: take the kit and the CI images built at 6c195c0f2
the main checkout's submodules could not be moved to the commits its branch records: the submodule `test-suites` stands at c01cd1ce3de50f58fe3e3d9e1e8d413c4ac14471, which is not behind the commit 13963e05a80f6a6029701319b53ae727a55bf41d its parent records for it or could not be moved to it, so it was left where it stands
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `microservice-repos`
onto its target branch `nightly`, resolve each conflict and continue the rebase
until it completes, then close this issue. Once it is closed, Nyxsis lands the
branch again, the check command included.
