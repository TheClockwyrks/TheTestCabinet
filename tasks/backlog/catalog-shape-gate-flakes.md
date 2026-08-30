# The Catalog Shape Gate Is Deterministic

`the_stored_shape_of_every_committed_version_is_unchanged`
(`crates/core/tests/catalog_and_seeding.rs`) reports the same result on every
run of the suite it belongs to.

## Current behaviour

The test failed once under `cargo nextest run --workspace --exclude
test-cabinet-desktop`, in a run of 5,567 tests where it was the only failure. It
passed when run alone, and it passed on a full re-run of the same suite over the
same tree. `.config/nextest.toml` sets `flaky-result=fail`, so a result that
varies between runs fails the gate.

The test reads the repository's own `test-cases/` directory through
`catalog_root`, which resolves to `$CARGO_MANIFEST_DIR/../../test-cases`. Every
case and every version is resolved and its serialized shape asserted. The
directory is shared with the rest of the suite rather than copied per test.

The failing run's assertion message was discarded, so which of the three
assertions failed and for which case is unrecorded.

## Design

Capture the failure before deciding the fix. Run the suite until the result
reproduces, keeping the full output.

Then establish whether the reading is affected by what the rest of the suite
does to the shared directory. If it is, give the test a catalog it owns.

## Done when

- [ ] The failing assertion and the case it names are recorded.
- [ ] The cause is identified.
- [ ] Repeated runs of the full suite report the same result.
- [ ] Gates green.
