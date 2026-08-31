# The Catalog Shape Gate Is Deterministic

`the_stored_shape_of_every_committed_version_is_unchanged`
(`crates/core/tests/catalog_and_seeding.rs`) reports the same result on every
run of the suite it belongs to.

## Current behaviour

The test failed once under `cargo nextest run --workspace --exclude
test-cabinet-desktop`, in a run of 5,567 tests where it was the only failure. It
passed when run alone, and it passed on a full re-run of the same suite over the
same tree. `.config/nextest.toml` sets `flaky-result=fail`, so a result that
varies between runs fails the gate. The failing run's assertion message was
discarded, so which of the four assertions failed and for which case is
unrecorded.

The test reads the repository's own `test-cases/` and `game-jams/` directories
through `catalog_root`, shared with the rest of the suite rather than copied per
test. Three of its assertions compare a resolved version against its own
serialization; the fourth compares the number of versions the catalog resolved
against the number of manifests `on_disk_manifests` walks off disk. Each is a
function of those two trees alone.

Repeated full runs of the suite report the same result, and a watch over both
trees across a full run records no write to either. A result that varies
therefore means either the committed manifests changed while the suite ran, or a
directory read failed and the walk answered a short list.

## Design

Reproduce the failure before deciding anything further. Run the suite until the
result recurs, keeping the full output.

A read that fails must name itself and the path it failed on, so that a run
which varies says why rather than presenting as a catalog disagreeing with its
own directory.

## Done when

- [ ] The failing assertion and the case it names are recorded.
- [ ] The cause is identified.
- [x] Repeated runs of the full suite report the same result.
- [x] Gates green.
