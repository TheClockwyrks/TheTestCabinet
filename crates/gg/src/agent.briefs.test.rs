//! The **briefs gg generates for the agents it delegates to** — the reviewer, the fix agent, the
//! speculation attempts, and the judge.
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

/// **No brief teaches an ending.**
///
/// Each brief below is the whole of what its agent was told to do, and none of them names a call, a
/// marker line, or a way to stop. The ending is the role's, not the brief's.
///
/// The forbidden phrases are the ones that were actually there. "End your final message with
/// exactly one line" and "call `harness.finish()` passing exactly one verdict as its summary" were
/// the two halves of a verdict protocol the loop then had to parse back out of prose — the reason a
/// reviewer could reject work while naming nothing to fix, and a judge could end with no winner at
/// all.
#[test]
fn no_generated_brief_teaches_an_ending() {
    let attempts = [SpeculationAttempt {
        id: "sub-1".to_string(),
        branch: "gg/spec-1".to_string(),
        path: PathBuf::from("/tmp/spec-1"),
        base: "0".repeat(40),
        status: STATUS_COMPLETED.to_string(),
        summary: "built it".to_string(),
        diff: "+ a line".to_string(),
    }];
    let briefs = [
        (
            "review",
            build_review_brief(
                "## Issue\nMake it work.",
                ReviewChanges {
                    summary: " src/main.rs | 2 +-",
                    baseline: Some(&"0".repeat(40)),
                },
                Vec::new(),
            ),
        ),
        (
            "judge",
            build_judge_brief("Build the thing.", &attempts, &[0]),
        ),
        (
            "merge",
            build_merge_brief("gg/issue-auth-1", "both sides touched `main.rs`"),
        ),
        (
            "fix",
            build_fix_brief("## Issue\nMake it work.", &["Fix the score.".to_string()]),
        ),
        (
            "attempt",
            build_attempt_brief("Build the thing.", 0, 3, None),
        ),
    ];

    for (name, brief) in &briefs {
        let lower = brief.to_ascii_lowercase();
        for forbidden in [
            "finish(",
            "harness.",
            "then stop",
            "end your final message",
            "stop with a short summary",
            "review:",
            "speculation judge",
        ] {
            assert!(
                !lower.contains(forbidden),
                "the {name} brief teaches an ending (`{forbidden}`):\n{brief}"
            );
        }
    }
}

/// **No brief names the harness, or the case a run is scored against.**
///
/// An agent is told what to do and how. That it is running under gg, inside a test case, for a
/// score, is not information it can act on — and naming it invites a model to reason about the
/// evaluation instead of the work.
#[test]
fn no_generated_brief_names_the_harness() {
    let briefs = [
        build_review_brief(
            "## Issue\nMake it work.",
            ReviewChanges {
                summary: " src/main.rs | 2 +-",
                baseline: None,
            },
            Vec::new(),
        ),
        build_fix_brief("## Issue\nMake it work.", &["Fix the score.".to_string()]),
        build_merge_brief("gg/issue-auth-1", "conflict"),
        build_attempt_brief("Build the thing.", 0, 3, None),
    ];
    for brief in &briefs {
        let lower = brief.to_ascii_lowercase();
        for forbidden in ["gg ", "gg's", "test cabinet", "the harness"] {
            assert!(!lower.contains(forbidden), "leaked `{forbidden}`:\n{brief}");
        }
    }
}

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
