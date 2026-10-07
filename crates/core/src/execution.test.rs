//! Tests for the execution seams — today the [`ArtifactCollector`] salvage
//! contract, whose default behavior is load-bearing for every collector that does
//! not implement it.

use super::*;

/// A collector that implements only the required half of the trait, standing in for
/// any host (a future runtime, say) that can hand back a collected tree
/// but has no per-file channel into a container.
struct TreeOnlyCollector;

#[async_trait::async_trait]
impl ArtifactCollector for TreeOnlyCollector {
    async fn collect(&self, _container: &ContainerHandle) -> Result<ArtifactCollection> {
        Ok(ArtifactCollection::new(PathBuf::from("/tmp/tree")))
    }
}

#[tokio::test]
async fn a_collector_that_cannot_salvage_reports_no_file_rather_than_failing() {
    // The salvage path runs while a run is *already* failing (a hung or timed-out
    // container being torn down), so the default must be a clean "nothing recovered",
    // never an error that turns a diagnosable timeout into a collection failure.
    let collector = TreeOnlyCollector;
    let salvaged = collector
        .collect_file(
            &ContainerHandle {
                id: "c1".to_string(),
            },
            "/work/implementation/.gg/replay.json",
            std::path::Path::new("/tmp/replay.json"),
        )
        .await
        .expect("the default salvage never errors");
    assert!(!salvaged);
}

#[tokio::test]
async fn a_collector_that_cannot_salvage_writes_nothing_to_the_destination() {
    // "Not recovered" must also mean "left no half-file behind": the caller assembles
    // whatever it finds at `dest`, so an empty or partial file there would be read as
    // a corrupt artifact rather than an absent one.
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("replay.json");
    let salvaged = TreeOnlyCollector
        .collect_file(
            &ContainerHandle {
                id: "c1".to_string(),
            },
            "/work/implementation/.gg/replay.json",
            &dest,
        )
        .await
        .unwrap();
    assert!(!salvaged);
    assert!(!dest.exists());
}
