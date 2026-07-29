//! The **briefs gg generates for the agents it delegates to** — the reviewer, the fix agent, the
//! speculation attempts, and the judge.
//!
//! A brief is model-facing product text like the system prompt, and its prose is a
//! [template](crate::prompts) like the system prompt's. What is tested *here* rather than beside the
//! templates is the property the **loop** depends on — the *ending each brief teaches*, which is the
//! one thing a brief can get wrong that costs a whole review round or a whole speculation without
//! failing anything. Each builder takes a `code` flag, and under
//! [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) there is no final message to end and no
//! stopping that is not a [`finish`](FINISH_FUNCTION) call. A brief that teaches the wrong ending
//! fails silently — the child does the work, never reaches `completed`, and everything gated on that
//! status quietly discards it.

use super::*;

/// **No brief gg generates tells a code-mode agent to stop.**
///
/// Under [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) there is no final message to end and no
/// stopping that is not a [`finish`](FINISH_FUNCTION) call, and four consumers gate on the
/// `completed` a delegated agent only reaches by calling it: the reviewer verdict, the judge
/// verdict, the speculation candidate filter, and the worktree merge. A brief that says "then stop"
/// or "end your final message" therefore costs a whole review loop or a whole speculation, silently
/// — the child does its work, ends `exhausted`, and its worktree is discarded.
///
/// All four are asserted together because the failure is uniform: each ending clause is one `if
/// code` away from the tool-calling wording, and `build_fix_brief`'s arm is otherwise reached only
/// when a reviewer requests changes.
#[test]
fn no_generated_brief_tells_a_code_mode_agent_to_stop() {
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
                    workspace: "/work/.gg-worktrees/issue-1",
                    baseline: Some(&"0".repeat(40)),
                },
                Vec::new(),
                true,
            ),
        ),
        (
            "fix",
            build_fix_brief(
                "## Issue\nMake it work.",
                &["Fix the score.".to_string()],
                true,
            ),
        ),
        (
            "attempt",
            build_attempt_brief("Build the thing.", 0, 3, None, true),
        ),
        (
            "judge",
            build_judge_brief("Build the thing.", &attempts, &[0], true),
        ),
    ];

    for (name, brief) in &briefs {
        assert!(
            brief.contains("finish("),
            "the {name} brief never names the one call that ends a code-mode session:\n{brief}"
        );
        for forbidden in [
            "then stop",
            "end your final message",
            "stop with a short summary",
        ] {
            assert!(
                !brief.to_ascii_lowercase().contains(forbidden),
                "the {name} brief tells a code-mode agent to `{forbidden}`:\n{brief}"
            );
        }
    }

    // The tool-calling arm is untouched: it still teaches the ending that mode actually has, which
    // is what makes the `code` flag a switch rather than a rewrite.
    let tool_calling = build_fix_brief(
        "## Issue\nMake it work.",
        &["Fix the score.".to_string()],
        false,
    );
    assert!(tool_calling.contains("then stop"), "{tool_calling}");
    assert!(!tool_calling.contains("finish("), "{tool_calling}");
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
            workspace: "/work/.gg-worktrees/issue-1",
            baseline: Some(&baseline),
        },
        Vec::new(),
        false,
    );

    // The map of what changed, and where to go read it.
    assert!(brief.contains("src/main.rs"), "{brief}");
    assert!(brief.contains("/work/.gg-worktrees/issue-1"), "{brief}");
    assert!(brief.contains(&format!("git diff {baseline}")), "{brief}");
    // …but no patch: nothing tells the reviewer it was given one, and no diff fence is opened.
    assert!(!brief.contains("```diff"), "{brief}");
    assert!(
        !brief.to_ascii_lowercase().contains("the diff below"),
        "{brief}"
    );

    // With no baseline (a run without git isolation) the reviewer still knows where it is working,
    // and is never told to diff against a commit that does not exist.
    let no_baseline = build_review_brief(
        "## Issue\nMake it work.",
        ReviewChanges {
            summary: "",
            workspace: "/work",
            baseline: None,
        },
        Vec::new(),
        false,
    );
    assert!(no_baseline.contains("/work"), "{no_baseline}");
    assert!(!no_baseline.contains("git diff"), "{no_baseline}");
    assert!(
        no_baseline.contains("No changes were detected"),
        "{no_baseline}"
    );
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
