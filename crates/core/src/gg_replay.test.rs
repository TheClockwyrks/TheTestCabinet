//! Tests for the [format v2](super) replay record: the pooled shape, the fold that makes
//! a turn fingerprint, and the upgrade that reads every record captured before v2.

use serde_json::{Value, json};

use super::*;
use crate::gg::GgCapabilitySet;

/// A minimal capability set, deserialized rather than constructed so the test does not
/// have to track the set's own migration shape.
fn capability_set() -> GgCapabilitySet {
    serde_json::from_value(json!({})).expect("an empty capability set deserializes")
}

fn message(role: &str, content: &str) -> Value {
    json!({ "role": role, "content": content })
}

fn image(data: &str) -> Value {
    json!({ "mediaType": "image/png", "dataBase64": data, "bytes": 3 })
}

/// One v1 `model_io` entry: the whole conversation and the whole tool array, re-serialized.
fn v1_model_io(seq: u64, messages: Vec<Value>, tools: Vec<Value>, text: &str) -> Value {
    json!({
        "agentId": "root",
        "seq": seq,
        "type": "model_io",
        "request": { "messages": messages, "tools": tools },
        "response": { "text": text, "toolCalls": [] },
    })
}

fn v1_record(entries: Vec<Value>) -> Value {
    json!({
        "sessionId": "run_1",
        "capabilitySet": {},
        "entries": entries,
    })
}

fn read(value: Value) -> GgReplayRecord {
    serde_json::from_value(value).expect("the record deserializes")
}

// --- identity ---------------------------------------------------------------

#[test]
fn an_absent_format_version_reads_as_version_one() {
    let record = read(v1_record(vec![]));
    assert_eq!(
        record.upgraded_from,
        Some(GG_REPLAY_FORMAT_V1),
        "an absent formatVersion means 1, not a second pre-versioning sentinel"
    );
    assert!(record.captured_before_v2());
    assert_eq!(
        record.format_version, GG_REPLAY_FORMAT_VERSION,
        "and the upgraded document in hand is v2"
    );
}

#[test]
fn a_v2_record_reports_the_current_format_and_was_not_upgraded() {
    let record = GgReplayRecord::new("run_1", capability_set());
    let round_tripped = read(serde_json::to_value(&record).expect("serializes"));
    assert_eq!(round_tripped.format_version, GG_REPLAY_FORMAT_VERSION);
    assert_eq!(round_tripped.upgraded_from, None);
    assert!(!round_tripped.captured_before_v2());
    assert_eq!(round_tripped, record);
}

#[test]
fn a_newer_format_version_is_refused_rather_than_guessed_at() {
    let mut value =
        serde_json::to_value(GgReplayRecord::new("run_1", capability_set())).expect("serializes");
    value["formatVersion"] = json!(GG_REPLAY_FORMAT_VERSION + 1);
    let error =
        serde_json::from_value::<GgReplayRecord>(value).expect_err("a newer format is refused");
    assert!(
        error.to_string().contains("newer than this build supports"),
        "unexpected error: {error}"
    );
}

#[test]
fn the_record_serializes_camel_case_with_the_format_version_first_class() {
    let value =
        serde_json::to_value(GgReplayRecord::new("run_1", capability_set())).expect("serializes");
    assert_eq!(value["formatVersion"], json!(GG_REPLAY_FORMAT_VERSION));
    assert_eq!(value["sessionId"], json!("run_1"));
    // Absent rather than null on a complete capture.
    assert!(value.get("truncation").is_none());
}

#[test]
fn the_recorder_carries_the_other_two_identities() {
    let mut record = GgReplayRecord::new("run_1", capability_set());
    record.recorder = GgReplayRecorder {
        gg_version: Some("0.7.0".into()),
        commit: Some("4af242d9".into()),
    };
    let round_tripped = read(serde_json::to_value(&record).expect("serializes"));
    assert_eq!(round_tripped.recorder.gg_version.as_deref(), Some("0.7.0"));
    assert_eq!(round_tripped.recorder.commit.as_deref(), Some("4af242d9"));
}

// --- fidelity ---------------------------------------------------------------

/// A capability set whose agents are named by `agents`, with `replay` enabled on exactly
/// the ones in `escalating`. The first agent is the root, by position.
fn set_with_replay_on(agents: &[&str], escalating: &[&str]) -> GgCapabilitySet {
    let agents: Vec<Value> = agents
        .iter()
        .map(|name| {
            json!({
                "name": name,
                "modelId": "some/model",
                "capabilities": if escalating.contains(name) {
                    json!([{ "id": crate::gg::CAPABILITY_REPLAY, "enabled": true }])
                } else {
                    json!([])
                },
            })
        })
        .collect();
    serde_json::from_value(json!({ "agents": agents })).expect("the capability set deserializes")
}

#[test]
fn a_run_that_asked_for_nothing_is_still_captured_at_standard_fidelity() {
    // The whole point of removing the gate: the default configuration records.
    assert_eq!(
        GgReplayFidelity::resolve(&capability_set()),
        GgReplayFidelity::Standard
    );
    assert_eq!(
        GgReplayFidelity::resolve(&set_with_replay_on(&["Root", "Reviewer"], &[])),
        GgReplayFidelity::Standard
    );
}

#[test]
fn the_replay_capability_escalates_from_any_agent_not_just_the_root() {
    // The defect this replaced: the old gate read `agents[0]` alone, so enabling `replay`
    // on the one subagent whose turns were under suspicion did nothing whatsoever.
    assert_eq!(
        GgReplayFidelity::resolve(&set_with_replay_on(&["Root", "Reviewer"], &["Reviewer"])),
        GgReplayFidelity::Full,
        "a non-root agent asking for full fidelity escalates the run"
    );
    assert_eq!(
        GgReplayFidelity::resolve(&set_with_replay_on(&["Root", "Reviewer"], &["Root"])),
        GgReplayFidelity::Full
    );
}

#[test]
fn a_record_without_a_fidelity_reads_as_standard_not_as_the_set_implies() {
    // Absent means standard even when the set says `replay`, because what the field
    // reports is what the *recorder* did — and a build with no full-only seams captured
    // the standard set however the run was configured.
    let mut value = serde_json::to_value(GgReplayRecord::new(
        "run_1",
        set_with_replay_on(&["Root"], &["Root"]),
    ))
    .expect("serializes");
    assert_eq!(value["fidelity"], json!("full"), "a v2 record states it");
    value.as_object_mut().expect("an object").remove("fidelity");
    assert_eq!(read(value).fidelity, GgReplayFidelity::Standard);
}

#[test]
fn an_upgraded_v1_record_is_standard_however_it_was_configured() {
    // Every v1 record was opted into — capture was the capability — but not one of them
    // carries a full-only input, because v1 recorded none of those categories at all.
    // Reporting them as `full` would invite a reader to conclude the session had no clock
    // reads rather than that the build had no clock capture.
    let mut value = v1_record(vec![]);
    value["capabilitySet"] =
        serde_json::to_value(set_with_replay_on(&["Root"], &["Root"])).expect("the set serializes");
    let record = read(value);
    assert!(record.captured_before_v2());
    assert_eq!(record.fidelity, GgReplayFidelity::Standard);
}

#[test]
fn the_fidelity_survives_a_round_trip() {
    let record = GgReplayRecord::new("run_1", set_with_replay_on(&["Root"], &["Root"]));
    assert_eq!(record.fidelity, GgReplayFidelity::Full);
    assert_eq!(
        read(serde_json::to_value(&record).expect("serializes")).fidelity,
        GgReplayFidelity::Full
    );
}

// --- pooling ----------------------------------------------------------------

#[test]
fn a_message_is_pooled_once_however_many_turns_it_survives() {
    let mut pools = GgReplayPools::new();
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
    let mut pools = GgReplayPools::new();
    let tools = json!([{ "name": "shell" }, { "name": "read_file" }]);
    let first = pools.intern_toolset(&tools);
    let second = pools.intern_toolset(&tools);

    assert_eq!(first, second);
    let parts = pools.into_parts();
    let toolsets = parts.toolsets;
    assert_eq!(toolsets.len(), 1, "12x redundancy collapses to 1");
}

#[test]
fn an_image_payload_is_replaced_by_a_blob_reference_and_stored_once() {
    let mut pools = GgReplayPools::new();
    let body = json!({
        "role": "user",
        "content": [{ "text": "look" }, image("QUJD")],
    });
    let first = pools.intern_message(&body);
    // A *different* message that carries the same picture.
    let second = pools.intern_message(&json!({
        "role": "user",
        "content": [{ "text": "again" }, image("QUJD")],
    }));
    assert_ne!(first, second);

    let parts = pools.into_parts();
    let messages = parts.messages;
    let blobs = parts.blobs;
    assert_eq!(blobs.len(), 1, "the same picture is stored once");
    assert_eq!(blobs[0].media_type, "image/png");
    assert_eq!(blobs[0].data_base64, "QUJD");
    assert_eq!(
        messages[0].body["content"][1],
        json!({ GG_REPLAY_BLOB_REF_KEY: 0 }),
        "the inline payload is replaced by a pool reference"
    );
}

#[test]
fn a_message_body_inflates_its_blob_references_back_to_the_bytes_it_was_sent_with() {
    let mut pools = GgReplayPools::new();
    let body = json!({ "role": "user", "content": [image("QUJD")] });
    let index = pools.intern_message(&body);
    let parts = pools.into_parts();
    let messages = parts.messages;
    let toolsets = parts.toolsets;
    let texts = parts.texts;
    let blobs = parts.blobs;

    let mut record = GgReplayRecord::new("run_1", capability_set());
    record.messages = messages;
    record.toolsets = toolsets;
    record.texts = texts;
    record.blobs = blobs;

    assert_eq!(
        record.message_body(index).expect("the message is pooled"),
        body
    );
}

#[test]
fn the_message_address_covers_the_image_bytes_not_just_its_descriptor() {
    // The v1 telemetry fingerprint hashed image *descriptors*, so two different pictures
    // of the same media type and decoded size collided — harmless for a log that discards
    // the pixels, catastrophic for a replay that must send them again.
    let mut pools = GgReplayPools::new();
    let first = pools.intern_message(&json!({ "role": "user", "content": [image("QUJD")] }));
    let second = pools.intern_message(&json!({ "role": "user", "content": [image("WFla")] }));

    assert_ne!(first, second);
    let parts = pools.into_parts();
    let messages = parts.messages;
    let blobs = parts.blobs;
    assert_ne!(messages[0].id, messages[1].id);
    assert_eq!(blobs.len(), 2);
}

#[test]
fn a_text_payload_is_pooled_once() {
    let mut pools = GgReplayPools::new();
    let first = pools.intern_text("ok\n");
    let second = pools.intern_text("ok\n");
    let third = pools.intern_text("nope\n");

    assert_eq!(first, second);
    assert_ne!(first, third);
    let parts = pools.into_parts();
    let texts = parts.texts;
    assert_eq!(texts, vec!["ok\n".to_string(), "nope\n".to_string()]);
}

// --- the turn fingerprint ---------------------------------------------------

#[test]
fn the_turn_fingerprint_folds_over_the_pool_ids() {
    let mut pools = GgReplayPools::new();
    let messages = vec![message("system", "you are gg"), message("user", "build it")];
    let tools = json!([{ "name": "shell" }]);
    let request = pools.intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &messages,
        Some(&tools),
    );

    let system_id = pools
        .message_id(0)
        .expect("the system message is pooled")
        .to_string();
    let user_id = pools
        .message_id(1)
        .expect("the user message is pooled")
        .to_string();
    let toolset_id = pools
        .toolset_id(0)
        .expect("the toolset is pooled")
        .to_string();

    assert_eq!(request.fingerprint.messages, 2, "the message count");
    assert_eq!(
        request.fingerprint.system.as_deref(),
        Some(system_id.as_str()),
        "the pooled id of the first system-role message"
    );
    assert_eq!(
        request.fingerprint.tools.as_deref(),
        Some(toolset_id.as_str()),
        "the toolset's pooled id, verbatim"
    );
    assert_eq!(
        request.fingerprint.conversation,
        GgTurnFingerprint::fold(&[system_id, user_id], None, None).conversation,
        "a SHA-256 over the ordered message-pool id strings"
    );
}

#[test]
fn the_fingerprint_is_independent_of_the_order_two_pools_were_filled_in() {
    // The property the whole scheme rests on: a playback interns the live request into
    // its own, differently-ordered pool and must still compute the recorded fingerprint.
    let conversation = vec![message("system", "you are gg"), message("user", "build it")];
    let tools = json!([{ "name": "shell" }]);

    let mut recorded = GgReplayPools::new();
    let from_recorder = recorded.intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &conversation,
        Some(&tools),
    );

    let mut live = GgReplayPools::new();
    // The playback pool has already seen unrelated traffic, so the same bodies land at
    // different indices.
    live.intern_message(&message("user", "something else"));
    live.intern_toolset(&json!([{ "name": "write_file" }]));
    let from_playback = live.intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &conversation,
        Some(&tools),
    );

    assert_ne!(
        from_recorder.messages, from_playback.messages,
        "indices differ"
    );
    assert_eq!(
        from_recorder.fingerprint, from_playback.fingerprint,
        "the fingerprint does not"
    );
}

#[test]
fn a_request_with_no_system_message_has_no_system_component() {
    let mut pools = GgReplayPools::new();
    let request = pools.intern_request(
        GgClientRole::Compaction,
        GgReplayRequestShape::Complete,
        &[message("user", "summarize this")],
        None,
    );
    assert_eq!(request.fingerprint.system, None);
    assert_eq!(request.fingerprint.tools, None);
    assert_eq!(request.toolset, None);
    assert_eq!(request.role, GgClientRole::Compaction);
}

#[test]
fn only_the_first_system_message_is_the_system_component() {
    let mut pools = GgReplayPools::new();
    let request = pools.intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &[
            message("system", "the prompt"),
            message("user", "go"),
            message("system", "a later note"),
        ],
        None,
    );
    assert_eq!(
        request.fingerprint.system.as_deref(),
        pools.message_id(0),
        "a later system message is thread material, not the prompt"
    );
}

#[test]
fn the_first_difference_is_reported_most_informative_component_first() {
    let base = GgTurnFingerprint {
        messages: 4,
        system: Some("aaa".into()),
        tools: Some("bbb".into()),
        conversation: "ccc".into(),
    };
    assert_eq!(base.first_difference(&base), None);

    // Every later component also differs, and only the first is named.
    let count = GgTurnFingerprint {
        messages: 5,
        system: Some("zzz".into()),
        tools: Some("zzz".into()),
        conversation: "zzz".into(),
    };
    assert_eq!(
        base.first_difference(&count),
        Some(GgFingerprintComponent::Messages)
    );

    let system = GgTurnFingerprint {
        system: Some("zzz".into()),
        tools: Some("zzz".into()),
        conversation: "zzz".into(),
        ..base.clone()
    };
    assert_eq!(
        base.first_difference(&system),
        Some(GgFingerprintComponent::System)
    );

    let tools = GgTurnFingerprint {
        tools: Some("zzz".into()),
        conversation: "zzz".into(),
        ..base.clone()
    };
    assert_eq!(
        base.first_difference(&tools),
        Some(GgFingerprintComponent::Tools)
    );

    let conversation = GgTurnFingerprint {
        conversation: "zzz".into(),
        ..base.clone()
    };
    assert_eq!(
        base.first_difference(&conversation),
        Some(GgFingerprintComponent::Conversation)
    );
}

#[test]
fn a_conversation_folds_unambiguously_over_its_ids() {
    // Without a separator `["ab", "c"]` and `["a", "bc"]` would fold to one value, and a
    // reconstruction that split one message into two would pass the staleness check.
    let first = GgTurnFingerprint::fold(&["ab".into(), "c".into()], None, None);
    let second = GgTurnFingerprint::fold(&["a".into(), "bc".into()], None, None);
    assert_ne!(first.conversation, second.conversation);
}

// --- request shape ----------------------------------------------------------

#[test]
fn the_request_shape_distinguishes_a_required_tool_call() {
    let mut pools = GgReplayPools::new();
    let messages = [message("user", "answer")];
    let tools = json!([{ "name": "finish" }]);
    let offered = pools.intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &messages,
        Some(&tools),
    );
    let required = pools.intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::CompleteRequiring,
        &messages,
        Some(&tools),
    );

    assert_eq!(offered.shape, GgReplayRequestShape::Complete);
    assert_eq!(required.shape, GgReplayRequestShape::CompleteRequiring);
    assert_eq!(
        offered.fingerprint, required.fingerprint,
        "the same question was asked; only the call shape differs"
    );
    assert_eq!(
        serde_json::to_value(required.shape).expect("serializes"),
        json!("complete_requiring")
    );
}

#[test]
fn an_absent_role_reads_as_the_agents_own_client() {
    let request: GgReplayRequest = serde_json::from_value(json!({
        "messages": [0],
        "fingerprint": { "messages": 1, "conversation": "abc" },
    }))
    .expect("a request without a role deserializes");
    assert_eq!(request.role, GgClientRole::Agent);
    assert_eq!(request.shape, GgReplayRequestShape::Complete);
}

// --- provenance, seed, truncation -------------------------------------------

#[test]
fn an_agent_row_carries_the_keys_its_binding_needs() {
    let reviewer = GgReplayAgent {
        agent_id: "agent_7".into(),
        profile: "Reviewer".into(),
        origin: GgReplayAgentOrigin::Reviewer {
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
        serde_json::from_value::<GgReplayAgent>(value).expect("round trips"),
        reviewer
    );
}

#[test]
fn a_merge_agent_is_bound_by_what_it_was_dispatched_for() {
    // Its live id comes off the global counter, so nothing about the id can bind it.
    let value = serde_json::to_value(GgReplayAgentOrigin::Merge {
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
fn a_seed_file_references_the_blob_pool_rather_than_carrying_a_second_copy() {
    let mut pools = GgReplayPools::new();
    // The mockup is in the pool because it was *sent to the model*.
    pools.intern_message(&json!({ "role": "user", "content": [image("QUJD")] }));
    let parts = pools.into_parts();
    let messages = parts.messages;
    let toolsets = parts.toolsets;
    let texts = parts.texts;
    let blobs = parts.blobs;

    let mut record = GgReplayRecord::new("run_1", capability_set());
    record.messages = messages;
    record.toolsets = toolsets;
    record.texts = texts;
    record.blobs = blobs;
    record.seed.provided_files = vec![GgReplaySeedFile {
        path: "reference/mockup.png".into(),
        blob: 0,
    }];

    let round_tripped = read(serde_json::to_value(&record).expect("serializes"));
    let seeded = &round_tripped.seed.provided_files[0];
    assert_eq!(
        round_tripped
            .blob(seeded.blob)
            .expect("the blob is pooled")
            .data_base64,
        "QUJD"
    );
    assert_eq!(
        round_tripped.blobs.len(),
        1,
        "and costs no additional bytes"
    );
}

#[test]
fn a_killed_capture_records_why_it_stops_short() {
    let mut record = GgReplayRecord::new("run_1", capability_set());
    record.truncation = Some(GgReplayTruncation {
        reason: GgReplayTruncationReason::SessionKilled,
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
    let mut record = GgReplayRecord::new("run_1", capability_set());
    record.seed.model_windows.insert("primary".into(), 200_000);
    record
        .seed
        .model_modalities
        .insert("primary".into(), GgReplayModalities { vision: false });
    let round_tripped = read(serde_json::to_value(&record).expect("serializes"));
    assert_eq!(round_tripped.seed.model_windows["primary"], 200_000);
    assert!(!round_tripped.seed.model_modalities["primary"].vision);
}

// --- entries ----------------------------------------------------------------

#[test]
fn every_entry_kind_round_trips_with_its_discriminator_inline() {
    let cases: Vec<(GgReplayEntryKind, &str)> = vec![
        (
            GgReplayEntryKind::ModelError {
                duration_ms: None,
                request: GgReplayPools::new().intern_request(
                    GgClientRole::Agent,
                    GgReplayRequestShape::Complete,
                    &[message("user", "look at this")],
                    None,
                ),
                error: GgReplayModelError {
                    kind: GgReplayModelErrorKind::VisionUnsupported,
                    message: "no image route".into(),
                    status: Some(400),
                    attempts: None,
                    model_id: Some("some/model".into()),
                },
            },
            "model_error",
        ),
        (
            GgReplayEntryKind::PromptFrame {
                items: vec![GgReplayPromptItem {
                    message: 0,
                    slot: GgReplayPromptSlot::System,
                    source: GgContextSource::System,
                    retention: GgReplayRetention::Pinned,
                    turn: 0,
                    label: None,
                    region: None,
                }],
            },
            "prompt_frame",
        ),
        (
            GgReplayEntryKind::Shell {
                origin: GgShellOrigin::CompletionValidation,
                command: GgReplayCommand {
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
            GgReplayEntryKind::Git {
                command: GgReplayCommand {
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
            GgReplayEntryKind::CancelProbe { canceled: true },
            "cancel_probe",
        ),
        (
            GgReplayEntryKind::Clock {
                elapsed_ms: 1_000,
                remaining_ms: Some(500),
            },
            "clock",
        ),
    ];

    for (kind, tag) in cases {
        let entry = GgReplayEntry {
            agent_id: "root".into(),
            seq: 3,
            kind,
        };
        let value = serde_json::to_value(&entry).expect("serializes");
        assert_eq!(value["type"], json!(tag));
        assert_eq!(value["agentId"], json!("root"), "the envelope stays inline");
        assert_eq!(value["seq"], json!(3));
        assert_eq!(
            serde_json::from_value::<GgReplayEntry>(value).expect("round trips"),
            entry
        );
    }
}

#[test]
fn a_shell_cwd_is_recorded_relative_to_the_workspace() {
    // An absolute path would never match a playback's (deliberately different) tree, so
    // every command would fall through to a cross-agent search or a miss.
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

// --- the v1 upgrade ---------------------------------------------------------

#[test]
fn a_v1_record_upgrades_into_the_pooled_shape() {
    let system = message("system", "you are gg");
    let first_user = message("user", "build it");
    let assistant = message("assistant", "on it");
    let tools = vec![json!({ "name": "shell" })];

    // The v1 quadratic term: turn two re-sends turn one's whole conversation and the
    // whole tool array.
    let record = read(v1_record(vec![
        v1_model_io(
            0,
            vec![system.clone(), first_user.clone()],
            tools.clone(),
            "a",
        ),
        v1_model_io(
            1,
            vec![system.clone(), first_user.clone(), assistant.clone()],
            tools.clone(),
            "b",
        ),
    ]));

    assert_eq!(record.messages.len(), 3, "five sent bodies, three distinct");
    assert_eq!(record.toolsets.len(), 1, "one distinct toolset");
    assert_eq!(record.entries.len(), 2);

    let GgReplayEntryKind::ModelIo {
        request, response, ..
    } = &record.entries[1].kind
    else {
        panic!("a v1 model_io upgrades to a v2 ModelIo");
    };
    assert_eq!(request.messages, vec![0, 1, 2]);
    assert_eq!(request.toolset, Some(0));
    assert_eq!(request.role, GgClientRole::Agent);
    assert_eq!(request.shape, GgReplayRequestShape::Complete);
    assert_eq!(response["text"], json!("b"));
    assert_eq!(record.entries[1].agent_id, "root");
    assert_eq!(record.entries[1].seq, 1);

    // And the turns gained fingerprints they were never captured with.
    assert_eq!(request.fingerprint.messages, 3);
    assert_eq!(
        request.fingerprint.system.as_deref(),
        Some(record.messages[0].id.as_str())
    );
    assert_eq!(
        request.fingerprint.tools.as_deref(),
        Some(record.toolsets[0].id.as_str())
    );
}

#[test]
fn a_v1_tool_result_upgrades_with_its_output_and_images_pooled() {
    let record = read(v1_record(vec![json!({
        "agentId": "agent_1",
        "seq": 4,
        "type": "tool_result",
        "call": { "id": "call_1", "name": "read_file", "arguments": { "path": "a.png" } },
        "outcome": {
            "ok": true,
            "output": "read a.png",
            "summary": "read",
            "images": [image("QUJD")],
            "failure": null,
        },
    })]));

    let GgReplayEntryKind::ToolResult { call, outcome } = &record.entries[0].kind else {
        panic!("a v1 tool_result upgrades to a v2 ToolResult");
    };
    assert_eq!(call.id, "call_1");
    assert_eq!(call.name, "read_file");
    assert_eq!(call.arguments["path"], json!("a.png"));
    assert_eq!(call.cwd, None, "v1 recorded no working directory to claim");
    assert!(outcome.ok);
    assert_eq!(record.text(outcome.output), Some("read a.png"));
    assert_eq!(
        outcome.summary.and_then(|index| record.text(index)),
        Some("read")
    );
    assert_eq!(outcome.images, vec![0]);
    assert_eq!(record.blob(0).expect("pooled").data_base64, "QUJD");
    assert_eq!(outcome.failure, None, "an explicit null is not a failure");
    assert_eq!(record.entries[0].agent_id, "agent_1");
    assert_eq!(record.entries[0].seq, 4);
}

#[test]
fn a_v1_upgrade_preserves_the_recorded_interleaving() {
    let record = read(v1_record(vec![
        v1_model_io(0, vec![message("user", "a")], vec![], "one"),
        json!({
            "agentId": "agent_1",
            "seq": 1,
            "type": "tool_result",
            "call": { "id": "c", "name": "shell", "arguments": {} },
            "outcome": { "ok": true, "output": "" },
        }),
        v1_model_io(2, vec![message("user", "b")], vec![], "two"),
    ]));
    let seqs: Vec<u64> = record.entries.iter().map(|entry| entry.seq).collect();
    assert_eq!(seqs, vec![0, 1, 2]);
    let agents: Vec<&str> = record
        .entries
        .iter()
        .map(|entry| entry.agent_id.as_str())
        .collect();
    assert_eq!(agents, vec!["root", "agent_1", "root"]);
}

#[test]
fn a_v1_turn_that_offered_no_tools_records_no_toolset() {
    // An absent `tools` key is a record written before the field existed; `tools: []` is
    // a turn that genuinely offered none. Neither is a toolset.
    let absent = read(v1_record(vec![json!({
        "agentId": "root",
        "seq": 0,
        "type": "model_io",
        "request": { "messages": [message("user", "hi")] },
        "response": {},
    })]));
    let GgReplayEntryKind::ModelIo { request, .. } = &absent.entries[0].kind else {
        panic!("a model_io");
    };
    assert_eq!(request.toolset, None);
    assert_eq!(request.fingerprint.tools, None);

    let empty = read(v1_record(vec![v1_model_io(
        0,
        vec![message("user", "hi")],
        vec![],
        "x",
    )]));
    let GgReplayEntryKind::ModelIo { request, .. } = &empty.entries[0].kind else {
        panic!("a model_io");
    };
    assert_eq!(
        request.toolset,
        Some(0),
        "an explicitly empty array is a toolset the turn offered"
    );
}

#[test]
fn a_malformed_v1_entry_is_an_error_rather_than_a_silent_drop() {
    // Dropping one would shift every following pool index in a reconstruction.
    let error = serde_json::from_value::<GgReplayRecord>(v1_record(vec![json!({
        "agentId": "root",
        "seq": 0,
        "type": "something_new",
    })]))
    .expect_err("an unknown v1 entry type is refused");
    assert!(
        error.to_string().contains("unknown v1 replay entry type"),
        "unexpected error: {error}"
    );

    let missing_seq = serde_json::from_value::<GgReplayRecord>(v1_record(vec![json!({
        "agentId": "root",
        "type": "model_io",
        "request": { "messages": [] },
        "response": {},
    })]))
    .expect_err("an entry without a seq is refused");
    assert!(
        missing_seq.to_string().contains("numeric `seq`"),
        "unexpected error: {missing_seq}"
    );
}

#[test]
fn an_upgraded_v1_record_keeps_its_session_identity_and_stays_marked_legacy() {
    let record = read(v1_record(vec![v1_model_io(
        0,
        vec![message("user", "hi")],
        vec![],
        "x",
    )]));
    assert_eq!(record.session_id, "run_1");
    assert!(record.captured_before_v2());
    assert_eq!(record.agents, vec![], "v1 has no provenance table");
    assert_eq!(record.seed, GgReplaySeed::default());
    assert_eq!(record.recorder, GgReplayRecorder::default());
}

#[test]
fn an_upgraded_record_re_serializes_in_the_v2_shape_and_survives_the_round_trip() {
    // One consumer code path: whatever went in, what comes out is v2 — and stays honest
    // about how it was captured, so a second read does not try to upgrade it again. It
    // would succeed at that, silently: a pooled request's `messages` are indices, and
    // interning `0` as a message body substitutes it for the system prompt.
    let record = read(v1_record(vec![v1_model_io(
        0,
        vec![message("system", "s"), message("user", "hi")],
        vec![json!({ "name": "shell" })],
        "x",
    )]));
    let value = serde_json::to_value(&record).expect("serializes");
    assert_eq!(value["formatVersion"], json!(GG_REPLAY_FORMAT_VERSION));
    assert_eq!(value["upgradedFrom"], json!(GG_REPLAY_FORMAT_V1));
    assert_eq!(value["messages"].as_array().expect("pooled").len(), 2);
    assert_eq!(value["entries"][0]["request"]["messages"], json!([0, 1]));

    let round_tripped = read(value);
    assert_eq!(round_tripped, record, "and reads back unchanged");
    assert!(round_tripped.captured_before_v2());
}

#[test]
fn a_pooled_body_under_a_v1_version_tag_is_refused_rather_than_re_interned() {
    // The failure mode the `upgradedFrom` split exists to make impossible, asserted
    // directly: a hand-written or mislabelled document cannot quietly become nonsense.
    let mut value = serde_json::to_value(read(v1_record(vec![v1_model_io(
        0,
        vec![message("user", "hi")],
        vec![],
        "x",
    )])))
    .expect("serializes");
    value["formatVersion"] = json!(GG_REPLAY_FORMAT_V1);
    value
        .as_object_mut()
        .expect("an object")
        .remove("upgradedFrom");

    let error = serde_json::from_value::<GgReplayRecord>(value)
        .expect_err("a pooled request is not a v1 request");
    assert!(
        error.to_string().contains("not pool indices"),
        "unexpected error: {error}"
    );
}

// --- addressing -------------------------------------------------------------

#[test]
fn a_content_address_is_the_leading_128_bits_of_sha_256() {
    let address = fingerprint_exact(b"abc");
    assert_eq!(address.len(), GG_REPLAY_ID_HEX_LEN);
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
    let mut pools = GgReplayPools::new();
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

/// An unclipped payload dedups exactly as it always did, and mints no clip row — so the table is
/// empty for a full-fidelity record by construction rather than by luck.
#[test]
fn interning_without_a_ceiling_records_no_clip() {
    let mut pools = GgReplayPools::new();
    let first = pools.intern_text_clipped("build output", None);
    let second = pools.intern_text("build output");
    assert_eq!(first, second);
    assert!(pools.into_parts().clips.is_empty());
}

/// The record's clip lookup answers "is this payload the whole of it?" — the question a reader has
/// to ask before treating a recorded payload as the payload.
#[test]
fn a_record_reports_which_of_its_texts_are_clips() {
    let mut record = GgReplayRecord::new("run_1", capability_set());
    record.texts = vec![
        "whole".to_string(),
        "tail".to_string(),
        "also whole".to_string(),
    ];
    record.clips = vec![GgReplayTextClip {
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
    let mut record = GgReplayRecord::new("run_1", capability_set());
    record.texts = vec!["tail".to_string()];
    record.clips = vec![GgReplayTextClip {
        text: 0,
        original_bytes: 1_048_576,
        original_id: fingerprint_exact(b"a megabyte of build log"),
    }];
    let json = serde_json::to_value(&record).expect("serializes");
    let back: GgReplayRecord = serde_json::from_value(json.clone()).expect("round trips");
    assert_eq!(back.clips, record.clips);

    let mut without = json;
    without.as_object_mut().unwrap().remove("clips");
    let back: GgReplayRecord =
        serde_json::from_value(without).expect("an older record still reads");
    assert!(back.clips.is_empty());
}

/// The fidelity is the single home of the clipping rule, so a recorder, a test and a reader cannot
/// hold three opinions about what a `full` record promises.
#[test]
fn full_fidelity_is_the_absence_of_a_ceiling() {
    assert_eq!(
        GgReplayFidelity::Standard.stream_max_bytes(),
        Some(GG_REPLAY_STANDARD_STREAM_MAX_BYTES)
    );
    assert_eq!(
        GgReplayFidelity::Standard.tool_max_bytes(),
        Some(GG_REPLAY_STANDARD_TOOL_MAX_BYTES)
    );
    assert_eq!(GgReplayFidelity::Full.stream_max_bytes(), None);
    assert_eq!(GgReplayFidelity::Full.tool_max_bytes(), None);
}
