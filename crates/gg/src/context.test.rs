//! Tests for the source-tagged context model, its token accounting, and the estimators.

use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::model::{ImageContent, Role};
use test_cabinet_core::gg::GgContextSource;

/// A model measuring with the deterministic heuristic estimator (chars/4 + framing) and
/// a fixed window, so token counts in these tests are exact and fast.
fn model(window_limit: Option<u64>) -> ContextModel {
    ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        window_limit,
        false,
    )
}

/// Like [`model`] but in [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE)
/// mode, where synthesized `user` messages carry a [heading](code_heading).
fn code_model(window_limit: Option<u64>) -> ContextModel {
    ContextModel::new(Arc::new(HeuristicTokenEstimator::new()), window_limit, true)
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
fn prompt_items_expose_source_message_tokens_and_label_in_order() {
    let mut ctx = model(Some(1000));
    ctx.set_system("system");
    ctx.push_user_prompt("build a game");
    ctx.push_tool_result(tool_output_source("write_file"), "c1", "wrote index.html");
    ctx.push_file_view(
        Some("index.html".to_string()),
        None,
        "c2",
        "<html></html>",
        Vec::new(),
    );

    let items: Vec<_> = ctx.prompt_items().collect();
    assert_eq!(items.len(), 4);

    // Each item carries its band, its message, the cached estimate, and its selector tag —
    // in push order, matching what `messages()` renders and what `total_tokens()` sums.
    assert_eq!(
        items.iter().map(|i| i.source).collect::<Vec<_>>(),
        vec![
            GgContextSource::System,
            GgContextSource::UserPrompt,
            GgContextSource::ToolOutput,
            GgContextSource::FileView,
        ]
    );
    assert_eq!(
        items.iter().map(|i| i.message.clone()).collect::<Vec<_>>(),
        ctx.messages()
    );
    assert_eq!(
        items.iter().map(|i| i.tokens as u64).sum::<u64>(),
        ctx.total_tokens()
    );
    // Only the file view is tagged — with the path it shows, which is what makes its share
    // of the window attributable to a file rather than only to the `file_view` band.
    assert_eq!(
        items.iter().map(|i| i.label).collect::<Vec<_>>(),
        vec![None, None, None, Some("index.html")]
    );
}

/// The four window-model fields [session capture](crate::capture) records as a prompt frame, and
/// the only place they are observable once a turn has gone out: the slot an item was rendered
/// from, its retention class, the turn it was pushed on, and a paged file view's region.
#[test]
fn prompt_items_carry_the_window_model_fields_a_rendered_message_loses() {
    let mut ctx = model(Some(10_000));
    ctx.set_system("system");
    ctx.push_user_prompt("build a game");
    ctx.begin_turn(3);
    ctx.push_file_view(
        Some("index.html".to_string()),
        Some(FileRegion {
            offset: 40,
            limit: 25,
        }),
        "c1",
        "<html></html>",
        Vec::new(),
    );
    ctx.refresh_context_usage_signal(signal_options());

    let items: Vec<_> = ctx.prompt_items().collect();
    assert_eq!(items.len(), 4);

    // The two ends are slots; everything between them is thread material. The signal is last
    // because it reports figures computed over the rest.
    assert_eq!(
        items.iter().map(|i| i.slot).collect::<Vec<_>>(),
        vec![
            PromptSlot::System,
            PromptSlot::Thread,
            PromptSlot::Thread,
            PromptSlot::ContextUsage,
        ]
    );
    // The system prompt and the build prompt survive a compaction; the file view and the
    // rebuilt signal are what compaction and eviction act on / replace.
    assert_eq!(
        items.iter().map(|i| i.retention).collect::<Vec<_>>(),
        vec![
            Retention::Pinned,
            Retention::Pinned,
            Retention::Ephemeral,
            Retention::Pinned,
        ]
    );
    // The opening context is unnumbered; everything pushed after `begin_turn(3)` carries it,
    // the re-assigned signal included.
    assert_eq!(
        items.iter().map(|i| i.turn).collect::<Vec<_>>(),
        vec![0, 0, 3, 3]
    );
    // Only the paged read carries a region — the window it actually covers, which is what a
    // reconstruction has to re-open to hold the same view.
    assert_eq!(
        items.iter().map(|i| i.region).collect::<Vec<_>>(),
        vec![
            None,
            None,
            Some(FileRegion {
                offset: 40,
                limit: 25
            }),
            None,
        ]
    );
}

/// Why the slot is worth recording at all: the system prompt and the rebuilt context-usage
/// signal are **identical** on every other axis — same band, same retention, no label, both
/// `system`-role messages — so nothing but the slot tells them apart downstream.
#[test]
fn the_slot_is_the_only_thing_separating_the_system_prompt_from_the_usage_signal() {
    let mut ctx = model(Some(10_000));
    ctx.set_system("the base system prompt");
    ctx.push_user_prompt("build a game");
    ctx.refresh_context_usage_signal(signal_options());

    let items: Vec<_> = ctx.prompt_items().collect();
    let first = items.first().expect("the system prompt is rendered first");
    let last = items.last().expect("the signal is rendered last");
    assert_eq!(first.source, last.source);
    assert_eq!(first.retention, last.retention);
    assert_eq!(first.label, last.label);
    assert_eq!(first.message.role, last.message.role);
    assert_ne!(first.slot, last.slot);
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
    ctx.set_system("system");
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
    ctx.set_system("s");
    ctx.push_user_prompt("u");
    ctx.push_assistant(Some("a".to_string()), Vec::new());
    ctx.push_tool_result(tool_output_source("shell"), "c1", "out");
    ctx.push_tool_result(tool_output_source("read_file"), "c2", "file body");

    // The system prompt is not a thread item: it sits in a slot of its own, rendered first.
    let system = ctx.system().expect("the slot was set");
    assert_eq!(system.source(), GgContextSource::System);
    assert!(system.retention().is_pinned());

    let items = ctx.items();
    assert_eq!(items[0].source(), GgContextSource::UserPrompt);
    assert!(items[0].retention().is_pinned());
    assert_eq!(items[1].source(), GgContextSource::Assistant);
    assert!(!items[1].retention().is_pinned());
    // A shell result is generic tool output; a file read is a (evictable) file view.
    assert_eq!(items[2].source(), GgContextSource::ToolOutput);
    assert_eq!(items[3].source(), GgContextSource::FileView);
    assert!(!items[2].retention().is_pinned());
    assert!(!items[3].retention().is_pinned());

    // The pinned/ephemeral partition (the Phase 2 seam) reflects the tags.
    assert_eq!(ctx.pinned().count(), 1);
    assert_eq!(ctx.ephemeral().count(), 3);
}

#[test]
fn per_source_accounting_sums_to_the_total() {
    let mut ctx = model(Some(10_000));
    ctx.set_system("system prompt text here");
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
    ctx.set_system("x"); // heuristic: framing(4) + ceil(1/4)=1 => 5 tokens
    assert_eq!(ctx.total_tokens(), 5);
    assert_eq!(ctx.window_limit(), Some(100));
    assert_eq!(ctx.fullness(), Some(0.05));

    // With no window limit, fullness is unknown (the wire reports it absent).
    let mut no_limit = model(None);
    no_limit.set_system("x");
    assert_eq!(no_limit.fullness(), None);
}

#[test]
fn breakdown_event_carries_the_accounting() {
    let mut ctx = model(Some(1000));
    ctx.set_system("system");
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
    ctx.set_system("system");
    ctx.push_file_view(
        Some("a.js".to_string()),
        None,
        "c1",
        "contents of a".repeat(5),
        Vec::new(),
    );
    ctx.push_file_view(
        Some("b.js".to_string()),
        None,
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
fn a_locked_file_view_is_spared_by_eviction() {
    let mut ctx = model(Some(100_000));
    // An ordinary (ephemeral) read and a locked (pinned) autoloaded spec, both file views.
    ctx.push_file_view(
        Some("read.md".to_string()),
        None,
        "c1",
        "a read spec",
        Vec::new(),
    );
    ctx.push_file_view_with_retention(
        Some("locked.md".to_string()),
        None,
        "c2",
        "a locked spec",
        Vec::new(),
        Retention::Pinned,
    );

    // A blanket eviction reclaims the ephemeral read but leaves the locked view in place.
    let result = ctx.evict_file_views(None);
    assert_eq!(result.items, 1);
    assert_eq!(result.paths, vec!["read.md".to_string()]);
    assert!(
        ctx.items()
            .iter()
            .any(|item| item.source() == GgContextSource::FileView
                && item.retention() == Retention::Pinned),
        "the locked view survives a blanket eviction"
    );
    // A targeted eviction of the locked path also spares it.
    let targeted = ctx.evict_file_views(Some("locked.md"));
    assert_eq!(targeted.items, 0);
}

#[test]
fn compaction_keeps_a_locked_file_view_and_carries_its_image() {
    let mut ctx = model(Some(100_000));
    ctx.set_system("system");
    ctx.push_user_prompt("build");
    // A locked autoloaded reference image, pinned as an image `tool` result.
    let image = ImageContent::new("image/png", "AAAA".to_string(), 3);
    ctx.push_assistant(None, vec![call("c1", "read_file")]);
    ctx.push_file_view_with_retention(
        Some("reference/title.png".to_string()),
        None,
        "c1",
        "`reference/title.png` — PNG image, 3 bytes. The image follows.",
        vec![image],
        Retention::Pinned,
    );
    // Some ephemeral thread material that a compaction will drop.
    ctx.push_assistant(Some("working".to_string()), Vec::new());

    // The compaction rewrite, composed from the primitive it is built on: drop the ephemeral
    // history, then append the summary the thread restarts from.
    ctx.clear_ephemeral();
    ctx.push(
        GgContextSource::History,
        Retention::Ephemeral,
        Message::user("SUMMARY"),
    );

    // The ephemeral assistant call that "read" it is gone, but the locked view's body stays,
    // re-framed to a user message that still carries the picture (not degraded to its caption).
    let carried = ctx
        .items()
        .iter()
        .find(|item| item.source() == GgContextSource::FileView)
        .expect("the locked file view survived compaction");
    assert_eq!(carried.retention(), Retention::Pinned);
    assert_eq!(carried.message().role, Role::User);
    assert_eq!(
        carried.message().images.len(),
        1,
        "the image travels with the re-framed message"
    );
    assert!(
        ctx.messages()
            .iter()
            .any(|m| m.content.as_deref() == Some("SUMMARY"))
    );
}

#[test]
fn evict_file_views_on_a_missing_path_reclaims_nothing() {
    let mut ctx = model(Some(100_000));
    ctx.push_file_view(Some("a.js".to_string()), None, "c1", "body", Vec::new());
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
fn archive_thread_removes_the_named_turns_and_archives_only_their_results() {
    let mut ctx = model(Some(100_000));
    // Pinned prefix (never archived), seeded before any turn opens.
    ctx.set_system("system");
    ctx.push_user_prompt("build");
    ctx.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::user("SKILL BODY"),
    );
    ctx.begin_turn(1);
    ctx.push_assistant(
        Some("turn one reading".to_string()),
        vec![call("c1", "read_file")],
    );
    ctx.push_file_view(
        Some("a.js".to_string()),
        None,
        "c1",
        "a contents",
        Vec::new(),
    );
    ctx.begin_turn(2);
    ctx.push_assistant(
        Some("turn two listing".to_string()),
        vec![call("c2", "list_dir")],
    );
    ctx.push_tool_result(GgContextSource::ToolOutput, "c2", "listing output");
    ctx.begin_turn(3);
    ctx.push_assistant(Some("turn three current".to_string()), Vec::new());

    let before = ctx.total_tokens();
    let result = ctx.archive_thread(&[TurnRange { from: 1, to: 2 }]);
    assert!(result.tokens > 0);
    // Two results archived (the file view and the tool output); the two assistant messages of
    // those turns are dropped rather than archived.
    assert_eq!(result.items.len(), 2);
    assert_eq!(result.dropped, 2);
    assert_eq!(result.turns, vec![1, 2]);
    assert!(ctx.total_tokens() < before);
    assert!(
        result
            .items
            .iter()
            .all(|it| it.source != GgContextSource::Assistant),
        "an archived turn's own messages are not kept: {:?}",
        result.items.iter().map(|it| it.source).collect::<Vec<_>>()
    );

    // The pinned prefix survives; the un-named turn stays live; the named ones are gone.
    let contents: Vec<String> = ctx
        .messages()
        .iter()
        .filter_map(|m| m.content.clone())
        .collect();
    assert!(
        contents.iter().any(|c| c == "SKILL BODY"),
        "skills retained"
    );
    assert!(contents.iter().any(|c| c.contains("turn three current")));
    assert!(!contents.iter().any(|c| c.contains("turn one reading")));
    assert!(!contents.iter().any(|c| c.contains("turn two listing")));
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
fn archive_thread_ranges_are_inclusive_and_may_overlap() {
    let mut ctx = model(Some(100_000));
    ctx.set_system("system");
    for turn in 1..=5u64 {
        ctx.begin_turn(turn);
        ctx.push_assistant(Some(format!("turn {turn}")), vec![call("c", "shell")]);
        ctx.push_tool_result(GgContextSource::ToolOutput, "c", format!("output {turn}"));
    }

    // [1,2] and [2,4] overlap: turn 2 is removed once, not twice.
    let result = ctx.archive_thread(&[TurnRange { from: 1, to: 2 }, TurnRange { from: 2, to: 4 }]);
    assert_eq!(result.turns, vec![1, 2, 3, 4]);
    assert_eq!(result.items.len(), 4, "one result per archived turn");
    assert_eq!(result.dropped, 4);

    let contents: Vec<String> = ctx
        .messages()
        .iter()
        .filter_map(|m| m.content.clone())
        .collect();
    assert!(contents.iter().any(|c| c.contains("turn 5")));
    for turn in 1..=4 {
        assert!(!contents.iter().any(|c| c.contains(&format!("turn {turn}"))));
    }
}

#[test]
fn archive_thread_never_touches_the_pinned_prefix_or_an_unopened_turn() {
    let mut ctx = model(Some(100_000));
    // Seeded before the first turn, so it carries turn 0.
    ctx.set_system("system");
    ctx.begin_turn(1);
    ctx.push_assistant(Some("turn one".to_string()), Vec::new());

    // A range wide enough to cover everything still leaves the pinned system prompt alone.
    let result = ctx.archive_thread(&[TurnRange { from: 0, to: 99 }]);
    assert_eq!(result.dropped, 1);
    assert!(ctx.tokens_for(GgContextSource::System) > 0);
    assert_eq!(ctx.tokens_for(GgContextSource::Assistant), 0);
}

#[test]
fn archive_thread_with_no_ranges_or_no_match_archives_nothing() {
    let mut ctx = model(Some(100_000));
    ctx.set_system("system");
    ctx.begin_turn(1);
    ctx.push_assistant(Some("only turn".to_string()), Vec::new());

    let before = ctx.total_tokens();
    assert_eq!(ctx.archive_thread(&[]).tokens, 0);
    // A range naming turns that never happened is a no-op rather than an error.
    let result = ctx.archive_thread(&[TurnRange { from: 7, to: 9 }]);
    assert!(result.items.is_empty());
    assert_eq!(result.tokens, 0);
    assert!(result.turns.is_empty());
    assert_eq!(ctx.total_tokens(), before);
}

// ---------------------------------------------------------------------------
// Turn headers on tool results
// ---------------------------------------------------------------------------

#[test]
fn tool_results_carry_a_turn_header_once_archival_is_armed() {
    let mut ctx = model(Some(100_000));
    ctx.enable_turn_headers();
    // Seeded before the first turn: no turn happened yet, so no header.
    ctx.push_file_view(
        Some("spec.md".to_string()),
        None,
        "c0",
        "the whole spec",
        Vec::new(),
    );
    ctx.begin_turn(12);
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "exit code: 0");

    let contents: Vec<String> = ctx
        .messages()
        .iter()
        .filter_map(|m| m.content.clone())
        .collect();
    assert!(
        contents.iter().any(|c| c == "the whole spec"),
        "the opening context is not labelled with a turn that never happened: {contents:?}"
    );
    let headed = contents
        .iter()
        .find(|c| c.contains("exit code: 0"))
        .expect("the result is in the window");
    assert!(
        headed.starts_with("Turn #12\n"),
        "the header leads the result: {headed:?}"
    );
    assert!(headed.contains(" tokens\n----\n"), "{headed:?}");
    assert!(headed.ends_with("exit code: 0"));
}

#[test]
fn turn_headers_are_absent_until_armed() {
    let mut ctx = model(Some(100_000));
    ctx.begin_turn(3);
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "exit code: 0");
    assert_eq!(
        ctx.messages()[0].content.as_deref(),
        Some("exit code: 0"),
        "an agent that cannot archive pays nothing for turn headers"
    );
}

#[test]
fn a_turn_header_reports_the_results_own_cost_with_separators() {
    let mut ctx = model(Some(1_000_000));
    ctx.enable_turn_headers();
    ctx.begin_turn(1);
    // Large enough that the figure is four digits and so carries a thousands separator.
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "token ".repeat(5_000));
    let content = ctx.messages()[0].content.clone().unwrap();
    let reported: String = content
        .lines()
        .nth(1)
        .expect("the token line")
        .trim_end_matches(" tokens")
        .to_string();
    assert!(
        reported.contains(','),
        "separated for reading: {reported:?}"
    );
    let reported: u64 = reported.replace(',', "").parse().expect("a number");
    // The header understates the item by its own length, and by nothing else.
    let actual = ctx.items()[0].tokens() as u64;
    assert!(
        reported <= actual && reported + 40 > actual,
        "{reported} vs {actual}"
    );
}

// ---------------------------------------------------------------------------
// Agent-managed context: the context-usage signal
// ---------------------------------------------------------------------------

/// The default options: a tool-calling agent with both reclaim tools and a five-file breakdown.
fn signal_options() -> UsageSignalOptions {
    UsageSignalOptions {
        can_evict: true,
        program_language: None,
        can_archive: true,
        top_file_views: 5,
    }
}

#[test]
fn the_usage_signal_reports_every_category_as_a_share_of_the_window() {
    let mut ctx = model(Some(10_000));
    ctx.set_system("the base system prompt");
    ctx.push_user_prompt("build a game");
    ctx.replace_source(
        GgContextSource::TaskList,
        Retention::Pinned,
        Some(Message::user("# Your tasks\n\n- [ ] scaffold")),
    );
    ctx.refresh_context_usage_signal(signal_options());

    let text = signal_text(&ctx).expect("a signal was injected");
    assert!(text.starts_with("Context Usage:\n"), "{text}");
    assert!(text.contains("- Overall: "), "{text}");
    // Each category the window actually holds is named with its own share, as a list.
    assert!(text.contains("- System Prompt: "), "{text}");
    assert!(text.contains("- Task Prompt: "), "{text}");
    assert!(text.contains("- Tasks: "), "{text}");
    // A category holding nothing is left out rather than reported as 0.0%.
    assert!(!text.contains("Memories"), "{text}");
    assert!(!text.contains("Board"), "{text}");
    // The figures are percentages to one decimal place.
    assert!(
        text.lines()
            .filter(|line| line.starts_with("- ") && line.contains(": "))
            .all(|line| line.ends_with('%')),
        "{text}"
    );
}

#[test]
fn the_usage_signal_breaks_file_views_down_by_file_when_eviction_is_possible() {
    let mut ctx = model(Some(20_000));
    ctx.set_system("system");
    ctx.push_file_view(
        Some("src/main.rs".to_string()),
        None,
        "c1",
        "main ".repeat(2_000),
        Vec::new(),
    );
    ctx.push_file_view(
        Some("src/foo.rs".to_string()),
        None,
        "c2",
        "foo ".repeat(200),
        Vec::new(),
    );
    ctx.refresh_context_usage_signal(signal_options());

    let text = signal_text(&ctx).unwrap();
    assert!(text.contains("- File Views: "), "{text}");
    assert!(text.contains("- Top File Views:"), "{text}");
    let main_at = text
        .find("`src/main.rs`")
        .expect("the biggest read is listed");
    let foo_at = text
        .find("`src/foo.rs`")
        .expect("the smaller read is listed");
    assert!(main_at < foo_at, "largest first: {text}");
}

/// The whole point of the rewrite: an agent that cannot evict is not handed a ranked list of
/// files it has no way to drop.
#[test]
fn the_file_breakdown_is_withheld_from_an_agent_that_cannot_evict() {
    let mut ctx = model(Some(20_000));
    ctx.set_system("system");
    ctx.push_file_view(
        Some("src/main.rs".to_string()),
        None,
        "c1",
        "main ".repeat(2_000),
        Vec::new(),
    );
    ctx.refresh_context_usage_signal(UsageSignalOptions {
        can_evict: false,
        ..signal_options()
    });

    let text = signal_text(&ctx).unwrap();
    assert!(
        text.contains("- File Views: "),
        "the band is still reported"
    );
    assert!(!text.contains("Top File Views"), "{text}");
    assert!(!text.contains("src/main.rs"), "{text}");
    assert!(!text.contains("evict_file_view"), "{text}");
}

#[test]
fn the_file_breakdown_is_capped_at_the_configured_count() {
    let mut ctx = model(Some(100_000));
    ctx.set_system("system");
    for index in 0..8 {
        ctx.push_file_view(
            Some(format!("src/f{index}.rs")),
            None,
            format!("c{index}"),
            "x".repeat(500 * (8 - index)),
            Vec::new(),
        );
    }
    ctx.refresh_context_usage_signal(UsageSignalOptions {
        top_file_views: 2,
        ..signal_options()
    });

    let text = signal_text(&ctx).unwrap();
    assert_eq!(
        text.matches("src/f").count(),
        2,
        "only the configured number of files is named: {text}"
    );
    assert!(text.contains("`src/f0.rs`"), "the two largest: {text}");
    assert!(text.contains("`src/f1.rs`"), "{text}");
}

/// Repeated reads of one path are one line, because one `evict_file_view { path }` reclaims all
/// of them — three entries would understate what dropping that file buys.
#[test]
fn repeated_reads_of_one_file_are_summed_into_one_entry() {
    let mut ctx = model(Some(100_000));
    ctx.set_system("system");
    for id in ["c1", "c2", "c3"] {
        ctx.push_file_view(
            Some("src/main.rs".to_string()),
            None,
            id,
            "main ".repeat(400),
            Vec::new(),
        );
    }
    ctx.push_file_view(
        Some("src/other.rs".to_string()),
        None,
        "c4",
        "other ".repeat(500),
        Vec::new(),
    );
    ctx.refresh_context_usage_signal(signal_options());

    let text = signal_text(&ctx).unwrap();
    assert_eq!(text.matches("`src/main.rs`").count(), 1, "{text}");
    assert!(
        text.find("`src/main.rs`") < text.find("`src/other.rs`"),
        "the summed three reads outweigh the single larger one: {text}"
    );
}

/// A locked, autoloaded specification is pinned precisely so it cannot be evicted, so listing it
/// among the files to drop would be pointing at the one read that will not go.
#[test]
fn a_pinned_file_view_is_left_out_of_the_breakdown() {
    let mut ctx = model(Some(20_000));
    ctx.set_system("system");
    ctx.push_file_view_with_retention(
        Some("specs/spec.md".to_string()),
        None,
        "c1",
        "spec ".repeat(2_000),
        Vec::new(),
        Retention::Pinned,
    );
    ctx.refresh_context_usage_signal(signal_options());
    let text = signal_text(&ctx).unwrap();
    assert!(!text.contains("specs/spec.md"), "{text}");
}

#[test]
fn the_usage_signal_is_refreshed_in_its_slot_and_never_accumulates() {
    let mut ctx = model(Some(10_000));
    ctx.set_system("the base system prompt");
    ctx.refresh_context_usage_signal(signal_options());
    let first = signal_text(&ctx).unwrap();
    assert_eq!(count_signal_items(&ctx), 1);

    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "x".repeat(20_000));
    ctx.refresh_context_usage_signal(signal_options());
    assert_eq!(count_signal_items(&ctx), 1, "a slot cannot accumulate");
    let second = signal_text(&ctx).unwrap();
    assert_ne!(first, second, "the signal tracked the larger window");
    assert!(second.contains("- Tool Output: "), "{second}");
}

/// The bug this fixes: as a *pinned* item the signal crossed every compaction boundary, so a
/// compacted window opened holding a reading of the window it no longer had — and then gained a
/// second one the moment the next turn refreshed it.
#[test]
fn the_usage_signal_does_not_survive_a_context_reset() {
    let mut ctx = model(Some(10_000));
    ctx.set_system("system");
    ctx.push_assistant(Some("working".to_string()), Vec::new());
    ctx.refresh_context_usage_signal(signal_options());
    assert_eq!(count_signal_items(&ctx), 1);

    ctx.clear_ephemeral();
    assert_eq!(count_signal_items(&ctx), 0, "the stale reading is gone");

    ctx.refresh_context_usage_signal(signal_options());
    assert_eq!(count_signal_items(&ctx), 1, "and exactly one replaces it");
}

/// The signal is always the last message, which is what lets it be rewritten every turn without
/// disturbing the prefix a provider's prompt cache reads.
#[test]
fn the_usage_signal_renders_last() {
    let mut ctx = model(Some(10_000));
    ctx.set_system("system");
    ctx.refresh_context_usage_signal(signal_options());
    ctx.push_assistant(Some("working".to_string()), Vec::new());
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "exit code: 0");

    let messages = ctx.messages();
    assert!(
        messages
            .last()
            .and_then(|m| m.content.as_deref())
            .is_some_and(|c| c.starts_with("Context Usage:")),
        "the signal is appended at the end of the prompt: {messages:?}"
    );
    // It is part of the request, so the log of that request carries it too.
    assert_eq!(ctx.prompt_items().count(), messages.len());
}

#[test]
fn no_usage_signal_without_a_window_limit() {
    let mut ctx = model(None);
    ctx.set_system("system");
    ctx.refresh_context_usage_signal(signal_options());
    assert_eq!(count_signal_items(&ctx), 0);
}

/// The text of the current context-usage signal, if any — identified by its stable heading.
fn signal_text(ctx: &ContextModel) -> Option<String> {
    ctx.messages().into_iter().find_map(|message| {
        message
            .content
            .filter(|content| content.starts_with("Context Usage:"))
    })
}

/// How many context-usage signals the rendered window holds (should always be 0 or 1).
fn count_signal_items(ctx: &ContextModel) -> usize {
    ctx.messages()
        .iter()
        .filter(|message| {
            message
                .content
                .as_deref()
                .is_some_and(|c| c.starts_with("Context Usage:"))
        })
        .count()
}

// ---------------------------------------------------------------------------
// Prompt cacheability: a turn's rendered window must extend the previous turn's
// ---------------------------------------------------------------------------

#[test]
fn replacing_a_source_with_an_unchanged_block_leaves_it_in_place() {
    let mut ctx = model(Some(100_000));
    ctx.set_system("system");
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
    ctx.set_system("system");
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
    let superseded = &ctx.items()[0];
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
    ctx.set_system("system");
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
    ctx.set_system("system");
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
    ctx.set_system("system");
    let before = ctx.messages();
    ctx.replace_source(GgContextSource::TaskList, Retention::Pinned, None);
    assert_eq!(ctx.messages(), before);
}

/// The property the slot buys: the signal is rewritten every turn, and because it renders after
/// every conversation item the *prefix* a prompt cache reads is untouched by that rewrite.
#[test]
fn refreshing_the_signal_only_ever_changes_the_last_message() {
    let mut ctx = model(Some(100_000));
    ctx.set_system("system");
    ctx.refresh_context_usage_signal(signal_options());
    ctx.push_assistant(None, vec![call("c1", "shell")]);
    ctx.push_tool_result(GgContextSource::ToolOutput, "c1", "x".repeat(40_000));

    let before = ctx.messages();
    ctx.refresh_context_usage_signal(signal_options());
    let after = ctx.messages();

    assert_eq!(after.len(), before.len());
    assert_eq!(
        after[..after.len() - 1],
        before[..before.len() - 1],
        "everything before the signal is byte-identical"
    );
    assert_ne!(
        after.last(),
        before.last(),
        "and the signal itself tracked the window"
    );
    assert_eq!(count_signal_items(&ctx), 1);
}

#[test]
fn every_turn_extends_the_previous_turns_window() {
    // The property a provider prompt cache needs, and the one this module owes the loop: turn
    // N+1's rendered messages always start with turn N's. Every mutable block is refreshed each
    // turn here — the memory block, the task list, the board, and the usage signal — some
    // holding still, some genuinely changing, and the window still only ever grows.
    let mut ctx = model(Some(100_000));
    ctx.set_system("system");
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
        // The signal is rebuilt every turn and changes constantly as the window grows; it renders
        // after every conversation item, so it is compared separately from the prefix below.
        ctx.refresh_context_usage_signal(signal_options());

        // The conversation itself — everything a prompt cache reads — only ever grows.
        let rendered: Vec<Message> = ctx
            .items()
            .iter()
            .map(|item| item.message().clone())
            .collect();
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
        None,
        "c1",
        "`ref.png` — PNG image, 400 KB.",
        vec![image(400 * 1024)],
    );

    let mut without = model(Some(100_000));
    without.push_file_view(
        Some("ref.png".to_string()),
        None,
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
        None,
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
    ctx.set_system("system");
    ctx.push_assistant(None, vec![call("c1", "read_file")]);
    ctx.push_file_view(
        Some("ref.png".to_string()),
        None,
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

// ---------------------------------------------------------------------------
// Responses-as-code message headings
// ---------------------------------------------------------------------------

#[test]
fn code_mode_heads_synthesized_user_messages_by_source() {
    let mut ctx = code_model(Some(100_000));
    ctx.set_system("the system prompt");
    ctx.push_user_prompt("build a game");
    ctx.push(
        GgContextSource::ToolOutput,
        Retention::Ephemeral,
        Message::user("it printed hi"),
    );
    ctx.push_assistant(Some("return 1;".to_string()), Vec::new());

    let messages = ctx.messages();
    // The system prompt is `system`-role, so it is never headed — the model reads it as instructions,
    // not as one of the labelled messages.
    assert_eq!(messages[0].content.as_deref(), Some("the system prompt"));
    // The task and the program's output each carry their heading, on its own line before a rule.
    assert_eq!(
        messages[1].content.as_deref(),
        Some("Task\n----\nbuild a game")
    );
    assert_eq!(
        messages[2].content.as_deref(),
        Some("Output\n----\nit printed hi")
    );
    // The assistant's own program is never headed — it is the model's message, not gg's synthesis.
    assert_eq!(messages[3].content.as_deref(), Some("return 1;"));
}

#[test]
fn tool_calling_mode_heads_nothing() {
    // The same pushes off the code path carry no heading: message kinds are distinguished by role
    // and tool-call structure there, so a heading would be noise.
    let mut ctx = model(Some(100_000));
    ctx.push_user_prompt("build a game");
    ctx.push(
        GgContextSource::ToolOutput,
        Retention::Ephemeral,
        Message::user("it printed hi"),
    );
    let messages = ctx.messages();
    assert_eq!(messages[0].content.as_deref(), Some("build a game"));
    assert_eq!(messages[1].content.as_deref(), Some("it printed hi"));
}

#[test]
fn an_unchanged_headed_block_is_not_re_pushed() {
    // The append-only rule must survive headings: a mutable block rebuilt byte-identically has to
    // stay put, or a code run would supersede its memory/board block every turn and lose the prompt
    // cache. `source_block_is` heads the candidate before comparing, so the headed stored block and
    // the un-headed rebuild still match.
    let mut ctx = code_model(Some(100_000));
    ctx.replace_source(
        GgContextSource::Memory,
        Retention::Pinned,
        Some(Message::user("- remember the physics")),
    );
    let after_first: Vec<_> = ctx.messages();
    assert_eq!(
        after_first[0].content.as_deref(),
        Some("Memories\n----\n- remember the physics")
    );

    // Rebuilding the identical block is a no-op: still exactly one item, unmoved.
    ctx.replace_source(
        GgContextSource::Memory,
        Retention::Pinned,
        Some(Message::user("- remember the physics")),
    );
    assert_eq!(ctx.messages(), after_first);
}

#[test]
fn every_source_has_a_heading_except_the_assistants_own_turn() {
    // The heading vocabulary is closed and documented in the system prompt; the one source without a
    // heading is the assistant's own program, which gg never synthesizes.
    for source in GgContextSource::ALL {
        match source {
            GgContextSource::Assistant => assert!(code_heading(source).is_none()),
            other => assert!(
                code_heading(other).is_some(),
                "{other:?} has no heading; add one and list it in the system prompt"
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// File-view regions
// ---------------------------------------------------------------------------

/// A view's region is the window the read **returned**, and a read that covered the whole file has
/// none — so re-opening it is a plain read of the path, and two whole-file views of one file are the
/// same view rather than two windows.
#[test]
fn a_region_is_the_window_a_read_actually_covered() {
    // The whole file, however it was asked for: no region.
    assert_eq!(FileRegion::covered(1, 300, 300), None);
    // An empty file: `last_line` of 0 precedes `first_line`, and it is still a whole-file view.
    assert_eq!(FileRegion::covered(1, 0, 0), None);
    // A first page that stops short is a genuine window — re-reading without the limit would pull in
    // the rest of the file.
    assert_eq!(
        FileRegion::covered(1, 50, 300),
        Some(FileRegion {
            offset: 1,
            limit: 50
        })
    );
    // A window in the middle, and one that runs to the end of the file.
    assert_eq!(
        FileRegion::covered(200, 249, 300),
        Some(FileRegion {
            offset: 200,
            limit: 50
        })
    );
    assert_eq!(
        FileRegion::covered(291, 300, 300),
        Some(FileRegion {
            offset: 291,
            limit: 10
        })
    );
}
