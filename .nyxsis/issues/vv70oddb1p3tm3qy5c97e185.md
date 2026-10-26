---
format: nyxsis-issue
version: 3
id: vv70oddb1p3tm3qy5c97e185
zone: NYX
number: 14
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T21:56:22.293098462Z
modified: 2026-10-26T21:58:47.59009236Z
done: 2026-10-26T21:58:47.59009236Z
outcome: |
  Rebased `tool-sn`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` onto `nightly`
  (48b703a), the same way NYX-13 handled tool-sprite. The one commit past f0a891e
  ("ci: take the kit and the CI images built at 6c195c0f2") was replayed alone and
  is now 7f630ff. Both conflicts, in `.copier-answers.yml` and
  `azure-pipelines.yml`, were resolved by taking the commit's version of each file
  as rendered from the kit at 9ecc82fe9. That gives `_commit:
  v0.6.3-5579-g9ecc82fe9` and the CI image pins at 6c195c0f2. The pipeline also
  brings in the kit's `scripts/ci/npm-feed.sh` steps; that script is already on
  nightly and takes the feed URL argument the steps pass. This is the same
  resolution as tool-sprite's fd2d5bf. The branch was pushed, and the superrepo
  records the new pin in e622c80da.

  Gates in tool-sn: format, markdownlint, no-nul-bytes, shell-tests, build-context
  and dependency-edges pass. cspell fails, but the failure was already on nightly
  and is not caused by this change: the `spell` npm script (`cspell lint
  --no-progress --cache`, with no globs) makes the installed cspell 10.2.2 print
  its usage and exit non-zero. My commit touches neither package.json nor
  cspell.json. The Rust gates were not run because no Rust source changed.

  Left: the superrepo branch is still based behind `nightly`. A trial rebase onto
  it hit submodule pin conflicts in contracts, engines, microservice-arena and
  ui-common, so I aborted it and left that to the landing's own superrepo rebase,
  as NYX-11 and NYX-13 did.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-sn`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not be
rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `tool-sn`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `954bda180703f421fd65ab46b639d0ee243a88c7`.
- Its target branch: `nightly`, at `48b703ad8c24b27088f09de27dc6bd1d574a9067`.

Git's output:

```text
the submodule `tool-sn`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 954bda180703f421fd65ab46b639d0ee243a88c7 could not be rebased onto its target branch `nightly` at 48b703ad8c24b27088f09de27dc6bd1d574a9067, its work past the commit f0a891e5f218717cb1d7b967843f59de4b2126c7 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 954bda1... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 954bda1... # ci: take the kit and the CI images built at 6c195c0f2
before it stopped, the landing pushed the target branch of this submodule to its remote, which therefore holds work no commit on the main checkout's upstream records yet: `tool-sprite`
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-sn` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
