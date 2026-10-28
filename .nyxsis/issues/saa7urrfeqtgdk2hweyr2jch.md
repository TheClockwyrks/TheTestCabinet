---
format: nyxsis-issue
version: 3
id: saa7urrfeqtgdk2hweyr2jch
zone: NYX
number: 11
title: Resolve the conflict landing NYX-8
type: conflict
priority: 0
state: done
branch: issue/o7hwklyhcecnv0j6u9k4aavr
created: 2026-10-26T21:27:24.814560052Z
modified: 2026-10-26T21:36:21.973576447Z
done: 2026-10-26T21:36:21.973576447Z
outcome: |
  Rebased `tool-voxel`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` onto its
  `nightly` (990f19a); it now stands at 2c4cc50, and the superrepo records it in
  441166e5b.

  The conflict had a structural cause: `tool-voxel`'s `nightly` is an ancestor of
  1badff4, the commit the superrepo's `nightly` already pins. Replaying only the
  kit commit onto `nightly` would have dropped master's work from what the
  superrepo pins: contracts v0.2.4, tool-model-core v0.1.2, and the kit and CI
  image updates at ed9c9929f and 32214df70. So the branch is now two commits on
  `nightly`:

  - 325564e takes 1badff4's tree onto `nightly` as it stands.
  - 2c4cc50 is the kit commit for 6c195c0f2, unchanged.

  The resulting tree is byte-identical to the original 7d38891, which keeps both
  sides' intent. The landing's own replay (`git rebase --onto nightly 1badff4`) is
  a no-op on this branch.

  Gates in `tool-voxel`: build-context, ci-tests, dependency-edges, format,
  markdownlint, no-nul-bytes, python-lint, shell-tests and rust-fmt passed. cspell
  passed on an exported copy of the tree; in the worktree it checks no files
  because the worktree path is under `.git/`, which cspell.json ignores.
  rust-clippy, rust-doc, rust-test and typescript were not run: the change touches
  no Rust or TypeScript, and the tree's code is 1badff4's.

  The superrepo's dependency-graph gate passed.

  Left: the superrepo branch was not rebased onto `nightly` here. Its 216ae79da
  moves the `microservice-artifacts` and `testcabinet.ai` pins, which `nightly`
  also moved. This issue names neither submodule, so the superrepo rebase is left
  to Nyxsis's landing. `microservice-artifacts`'s kit commit b735a17 merges
  cleanly onto aa49638, the commit `nightly` pins for it. `testcabinet.ai`'s
  da38dca conflicts with df38522, so that landing is expected to stop there.
---

The landing of NYX-8 stopped at a submodule's rebase, in the submodule
`tool-voxel`: the submodule's branch `issue/o7hwklyhcecnv0j6u9k4aavr` could not
be rebased onto its target branch `nightly`, so the rebase was aborted and the
submodule stands clean on its branch with nothing landed.

- The submodule: `tool-voxel`.
- The submodule's branch: `issue/o7hwklyhcecnv0j6u9k4aavr`, at
  `7d3889140ac1c6c2a70bedd19e0b65f7ae013b30`.
- Its target branch: `nightly`, at `990f19a26a9a5e0b96ceb9b3adaa46185385fbf5`.

Git's output:

```text
the submodule `tool-voxel`'s branch `issue/o7hwklyhcecnv0j6u9k4aavr` at 7d3889140ac1c6c2a70bedd19e0b65f7ae013b30 could not be rebased onto its target branch `nightly` at 990f19a26a9a5e0b96ceb9b3adaa46185385fbf5, its work past the commit 1badff44c62ea5dad9f1b0563f24be44eb3b46c4 the main checkout's branch records for it replayed alone:
Auto-merging .copier-answers.yml
CONFLICT (content): Merge conflict in .copier-answers.yml
Auto-merging azure-pipelines.yml
CONFLICT (content): Merge conflict in azure-pipelines.yml
Rebasing (1/1)error: could not apply 7d38891... ci: take the kit and the CI images built at 6c195c0f2
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".
hint: You can instead skip this commit: run "git rebase --skip".
hint: To abort and get back to the state before "git rebase", run "git rebase --abort".
hint: Disable this message with "git config set advice.mergeConflict false"
Could not apply 7d38891... # ci: take the kit and the CI images built at 6c195c0f2
```

Rebase `issue/o7hwklyhcecnv0j6u9k4aavr` in the submodule `tool-voxel` onto its
target branch `nightly`, resolve each conflict and continue the rebase until it
completes, then close this issue. Once it is closed, Nyxsis lands the branch
again, the check command included.
