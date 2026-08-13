//! Tests for the [session record](super): the pooled shape, the content addresses that make
//! pooling safe, and the version check that refuses everything else.

use serde_json::{Value, json};

use super::*;
use crate::gg::GgCapabilitySet;

/// A minimal capability set, deserialized rather than constructed so the test does not
/// have to track the set's own field list.
fn capability_set() -> GgCapabilitySet {
    serde_json::from_value(json!({})).expect("an empty capability set deserializes")
}

fn message(role: &str, content: &str) -> Value {
    json!({ "role": role, "content": content })
}

fn image(data: &str) -> Value {
    json!({ "mediaType": "image/png", "dataBase64": data, "bytes": 3 })
}

fn read(value: Value) -> GgSessionRecord {
    serde_json::from_value(value).expect("the record deserializes")
}

// --- identity ---------------------------------------------------------------

#[test]
fn a_newer_format_version_is_refused_rather_than_guessed_at() {
    let mut value =
        serde_json::to_value(GgSessionRecord::new("run_1", capability_set())).expect("serializes");
    value["formatVersion"] = json!(GG_SESSION_FORMAT_VERSION + 1);
    let error =
        serde_json::from_value::<GgSessionRecord>(value).expect_err("a newer format is refused");
    assert!(
        error
            .to_string()
            .contains("is not the format this build reads"),
        "unexpected error: {error}"
    );
}

#[test]
fn a_record_that_states_no_format_version_is_malformed() {
    // The field is required rather than defaulted: a document that does not say what format
    // it is in is not a record in some other format to be refused, it is not a record.
    let mut value =
        serde_json::to_value(GgSessionRecord::new("run_1", capability_set())).expect("serializes");
    value
        .as_object_mut()
        .expect("an object")
        .remove("formatVersion");
    let error = serde_json::from_value::<GgSessionRecord>(value)
        .expect_err("a record without a format version does not parse");
    assert!(
        error.to_string().contains("missing field `formatVersion`"),
        "unexpected error: {error}"
    );
}

#[test]
fn the_record_serializes_camel_case_with_the_format_version_first_class() {
    let value =
        serde_json::to_value(GgSessionRecord::new("run_1", capability_set())).expect("serializes");
    assert_eq!(value["formatVersion"], json!(GG_SESSION_FORMAT_VERSION));
    assert_eq!(value["sessionId"], json!("run_1"));
    // Absent rather than null on a complete capture.
    assert!(value.get("truncation").is_none());
}

#[test]
fn the_recorder_carries_the_other_two_identities() {
    let mut record = GgSessionRecord::new("run_1", capability_set());
    record.recorder = GgSessionRecorder {
        gg_version: Some("0.7.0".into()),
        commit: Some("4af242d9".into()),
    };
    let round_tripped = read(serde_json::to_value(&record).expect("serializes"));
    assert_eq!(round_tripped.recorder.gg_version.as_deref(), Some("0.7.0"));
    assert_eq!(round_tripped.recorder.commit.as_deref(), Some("4af242d9"));
}

// --- pooling ----------------------------------------------------------------

#[test]
fn a_message_is_pooled_once_however_many_turns_it_survives() {
    let mut pools = GgSessionPools::new();
    let system = message("system", "you are gg");
    let first = pools.intern_message(&system);
    let second = pools.intern_message(&message("user", "build it"));
    let again = pools.intern_message(&system);

    assert_eq!(first, 0);
    assert_eq!(second, 1);
    assert_eq!(again, first, "an identical body reuses its pool slot");
    let parts = pools.into_parts();
    let messages = parts.messages;
    assert_eq!(messages.len(), 2);
}

#[test]
fn a_toolset_is_pooled_once_however_many_turns_offer_it() {
    let mut pools = GgSessionPools::new();
    let tools = json!([{ "name": "shell" }, { "name": "read_file" }]);
    let first = pools.intern_toolset(&tools);
    let second = pools.intern_toolset(&tools);

    assert_eq!(first, second);
    let parts = pools.into_parts();
    let toolsets = parts.toolsets;
    assert_eq!(toolsets.len(), 1, "12x redundancy collapses to 1");
}

/// **A message's address covers the picture it carried, and the stored body does not.**
///
/// Two facts at once, and they pull in opposite directions on purpose. The address is computed
/// over the message *as sent*, so two different pictures of the same media type and decoded size
/// are two different messages rather than one — a descriptor-only address would collide them, and
/// the pool would then serve one turn's window in place of another's. The stored body is the
/// descriptor alone, because the bytes are the one thing in a session too large to keep on every
/// run and the telemetry stream already withholds them for exactly that reason.
#[test]
fn a_message_is_addressed_by_the_picture_it_carried_and_stores_only_its_descriptor() {
    let mut pools = GgSessionPools::new();
    let first = pools.intern_message(&json!({ "role": "user", "content": [image("QUJD")] }));
    let second = pools.intern_message(&json!({ "role": "user", "content": [image("WFla")] }));

    assert_ne!(first, second);
    let messages = pools.into_parts().messages;
    assert_ne!(messages[0].id, messages[1].id);
    for pooled in &messages {
        let stored = &pooled.body["content"][0];
        assert_eq!(stored["mediaType"], "image/png");
        assert!(
            stored.get("dataBase64").is_none(),
            "a pooled body keeps the descriptor and never the bytes: {stored}"
        );
    }
}

#[test]
fn a_text_payload_is_pooled_once() {
    let mut pools = GgSessionPools::new();
    let first = pools.intern_text("ok\n");
    let second = pools.intern_text("ok\n");
    let third = pools.intern_text("nope\n");

    assert_eq!(first, second);
    assert_ne!(first, third);
    let parts = pools.into_parts();
    let texts = parts.texts;
    assert_eq!(texts, vec!["ok\n".to_string(), "nope\n".to_string()]);
}

// --- request shape ----------------------------------------------------------

#[test]
fn the_request_shape_distinguishes_a_required_tool_call() {
    let mut pools = GgSessionPools::new();
    let messages = [message("user", "answer")];
    let tools = json!([{ "name": "finish" }]);
    let offered = pools.intern_request(
        GgClientRole::Agent,
        GgSessionRequestShape::Complete,
        &messages,
        Some(&tools),
    );
    let required = pools.intern_request(
        GgClientRole::Agent,
        GgSessionRequestShape::CompleteRequiring,
        &messages,
        Some(&tools),
    );

    assert_eq!(offered.shape, GgSessionRequestShape::Complete);
    assert_eq!(required.shape, GgSessionRequestShape::CompleteRequiring);
    assert_eq!(
        offered.messages, required.messages,
        "the same conversation was sent; only the call shape differs"
    );
    assert_eq!(
        serde_json::to_value(required.shape).expect("serializes"),
        json!("complete_requiring")
    );
}

#[test]
fn an_absent_role_reads_as_the_agents_own_client() {
    let request: GgSessionRequest = serde_json::from_value(json!({ "messages": [0] }))
        .expect("a request without a role deserializes");
    assert_eq!(request.role, GgClientRole::Agent);
    assert_eq!(request.shape, GgSessionRequestShape::Complete);
}

// --- provenance, seed, truncation -------------------------------------------

#[test]
fn an_agent_row_carries_the_keys_its_binding_needs() {
    let reviewer = GgSessionAgent {
        agent_id: "agent_7".into(),
        profile: "Reviewer".into(),
        origin: GgSessionAgentOrigin::Reviewer {
            issue: "ISSUE-2".into(),
            round: 1,
            position: 0,
        },
        terminal_status: Some(GgAgentStatus::Done),
        limit_hit: None,
    };
    let value = serde_json::to_value(&reviewer).expect("serializes");
    assert_eq!(value["origin"]["type"], json!("reviewer"));
    assert_eq!(value["origin"]["issue"], json!("ISSUE-2"));
    assert_eq!(value["origin"]["round"], json!(1));
    assert_eq!(value["origin"]["position"], json!(0));
    assert_eq!(
        serde_json::from_value::<GgSessionAgent>(value).expect("round trips"),
        reviewer
    );
}

#[test]
fn a_merge_agent_is_bound_by_what_it_was_dispatched_for() {
    // Its live id comes off the global counter, so nothing about the id can bind it.
    let value = serde_json::to_value(GgSessionAgentOrigin::Merge {
        issue: "ISSUE-2".into(),
        ordinal: 0,
    })
    .expect("serializes");
    assert_eq!(
        value,
        json!({ "type": "merge", "issue": "ISSUE-2", "ordinal": 0 })
    );
}

#[test]
fn a_killed_capture_records_why_it_stops_short() {
    let mut record = GgSessionRecord::new("run_1", capability_set());
    record.truncation = Some(GgSessionTruncation {
        reason: GgSessionTruncationReason::SessionKilled,
        last_seq: Some(41),
        bytes: None,
    });
    let value = serde_json::to_value(&record).expect("serializes");
    assert_eq!(value["truncation"]["reason"], json!("session_killed"));
    assert_eq!(value["truncation"]["lastSeq"], json!(41));
    assert_eq!(read(value), record);
}

#[test]
fn the_seed_records_the_resolved_modalities_not_the_initial_ones() {
    let mut record = GgSessionRecord::new("run_1", capability_set());
    record.seed.model_windows.insert("primary".into(), 200_000);
    record
        .seed
        .model_modalities
        .insert("primary".into(), GgSessionModalities { vision: false });
    let round_tripped = read(serde_json::to_value(&record).expect("serializes"));
    assert_eq!(round_tripped.seed.model_windows["primary"], 200_000);
    assert!(!round_tripped.seed.model_modalities["primary"].vision);
}

// --- entries ----------------------------------------------------------------

#[test]
fn every_entry_kind_round_trips_with_its_discriminator_inline() {
    let cases: Vec<(GgSessionEntryKind, &str)> = vec![
        (
            GgSessionEntryKind::ModelError {
                duration_ms: None,
                request: GgSessionPools::new().intern_request(
                    GgClientRole::Agent,
                    GgSessionRequestShape::Complete,
                    &[message("user", "look at this")],
                    None,
                ),
                error: GgSessionModelError {
                    kind: GgSessionModelErrorKind::VisionUnsupported,
                    message: "no image route".into(),
                    status: Some(400),
                    attempts: None,
                    model_id: Some("some/model".into()),
                },
            },
            "model_error",
        ),
        (
            GgSessionEntryKind::PromptFrame {
                items: vec![GgSessionPromptItem {
                    message: 0,
                    slot: GgSessionPromptSlot::System,
                    source: GgContextSource::System,
                    retention: GgSessionRetention::Pinned,
                    turn: 0,
                    label: None,
                    region: None,
                }],
            },
            "prompt_frame",
        ),
        (
            GgSessionEntryKind::Shell {
                origin: GgShellOrigin::Hook,
                command: GgSessionCommand {
                    command: "npm run build".into(),
                    cwd: GgShellCwd::Relative { path: "web".into() },
                    exit_code: 0,
                    stdout: 0,
                    stderr: 1,
                },
            },
            "shell",
        ),
        (
            GgSessionEntryKind::Git {
                command: GgSessionCommand {
                    command: "git merge issue-2".into(),
                    cwd: GgShellCwd::Workspace,
                    exit_code: 1,
                    stdout: 0,
                    stderr: 1,
                },
            },
            "git",
        ),
        (
            GgSessionEntryKind::CancelProbe { canceled: true },
            "cancel_probe",
        ),
        (
            GgSessionEntryKind::Clock {
                elapsed_ms: 1_000,
                remaining_ms: Some(500),
            },
            "clock",
        ),
    ];

    for (kind, tag) in cases {
        let entry = GgSessionEntry {
            agent_id: "root".into(),
            seq: 3,
            kind,
        };
        let value = serde_json::to_value(&entry).expect("serializes");
        assert_eq!(value["type"], json!(tag));
        assert_eq!(value["agentId"], json!("root"), "the envelope stays inline");
        assert_eq!(value["seq"], json!(3));
        assert_eq!(
            serde_json::from_value::<GgSessionEntry>(value).expect("round trips"),
            entry
        );
    }
}

#[test]
fn a_shell_cwd_is_recorded_relative_to_the_workspace() {
    // An absolute path names the container's tree, which nothing reading the record afterward
    // shares, so two runs of the same command would read back as two different commands.
    assert_eq!(
        serde_json::to_value(GgShellCwd::Workspace).expect("serializes"),
        json!({ "type": "workspace" })
    );
    assert_eq!(
        serde_json::to_value(GgShellCwd::Relative { path: "web".into() }).expect("serializes"),
        json!({ "type": "relative", "path": "web" })
    );
    assert_eq!(
        serde_json::to_value(GgShellCwd::Absolute {
            path: "/usr/lib".into()
        })
        .expect("serializes"),
        json!({ "type": "absolute", "path": "/usr/lib" })
    );
}

// --- addressing -------------------------------------------------------------

#[test]
fn a_content_address_is_the_leading_128_bits_of_sha_256() {
    let address = fingerprint_exact(b"abc");
    assert_eq!(address.len(), GG_SESSION_ID_HEX_LEN);
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    assert_eq!(address, "ba7816bf8f01cfea414140de5dae2223");
}

#[test]
fn a_json_address_does_not_depend_on_the_order_fields_were_written_in() {
    let first: Value = serde_json::from_str(r#"{"a":1,"b":2}"#).expect("parses");
    let second: Value = serde_json::from_str(r#"{"b":2,"a":1}"#).expect("parses");
    assert_eq!(fingerprint_json(&first), fingerprint_json(&second));
}

// --- payload clipping -------------------------------------------------------

/// The clip keeps the **tail** and lands on a character boundary, so a clipped payload is always
/// valid UTF-8 and is never longer than the ceiling it was measured against.
#[test]
fn clipping_keeps_a_valid_tail_within_the_ceiling() {
    assert_eq!(
        clip_text("short", 16),
        None,
        "a payload that fits is not clipped"
    );
    assert_eq!(
        clip_text("0123456789", 10),
        None,
        "and neither is one that fits exactly"
    );

    let (kept, original) = clip_text("0123456789", 4).expect("a longer payload is clipped");
    assert_eq!(kept, "6789");
    assert_eq!(original, 10);

    // `é` is two bytes, so a cut landing inside it must move forward — never producing invalid
    // UTF-8, and never producing a *longer* result by moving backwards.
    let multibyte = "ééééé";
    let (kept, original) = clip_text(multibyte, 5).expect("clipped");
    assert!(multibyte.ends_with(kept));
    assert!(
        kept.len() <= 5,
        "the ceiling is never exceeded: {}",
        kept.len()
    );
    assert_eq!(original, 10);
}

/// The dedup key is the address of the payload **as given**, so two payloads that share a tail
/// occupy two entries with two clip rows rather than collapsing into one whose single row could
/// describe only one of them.
#[test]
fn two_payloads_sharing_a_clipped_tail_stay_two_pool_entries() {
    let mut pools = GgSessionPools::new();
    let tail = "z".repeat(64);
    let first = pools.intern_text_clipped(&format!("a{tail}"), Some(64));
    let second = pools.intern_text_clipped(&format!("bb{tail}"), Some(64));
    assert_ne!(first, second);

    let parts = pools.into_parts();
    assert_eq!(parts.texts[first as usize], parts.texts[second as usize]);
    assert_eq!(parts.clips.len(), 2);
    assert_eq!(parts.clips[0].original_bytes, 65);
    assert_eq!(parts.clips[1].original_bytes, 66);
    assert_eq!(
        parts.clips[0].original_id,
        fingerprint_exact(format!("a{tail}").as_bytes()),
        "the address is of the whole payload, which is what makes a clipped record checkable"
    );
}

/// An unclipped payload dedups exactly as it always did, and mints no clip row — so an empty table
/// is the positive statement "nothing was clipped" by construction rather than by luck.
#[test]
fn interning_without_a_ceiling_records_no_clip() {
    let mut pools = GgSessionPools::new();
    let first = pools.intern_text_clipped("build output", None);
    let second = pools.intern_text("build output");
    assert_eq!(first, second);
    assert!(pools.into_parts().clips.is_empty());
}

/// The record's clip lookup answers "is this payload the whole of it?" — the question a reader has
/// to ask before treating a recorded payload as the payload.
#[test]
fn a_record_reports_which_of_its_texts_are_clips() {
    let mut record = GgSessionRecord::new("run_1", capability_set());
    record.texts = vec![
        "whole".to_string(),
        "tail".to_string(),
        "also whole".to_string(),
    ];
    record.clips = vec![GgSessionTextClip {
        text: 1,
        original_bytes: 4_096,
        original_id: fingerprint_exact(b"the whole payload"),
    }];

    assert!(record.clip(0).is_none());
    assert_eq!(record.clip(1).map(|clip| clip.original_bytes), Some(4_096));
    assert!(record.clip(2).is_none());
    assert!(
        record.clip(9).is_none(),
        "a reference past the pool is absent, not a panic"
    );
}

/// The clip table survives a round trip, and is **absent-tolerant**: a record written before the
/// table existed reads as one that clipped nothing rather than failing to parse.
#[test]
fn the_clip_table_round_trips_and_defaults_to_empty() {
    let mut record = GgSessionRecord::new("run_1", capability_set());
    record.texts = vec!["tail".to_string()];
    record.clips = vec![GgSessionTextClip {
        text: 0,
        original_bytes: 1_048_576,
        original_id: fingerprint_exact(b"a megabyte of build log"),
    }];
    let json = serde_json::to_value(&record).expect("serializes");
    let back: GgSessionRecord = serde_json::from_value(json.clone()).expect("round trips");
    assert_eq!(back.clips, record.clips);

    let mut without = json;
    without.as_object_mut().unwrap().remove("clips");
    let back: GgSessionRecord =
        serde_json::from_value(without).expect("an older record still reads");
    assert!(back.clips.is_empty());
}
