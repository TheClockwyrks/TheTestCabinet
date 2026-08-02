//! The **committed fixture suite**: whole recorded sessions, checked into the repository, each of
//! which asserts that this build of gg still reconstructs it faithfully.
//!
//! This is the second reason playback exists, and on some days the better one. Every other test in
//! this module records a session and plays it back **in the same process**, which can never detect
//! a prompt-template change: the recorder stamps the fingerprint of the request this build built,
//! and then this build builds the same request again. A fixture is the missing half — the record
//! was written by an *earlier* build, so when a system prompt, a tool description or the
//! context-usage block moves, **every fixture fails at once**, naming the diverged component and
//! showing the diff.
//!
//! # Provenance — read this before trusting a number out of one
//!
//! [Owner decision Q7](../../../../HANDOFF-gg-analysis.md) permits **real** recorded sessions here,
//! following the precedent of `crates/gg/src/testdata/*.txt` (fifteen committed real model
//! replies), at ≤500 KB each post-pooling and about six at most.
//!
//! The records committed today are **not** real sessions. No provider credential exists in the
//! environment this suite was built in, so every one of them was driven by gg's offline
//! `MockClient` — through the real turn loop, the real tools, the real recorder and the real
//! host-side assembler, but against scripted model output rather than a model's. What that costs
//! is only the realism of the *content*: the regression signal is unaffected, because it comes
//! from the request gg builds and not from the answer it gets. A real session dropped in beside
//! these would be strictly better and needs no code change — capture it, trim it to the budget,
//! and the loader picks it up.
//!
//! The budget is enforced [here](the_fixture_suite_stays_within_its_committed_budget) rather than
//! left as a note, because a cap nothing checks is a cap that a captured real session quietly
//! blows through.
//!
//! # Regenerating them
//!
//! ```text
//! cargo nextest run -p test-cabinet-gg --run-ignored only capture_the_committed_fixtures
//! ```
//!
//! Legitimately needed whenever gg's prompt construction changes on purpose — which is exactly
//! when this suite goes red — and the *diff of what it regenerates* is then the record of what the
//! change did to every recorded session's requests.

use std::path::PathBuf;

use test_cabinet_core::gg_replay_assembly::assemble_journal_to_gz;

use super::*;

/// The committed fixtures, relative to the crate root.
///
/// Beside `testdata/`'s committed model replies on purpose: they are the same kind of artifact —
/// real-ish inputs a test asserts against, too large and too structural to be a string literal —
/// and keeping them in one place is what stops a second convention growing.
const FIXTURE_DIR: &str = "src/testdata/playback";

/// The most a single committed fixture may weigh, post-pooling: **500 KB**.
///
/// Owner decision Q7's number. It is generous for a scripted session and tight for a real one,
/// which is the point — a real capture has to be trimmed deliberately (drop the image blobs, take
/// a shorter session) rather than committed at whatever size it happened to be.
const MAX_FIXTURE_BYTES: u64 = 500 * 1024;

/// The most fixtures the suite may hold: **six**.
///
/// Every fixture is replayed by every `cargo nextest` run, so the cap is a wall-clock budget as
/// well as a repository-size one. Six distinct *session shapes* is already more coverage than the
/// hand-written loop suite has.
const MAX_FIXTURES: usize = 6;

/// The directory the fixtures live in.
fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE_DIR)
}

/// Every committed fixture, in name order.
///
/// Discovered rather than listed, so dropping a newly captured real session into the directory is
/// all it takes to put it under the suite — there is no second place to remember.
fn fixtures() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(fixture_dir())
        .expect("the fixture directory exists")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "gz"))
        .collect();
    paths.sort();
    paths
}

// ---------------------------------------------------------------------------
// What the suite asserts
// ---------------------------------------------------------------------------

/// **The fixture suite.** Every committed record reconstructs into the session it captured, with no
/// divergence of any kind.
///
/// This is the regression signal. When it goes red after a prompt edit, the failure names the
/// component that moved and — for the system prompt, which is the usual culprit — carries the
/// rendered diff region, so the answer to *"what did I change?"* is in the failure output rather
/// than in a bisect.
///
/// One fixture at a time, sequentially, because each reconstruction runs a real turn loop with real
/// `git` in its own workspace and a failure has to name which record produced it.
#[tokio::test]
async fn every_committed_fixture_reconstructs_faithfully() {
    let fixtures = fixtures();
    assert!(
        !fixtures.is_empty(),
        "the committed fixture suite is not empty — without it, nothing in this crate detects a \
         prompt-template change against a session recorded by an earlier build",
    );

    for path in fixtures {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let record = crate::replay_cli::read_record(&path)
            .unwrap_or_else(|err| panic!("the fixture `{name}` reads back: {err}"));
        let replayed = TempDir::new().unwrap();
        let report = Playback::new(record, replayed.path().join("tree"))
            .run()
            .await
            .unwrap_or_else(|err| panic!("the fixture `{name}` is reconstructible: {err}"));

        assert!(
            report.divergences.is_empty(),
            "this build still produces the session `{name}` recorded.\n\
             Divergences: {:#?}\n\
             If gg's prompt construction changed on purpose, regenerate the suite:\n  \
             cargo nextest run -p test-cabinet-gg --run-ignored only capture_the_committed_fixtures",
            report.divergences,
        );
        assert!(report.faithful, "`{name}` reconstructs faithfully");
        assert_eq!(report.exit_code(), 0, "`{name}` is a clean reconstruction");
    }
}

/// The suite stays inside the [budget](self#provenance--read-this-before-trusting-a-number-out-of-one)
/// owner decision Q7 set: at most six fixtures, at most 500 KB each.
///
/// Asserted rather than trusted because the case the cap exists for — somebody committing a real
/// captured session — is exactly the case where the size is not obvious until it is in the
/// repository forever.
#[test]
fn the_fixture_suite_stays_within_its_committed_budget() {
    let fixtures = fixtures();
    assert!(
        fixtures.len() <= MAX_FIXTURES,
        "at most {MAX_FIXTURES} fixtures; found {}: {fixtures:?}",
        fixtures.len(),
    );
    for path in fixtures {
        let bytes = std::fs::metadata(&path)
            .expect("a fixture is readable")
            .len();
        assert!(
            bytes <= MAX_FIXTURE_BYTES,
            "`{}` is {bytes} bytes, over the {MAX_FIXTURE_BYTES}-byte cap — trim the session or \
             strip its image blobs before committing it",
            path.display(),
        );
    }
}

/// The concurrent fixture is **really** concurrent, and the committed record proves the
/// [barrier](Ordering::Seq) is doing something.
///
/// The same measurement the in-process race makes, made against a record on disk: reconstruct it
/// with the ordering turned off and it diverges on the **conversation**, which is where run-global
/// prompt state lives. Without this, `board-race` would be indistinguishable from any other
/// fixture and a change that silently removed the skew would go unnoticed — a fixture that no
/// longer exercises what it was captured for still passes the suite above.
#[tokio::test]
async fn the_concurrent_fixture_diverges_without_the_barrier() {
    let path = fixture_dir().join("board-race.json.gz");
    let record = crate::replay_cli::read_record(&path).expect("the concurrent fixture reads back");
    let replayed = TempDir::new().unwrap();
    let report = Playback::new(record, replayed.path().join("tree"))
        .ordering(Ordering::Free)
        .run()
        .await
        .expect("the fixture is reconstructible either way");

    assert!(
        !report.faithful,
        "an unordered reconstruction of a concurrent record is a session that did not happen",
    );
    assert!(
        report.divergences.iter().any(|drift| drift.kind
            == DriftKind::Fingerprint(GgFingerprintComponent::Conversation)),
        "and it diverges on the conversation: {:#?}",
        report.divergences,
    );
}

// ---------------------------------------------------------------------------
// Capturing them
// ---------------------------------------------------------------------------

/// **Regenerate the committed fixtures.** Ignored by default — it writes into the source tree.
///
/// ```text
/// cargo nextest run -p test-cabinet-gg --run-ignored only capture_the_committed_fixtures
/// ```
///
/// Each scenario is driven exactly the way its in-process twin above drives it, and then assembled
/// through the **host's own** assembler rather than serialized from memory — so what is committed
/// is byte-for-byte the artifact a real run's `replay.json.gz` is, and a fixture cannot pass
/// because it took a shortcut a run does not have.
///
/// The four shapes, and why each earns its place in a six-slot budget:
///
/// | Fixture | Exercises |
/// | --- | --- |
/// | `single-agent-tools` | the plain turn loop: a write, a read of what the write made, a memory that then rides every later prompt |
/// | `issue-review` | the v0.7.0 multi-agent headline — an auto-dispatched issue, a reviewer that sends it back, a second dispatch — and therefore three agents gg creates with **no parent**, bound only by board state |
/// | `responses-as-code` | the transpiler, the wasmtime sandbox, the typed membrane and the deferred-effect machinery, re-run against recorded program text |
/// | `board-race` | two agents genuinely in flight at once, with an interleaving that **only latency produced** — the record the ordering barrier exists for |
#[tokio::test]
#[ignore = "writes the committed fixtures into the source tree"]
async fn capture_the_committed_fixtures() {
    let dir = fixture_dir();
    std::fs::create_dir_all(&dir).expect("the fixture directory");

    // 1. The plain turn loop, scripted.
    let workspace = TempDir::new().unwrap();
    drive(workspace.path(), "fixture-single-agent-tools").await;
    freeze(workspace.path(), &dir.join("single-agent-tools.json.gz"));

    // 2. The board-dispatched issue/review cycle, driven through the production factory's
    //    `mock/demo-*` scripts so gg's real dispatch machinery is what produced the record.
    let workspace = TempDir::new().unwrap();
    drive_set(workspace.path(), "fixture-issue-review", issue_review_set()).await;
    freeze(workspace.path(), &dir.join("issue-review.json.gz"));

    // 3. Responses as code.
    let workspace = TempDir::new().unwrap();
    drive_set(
        workspace.path(),
        "fixture-responses-as-code",
        responses_as_code_set(),
    )
    .await;
    assert!(
        workspace
            .path()
            .join(crate::client::MOCK_CODE_LEVEL_FILES[0])
            .exists(),
        "the recorded run's program really ran",
    );
    freeze(workspace.path(), &dir.join("responses-as-code.json.gz"));

    // 4. The two-issue race. `drive_board_race` asserts the skew before handing the record back,
    //    so a capture that failed to produce a genuinely concurrent record fails here rather than
    //    committing a fixture that proves nothing.
    let workspace = TempDir::new().unwrap();
    drive_board_race(workspace.path(), "fixture-board-race").await;
    freeze(workspace.path(), &dir.join("board-race.json.gz"));
}

/// Drive one session under `set` through the **production** client factory — gg's own `mock/demo-*`
/// scripts — and leave its capture journal in `dir`.
///
/// Through `run` rather than `run_with_seams` on purpose: the two sets captured this way exist to
/// pin gg's real dispatch and sandbox machinery, and an in-crate scripted factory cannot reach it.
async fn drive_set(dir: &Path, session_id: &str, set: GgCapabilitySet) {
    let emitter = Emitter::with_sink(Some(session_id.to_string()), Box::new(CapturingSink::new()));
    let outcome = crate::agent::run(&invocation_with(dir, session_id, set), &emitter).await;
    assert_eq!(outcome, SessionOutcome::Ran, "the driven session launched");
}

/// Assemble a driven session's journal into a committed fixture at `target`.
fn freeze(workspace: &Path, target: &Path) {
    assemble_journal_to_gz(&workspace.join(GG_REPLAY_JOURNAL_PATH), target)
        .expect("the journal assembles into a fixture");
    let bytes = std::fs::metadata(target)
        .expect("the fixture was written")
        .len();
    assert!(
        bytes <= MAX_FIXTURE_BYTES,
        "the captured fixture {} is {bytes} bytes, over the {MAX_FIXTURE_BYTES}-byte cap",
        target.display(),
    );
    println!("captured {} ({bytes} bytes)", target.display());
}
