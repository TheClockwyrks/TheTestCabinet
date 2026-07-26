//! Tests for the compaction trigger, the swappable summarizer (including its offline mock
//! path), and the pinned-state-retaining rewrite.

use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::client::{MOCK_COMPACTION_SUMMARY, MockClient};
use crate::context::{ContextModel, HeuristicTokenEstimator, Retention};
use crate::model::Message;
use test_cabinet_core::gg::{GgContextSource, GgContextSourceUsage};

/// The token count of one source band in a per-source usage vec (`0` if absent, though gg
/// always emits every band). Keeps the pre/post composition assertions readable.
fn band_tokens(usage: &[GgContextSourceUsage], source: GgContextSource) -> u64 {
    usage
        .iter()
        .find(|u| u.source == source)
        .map(|u| u.tokens)
        .unwrap_or(0)
}

/// A context model measured with the deterministic heuristic estimator and the given window,
/// so fullness in these tests is exact and fast.
fn model(window_limit: u64) -> ContextModel {
    ContextModel::new(Arc::new(HeuristicTokenEstimator::new()), Some(window_limit))
}

/// A model client for the summarizer: the scripted mock (which answers a marked
/// summarization request off-script).
fn mock() -> MockClient {
    MockClient::new("mock/x", Vec::new())
}

// ---------------------------------------------------------------------------
// Trigger policy resolution
// ---------------------------------------------------------------------------

#[test]
fn policy_defaults_then_honors_a_valid_trigger_fullness() {
    assert_eq!(
        CompactionPolicy::resolve(&json!({})).trigger_fullness,
        DEFAULT_TRIGGER_FULLNESS
    );
    assert_eq!(
        CompactionPolicy::resolve(&json!({ "triggerFullness": 0.6 })).trigger_fullness,
        0.6
    );
    // Out-of-range values are ignored in favor of the default (would compact every turn or
    // never).
    assert_eq!(
        CompactionPolicy::resolve(&json!({ "triggerFullness": 0.0 })).trigger_fullness,
        DEFAULT_TRIGGER_FULLNESS
    );
    assert_eq!(
        CompactionPolicy::resolve(&json!({ "triggerFullness": 1.5 })).trigger_fullness,
        DEFAULT_TRIGGER_FULLNESS
    );
}

#[test]
fn setup_resolves_from_the_capability_set() {
    use test_cabinet_core::gg::{CAPABILITY_COMPACTION, GgCapabilityConfig, GgCapabilitySet};

    // Absent: disabled.
    let off = CompactionSetup::resolve(&GgCapabilitySet::minimal("mock/x"));
    assert!(!off.enabled);

    // Present + enabled with a param: enabled, threshold read.
    let mut set = GgCapabilitySet::minimal("mock/x");
    set.capabilities.push(GgCapabilityConfig {
        id: CAPABILITY_COMPACTION.to_string(),
        enabled: true,
        implementation: None,
        params: json!({ "triggerFullness": 0.7 }),
    });
    let on = CompactionSetup::resolve(&set);
    assert!(on.enabled);
    assert_eq!(on.policy.trigger_fullness, 0.7);
}

/// The summary headroom defaults, honors a valid fraction, and ignores one that would leave
/// the agent no window to work in.
#[test]
fn policy_defaults_then_honors_a_valid_summary_headroom() {
    assert_eq!(
        CompactionPolicy::resolve(&json!({})).summary_headroom,
        DEFAULT_SUMMARY_HEADROOM
    );
    assert_eq!(
        CompactionPolicy::resolve(&json!({ "summaryHeadroom": 0.35 })).summary_headroom,
        0.35
    );
    // Zero headroom is a legitimate (if reckless) choice — the operator asking for the whole
    // window is honored, unlike a negative or window-consuming value.
    assert_eq!(
        CompactionPolicy::resolve(&json!({ "summaryHeadroom": 0.0 })).summary_headroom,
        0.0
    );
    assert_eq!(
        CompactionPolicy::resolve(&json!({ "summaryHeadroom": 0.95 })).summary_headroom,
        DEFAULT_SUMMARY_HEADROOM
    );
    assert_eq!(
        CompactionPolicy::resolve(&json!({ "summaryHeadroom": -0.1 })).summary_headroom,
        DEFAULT_SUMMARY_HEADROOM
    );
}

/// The working window reserves the headroom, never returns zero, and never exceeds the
/// window it narrows.
#[test]
fn policy_working_window_reserves_the_headroom() {
    let default = CompactionPolicy::default();
    assert_eq!(default.working_window(200_000), 160_000);
    // A tiny window still leaves the agent something to fill, rather than a zero
    // denominator that would make every fullness ratio infinite.
    assert_eq!(default.working_window(1), 1);
    assert_eq!(
        CompactionPolicy {
            summary_headroom: 0.0,
            ..CompactionPolicy::default()
        }
        .working_window(200_000),
        200_000
    );
}

/// The window is only reduced when compaction is actually on: an off arm keeps the model's
/// whole window, since there is no summarization call to reserve for.
#[test]
fn working_window_only_reserves_when_compaction_is_on() {
    use test_cabinet_core::gg::{CAPABILITY_COMPACTION, GgCapabilityConfig, GgCapabilitySet};

    let off = GgCapabilitySet::minimal("mock/x");
    assert_eq!(working_window(&off, 200_000), 200_000);

    let mut on = GgCapabilitySet::minimal("mock/x");
    on.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_COMPACTION));
    assert_eq!(working_window(&on, 200_000), 160_000);

    // A disabled compaction capability that carries params is still an off arm.
    let mut disabled = GgCapabilitySet::minimal("mock/x");
    disabled.capabilities.push(GgCapabilityConfig {
        id: CAPABILITY_COMPACTION.to_string(),
        enabled: false,
        implementation: None,
        params: json!({ "summaryHeadroom": 0.5 }),
    });
    assert_eq!(working_window(&disabled, 200_000), 200_000);

    // The headroom param is honored on the enabled arm.
    let mut tuned = GgCapabilitySet::minimal("mock/x");
    tuned.capabilities.push(GgCapabilityConfig {
        id: CAPABILITY_COMPACTION.to_string(),
        enabled: true,
        implementation: None,
        params: json!({ "summaryHeadroom": 0.5 }),
    });
    assert_eq!(working_window(&tuned, 200_000), 100_000);
}

// ---------------------------------------------------------------------------
// The swappable summarizer, offline
// ---------------------------------------------------------------------------

/// The `implementation` string classifies to a strategy: `structured` selects the structured
/// summarizer, and `model`/`default`/empty/`None` — plus any unrecognized name — fall back to
/// the model summarizer, so a study naming a not-yet-built strategy still launches.
#[test]
fn strategy_name_classifies_the_implementation() {
    assert_eq!(strategy_name(Some("structured")), "structured");
    assert_eq!(strategy_name(Some("model")), "model");
    assert_eq!(strategy_name(Some("default")), "model");
    assert_eq!(strategy_name(Some("")), "model");
    assert_eq!(strategy_name(None), "model");
    // An unrecognized strategy falls back to the default rather than failing to launch.
    assert_eq!(strategy_name(Some("not-a-strategy")), "model");
}

/// The resolved setup records the strategy name it selected, so a compaction event can be
/// labelled with the summarizer that produced it.
#[test]
fn setup_records_the_selected_strategy() {
    use test_cabinet_core::gg::{CAPABILITY_COMPACTION, GgCapabilityConfig, GgCapabilitySet};

    let mut structured = GgCapabilitySet::minimal("mock/x");
    structured.capabilities.push(GgCapabilityConfig {
        id: CAPABILITY_COMPACTION.to_string(),
        enabled: true,
        implementation: Some("structured".to_string()),
        params: json!({}),
    });
    assert_eq!(CompactionSetup::resolve(&structured).strategy, "structured");

    // An absent implementation records the default `model` strategy.
    let mut plain = GgCapabilitySet::minimal("mock/x");
    plain
        .capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_COMPACTION));
    assert_eq!(CompactionSetup::resolve(&plain).strategy, "model");
}

/// The default model summarizer is answered offline by the mock's marker path, returning
/// the deterministic canned summary — and **without** consuming a scripted turn, so the
/// mock's main script stays in step across a compaction boundary.
#[tokio::test]
async fn mock_summarizer_answers_offline_without_consuming_the_script() {
    let client = MockClient::with_default_script("mock/echo");
    let summarizer = ModelSummarizer;

    let history = vec![
        Message::user("build a game"),
        Message::assistant(Some("working on it".to_string()), Vec::new()),
    ];
    let summary = summarizer
        .summarize(SummaryRequest {
            history: &history,
            client: &client,
        })
        .await;
    assert_eq!(summary, MOCK_COMPACTION_SUMMARY);

    // The next ordinary (unmarked) turn returns the *first* scripted response — proof the
    // summarization call did not advance the cursor.
    let next = client
        .complete(&[Message::user("go")], &[])
        .await
        .expect("mock completes");
    assert_eq!(
        next.tool_calls.first().map(|c| c.name.as_str()),
        Some("read_skill")
    );
}

/// The `structured` summarizer's prompt carries the marker too, so it is likewise answered
/// offline by the mock — returning the canned summary without advancing the scripted cursor.
/// This proves the second strategy is wired and offline-safe (its section prompt keeps the
/// marker), even though its output is indistinguishable from the default's under the mock.
#[tokio::test]
async fn structured_summarizer_answers_offline_without_consuming_the_script() {
    let client = MockClient::with_default_script("mock/echo");
    let summarizer = StructuredSummarizer;

    let history = vec![
        Message::user("build a game"),
        Message::assistant(Some("working on it".to_string()), Vec::new()),
    ];
    let summary = summarizer
        .summarize(SummaryRequest {
            history: &history,
            client: &client,
        })
        .await;
    assert_eq!(summary, MOCK_COMPACTION_SUMMARY);

    let next = client
        .complete(&[Message::user("go")], &[])
        .await
        .expect("mock completes");
    assert_eq!(
        next.tool_calls.first().map(|c| c.name.as_str()),
        Some("read_skill")
    );
}

// ---------------------------------------------------------------------------
// The trigger: when it does and does not fire
// ---------------------------------------------------------------------------

#[tokio::test]
async fn does_not_compact_when_disabled() {
    let client = mock();
    let setup = CompactionSetup {
        enabled: false,
        policy: CompactionPolicy {
            trigger_fullness: 0.0,
            ..CompactionPolicy::default()
        },
        strategy: "model",
        summarizer: Box::new(ModelSummarizer),
    };
    let mut ctx = model(10);
    ctx.push_system("a system prompt that easily exceeds the tiny window budget here");
    ctx.push_assistant(Some("lots of ephemeral text ".repeat(4)), Vec::new());
    assert!(ctx.fullness().unwrap() >= 1.0, "the window is over-full");

    let event = compact_if_needed(&mut ctx, &client, &setup, RetainedCounts::default()).await;
    assert!(event.is_none(), "a disabled capability never compacts");
}

#[tokio::test]
async fn does_not_compact_below_the_threshold() {
    let client = mock();
    let setup = CompactionSetup {
        enabled: true,
        policy: CompactionPolicy {
            trigger_fullness: 0.9,
            ..CompactionPolicy::default()
        },
        strategy: "model",
        summarizer: Box::new(ModelSummarizer),
    };
    let mut ctx = model(100_000);
    ctx.push_system("short");
    ctx.push_assistant(Some("a little work".to_string()), Vec::new());
    assert!(ctx.fullness().unwrap() < 0.9);

    let event = compact_if_needed(&mut ctx, &client, &setup, RetainedCounts::default()).await;
    assert!(event.is_none(), "below the threshold, nothing compacts");
}

#[tokio::test]
async fn does_not_compact_with_no_ephemeral_history() {
    let client = mock();
    let setup = CompactionSetup {
        enabled: true,
        policy: CompactionPolicy {
            trigger_fullness: 0.1,
            ..CompactionPolicy::default()
        },
        strategy: "model",
        summarizer: Box::new(ModelSummarizer),
    };
    // Over the threshold, but every item is pinned — there is nothing to summarize.
    let mut ctx = model(20);
    ctx.push_system("a pinned system prompt with enough text to cross the low threshold");
    ctx.push_user_prompt("a pinned build prompt");
    assert!(ctx.fullness().unwrap() >= 0.1);
    assert!(!ctx.has_ephemeral());

    let event = compact_if_needed(&mut ctx, &client, &setup, RetainedCounts::default()).await;
    assert!(
        event.is_none(),
        "with no ephemeral history, compaction is a no-op"
    );
}

/// The heart of the retention contract: when compaction fires, the pinned prefix — a read
/// skill body, a memory, and the task list — survives **verbatim**, the ephemeral history
/// is replaced by a single summary item, `afterTokens < beforeTokens`, and the reported
/// retained counts are carried through.
#[tokio::test]
async fn compacts_and_retains_pinned_state_verbatim() {
    let client = mock();
    let setup = CompactionSetup {
        enabled: true,
        policy: CompactionPolicy {
            trigger_fullness: 0.5,
            ..CompactionPolicy::default()
        },
        strategy: "model",
        summarizer: Box::new(ModelSummarizer),
    };

    const SKILL_BODY: &str = "SKILL BODY: scaffold an index.html with a canvas and a loop.";
    const MEMORY_BODY: &str = "MEMORY BODY: the game is an arrow-key maze runner.";
    const TASK_BODY: &str = "TASK BODY: [ ] scaffold; [ ] movement.";
    const BOARD_BODY: &str = "BOARD BODY: epic core-loop; [ ] render-loop; [ ] input-handling.";

    let mut ctx = model(200);
    // Pinned prefix.
    ctx.push_system("SYSTEM PROMPT");
    ctx.push_user_prompt("USER BUILD PROMPT");
    // A read skill is pinned as the tool result answering its read_skill call.
    ctx.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::tool_result("call_skill", SKILL_BODY),
    );
    ctx.push(
        GgContextSource::Memory,
        Retention::Pinned,
        Message::user(MEMORY_BODY),
    );
    ctx.push(
        GgContextSource::TaskList,
        Retention::Pinned,
        Message::user(TASK_BODY),
    );
    // The epic/issue board is pinned like the task list.
    ctx.push(
        GgContextSource::Board,
        Retention::Pinned,
        Message::user(BOARD_BODY),
    );
    // Ephemeral history (the part that gets summarized away).
    ctx.push_assistant(Some("ephemeral chatter ".repeat(10)), Vec::new());
    ctx.push_tool_result(
        GgContextSource::ToolOutput,
        "call_ls",
        "a directory listing ".repeat(10),
    );
    ctx.push_tool_result(
        GgContextSource::FileView,
        "call_read",
        "a file body ".repeat(10),
    );

    assert!(
        ctx.fullness().unwrap() >= 0.5,
        "the window is past the threshold"
    );
    let before = ctx.total_tokens();

    let event = compact_if_needed(
        &mut ctx,
        &client,
        &setup,
        RetainedCounts {
            skills: 1,
            tasks: 2,
            memories: 1,
            issues: 2,
        },
    )
    .await
    .expect("compaction fired at the threshold");

    // The telemetry: reclaimed window, the retention proof, and the strategy/summary/pre-post
    // composition the console's Compaction view reads.
    match event {
        GgTelemetryKind::Compaction {
            strategy,
            trigger_fullness,
            before_tokens,
            after_tokens,
            summary_tokens,
            retained,
            before_by_source,
            after_by_source,
            summary,
            summary_fallback,
        } => {
            assert_eq!(strategy, "model");
            assert_eq!(trigger_fullness, 0.5);
            assert_eq!(before_tokens, before);
            assert!(after_tokens < before_tokens, "compaction reclaimed window");
            assert!(summary_tokens > 0);
            assert_eq!(retained.skills, 1);
            assert_eq!(retained.tasks, 2);
            assert_eq!(retained.memories, 1);
            assert_eq!(retained.issues, 2);
            // The mock answered the summarization request off-script, so it is a real summary,
            // not the fallback note.
            assert_eq!(summary, MOCK_COMPACTION_SUMMARY);
            assert!(!summary_fallback);
            // The pre/post composition straddles the boundary: the ephemeral bands are present
            // before and collapsed after, while the pinned bands persist. Both carry every band.
            let before_tok = |src| band_tokens(&before_by_source, src);
            let after_tok = |src| band_tokens(&after_by_source, src);
            assert_eq!(before_by_source.len(), GgContextSource::ALL.len());
            assert_eq!(after_by_source.len(), GgContextSource::ALL.len());
            assert!(before_tok(GgContextSource::Assistant) > 0);
            assert!(before_tok(GgContextSource::ToolOutput) > 0);
            assert!(before_tok(GgContextSource::FileView) > 0);
            assert_eq!(after_tok(GgContextSource::Assistant), 0);
            assert_eq!(after_tok(GgContextSource::ToolOutput), 0);
            assert_eq!(after_tok(GgContextSource::FileView), 0);
            // The summary lands in the History band, and the pinned bands survive the boundary
            // (their exact token counts can shift slightly — a dangling tool-role skill message
            // is re-framed to a user message — but the bodies are retained verbatim, asserted
            // below).
            assert!(after_tok(GgContextSource::History) > 0);
            assert!(before_tok(GgContextSource::Skill) > 0);
            assert!(after_tok(GgContextSource::Skill) > 0);
        }
        other => panic!("expected a Compaction event, got {other:?}"),
    }

    // The window now: the pinned bands are unchanged, the ephemeral bands are gone, and a
    // single History (summary) item exists.
    assert!(ctx.total_tokens() < before);
    assert_eq!(ctx.tokens_for(GgContextSource::Assistant), 0);
    assert_eq!(ctx.tokens_for(GgContextSource::ToolOutput), 0);
    assert_eq!(ctx.tokens_for(GgContextSource::FileView), 0);
    assert!(
        ctx.tokens_for(GgContextSource::History) > 0,
        "the summary is present"
    );
    assert!(
        ctx.tokens_for(GgContextSource::Skill) > 0,
        "the skill band survives"
    );
    assert!(ctx.tokens_for(GgContextSource::Memory) > 0);
    assert!(ctx.tokens_for(GgContextSource::TaskList) > 0);
    assert!(
        ctx.tokens_for(GgContextSource::Board) > 0,
        "the board band survives"
    );

    // The pinned bodies are retained verbatim (byte-identical) in the rendered messages, and
    // no `tool`-role message dangles (the skill was re-framed to a valid standalone message).
    let messages = ctx.messages();
    let contents: Vec<String> = messages.iter().filter_map(|m| m.content.clone()).collect();
    assert!(
        contents.iter().any(|c| c.contains(SKILL_BODY)),
        "the read skill body survives verbatim"
    );
    assert!(contents.iter().any(|c| c == MEMORY_BODY));
    assert!(contents.iter().any(|c| c == TASK_BODY));
    assert!(
        contents.iter().any(|c| c == BOARD_BODY),
        "the board body survives verbatim"
    );
    assert!(
        contents.iter().any(|c| c.contains(MOCK_COMPACTION_SUMMARY)),
        "the ephemeral history was replaced by the summary"
    );
    assert!(
        messages.iter().all(|m| m.role != crate::model::Role::Tool),
        "no dangling tool message remains after compaction"
    );
    // The summarized ephemeral content is gone from the live window.
    assert!(!contents.iter().any(|c| c.contains("ephemeral chatter")));
}
