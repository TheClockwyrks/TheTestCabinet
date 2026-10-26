---
format: nyxsis-issue
version: 3
id: tekgu6jtrpb74jdbubvy2pmt
zone: NYX
number: 15
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T22:02:25.341597568Z
modified: 2026-10-26T22:04:37.689899152Z
done: 2026-10-26T22:04:37.689899152Z
outcome: |
  Rebased `tool-sfx-synth`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` onto
  `nightly` (13c908f). The rebase replays only the work past f5e7768, so the
  result is one commit on top of nightly: 68f83a6, "ci: take the kit and the CI
  images built at 6c195c0f2". The superrepo records it in c23f4bad1.

  Both conflicts were version pins:

  - `.copier-answers.yml`: took the newer kit `_commit`, v0.6.3-5579-g9ecc82fe9.
  - `azure-pipelines.yml`: kept nightly's file and moved only the rust and web CI
    image pins, from af509db6 to 6c195c0f. Taking the branch's whole file would
    also have brought in the npm-feed steps of the master-only commits 89b3787 and
    b7384c8, which nightly doesn't have, along with the scripts those steps call.

  The `CLAUDE.md` change applied cleanly.

  Gates in the submodule:

  - Passed: ci-tests, format, markdownlint, no-nul-bytes, build-context,
    shell-tests, python-lint and dependency-edges.
  - cspell finds no files inside this worktree, because the worktree sits under
    `.git/` and `cspell.json` ignores `**/.git/**`. It passes on a copy of the
    tree taken outside `.git/` (6 files, 0 issues).
  - The Rust gates were not run. No Rust code changed.

  Left: the master-only kit changes in 89b3787 and b7384c8 (npm-feed and the
  build-context/image scripts) are still not on `nightly`. They reach it through
  their own path, not through this landing.
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
