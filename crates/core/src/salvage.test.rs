//! Tests for salvaging a dying container's capture journal.
//!
//! The collector is faked here for the reason the whole module exists: the real ones
//! reach into a container, and the behaviour under test is what happens *around* that
//! copy — where the file is asked for, where it lands, and which outcomes are treated as
//! "nothing to assemble" rather than as failures.

use std::path::Path;

use super::*;
use crate::error::{Error, Result};
use crate::execution::ArtifactCollection;

/// A collector that answers `collect_file` in one prescribed way and records the
/// container path it was asked for.
struct FakeCollector {
    /// What the salvage attempt should do.
    outcome: Outcome,
    /// The path the collector was asked to copy, captured for assertion.
    asked_for: std::sync::Mutex<Option<String>>,
}

/// The four shapes a salvage attempt can take, from the caller's point of view.
enum Outcome {
    /// The journal was there: write these bytes to the destination.
    Recovered(&'static [u8]),
    /// Nothing to copy — the run never wrote one.
    Absent,
    /// The copy "succeeded" but produced a zero-byte file: a session that died before
    /// even its header line reached disk.
    Empty,
    /// The host destination could not be written.
    Failed,
}

impl FakeCollector {
    fn new(outcome: Outcome) -> Self {
        Self {
            outcome,
            asked_for: std::sync::Mutex::new(None),
        }
    }
}

#[async_trait::async_trait]
impl ArtifactCollector for FakeCollector {
    async fn collect(&self, _container: &ContainerHandle) -> Result<ArtifactCollection> {
        unreachable!("salvage must never collect the whole implementation tree");
    }

    async fn collect_file(
        &self,
        _container: &ContainerHandle,
        container_path: &str,
        dest: &Path,
    ) -> Result<bool> {
        *self.asked_for.lock().expect("asked_for") = Some(container_path.to_string());
        match self.outcome {
            Outcome::Recovered(bytes) => {
                std::fs::write(dest, bytes).expect("write the salvaged journal");
                Ok(true)
            }
            Outcome::Absent => Ok(false),
            Outcome::Empty => {
                std::fs::write(dest, b"").expect("write an empty journal");
                Ok(true)
            }
            Outcome::Failed => Err(Error::ArtifactCollection("no such destination".to_string())),
        }
    }
}

fn handle() -> ContainerHandle {
    ContainerHandle {
        id: "run-container".to_string(),
    }
}

/// A stand-in for the engine's output directory — the volume the run tree is written to,
/// and therefore the one the salvage must stage into.
fn output_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("an output directory")
}

#[test]
fn the_journal_is_asked_for_at_its_absolute_in_container_path() {
    // Every host-side reader joins the workspace-relative path onto a collected tree;
    // salvage is the one caller that needs the container's own view, because it copies
    // the file before any tree exists.
    assert_eq!(journal_container_path(), "/work/.gg/replay.ndjson");
}

#[tokio::test]
async fn a_salvaged_journal_lands_where_the_assembler_looks_for_it() {
    // The scratch directory is shaped like a *collected tree*, not like an arbitrary
    // holding pen: the replay assembly stage joins `GG_SESSION_JOURNAL_PATH` onto the tree
    // it is given, so the salvaged file must sit at exactly that relative path for the
    // ordinary stage to work unchanged on the failure path.
    let out = output_dir();
    let collector = FakeCollector::new(Outcome::Recovered(b"{\"type\":\"header\"}\n"));
    let scratch = salvage_journal_tree(&collector, &handle(), out.path())
        .await
        .expect("a journal that was copied out should be reported");

    assert_eq!(
        collector.asked_for.lock().expect("asked_for").as_deref(),
        Some("/work/.gg/replay.ndjson"),
    );
    let journal = scratch.path().join(GG_SESSION_JOURNAL_PATH);
    assert_eq!(
        std::fs::read(&journal).expect("read the salvaged journal"),
        b"{\"type\":\"header\"}\n",
    );
    // Only the journal — never the implementation tree. A hung run must not come back
    // carrying a half-written build that a reviewer could open and score.
    let entries: Vec<_> = std::fs::read_dir(scratch.path())
        .expect("read the scratch tree")
        .map(|entry| entry.expect("entry").file_name())
        .collect();
    assert_eq!(entries, vec![std::ffi::OsString::from(".gg")]);
}

#[tokio::test]
async fn a_run_that_wrote_no_journal_salvages_nothing() {
    // The overwhelmingly common case: a third-party-harness run, or a gg run that failed
    // before capture started. It is an ordinary absence, not a failure.
    assert!(
        salvage_journal_tree(
            &FakeCollector::new(Outcome::Absent),
            &handle(),
            output_dir().path()
        )
        .await
        .is_none()
    );
}

#[tokio::test]
async fn an_empty_salvaged_journal_is_reported_as_nothing_to_assemble() {
    // A zero-byte journal is a session that died before its header line reached disk.
    // Assembly refuses a headerless journal, so handing one on would turn a silent
    // absence into a warned-about stage failure for no gain.
    assert!(
        salvage_journal_tree(
            &FakeCollector::new(Outcome::Empty),
            &handle(),
            output_dir().path()
        )
        .await
        .is_none()
    );
}

#[tokio::test]
async fn a_failed_salvage_is_swallowed_rather_than_raised() {
    // This runs while a run is *already* failing. Reporting that failure accurately
    // outranks the diagnostic, so a collector error yields no tree rather than an error
    // the caller would have to decide what to do with.
    assert!(
        salvage_journal_tree(
            &FakeCollector::new(Outcome::Failed),
            &handle(),
            output_dir().path()
        )
        .await
        .is_none()
    );
}

#[tokio::test]
async fn the_scratch_tree_is_on_the_output_volume_and_does_not_survive() {
    // R17. The copy is bounded only by the run's `replay_max_bytes` ceiling — 256 MiB by
    // default — so it must be staged on the volume the run tree is on, never on a
    // container's `/tmp`, which is routinely a small `tmpfs`. Filling that would either
    // fail the salvage or take the pod down, on the one path where the failure being
    // reported has to stay diagnosable.
    let out = output_dir();
    let collector = FakeCollector::new(Outcome::Recovered(b"{\"type\":\"header\"}\n"));
    let path = {
        let scratch = salvage_journal_tree(&collector, &handle(), out.path())
            .await
            .expect("a journal that was copied out should be reported");
        assert_eq!(
            scratch.path().parent(),
            Some(out.path()),
            "the salvage scratch tree must be staged under the output directory, not in \
             `std::env::temp_dir`",
        );
        scratch.path().to_path_buf()
    };
    // And it is scratch: dropping the handle takes the copied journal with it, so a
    // salvage that the assembler refused leaves nothing behind on the run's volume.
    assert!(
        !path.exists(),
        "the scratch tree must not outlive its handle"
    );
}
