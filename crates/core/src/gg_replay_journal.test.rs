//! Tests for the [capture journal](super): the streaming interner that holds ids rather
//! than bodies, and the property that binds it to the body-retaining pool — the two hand
//! out the **same** indices and fold the **same** fingerprint, because they share one
//! [`GgReplayInterner`].

use serde_json::{Value, json};

use super::*;
use crate::gg_replay::{
    GG_REPLAY_BLOB_REF_KEY, GG_REPLAY_FORMAT_VERSION, GgClientRole, GgReplayPools,
    GgReplayRequestShape,
};

fn message(role: &str, content: &str) -> Value {
    json!({ "role": role, "content": content })
}

fn image(data: &str) -> Value {
    json!({ "mediaType": "image/png", "dataBase64": data, "bytes": 3 })
}

/// The message-pool lines a batch produced, in the order their indices were minted.
fn message_lines(lines: &[GgJournalLine]) -> Vec<(u32, &GgReplayMessage)> {
    lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Message { index, message } => Some((*index, message)),
            _ => None,
        })
        .collect()
}

fn blob_lines(lines: &[GgJournalLine]) -> Vec<(u32, &GgReplayBlob)> {
    lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Blob { index, blob } => Some((*index, blob)),
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

#[test]
fn an_image_becomes_a_blob_line_ahead_of_the_message_that_references_it() {
    let mut interner = GgJournalInterner::new();
    let index = interner.intern_message(&json!({
        "role": "user",
        "content": "look",
        "images": [image("QUJD")],
    }));
    assert_eq!(index, 0);

    let lines = interner.take_pending();
    // The blob is queued first: assembly reading the journal in order never sees a
    // message referencing a body it has not read yet.
    assert!(matches!(lines[0], GgJournalLine::Blob { index: 0, .. }));
    assert!(matches!(lines[1], GgJournalLine::Message { index: 0, .. }));

    let (_, message) = message_lines(&lines)[0];
    assert_eq!(
        message.body["images"][0][GG_REPLAY_BLOB_REF_KEY],
        json!(0),
        "the stored body carries a blob reference, not the payload"
    );
    assert_eq!(blob_lines(&lines)[0].1.data_base64, "QUJD");
}

#[test]
fn two_pictures_of_one_media_type_and_size_are_distinct_blobs() {
    // The property gg's telemetry `fingerprint` cannot express: it hashes image
    // *descriptors*, so these two would collide there. A replay must send them again.
    let mut interner = GgJournalInterner::new();
    interner.intern_message(&json!({ "role": "user", "images": [image("QUJD")] }));
    interner.intern_message(&json!({ "role": "user", "images": [image("WFla")] }));
    let lines = interner.take_pending();
    assert_eq!(blob_lines(&lines).len(), 2);
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

/// The binding property: the streaming interner and the body-retaining pool are two
/// storage strategies over **one** [`GgReplayInterner`], so a request interned through
/// either yields identical indices and an identical fingerprint. A recorder and a playback
/// that disagreed here would make the staleness detector itself the bug.
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
        GgReplayRequestShape::Complete,
        &messages,
        Some(&tools),
    );

    let mut pools = GgReplayPools::new();
    let retained = pools.intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &messages,
        Some(&tools),
    );

    assert_eq!(streamed, retained);
    // And the pooled bodies the journal streamed are the ones the pool retained.
    let (pooled_messages, pooled_toolsets, _, pooled_blobs) = pools.into_parts();
    let lines = journal.take_pending();
    for (index, message) in message_lines(&lines) {
        assert_eq!(message, &pooled_messages[index as usize]);
    }
    for (index, blob) in blob_lines(&lines) {
        assert_eq!(blob, &pooled_blobs[index as usize]);
    }
    assert_eq!(pooled_toolsets.len(), 1);
}

// --- the line vocabulary ----------------------------------------------------

#[test]
fn every_line_round_trips_through_ndjson() {
    let capability_set = serde_json::from_value(json!({})).expect("an empty capability set");
    let lines = vec![
        GgJournalLine::Header {
            format_version: GG_REPLAY_FORMAT_VERSION,
            session_id: "run_1".to_string(),
            capability_set: Box::new(capability_set),
            recorder: GgReplayRecorder {
                gg_version: Some("0.7.0".to_string()),
                commit: None,
            },
        },
        GgJournalLine::Text {
            index: 0,
            text: "ok\n".to_string(),
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
