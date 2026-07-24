//! Tests for the source-tagged context model, its token accounting, and the estimators.

use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::model::Role;
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
