//! Tests for the `tcab gg-playback` front end.
//!
//! The reconstruction itself is proven in gg's own suite — this is the front end, and what a front
//! end can get wrong is the two things a consumer actually reads: the **exit code** and the
//! **report document**. Both are projections of the library's report, and both have a mode stamped
//! into them precisely so a relaxed reconstruction cannot be mistaken for a clean one; each
//! assertion below is about keeping that stamping honest.

use test_cabinet_core::gg_replay::GgFingerprintComponent;
use test_cabinet_gg::playback::drift::{Drift, DriftKind, DriftVerdict};

use super::*;

/// The arguments a default invocation parses to, so a test that cares about one flag says only
/// that.
fn args() -> GgPlaybackArgs {
    GgPlaybackArgs {
        run_id: None,
        record: Some(PathBuf::from("record.json.gz")),
        workspace: None,
        report: None,
        events: None,
        strictness: StrictnessArg::Exact,
        ordering: OrderingArg::Seq,
        execute_unrecorded: false,
        stop_on_unrecorded: false,
    }
}

/// A `system` fingerprint divergence, the archetype: somebody edited a prompt template.
fn system_drift() -> Drift {
    Drift::reported(
        DriftKind::Fingerprint(GgFingerprintComponent::System),
        "root",
        "the system prompt moved",
    )
    .with_verdict(DriftVerdict::Fatal)
    .with_diff(Some(
        "--- recorded (line 1)\n  a\n+++ live (line 1)\n  b\n".to_string(),
    ))
}

// ---------------------------------------------------------------------------
// The components line
// ---------------------------------------------------------------------------

/// The most diagnostic line in the report names the fingerprint components that moved, and names
/// them in the **matrix's** order rather than in detection order — message count, system, tools,
/// conversation — because that is the order of informativeness the comparison itself uses.
#[test]
fn the_components_line_lists_what_moved_in_the_matrix_order() {
    let divergences = vec![
        Drift::reported(
            DriftKind::Fingerprint(GgFingerprintComponent::Conversation),
            "root",
            "the transcript moved",
        ),
        system_drift(),
        Drift::reported(
            DriftKind::ToolResult,
            "root",
            "read_file answered differently",
        ),
    ];
    assert_eq!(
        moved_components(&divergences),
        vec!["system", "conversation"],
        "the components line names the fingerprint components, in the matrix's order",
    );
}

/// A component is named **once** however many turns it moved on. A prompt edit diverges every turn
/// of every agent, and a components line that repeated `system` two hundred times would bury the
/// one fact it exists to carry.
#[test]
fn a_component_that_moved_on_every_turn_is_named_once() {
    let divergences: Vec<Drift> = (0..5).map(|_| system_drift()).collect();
    assert_eq!(moved_components(&divergences), vec!["system"]);
}

/// A reconstruction that found no *fingerprint* divergence has no components line at all — an
/// empty `components:` would read as a finding.
#[test]
fn a_run_with_no_fingerprint_drift_names_no_components() {
    let divergences = vec![Drift::reported(
        DriftKind::CommandNotRecorded,
        "root",
        "npm run build was not recorded",
    )];
    assert!(moved_components(&divergences).is_empty());
}

// ---------------------------------------------------------------------------
// The escape hatches
// ---------------------------------------------------------------------------

/// The default leaves the library's own miss policy in place — synthesize a classified failure and
/// carry on — rather than restating it here. A second copy of a default is a second thing to keep
/// in step.
#[test]
fn the_default_leaves_the_miss_policy_to_the_library() {
    assert_eq!(miss_policy(&args()), None);
}

/// `--execute-unrecorded` is the **one** flag that lets a playback start a process, and it is
/// never inferred: nothing but typing it selects [`MissPolicy::Execute`].
#[test]
fn executing_an_unrecorded_command_has_to_be_asked_for_by_name() {
    let mut args = args();
    args.execute_unrecorded = true;
    assert_eq!(miss_policy(&args), Some(MissPolicy::Execute));
}

/// `--stop-on-unrecorded` is the opposite posture — nothing rather than a session in which a
/// build's output was invented.
#[test]
fn stopping_on_an_unrecorded_command_selects_the_fatal_policy() {
    let mut args = args();
    args.stop_on_unrecorded = true;
    assert_eq!(miss_policy(&args), Some(MissPolicy::Stop));
}

// ---------------------------------------------------------------------------
// The exit code
// ---------------------------------------------------------------------------

/// The library's codes survive the narrowing to a process status byte unchanged — 0 faithful,
/// 1 exact-and-diverged, 2 `shape`, 3 `none`.
///
/// The distinction between 1 and 2/3 is the whole point of the code carrying the mode, and the
/// narrowing is where it could quietly be lost.
#[test]
fn every_library_exit_code_survives_the_narrowing() {
    for code in 0..=3 {
        assert_eq!(i32::from(exit_byte(code)), code);
    }
}

/// A code that could not be a byte saturates rather than wrapping. `255` is a failure on every
/// shell; a wrap to `0` would report a diverged reconstruction as a faithful one, which is the one
/// mistake this command must never make.
#[test]
fn an_out_of_range_code_saturates_rather_than_wrapping() {
    assert_eq!(exit_byte(256), u8::MAX);
    assert_eq!(exit_byte(-1), u8::MAX);
}
