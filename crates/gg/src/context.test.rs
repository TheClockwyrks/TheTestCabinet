//! Tests for the source-tagged context model, its token accounting, and the estimators.

use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::model::{ImageContent, Role};
use test_cabinet_core::gg::GgContextSource;

/// A model measuring with the deterministic heuristic estimator (chars/4 + framing) and
/// a fixed window, so token counts in these tests are exact and fast.
fn model(window_limit: Option<u64>) -> ContextModel {
    ContextModel::new(Arc::new(HeuristicTokenEstimator::new()), window_limit)
}

/// A tool call with the given name and id, for building assistant/tool items.
fn call(id: &str, name: &str) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        name: name.to_string(),
        arguments: json!({ "path": "index.html" }),
    }
}

#[test]
fn prompt_items_expose_source_message_and_tokens_in_order() {
    let mut ctx = model(Some(1000));
    ctx.push_system("system");
    ctx.push_user_prompt("build a game");
    ctx.push_tool_result(tool_output_source("write_file"), "c1", "wrote index.html");

    let items: Vec<_> = ctx.prompt_items().collect();
    assert_eq!(items.len(), 3);

    // Each item carries its band, its message, and the cached estimate — in push order,
    // matching what `messages()` renders and what `total_tokens()` sums.
    let (sources, messages, tokens): (Vec<_>, Vec<_>, Vec<_>) = {
        let mut s = Vec::new();
        let mut m = Vec::new();
        let mut t = Vec::new();
        for (source, message, tok) in &items {
            s.push(*source);
            m.push((*message).clone());
            t.push(*tok);
        }
        (s, m, t)
    };
    assert_eq!(
        sources,
        vec![
            GgContextSource::System,
            GgContextSource::UserPrompt,
            GgContextSource::ToolOutput,
        ]
    );
    assert_eq!(messages, ctx.messages());
    assert_eq!(
        tokens.iter().map(|t| *t as u64).sum::<u64>(),
        ctx.total_tokens()
    );
}

#[test]
fn estimate_matches_the_models_estimator() {
    let ctx = model(Some(1000));
    let message = Message::user("some prompt text");
    // The public estimate helper agrees with the estimator the window is counted by.
    assert_eq!(
        ctx.estimate(&message) as u64,
        HeuristicTokenEstimator::new().estimate_message(&message) as u64
    );
}

#[test]
fn renders_to_messages_in_push_order_faithfully() {
    let mut ctx = model(Some(1000));
    ctx.push_system("system");
    ctx.push_user_prompt("build a game");
    ctx.push_assistant(Some("on it".to_string()), vec![call("c1", "write_file")]);
    ctx.push_tool_result(tool_output_source("write_file"), "c1", "wrote index.html");

    let messages = ctx.messages();
    assert_eq!(messages.len(), 4);

    // Order and role/content are preserved exactly (the Phase 0 transcript shape).
    assert_eq!(messages[0].role, Role::System);
    assert_eq!(messages[0].content.as_deref(), Some("system"));
    assert_eq!(messages[1].role, Role::User);
    assert_eq!(messages[1].content.as_deref(), Some("build a game"));
    assert_eq!(messages[2].role, Role::Assistant);
    assert_eq!(messages[2].content.as_deref(), Some("on it"));
    assert_eq!(messages[2].tool_calls.len(), 1);
    assert_eq!(messages[2].tool_calls[0].id, "c1");
    assert_eq!(messages[3].role, Role::Tool);
    assert_eq!(messages[3].tool_call_id.as_deref(), Some("c1"));
    assert_eq!(messages[3].content.as_deref(), Some("wrote index.html"));
}

#[test]
fn tags_sources_and_retention_per_item() {
    let mut ctx = model(Some(1000));
    ctx.push_system("s");
    ctx.push_user_prompt("u");
    ctx.push_assistant(Some("a".to_string()), Vec::new());
    ctx.push_tool_result(tool_output_source("shell"), "c1", "out");
    ctx.push_tool_result(tool_output_source("read_file"), "c2", "file body");

    let items = ctx.items();
    assert_eq!(items[0].source(), GgContextSource::System);
    assert!(items[0].retention().is_pinned());
    assert_eq!(items[1].source(), GgContextSource::UserPrompt);
    assert!(items[1].retention().is_pinned());
    assert_eq!(items[2].source(), GgContextSource::Assistant);
    assert!(!items[2].retention().is_pinned());
    // A shell result is generic tool output; a file read is a (evictable) file view.
    assert_eq!(items[3].source(), GgContextSource::ToolOutput);
    assert_eq!(items[4].source(), GgContextSource::FileView);
    assert!(!items[3].retention().is_pinned());
    assert!(!items[4].retention().is_pinned());

    // The pinned/ephemeral partition (the Phase 2 seam) reflects the tags.
    assert_eq!(ctx.pinned().count(), 2);
    assert_eq!(ctx.ephemeral().count(), 3);
}

#[test]
fn per_source_accounting_sums_to_the_total() {
    let mut ctx = model(Some(10_000));
    ctx.push_system("system prompt text here");
    ctx.push_user_prompt("the build prompt");
    ctx.push_tool_result(tool_output_source("read_file"), "c1", "a file body");
    ctx.push_tool_result(tool_output_source("read_file"), "c2", "another file body");
    ctx.push_tool_result(tool_output_source("shell"), "c3", "shell output");

    // Each source's figure is the sum of its items; the total is the sum of every band.
    let by_source = ctx.usage_by_source();
    assert_eq!(by_source.len(), GgContextSource::ALL.len());
    let banded_total: u64 = by_source.iter().map(|b| b.tokens).sum();
    assert_eq!(banded_total, ctx.total_tokens());

    // FileView accumulates across both reads.
    let file_view = ctx.tokens_for(GgContextSource::FileView);
    assert!(file_view > 0);
    assert_eq!(
        file_view,
        by_source
            .iter()
            .find(|b| b.source == GgContextSource::FileView)
            .unwrap()
            .tokens
    );
    // A source with no items reports zero (still present, for a stable graph band).
    assert_eq!(ctx.tokens_for(GgContextSource::Skill), 0);
}

#[test]
fn usage_by_source_is_in_stable_all_order() {
    let ctx = model(Some(1000));
    let by_source = ctx.usage_by_source();
    for (band, &source) in by_source.iter().zip(GgContextSource::ALL.iter()) {
        assert_eq!(band.source, source);
        assert_eq!(band.tokens, 0);
    }
}

#[test]
fn fullness_is_total_over_limit_and_unknown_without_a_limit() {
    let mut ctx = model(Some(100));
    ctx.push_system("x"); // heuristic: framing(4) + ceil(1/4)=1 => 5 tokens
    assert_eq!(ctx.total_tokens(), 5);
    assert_eq!(ctx.window_limit(), Some(100));
    assert_eq!(ctx.fullness(), Some(0.05));

    // With no window limit, fullness is unknown (the wire reports it absent).
    let mut no_limit = model(None);
    no_limit.push_system("x");
    assert_eq!(no_limit.fullness(), None);
}

#[test]
fn breakdown_event_carries_the_accounting() {
    let mut ctx = model(Some(1000));
    ctx.push_system("system");
    ctx.push_user_prompt("prompt");

    match ctx.breakdown_event() {
        GgTelemetryKind::ContextBreakdown {
            by_source,
            total_tokens,
            window_limit,
            fullness,
        } => {
            assert_eq!(by_source.len(), GgContextSource::ALL.len());
            assert_eq!(total_tokens, ctx.total_tokens());
            assert_eq!(window_limit, Some(1000));
            assert_eq!(fullness, ctx.fullness());
        }
        other => panic!("expected a ContextBreakdown, got {other:?}"),
    }
}

#[test]
fn heuristic_estimator_counts_are_plausible() {
    let est = HeuristicTokenEstimator::new();
    assert_eq!(est.estimate_str(""), 0);
    // ceil(8 / 4) == 2.
    assert_eq!(est.estimate_str("12345678"), 2);
    // A message adds the fixed framing allowance on top of its text.
    let message = Message::user("12345678");
    assert_eq!(est.estimate_message(&message), MESSAGE_FRAMING_TOKENS + 2);
}

#[test]
fn bpe_estimator_returns_plausible_counts() {
    let est = BpeTokenEstimator::new();
    // Empty is zero; a sentence is a handful of tokens (more than words for punctuation,
    // fewer than characters) — the exact number is an approximation, so bound it loosely.
    assert_eq!(est.estimate_str(""), 0);
    let n = est.estimate_str("The quick brown fox jumps over the lazy dog.");
    assert!(
        (5..=20).contains(&n),
        "a short sentence should be a handful of tokens, got {n}"
    );
    // A message includes its tool-call name and arguments plus the framing allowance.
    let message = Message::assistant(Some("done".to_string()), vec![call("c1", "write_file")]);
    assert!(est.estimate_message(&message) > est.estimate_str("done"));
}

#[test]
fn tool_output_source_maps_reads_to_file_views() {
    assert_eq!(tool_output_source("read_file"), GgContextSource::FileView);
    assert_eq!(tool_output_source("shell"), GgContextSource::ToolOutput);
    assert_eq!(
        tool_output_source("write_file"),
        GgContextSource::ToolOutput
    );
    assert_eq!(tool_output_source("list_dir"), GgContextSource::ToolOutput);
}

// ---------------------------------------------------------------------------
// Agent-managed context: file-view eviction
// ---------------------------------------------------------------------------

#[test]
fn evict_file_views_removes_all_or_by_path_and_reclaims_tokens() {
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    ctx.push_file_view(
        Some("a.js".to_string()),
        "c1",
        "contents of a".repeat(5),
        Vec::new(),
    );
    ctx.push_file_view(
        Some("b.js".to_string()),
        "c2",
        "contents of b".repeat(5),
        Vec::new(),
    );
    ctx.push_tool_result(GgContextSource::ToolOutput, "c3", "some shell output");

    let before = ctx.total_tokens();
    assert!(ctx.tokens_for(GgContextSource::FileView) > 0);

    // Targeted eviction removes only the matching path.
    let result = ctx.evict_file_views(Some("a.js"));
    assert_eq!(result.items, 1);
    assert!(result.tokens > 0);
    assert_eq!(result.paths, vec!["a.js".to_string()]);
    assert!(ctx.total_tokens() < before, "the window was reclaimed");
    // b.js's view remains; other tool output is untouched.
    assert!(ctx.tokens_for(GgContextSource::FileView) > 0);
    assert!(ctx.tokens_for(GgContextSource::ToolOutput) > 0);

    // A blanket eviction removes the rest of the file views (and nothing else).
    let rest = ctx.evict_file_views(None);
    assert_eq!(rest.items, 1);
    assert_eq!(rest.paths, vec!["b.js".to_string()]);
    assert_eq!(
        ctx.tokens_for(GgContextSource::FileView),
        0,
        "the file-view band drops to zero after eviction"
    );
    assert!(ctx.tokens_for(GgContextSource::ToolOutput) > 0);
}

#[test]
fn evict_file_views_on_a_missing_path_reclaims_nothing() {
    let mut ctx = model(Some(100_000));
    ctx.push_file_view(Some("a.js".to_string()), "c1", "body", Vec::new());
    let before = ctx.total_tokens();
    let result = ctx.evict_file_views(Some("nope.js"));
    assert_eq!(result.items, 0);
    assert_eq!(result.tokens, 0);
    assert_eq!(ctx.total_tokens(), before);
}

// ---------------------------------------------------------------------------
// Agent-managed context: thread archival
// ---------------------------------------------------------------------------

#[test]
fn archive_thread_removes_old_turns_keeping_the_recent_one() {
    let mut ctx = model(Some(100_000));
    // Pinned prefix (never archived).
    ctx.push_system("system");
    ctx.push_user_prompt("build");
    ctx.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::user("SKILL BODY"),
    );
    // Turn 0.
    ctx.push_assistant(
        Some("turn zero reading".to_string()),
        vec![call("c1", "read_file")],
    );
    ctx.push_file_view(Some("a.js".to_string()), "c1", "a contents", Vec::new());
    // Turn 1.
    ctx.push_assistant(
        Some("turn one listing".to_string()),
        vec![call("c2", "list_dir")],
    );
    ctx.push_tool_result(GgContextSource::ToolOutput, "c2", "listing output");
    // Turn 2 (current).
    ctx.push_assistant(Some("turn two current".to_string()), Vec::new());

    let before = ctx.total_tokens();
    let result = ctx.archive_thread(1); // keep the current turn, archive 0 and 1.
    assert!(result.tokens > 0);
    // Four items archived: two assistant turns and their two tool/file results.
    assert_eq!(result.items.len(), 4);
    assert!(ctx.total_tokens() < before);

    // The pinned prefix survives; the current turn stays live; the older turns are gone.
    let contents: Vec<String> = ctx
        .messages()
        .iter()
        .filter_map(|m| m.content.clone())
        .collect();
    assert!(
        contents.iter().any(|c| c == "SKILL BODY"),
        "skills retained"
    );
    assert!(contents.iter().any(|c| c.contains("turn two current")));
    assert!(!contents.iter().any(|c| c.contains("turn zero reading")));
    assert!(!contents.iter().any(|c| c.contains("turn one listing")));
    assert_eq!(
        ctx.tokens_for(GgContextSource::FileView),
        0,
        "the archived turn's file view left the window"
    );
    assert!(ctx.tokens_for(GgContextSource::Skill) > 0);

    // The archived items carry their source band for the archive store.
    assert!(
        result
            .items
            .iter()
            .any(|it| it.source == GgContextSource::FileView)
    );
}

#[test]
fn archive_thread_keeping_all_turns_archives_nothing() {
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    ctx.push_assistant(Some("only turn".to_string()), Vec::new());
    let before = ctx.total_tokens();
    let result = ctx.archive_thread(5); // more than the number of turns.
    assert!(result.items.is_empty());
    assert_eq!(result.tokens, 0);
    assert_eq!(ctx.total_tokens(), before);
}

#[test]
fn archive_thread_with_zero_keep_archives_all_ephemeral_history() {
    let mut ctx = model(Some(100_000));
    ctx.push_system("system"); // pinned
    ctx.push_assistant(Some("turn a".to_string()), Vec::new());
    ctx.push_assistant(Some("turn b".to_string()), Vec::new());
    let result = ctx.archive_thread(0);
    assert_eq!(result.items.len(), 2);
    // Only the pinned system prompt remains.
    assert_eq!(ctx.tokens_for(GgContextSource::Assistant), 0);
    assert!(ctx.tokens_for(GgContextSource::System) > 0);
}

// ---------------------------------------------------------------------------
// Agent-managed context: the fullness signal
// ---------------------------------------------------------------------------

#[test]
fn fullness_signal_reflects_current_state_and_refreshes_in_place() {
    let mut ctx = model(Some(1000));
    ctx.push_system("the base system prompt");
    ctx.refresh_fullness_signal();

    // The signal is a pinned, system-adjacent line that reports the current fill.
    let signal_after_first = signal_text(&ctx).expect("a signal was injected");
    assert!(signal_after_first.contains("Context window:"));
    assert!(signal_after_first.contains("% full"));
    // It mentions the tools the agent can use to reclaim space.
    assert!(signal_after_first.contains("evict_file_view"));
    assert!(signal_after_first.contains("archive_thread"));

    // There is exactly one signal item, and the base prompt is untouched.
    assert_eq!(count_signal_items(&ctx), 1);
    assert!(
        ctx.messages()
            .iter()
            .any(|m| m.content.as_deref() == Some("the base system prompt"))
    );

    // Grow the window, refresh again: still exactly one signal (refreshed in place), and the
    // reported percentage tracks the larger window.
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "x".repeat(2000));
    ctx.refresh_fullness_signal();
    assert_eq!(count_signal_items(&ctx), 1);
    let signal_after_growth = signal_text(&ctx).unwrap();
    assert_ne!(
        signal_after_first, signal_after_growth,
        "the signal updated to the new fill"
    );
    // The larger tool output shows up as a top consumer.
    assert!(signal_after_growth.contains("tool output"));
}

#[test]
fn no_fullness_signal_without_a_window_limit() {
    let mut ctx = model(None);
    ctx.push_system("system");
    ctx.refresh_fullness_signal();
    assert_eq!(count_signal_items(&ctx), 0);
}

/// The text of the current fullness-signal item, if any (a `System` item whose content is the
/// signal line — identified here by its stable "Context window:" prefix).
fn signal_text(ctx: &ContextModel) -> Option<String> {
    ctx.items()
        .iter()
        .find(|item| {
            item.source() == GgContextSource::System
                && item
                    .message()
                    .content
                    .as_deref()
                    .is_some_and(|c| c.starts_with("Context window:"))
        })
        .and_then(|item| item.message().content.clone())
}

/// How many fullness-signal items exist (should always be 0 or 1).
fn count_signal_items(ctx: &ContextModel) -> usize {
    ctx.items()
        .iter()
        .filter(|item| {
            item.source() == GgContextSource::System
                && item
                    .message()
                    .content
                    .as_deref()
                    .is_some_and(|c| c.starts_with("Context window:"))
        })
        .count()
}

// ---------------------------------------------------------------------------
// Prompt cacheability: a turn's rendered window must extend the previous turn's
// ---------------------------------------------------------------------------

#[test]
fn replacing_a_source_with_an_unchanged_block_leaves_it_in_place() {
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    let block = Message::user("# Your tasks\n\n- [ ] scaffold");
    ctx.replace_source(
        GgContextSource::TaskList,
        Retention::Pinned,
        Some(block.clone()),
    );

    // A turn's worth of history lands after the block.
    ctx.push_assistant(None, vec![call("c1", "shell")]);
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "exit code: 0");
    let before = ctx.messages();

    // The next turn rebuilds the same block from an unchanged store: it must not be lifted
    // out and re-appended behind the history above, because that would rewrite the prompt
    // just before its end and cost the run its prompt cache.
    ctx.replace_source(
        GgContextSource::TaskList,
        Retention::Pinned,
        Some(block.clone()),
    );
    assert_eq!(ctx.messages(), before, "an unchanged block did not move");
    assert_eq!(
        ctx.messages()[1].content.as_deref(),
        Some("# Your tasks\n\n- [ ] scaffold"),
        "the block kept its original position"
    );
    assert_eq!(
        ctx.items()
            .iter()
            .filter(|item| item.source() == GgContextSource::TaskList)
            .count(),
        1,
        "still exactly one block"
    );
}

#[test]
fn replacing_a_source_with_a_changed_block_moves_it_to_the_tail() {
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    ctx.replace_source(
        GgContextSource::TaskList,
        Retention::Pinned,
        Some(Message::user("# Your tasks\n\n- [ ] scaffold")),
    );
    ctx.push_assistant(None, vec![call("c1", "add_task")]);
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "Added task `core`.");

    ctx.replace_source(
        GgContextSource::TaskList,
        Retention::Pinned,
        Some(Message::user("# Your tasks\n\n- [ ] scaffold\n- [ ] core")),
    );

    let messages = ctx.messages();
    assert_eq!(
        messages.last().unwrap().content.as_deref(),
        Some("# Your tasks\n\n- [ ] scaffold\n- [ ] core"),
        "a block with news for the model is appended at the tail"
    );
    // The superseded copy stays exactly where it was: deleting it out of the middle would
    // invalidate the cache for every message after it, which is the whole cost being avoided.
    assert_eq!(
        messages[1].content.as_deref(),
        Some("# Your tasks\n\n- [ ] scaffold"),
        "the superseded copy is left in place"
    );
    // ...but it is no longer the live block: it counts as ordinary ephemeral history, so the
    // task-list band reflects only the current list and a compaction summarizes the old one.
    let task_items: Vec<_> = ctx
        .items()
        .iter()
        .filter(|item| item.source() == GgContextSource::TaskList)
        .collect();
    assert_eq!(task_items.len(), 1, "exactly one live block");
    assert_eq!(
        task_items[0].message().content.as_deref(),
        Some("# Your tasks\n\n- [ ] scaffold\n- [ ] core")
    );
    let superseded = &ctx.items()[1];
    assert_eq!(superseded.source(), GgContextSource::History);
    assert!(!superseded.retention().is_pinned());
}

#[test]
fn a_changed_block_still_extends_the_previous_window() {
    // The regression the first fix missed: holding an unchanged block still meant that when it
    // *did* change it was yanked out of the middle, invalidating every message behind it — and
    // the longer it had held still, the more that cost. Superseding in place keeps the render
    // append-only across the change too.
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    ctx.replace_source(
        GgContextSource::TaskList,
        Retention::Pinned,
        Some(Message::user("# Your tasks\n\n- [ ] verify")),
    );
    // A long stretch of history accumulates behind the block while it holds still.
    for turn in 0..6 {
        let id = format!("c{turn}");
        ctx.push_assistant(None, vec![call(&id, "shell")]);
        ctx.push_tool_result(GgContextSource::ToolOutput, &id, "exit code: 0");
        ctx.replace_source(
            GgContextSource::TaskList,
            Retention::Pinned,
            Some(Message::user("# Your tasks\n\n- [ ] verify")),
        );
    }
    let before = ctx.messages();

    // Now the model completes the task, so the block genuinely changes.
    ctx.push_assistant(None, vec![call("done", "complete_task")]);
    ctx.push_tool_result(GgContextSource::ToolOutput, "done", "Marked `verify` done.");
    ctx.replace_source(
        GgContextSource::TaskList,
        Retention::Pinned,
        Some(Message::user("# Your tasks\n\n- [x] verify")),
    );

    let after = ctx.messages();
    assert!(
        after.starts_with(&before),
        "a changed block must not rewrite the window behind it"
    );
    assert_eq!(
        after.last().unwrap().content.as_deref(),
        Some("# Your tasks\n\n- [x] verify")
    );
}

#[test]
fn replacing_a_source_collapses_multiple_items_back_to_one() {
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    let block = Message::user("# Memories\n\n- plan");
    // Two items for one single-block source (a shape no caller should produce, but the
    // in-place path must not mistake it for "already correct").
    ctx.push(GgContextSource::Memory, Retention::Pinned, block.clone());
    ctx.push(GgContextSource::Memory, Retention::Pinned, block.clone());

    ctx.replace_source(GgContextSource::Memory, Retention::Pinned, Some(block));
    assert_eq!(
        ctx.items()
            .iter()
            .filter(|item| item.source() == GgContextSource::Memory)
            .count(),
        1,
        "collapsed to a single block"
    );
}

#[test]
fn replacing_an_absent_source_with_nothing_changes_nothing() {
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    let before = ctx.messages();
    ctx.replace_source(GgContextSource::TaskList, Retention::Pinned, None);
    assert_eq!(ctx.messages(), before);
}

#[test]
fn an_unchanged_fullness_signal_stays_where_it_is() {
    // A 100k window rounds its reported figures to the nearest 1k, so a small growth does
    // not change the line.
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    ctx.refresh_fullness_signal();
    // The *live* signal: a superseded copy is retagged to `History`, so it no longer matches.
    let signal_index = |ctx: &ContextModel| {
        ctx.items()
            .iter()
            .position(|item| {
                item.source() == GgContextSource::System
                    && item
                        .message()
                        .content
                        .as_deref()
                        .is_some_and(|c| c.starts_with("Context window:"))
            })
            .expect("a signal is present")
    };
    assert_eq!(signal_index(&ctx), 1);

    ctx.push_assistant(None, vec![call("c1", "shell")]);
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "exit code: 0");
    let before = ctx.messages();
    ctx.refresh_fullness_signal();

    assert_eq!(
        ctx.messages(),
        before,
        "a signal whose figures did not move stays put, keeping the prompt an extension"
    );
    assert_eq!(signal_index(&ctx), 1);
    assert_eq!(count_signal_items(&ctx), 1);

    // Growth past the reporting resolution appends a fresh line — the signal still tracks the
    // window — while the superseded copy stays put so the prompt is still an extension.
    ctx.push_tool_result(GgContextSource::ToolOutput, "c2", "x".repeat(40_000));
    let before = ctx.messages();
    ctx.refresh_fullness_signal();
    assert!(ctx.messages().starts_with(&before));
    assert_eq!(count_signal_items(&ctx), 1, "exactly one live signal");
    assert_eq!(
        signal_index(&ctx),
        ctx.items().len() - 1,
        "a meaningfully changed signal is appended at the tail"
    );
}

#[test]
fn fullness_figures_are_reported_at_one_percent_of_the_window() {
    assert_eq!(fullness_report_granularity(100_000), 1_000);
    // A tiny or zero limit never divides by zero or rounds everything to nothing.
    assert_eq!(fullness_report_granularity(50), 1);
    assert_eq!(fullness_report_granularity(0), 1);

    // Round-half-up to the nearest multiple, and an exact multiple is unchanged.
    assert_eq!(round_to(1_499, 1_000), 1_000);
    assert_eq!(round_to(1_500, 1_000), 2_000);
    assert_eq!(round_to(2_000, 1_000), 2_000);
    // A granularity of one reports the exact figure.
    assert_eq!(round_to(1_234, 1), 1_234);
}

#[test]
fn every_turn_extends_the_previous_turns_window() {
    // The property a provider prompt cache needs, and the one this module owes the loop: turn
    // N+1's rendered messages always start with turn N's. Every mutable block is refreshed each
    // turn here — the memory block, the task list, the board, and the fullness signal — some
    // holding still, some genuinely changing, and the window still only ever grows.
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    ctx.push_user_prompt("build a game");

    let memories = Message::user("# Memories\n\n- plan");
    let mut previous: Option<Vec<Message>> = None;

    for turn in 0..12 {
        // The memory block never changes; the task list changes on some turns and the board on
        // others, so changes land both together and apart.
        ctx.replace_source(
            GgContextSource::Memory,
            Retention::Pinned,
            Some(memories.clone()),
        );
        ctx.replace_source(
            GgContextSource::TaskList,
            Retention::Pinned,
            Some(Message::user(format!(
                "# Your tasks\n\n- [ ] step {}",
                turn / 3
            ))),
        );
        ctx.replace_source(
            GgContextSource::Board,
            Retention::Pinned,
            Some(Message::user(format!("# Board\n\n- issue {}", turn / 4))),
        );
        // Growing tool output pushes the fullness figures past their reporting resolution now
        // and then, so the signal changes on its own schedule as well.
        ctx.refresh_fullness_signal();

        let rendered = ctx.messages();
        if let Some(previous) = &previous {
            assert!(
                rendered.starts_with(previous),
                "turn {turn} did not extend turn {}'s window",
                turn - 1
            );
        }
        previous = Some(rendered);

        let id = format!("c{turn}");
        ctx.push_assistant(None, vec![call(&id, "shell")]);
        ctx.push_tool_result(GgContextSource::ToolOutput, &id, "x".repeat(4_000));
    }

    // Each mutable source still has exactly one live block at the end.
    for source in [
        GgContextSource::Memory,
        GgContextSource::TaskList,
        GgContextSource::Board,
    ] {
        assert_eq!(
            ctx.items()
                .iter()
                .filter(|item| item.source() == source)
                .count(),
            1,
            "{source:?} kept a single live block"
        );
    }
}

// ---------------------------------------------------------------------------
// Images in the window
// ---------------------------------------------------------------------------

/// An `ImageContent` of `bytes` decoded size, with placeholder data.
fn image(bytes: u64) -> ImageContent {
    ImageContent::new("image/png", "QUJD", bytes)
}

#[test]
fn an_attached_image_is_charged_to_the_window() {
    // An image accounted as free would let fullness drift below the truth and delay
    // compaction — precisely on the runs that read the most reference material.
    let mut with_image = model(Some(100_000));
    with_image.push_file_view(
        Some("ref.png".to_string()),
        "c1",
        "`ref.png` — PNG image, 400 KB.",
        vec![image(400 * 1024)],
    );

    let mut without = model(Some(100_000));
    without.push_file_view(
        Some("ref.png".to_string()),
        "c1",
        "`ref.png` — PNG image, 400 KB.",
        Vec::new(),
    );

    assert!(
        with_image.total_tokens() > without.total_tokens() + 100,
        "the picture costs materially more than its caption alone"
    );
    // And it is attributed to the file-view band, so eviction can reclaim it.
    assert!(with_image.tokens_for(GgContextSource::FileView) > 100);
}

#[test]
fn estimate_image_scales_with_size_and_has_a_floor() {
    assert!(estimate_image(1024 * 1024) > estimate_image(64 * 1024));
    // Even a tiny icon is charged something rather than nothing.
    assert!(estimate_image(0) > 0);
}

#[test]
fn evicting_a_file_view_reclaims_its_image_too() {
    let mut ctx = model(Some(100_000));
    ctx.push_file_view(
        Some("ref.png".to_string()),
        "c1",
        "`ref.png` — PNG image.",
        vec![image(400 * 1024)],
    );
    let result = ctx.evict_file_views(Some("ref.png"));
    assert_eq!(result.items, 1);
    assert!(result.tokens > 100, "the image's cost came back");
    assert_eq!(ctx.tokens_for(GgContextSource::FileView), 0);
}

#[test]
fn strip_images_drops_pictures_but_keeps_the_conversation_well_formed() {
    let mut ctx = model(Some(100_000));
    ctx.push_system("system");
    ctx.push_assistant(None, vec![call("c1", "read_file")]);
    ctx.push_file_view(
        Some("ref.png".to_string()),
        "c1",
        "`ref.png` — PNG image, 400 KB.",
        vec![image(400 * 1024)],
    );
    let before = ctx.total_tokens();

    let stripped = ctx.strip_images("[note]");
    assert_eq!(stripped, 1);

    let messages = ctx.messages();
    let result = messages
        .iter()
        .find(|m| m.role == Role::Tool)
        .expect("the tool result survives");
    // The picture is gone…
    assert!(result.images.is_empty());
    // …but the result still answers the assistant's call, so the provider does not see
    // a tool call with no matching result.
    assert_eq!(result.tool_call_id.as_deref(), Some("c1"));
    // The model is told where the image went rather than left to notice it vanished.
    let content = result.content.as_deref().unwrap_or_default();
    assert!(content.contains("ref.png"), "{content}");
    assert!(content.contains("[note]"), "{content}");
    // And the window is re-accounted, reclaiming what the image cost.
    assert!(ctx.total_tokens() < before);
}

#[test]
fn strip_images_is_a_no_op_when_there_are_none() {
    // The loop uses this to decide whether a provider refusal is recoverable at all: a
    // zero here means dropping pictures cannot help, so retrying would only spin.
    let mut ctx = model(Some(100_000));
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "shell output");
    let before = ctx.total_tokens();
    assert_eq!(ctx.strip_images("[note]"), 0);
    assert_eq!(ctx.total_tokens(), before);
}
