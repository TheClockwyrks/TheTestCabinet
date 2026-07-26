//! The **briefs gg generates for the agents it delegates to** — the reviewer, the fix agent, the
//! speculation attempts, and the judge.
//!
//! A brief is model-facing product text like the system prompt, but it is built in `agent.rs` rather
//! than rendered from a template, so it is tested here rather than beside the prompts. What it has to
//! get right is the *ending it teaches*: each builder takes a `code` flag, and under
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
        status: STATUS_COMPLETED.to_string(),
        summary: "built it".to_string(),
        diff: "+ a line".to_string(),
    }];
    let briefs = [
        (
            "review",
            build_review_brief("## Issue\nMake it work.", "+ a line", true),
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
