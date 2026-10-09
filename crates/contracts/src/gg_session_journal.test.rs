//! Tests for the [capture journal](super): the streaming interner that holds ids rather
//! than bodies, and the property that binds it to the body-retaining pool — the two hand
//! out the **same** indices, because they share one [`GgSessionInterner`].

use serde_json::{Value, json};

use super::*;
use crate::gg_session_record::{
    GG_SESSION_FORMAT_VERSION, GgClientRole, GgSessionPools, GgSessionRequestShape,
};

fn message(role: &str, content: &str) -> Value {
    json!({ "role": role, "content": content })
}

fn image(data: &str) -> Value {
    json!({ "mediaType": "image/png", "dataBase64": data, "bytes": 3 })
}

/// The message-pool lines a batch produced, in the order their indices were minted.
fn message_lines(lines: &[GgJournalLine]) -> Vec<(u32, &GgSessionMessage)> {
    lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Message { index, message } => Some((*index, message)),
            _ => None,
        })
        .collect()
}

// --- the streaming interner -------------------------------------------------

#[test]
fn a_body_is_emitted_once_and_referenced_by_index_thereafter() {
    let mut interner = GgJournalInterner::new();
    let system = message("system", "you are gg");

    let first = interner.intern_message(&system);
    let second = interner.intern_message(&message("user", "build it"));
    let again = interner.intern_message(&system);

    assert_eq!((first, second), (0, 1));
    assert_eq!(again, first, "an identical body reuses its pool slot");
    let lines = interner.take_pending();
    assert_eq!(
        message_lines(&lines)
            .iter()
            .map(|(i, _)| *i)
            .collect::<Vec<_>>(),
        vec![0, 1],
        "the repeat emits no second line"
    );
}

#[test]
fn pending_lines_are_a_contiguous_prefix_in_index_order() {
    let mut interner = GgJournalInterner::new();
    for turn in 0..4 {
        interner.intern_message(&message("user", &format!("turn {turn}")));
    }
    let lines = interner.take_pending();
    assert_eq!(
        message_lines(&lines)
            .iter()
            .map(|(i, _)| *i)
            .collect::<Vec<_>>(),
        vec![0, 1, 2, 3]
    );
    assert!(
        interner.take_pending().is_empty(),
        "taking drains the buffer, so a line can never be written twice"
    );
}

/// **A journalled message keeps the picture's descriptor and drops its bytes** — and two
/// pictures that share a descriptor are still two different messages.
///
/// The bytes go because a run's images are the one payload large enough to dominate a journal
/// that is written on every run. The *address* still covers them, which is what stops two
/// different pictures of one media type and size — indistinguishable once the bytes are gone —
/// from collapsing into one pooled message and serving the wrong turn's window.
#[test]
fn a_journalled_message_keeps_a_pictures_descriptor_and_not_its_bytes() {
    let mut interner = GgJournalInterner::new();
    assert_eq!(
        interner.intern_message(&json!({
            "role": "user",
            "content": "look",
            "images": [image("QUJD")],
        })),
        0
    );
    assert_eq!(
        interner.intern_message(&json!({
            "role": "user",
            "content": "look",
            "images": [image("WFla")],
        })),
        1,
        "two pictures the descriptor cannot tell apart are still two messages"
    );

    let lines = interner.take_pending();
    for (_, message) in message_lines(&lines) {
        let stored = &message.body["images"][0];
        assert_eq!(stored["mediaType"], "image/png");
        assert_eq!(stored["bytes"], 3);
        assert!(
            stored.get("dataBase64").is_none(),
            "a journalled body keeps the descriptor and never the payload: {stored}"
        );
    }
}

#[test]
fn a_text_is_pooled_by_content_so_a_repeated_tool_output_costs_one_line() {
    let mut interner = GgJournalInterner::new();
    let first = interner.intern_text("ok\n");
    let second = interner.intern_text("ok\n");
    let third = interner.intern_text("nope\n");

    assert_eq!(first, second);
    assert_eq!(third, 1);
    let text_lines = interner
        .take_pending()
        .into_iter()
        .filter(|line| matches!(line, GgJournalLine::Text { .. }))
        .count();
    assert_eq!(text_lines, 2, "the repeat emits no second line");
}

/// The binding property: the streaming interner and the body-retaining pool are two storage
/// strategies over **one** [`GgSessionInterner`], so a request interned through either yields
/// identical indices. A journal whose indices disagreed with assembly's would substitute one
/// message body for another in the assembled record.
#[test]
fn the_journal_interner_and_the_record_pools_agree_index_for_index() {
    let messages = vec![
        message("system", "you are gg"),
        message("user", "build it"),
        json!({ "role": "user", "images": [image("QUJD")] }),
    ];
    let tools = json!([{ "name": "write_file", "description": "", "parameters": {} }]);

    let mut journal = GgJournalInterner::new();
    let streamed = journal.intern_request(
        GgClientRole::Agent,
        GgSessionRequestShape::Complete,
        &messages,
        Some(&tools),
    );

    let mut pools = GgSessionPools::new();
    let retained = pools.intern_request(
        GgClientRole::Agent,
        GgSessionRequestShape::Complete,
        &messages,
        Some(&tools),
    );

    assert_eq!(streamed, retained);
    // And the pooled bodies the journal streamed are the ones the pool retained.
    let parts = pools.into_parts();
    let pooled_messages = parts.messages;
    let pooled_toolsets = parts.toolsets;
    let lines = journal.take_pending();
    for (index, message) in message_lines(&lines) {
        assert_eq!(message, &pooled_messages[index as usize]);
    }
    assert_eq!(pooled_toolsets.len(), 1);
}

// --- the line vocabulary ----------------------------------------------------

#[test]
fn every_line_round_trips_through_ndjson() {
    let capability_set = serde_json::from_value(json!({})).expect("an empty capability set");
    let lines = vec![
        GgJournalLine::Header {
            format_version: GG_SESSION_FORMAT_VERSION,
            session_id: "run_1".to_string(),
            routing_key: Some("tz4a98xxat96iws9zmbrgj3a".to_string()),
            capability_set: Box::new(capability_set),
            recorder: GgSessionRecorder {
                gg_version: Some("0.7.0".to_string()),
                commit: None,
            },
        },
        GgJournalLine::Text {
            index: 0,
            text: "ok\n".to_string(),
            clip: None,
        },
        GgJournalLine::End {
            entries: 0,
            truncation: None,
        },
    ];

    let ndjson: String = lines
        .iter()
        .map(|line| format!("{}\n", serde_json::to_string(line).expect("serializes")))
        .collect();
    // One complete JSON object per line — the property that lets a torn tail be discarded
    // without disturbing anything before it.
    assert_eq!(ndjson.lines().count(), lines.len());
    let parsed: Vec<GgJournalLine> = ndjson
        .lines()
        .map(|line| serde_json::from_str(line).expect("parses"))
        .collect();
    assert_eq!(parsed, lines);
}

#[test]
fn a_complete_end_line_omits_the_truncation_key_entirely() {
    let value = serde_json::to_value(GgJournalLine::End {
        entries: 12,
        truncation: None,
    })
    .expect("serializes");
    assert_eq!(value["type"], json!("end"));
    assert_eq!(value["entries"], json!(12));
    assert!(
        value.get("truncation").is_none(),
        "a complete capture says nothing about truncation rather than saying null"
    );
}
