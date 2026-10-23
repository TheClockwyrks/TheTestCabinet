# Give the suites repository a README and a gitignore

Commit a README and a `.gitignore` to the test suites repository and move this
repository's submodule pointer to that commit, so a clone of the suites
repository explains itself and ignores what is written into it.

## Current state

The suites repository holds one commit, `chore: initialize the test suites
repository`, with no tracked files. `.gitmodules` records it at `test-suites/`
tracking `master`, and this repository's pointer names that commit.

Nothing in the tree says what the repository is for, so a clone taken on its own
shows an empty folder. The only `.gitignore` it can have today is the one The
Spec Cabinet writes on its first save, from
`ensure_working_folders_ignored` in `crates/spec-cabinet/src/save.rs:1409`, and
that file is untracked until a suite creation commits it.

[Test Suites](../../apps/docs/src/content/docs/test-suites/overview.md) is
authoritative for what the repository holds and how a suite folder is laid out.

## Design

### The README

`README.md` at the root of the suites repository follows this repository's own
README: a title, a short overview of what the repository is, and a pointer to the
documentation site for anything further. It states that the repository holds the
authored test suites The Test Cabinet draws test cases from, that each top-level
folder is one suite named by its slug holding its drafts and its exported
versions, that The Spec Cabinet is the only writer of the tree, and that The Test
Cabinet ingests exported versions. It links to the suites pages on the
documentation site rather than restating any format.

### The gitignore

`.gitignore` at the root ignores what is produced rather than authored:
`.previews/`, which holds the preview versions The Spec Cabinet writes for the
local stack to ingest, and the dependency and editor directories a suite's
scaffolded workspaces leave behind, such as `node_modules/`.

The Spec Cabinet no longer writes this file once
[`keep-spec-cabinet-state-out-of-the-suites-checkout.md`](../spec-cabinet/keep-spec-cabinet-state-out-of-the-suites-checkout.md)
lands, which also settles which folders remain in the checkout. That issue lands
first, and this file is written to match what it leaves behind.

### The pointer

Both files are committed to the suites repository on `master` with a
Conventional Commits subject, and this repository commits the moved submodule
pointer. `development/building.md` already names the clone and update commands,
so it changes only if the move gives a reader something new to run.

## Done when

- [ ] The suites repository tracks a `README.md` describing itself and pointing at the
      documentation site, in this repository's README style.
- [ ] The suites repository tracks a `.gitignore` covering previews and dependency
      directories.
- [ ] This repository's submodule pointer names that commit and is committed.
- [ ] A fresh `git clone --recurse-submodules` populates `test-suites/` with both files.
- [ ] The Spec Cabinet writes no `.gitignore` over the committed one.
- [ ] Gates green.
