//! The **briefs gg generates for the agents it delegates to** — the reviewer and the fix agent.
//!
//! A brief is model-facing product text like the system prompt, and its prose is a
//! [template](crate::prompts) like the system prompt's. What is tested *here* rather than beside the
//! templates is what the **loop** depends on: that a brief describes the work and nothing else.
//!
//! In particular no brief teaches an ending. It cannot usefully: an agent's ending calls are decided
//! by the [role](crate::ending::EndingRole) it was dispatched in, they are the only ones in its
//! scope, and the system prompt has already named them. A brief that restated one would be a second
//! authority on the contract — and the mode-dependent version of that restatement is what used to
//! send a code-mode reviewer looking for a final message to end.

use super::*;

/// **A fix brief always has something to act on.**
///
/// The list comes from a `request_changes` call, which refuses an empty one — so the template has no
/// "the reviewer listed nothing" arm to render, and the agent is never sent back to re-read criteria
/// it already believed it had met.
#[test]
fn a_fix_brief_lists_every_requested_change() {
    let brief = build_fix_brief(
        "## Issue\nMake it work.",
        &[
            "Fix the off-by-one in `step()`.".to_string(),
            "Add a restart button.".to_string(),
        ],
    );
    assert!(brief.contains("## Requested changes"), "{brief}");
    assert!(
        brief.contains("1. Fix the off-by-one in `step()`."),
        "{brief}"
    );
    assert!(brief.contains("2. Add a restart button."), "{brief}");
}

/// **A reviewer is sent to the code, not handed it.**
///
/// The brief carries the per-file *summary* of the change and the worktree the reviewer is rooted
/// at; it must not carry the patch. A full diff of a real issue drags in every generated file the
/// work touched — a regenerated lockfile alone can dwarf the code under review — and the reviewer
/// can read any of it for itself, since its tools run in that very tree.
#[test]
fn the_review_brief_points_at_the_worktree_instead_of_pasting_the_diff() {
    let baseline = "0".repeat(40);
    let brief = build_review_brief(
        "## Issue\nMake it work.",
        ReviewChanges {
            summary: " src/main.rs      |  12 ++++--\n package-lock.json | 900 ++++++++",
            baseline: Some(&baseline),
        },
        Vec::new(),
    );

    // The map of what changed, and the commit to diff it against.
    assert!(brief.contains("src/main.rs"), "{brief}");
    assert!(brief.contains(&baseline), "{brief}");
    // …but no patch: nothing tells the reviewer it was given one, and no diff fence is opened.
    assert!(!brief.contains("```diff"), "{brief}");
    assert!(
        !brief.to_ascii_lowercase().contains("the diff below"),
        "{brief}"
    );

    // With no baseline (a run without git isolation) the reviewer still knows where it is working,
    // and is never given a commit to diff against that does not exist.
    let no_baseline = build_review_brief(
        "## Issue\nMake it work.",
        ReviewChanges {
            summary: "",
            baseline: None,
        },
        Vec::new(),
    );
    assert!(!no_baseline.contains("Against `"), "{no_baseline}");
    assert!(no_baseline.contains("Nothing changed"), "{no_baseline}");
}

/// **A blocked agent says what it is blocked on.**
///
/// `blocked` on its own is indistinguishable from stuck, so every wait names its condition: the
/// issue being awaited, or the subagents being collected (summarized past the first few, since a
/// wall of ids on a status line is no more legible than a count).
#[test]
fn a_wait_condition_names_what_is_being_waited_for() {
    match agent_blocked_on("issue `AUTH-1.0`") {
        GgTelemetryKind::AgentStatus { status, waiting_on } => {
            assert_eq!(status, GgAgentStatus::Blocked);
            assert_eq!(waiting_on.as_deref(), Some("issue `AUTH-1.0`"));
        }
        other => panic!("expected an agent status event, got {other:?}"),
    }
    // A non-blocking transition carries no condition — there is nothing to wait for.
    match agent_status(GgAgentStatus::Running) {
        GgTelemetryKind::AgentStatus { waiting_on, .. } => assert!(waiting_on.is_none()),
        other => panic!("expected an agent status event, got {other:?}"),
    }

    assert_eq!(
        waited_subagents_condition(&["sub-1".to_string()]),
        "subagent `sub-1`"
    );
    assert_eq!(
        waited_subagents_condition(&["sub-1".to_string(), "sub-2".to_string()]),
        "subagents `sub-1`, `sub-2`"
    );
    assert_eq!(
        waited_subagents_condition(&[
            "sub-1".to_string(),
            "sub-2".to_string(),
            "sub-3".to_string(),
            "sub-4".to_string(),
            "sub-5".to_string(),
        ]),
        "subagents `sub-1`, `sub-2`, `sub-3` +2 more"
    );
}
