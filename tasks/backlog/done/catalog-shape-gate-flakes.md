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
discarded, so which assertion failed and for which case is unrecorded.

The test reads the repository's own `test-cases/` and `game-jams/` directories
through `catalog_root`, shared with the rest of the suite rather than copied per
test. Three of its assertions compare a resolved version against its own
serialization; the fourth compares the number of versions the catalog resolved
against the number of manifests `on_disk_manifests` walks off disk. Each is a
function of those two trees alone.

Repeated full runs of the suite report the same result, and a watch over both
trees across a full run records no write to either. A result that varies
therefore means either the committed manifests changed while the suite ran, or a
directory read failed and the walk answered a short list. The second reads as a
catalog disagreeing with its own directory, because `on_disk_manifests` skips
whatever it cannot read and descends into the git-ignored build output that any
reference build rewrites beside the suite.

## Design

`on_disk_manifests` names any read that fails and the path it failed on, and
classifies a directory entry by its own type rather than by following it. It
stops at the build output under a version, so the count it hands the last
assertion is a reading of the committed catalog alone.

## Done when

- [x] A read that fails names itself rather than shortening the walk's answer.
- [x] The walk reads the committed catalog rather than the build output beside it.
- [x] Repeated runs of the full suite report the same result.
- [x] Gates green.
