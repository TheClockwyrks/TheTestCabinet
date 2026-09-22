# Split the Spec Cabinet into its own repository

This issue follows the v0.7.0 tag. Move the Spec Cabinet out of
`feat/the-spec-cabinet` into the `the-spec-cabinet` repository
(`git@ssh.dev.azure.com:v3/genyume/the-test-cabinet/the-spec-cabinet`), and
leave the test-suite support behind as an ordinary Test Cabinet
branch.

## Current state

`feat/the-spec-cabinet` is `feat/gg` plus three kinds of work: the Spec Cabinet
itself (`crates/spec-cabinet`, `apps/spec-cabinet`,
`packages/spec-cabinet-sandbox*`, `crates/spec-cabinet-sandbox-artifacts`,
`tasks/spec-cabinet` and the `the-spec-cabinet` docs section), the test-suite
support in shared code (core's suite model with resolve and validate, backend
suite and preview ingest, the console's Test Suites tab and detail page,
`tcab ingest --env`, content-digest change detection, the `test-suites` docs
section and the `test-suites` submodule), and shared-code edits the v0.7.0
release picks up separately.

The Spec Cabinet is unfinished and waits on a forthcoming open-source common
library shared with several other projects, onto which it is refactored before
it is completed.

## Design

### The extraction

Extract the Spec Cabinet paths into the new repository with `git filter-repo`'s
subdirectory filtering, run against the rewritten `feat/the-spec-cabinet`, so
their history comes along. The new repository starts as the extracted code
as-is, depending on the contracts crate for the suite format types and on The
Test Cabinet for nothing. The refactor onto the common library happens there.

### What stays

Everything on the branch that is test-suite support in shared code becomes the
Test Cabinet branch `feat/test-suites`, aimed at v1.0, where test suites
replace test cases. The suite format types move to the contracts crate as part
of that branch, following
[`create-the-contracts-repo-and-move-the-shared-contracts-into-it.md`](create-the-contracts-repo-and-move-the-shared-contracts-into-it.md).
`feat/the-spec-cabinet` is deleted once both destinations hold its content.

The `test-suites` submodule stays on `feat/test-suites` at the relative URL the
submodule issue establishes, and the Spec Cabinet repository references the
same `test-suites` repository as the tree it writes.

## Done when

- [ ] The `the-spec-cabinet` repository holds the Spec Cabinet paths with
      their history and builds on its own.
- [ ] `feat/test-suites` exists in The Test Cabinet holding the test-suite
      support and none of the Spec Cabinet paths, and it builds and passes the
      gates.
- [ ] `feat/the-spec-cabinet` is deleted.
- [ ] `CLAUDE.md` and the architecture page point to the Spec Cabinet
      repository, and the `the-spec-cabinet` docs section lives there.
