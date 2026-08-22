//! Tests for [host-side assembly](super): what a journal becomes, what damage it
//! survives, and what damage it is refused for.
//!
//! Journals under test are built through the **real** streaming interner rather than by
//! hand, so the pool lines, the indices and the fingerprints are exactly the ones a
//! recording session writes — the two sides of the format cannot drift apart in a test
//! that constructs one of them itself.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::*;
use crate::gg::{GgAgentStatus, GgCapabilitySet, ROOT_PROFILE_ID};
use crate::gg_session_journal::GgJournalInterner;
use crate::gg_session_record::{
    GgClientRole, GgSessionAgentOrigin, GgSessionCommand, GgSessionImage, GgSessionInterner,
    GgSessionModalities, GgSessionRecord, GgSessionRequestShape, GgSessionToolCall,
    GgSessionToolOutcome, GgShellCwd, GgShellOrigin,
};

// --- building a journal -----------------------------------------------------

fn message(role: &str, content: &str) -> Value {
    json!({ "role": role, "content": content })
}

/// The header a recording session writes first.
fn header() -> GgJournalLine {
    GgJournalLine::Header {
        format_version: GG_SESSION_FORMAT_VERSION,
        session_id: "run-1".to_string(),
        capability_set: Box::new(GgCapabilitySet::minimal("some/model")),
        recorder: GgSessionRecorder {
            gg_version: Some("0.7.0".to_string()),
            commit: None,
        },
    }
}

fn entry(seq: u64, kind: GgSessionEntryKind) -> GgJournalLine {
    GgJournalLine::Entry {
        entry: Box::new(GgSessionEntry {
            agent_id: "root".to_string(),
            seq,
            kind,
        }),
    }
}

/// A session that made one model call and one tool call, as the recorder would have
/// written it: each entry preceded by the bodies it newly interned.
fn session() -> Vec<GgJournalLine> {
    let mut interner = GgJournalInterner::new();
    let mut lines = vec![header()];

    let request = interner.intern_request(
        GgClientRole::Agent,
        GgSessionRequestShape::Complete,
        &[message("system", "you are gg"), message("user", "build it")],
        Some(&json!([{ "name": "shell" }])),
    );
    lines.extend(interner.take_pending());
    lines.push(entry(
        0,
        GgSessionEntryKind::ModelIo {
            request,
            response: json!({ "text": "on it", "toolCalls": [] }),
            duration_ms: None,
        },
    ));

    let output = interner.intern_text("ok");
    lines.extend(interner.take_pending());
    lines.push(entry(
        1,
        GgSessionEntryKind::ToolResult {
            call: GgSessionToolCall {
                id: "call-1".to_string(),
                name: "shell".to_string(),
                arguments: json!({ "command": "ls" }),
                cwd: Some(GgShellCwd::Workspace),
            },
            outcome: GgSessionToolOutcome {
                ok: true,
                output,
                summary: None,
                images: vec![GgSessionImage {
                    media_type: "image/png".to_string(),
                    bytes: 3,
                }],
                data: None,
                data_text: None,
                failure: None,
            },
        },
    ));
    lines
}

/// The terminating line a complete capture writes.
fn end(entries: u64) -> GgJournalLine {
    GgJournalLine::End {
        entries,
        truncation: None,
    }
}

/// Write `lines` as NDJSON into a journal file under `dir`.
fn write_journal(dir: &Path, lines: &[GgJournalLine]) -> PathBuf {
    let path = dir.join("replay.ndjson");
    write_journal_at(&path, lines);
    path
}

/// Write `lines` as NDJSON at exactly `path`, creating its parent.
fn write_journal_at(path: &Path, lines: &[GgJournalLine]) {
    std::fs::create_dir_all(path.parent().expect("a parent")).expect("the journal's directory");
    let mut file = std::fs::File::create(path).expect("create the journal");
    for line in lines {
        let json = serde_json::to_string(line).expect("serialize a journal line");
        writeln!(file, "{json}").expect("write a journal line");
    }
}

/// Read back an assembled artifact, through the same gzip + `Deserialize` path the
/// console and a replay driver use.
fn read_record(path: &Path) -> GgSessionRecord {
    let bytes = std::fs::read(path).expect("read the assembled record");
    assert_eq!(
        &bytes[..2],
        &[0x1f, 0x8b],
        "the artifact should be gzipped — the whole run-tree convention assumes it",
    );
    let mut json = String::new();
    flate2::read::GzDecoder::new(&bytes[..])
        .read_to_string(&mut json)
        .expect("decompress the assembled record");
    serde_json::from_str(&json).expect("deserialize the assembled record")
}

/// A scratch run tree, and the artifact path inside it.
fn output_in(dir: &Path) -> PathBuf {
    dir.join("run-1").join(GG_SESSION_TREE_ARTIFACT)
}

// --- the happy path ---------------------------------------------------------

#[test]
fn a_complete_journal_assembles_into_the_record_it_captured() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(end(2));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(assembly.entries, 2);
    assert_eq!(assembly.truncation, None);
    let record = read_record(&output);
    assert_eq!(record.format_version, GG_SESSION_FORMAT_VERSION);
    assert_eq!(record.session_id, "run-1");
    assert_eq!(
        record.capability_set,
        GgCapabilitySet::minimal("some/model"),
        "the record runs under the configuration the session was captured with",
    );
    assert_eq!(
        record.recorder.gg_version.as_deref(),
        Some("0.7.0"),
        "which build captured is carried through, explanatory only",
    );
    // Two distinct messages, one toolset, one tool output — the pools the interner minted,
    // in the order it minted them.
    assert_eq!(record.messages.len(), 2);
    assert_eq!(record.messages[0].body, message("system", "you are gg"));
    assert_eq!(record.toolsets.len(), 1);
    assert_eq!(record.texts, vec!["ok".to_string()]);
    assert_eq!(
        record
            .entries
            .iter()
            .map(|entry| entry.seq)
            .collect::<Vec<_>>(),
        vec![0, 1],
    );
    match &record.entries[0].kind {
        GgSessionEntryKind::ModelIo { request, .. } => {
            assert_eq!(request.messages, vec![0, 1]);
            assert_eq!(request.toolset, Some(0));
        }
        other => panic!("expected the model turn first, got {other:?}"),
    }
    assert!(record.truncation.is_none());
}

#[test]
fn the_document_carries_every_field_the_record_serializes() {
    // Assembly writes the document field by field (the arrays never exist in memory at
    // once, so `serde_json` cannot write it), which is the one thing about the format
    // that can silently drift from the type. A field added to the record and forgotten
    // here would deserialize as its `#[serde(default)]` — silently, and forever.
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(end(2));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    assemble_journal_to_gz(&journal, &output).expect("assemble");

    let bytes = std::fs::read(&output).expect("read the artifact");
    let mut json = String::new();
    flate2::read::GzDecoder::new(&bytes[..])
        .read_to_string(&mut json)
        .expect("decompress");
    let assembled: serde_json::Map<String, Value> =
        serde_json::from_str(&json).expect("the document is a JSON object");
    let serialized = serde_json::to_value(GgSessionRecord::new(
        "run-1",
        GgCapabilitySet::minimal("some/model"),
    ))
    .expect("serialize an empty record");
    let expected = serialized.as_object().expect("an object");

    assert_eq!(
        assembled.keys().collect::<Vec<_>>(),
        expected.keys().collect::<Vec<_>>(),
        "the hand-written document and the record type must carry the same fields",
    );
}

/// Deterministic filler of `bytes` characters, seeded on `seed`.
///
/// Not `"x".repeat(n)`: a run's real payloads are prose and source, and a body that gzip
/// erases to nothing would make the measurement below flattering rather than informative.
/// This compresses roughly as poorly as anything realistic can, so the figure it produces is
/// a **ceiling** on what a real session of the same shape costs.
fn filler(seed: u64, bytes: usize) -> String {
    let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    (0..bytes)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            char::from(b'a' + (state % 26) as u8)
        })
        .collect()
}

/// Always-on capture rests on one measured claim: with the conversation, the toolset and the
/// payloads content-addressed, a session costs so little to record that gating it buys
/// nothing. This is that measurement, end to end through the real interner, the real
/// assembly and the real gzip.
///
/// The shape under test is the one a plain transcript cannot afford — a **growing**
/// conversation re-sent in full on every turn, with a large tool array offered alongside it —
/// so the quadratic term is present and is exactly what pooling has to remove. The unpooled
/// figure is computed the way a transcript would actually write it (whole conversation plus
/// whole toolset, per turn) rather than taken from the design note, so the collapse is
/// measured here rather than asserted from memory.
#[test]
fn an_always_on_capture_of_a_realistic_session_costs_a_fraction_of_a_megabyte() {
    const TURNS: u64 = 30;
    const MEGABYTE: u64 = 1024 * 1024;

    let dir = tempfile::tempdir().expect("scratch");
    let mut interner = GgJournalInterner::new();
    let mut lines = vec![header()];
    // gg's system prompt and its offered tool array: large, identical on every turn, and
    // together the single biggest thing an unpooled transcript would re-serialize 30 times
    // over.
    let tools = json!([{ "name": "shell", "schema": filler(1, 20_000) }]);
    let mut conversation = vec![message("system", &filler(2, 12_000))];
    let mut unpooled_bytes: u64 = 0;

    for turn in 0..TURNS {
        conversation.push(message("user", &filler(100 + turn, 3_000)));
        // What a transcript would write for this turn: the whole conversation and the whole
        // tool array.
        unpooled_bytes += serde_json::to_vec(&conversation).expect("serialize").len() as u64
            + serde_json::to_vec(&tools).expect("serialize").len() as u64;

        let request = interner.intern_request(
            GgClientRole::Agent,
            GgSessionRequestShape::Complete,
            &conversation,
            Some(&tools),
        );
        lines.extend(interner.take_pending());
        let reply = filler(200 + turn, 1_500);
        lines.push(entry(
            turn,
            GgSessionEntryKind::ModelIo {
                request,
                response: json!({ "text": reply, "toolCalls": [] }),
                duration_ms: None,
            },
        ));
        conversation.push(message("assistant", &reply));
    }
    lines.push(end(TURNS));

    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());
    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(assembly.entries, TURNS);
    assert!(
        assembly.compressed_bytes < MEGABYTE,
        "a {TURNS}-turn session assembles to {} bytes, which is not well under a megabyte",
        assembly.compressed_bytes,
    );
    assert!(
        unpooled_bytes / assembly.compressed_bytes >= 10,
        "pooling should collapse the transcript by an order of magnitude or better; unpooled it \
         would have been {unpooled_bytes} bytes and this record is {} bytes",
        assembly.compressed_bytes,
    );
    // Each distinct body once, not once per turn it survived: the system prompt, one user
    // message per turn, and each turn's reply except the last — which was appended after
    // the final request and so was never sent to anything.
    let record = read_record(&output);
    assert_eq!(record.messages.len() as u64, TURNS * 2);
    assert_eq!(record.toolsets.len(), 1, "the tool array is pooled once");
}

#[test]
fn a_reported_ceiling_truncation_survives_assembly() {
    // Capture that stopped deliberately is not damage: the journal is well-formed, and
    // the reason the recorder gave is the record's own explanation of why it is short.
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(GgJournalLine::End {
        entries: 2,
        truncation: Some(GgSessionTruncation {
            reason: GgSessionTruncationReason::ByteCeiling,
            last_seq: Some(1),
            bytes: Some(4096),
        }),
    });
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(
        assembly.truncation,
        Some(GgSessionTruncation {
            reason: GgSessionTruncationReason::ByteCeiling,
            last_seq: Some(1),
            bytes: Some(4096),
        }),
    );
    assert_eq!(read_record(&output).truncation, assembly.truncation);
}

// --- the provenance lines ---------------------------------------------------

/// One agent row, as the recorder writes it when the agent comes into existence: the instance's
/// id, the [slug](crate::gg::GgAgentConfig::slug) of the profile it ran under, and that profile's
/// display name.
fn agent_line(
    agent_id: &str,
    profile_id: &str,
    profile: &str,
    origin: GgSessionAgentOrigin,
) -> GgJournalLine {
    GgJournalLine::Agent {
        agent: Box::new(GgSessionAgent {
            agent_id: agent_id.to_string(),
            profile_id: profile_id.to_string(),
            profile: profile.to_string(),
            origin,
            terminal_status: None,
            limit_hit: None,
        }),
    }
}

/// The same row once the agent's loop has ended.
fn ended_agent_line(
    agent_id: &str,
    profile_id: &str,
    profile: &str,
    origin: GgSessionAgentOrigin,
    status: GgAgentStatus,
) -> GgJournalLine {
    let GgJournalLine::Agent { mut agent } = agent_line(agent_id, profile_id, profile, origin)
    else {
        unreachable!("agent_line writes an agent line")
    };
    agent.terminal_status = Some(status);
    GgJournalLine::Agent { agent }
}

/// An envelope naming `prompt`.
fn seed_line(prompt: &str) -> GgJournalLine {
    GgJournalLine::Seed {
        seed: Box::new(GgSessionSeed {
            baseline_commit: Some("abc123".to_string()),
            prompt: prompt.to_string(),
            model_windows: BTreeMap::from([("some/model".to_string(), 128_000)]),
            model_modalities: BTreeMap::from([(
                "some/model".to_string(),
                GgSessionModalities { vision: true },
            )]),
        }),
    }
}

#[test]
fn the_invocation_envelope_and_the_agent_table_survive_assembly() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = vec![header(), seed_line("Build a tiny game.")];
    lines.push(agent_line(
        "root",
        ROOT_PROFILE_ID,
        "Root",
        GgSessionAgentOrigin::Root,
    ));
    lines.push(agent_line(
        "agent-0",
        "worker",
        "Worker",
        GgSessionAgentOrigin::Spawn {
            parent: "root".to_string(),
            ordinal: 0,
        },
    ));
    lines.push(end(0));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    assemble_journal_to_gz(&journal, &output).expect("assemble");

    let record = read_record(&output);
    assert_eq!(record.seed.prompt, "Build a tiny game.");
    assert_eq!(record.seed.baseline_commit.as_deref(), Some("abc123"));
    assert_eq!(record.seed.model_windows["some/model"], 128_000);
    assert!(record.seed.model_modalities["some/model"].vision);
    assert_eq!(
        record
            .agents
            .iter()
            .map(|agent| agent.agent_id.as_str())
            .collect::<Vec<_>>(),
        vec!["root", "agent-0"],
        "the table is in creation order, which is the order the rows were written",
    );
    assert_eq!(
        record.agents[1].origin,
        GgSessionAgentOrigin::Spawn {
            parent: "root".to_string(),
            ordinal: 0,
        },
        "and each row carries the keys a reconstruction binds the agent by",
    );
}

/// The property the whole `agents` table exists for: an agent that pinned **no input** is still in
/// it, because the table is written when an agent comes into existence rather than derived from
/// what it happened to record.
///
/// This is the shape of every killed run with a fleet: an agent parked behind the parallelism cap,
/// or one whose first model call never returned, ran and recorded nothing. A reconstruction that
/// learned its agents from the entries would run a smaller fleet than the run did.
#[test]
fn an_agent_that_recorded_nothing_still_has_its_row() {
    let dir = tempfile::tempdir().expect("scratch");
    // The root records everything in `session()`; the subagent records not one entry.
    let mut lines = vec![header()];
    lines.push(agent_line(
        "root",
        ROOT_PROFILE_ID,
        "Root",
        GgSessionAgentOrigin::Root,
    ));
    lines.push(agent_line(
        "agent-0",
        "worker",
        "Worker",
        GgSessionAgentOrigin::Spawn {
            parent: "root".to_string(),
            ordinal: 0,
        },
    ));
    lines.extend(session().into_iter().skip(1));
    // No `End` line at all: this is a session that was killed, which is exactly when the
    // distinction matters.
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    assemble_journal_to_gz(&journal, &output).expect("assemble");

    let record = read_record(&output);
    assert!(
        record
            .entries
            .iter()
            .all(|entry| entry.agent_id.as_str() == "root"),
        "the premise: the subagent pinned nothing at all",
    );
    assert_eq!(
        record
            .agents
            .iter()
            .map(|agent| agent.agent_id.as_str())
            .collect::<Vec<_>>(),
        vec!["root", "agent-0"],
        "and it is in the table regardless",
    );
    assert_eq!(
        record.truncation.map(|truncation| truncation.reason),
        Some(GgSessionTruncationReason::SessionKilled),
    );
}

#[test]
fn a_terminal_agent_row_supersedes_the_one_the_agent_was_born_with() {
    let dir = tempfile::tempdir().expect("scratch");
    let lines = vec![
        header(),
        agent_line("root", ROOT_PROFILE_ID, "Root", GgSessionAgentOrigin::Root),
        agent_line(
            "agent-0",
            "worker",
            "Worker",
            GgSessionAgentOrigin::Spawn {
                parent: "root".to_string(),
                ordinal: 0,
            },
        ),
        ended_agent_line(
            "root",
            ROOT_PROFILE_ID,
            "Root",
            GgSessionAgentOrigin::Root,
            GgAgentStatus::Done,
        ),
        end(0),
    ];
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    assemble_journal_to_gz(&journal, &output).expect("assemble");

    let record = read_record(&output);
    assert_eq!(record.agents.len(), 2, "an upsert, not an append");
    assert_eq!(
        record.agents[0].terminal_status,
        Some(GgAgentStatus::Done),
        "the terminal row replaces the opening one",
    );
    assert_eq!(
        record.agents[0].agent_id, "root",
        "and in place, so the table stays in creation order",
    );
    assert_eq!(
        record.agents[1].terminal_status, None,
        "an agent that never ended keeps the row it was born with",
    );
}

/// The envelope is rewritten when a value it could not know at launch resolves — today, a model
/// the provider refused an image for. The **last** line wins, or a reconstruction would send
/// images on the first image turn and diverge for a reason that has nothing to do with a change.
#[test]
fn the_last_envelope_supersedes_the_ones_before_it() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut resolved = seed_line("Build a tiny game.");
    let GgJournalLine::Seed { seed } = &mut resolved else {
        unreachable!("seed_line writes a seed line")
    };
    seed.model_modalities.insert(
        "some/model".to_string(),
        GgSessionModalities { vision: false },
    );
    let lines = vec![header(), seed_line("Build a tiny game."), resolved, end(0)];
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    assemble_journal_to_gz(&journal, &output).expect("assemble");

    let record = read_record(&output);
    assert!(
        !record.seed.model_modalities["some/model"].vision,
        "the resolved state, not the declared one",
    );
    assert_eq!(
        record.seed.prompt, "Build a tiny game.",
        "and the rest of the envelope is unchanged",
    );
}

// --- damage that is reported ------------------------------------------------

#[test]
fn a_journal_without_its_end_line_is_a_killed_session() {
    // The `End` line's *absence* is the only signal a killed gg can leave: it had no
    // opportunity to write a self-report either.
    let dir = tempfile::tempdir().expect("scratch");
    let journal = write_journal(dir.path(), &session());
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(
        assembly.truncation,
        Some(GgSessionTruncation {
            reason: GgSessionTruncationReason::SessionKilled,
            last_seq: Some(1),
            bytes: None,
        }),
    );
    assert_eq!(
        assembly.entries, 2,
        "everything that reached the journal is still served",
    );
    assert_eq!(read_record(&output).entries.len(), 2);
}

#[test]
fn a_torn_final_line_keeps_everything_before_it() {
    let dir = tempfile::tempdir().expect("scratch");
    let journal = write_journal(dir.path(), &session());
    // A batch that was still being written when the process stopped: a complete prefix
    // and no terminating newline.
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&journal)
        .expect("reopen the journal");
    file.write_all(br#"{"type":"entry","entry":{"agentId":"root","seq":2,"#)
        .expect("write a torn line");
    drop(file);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(
        assembly.truncation,
        Some(GgSessionTruncation {
            reason: GgSessionTruncationReason::CorruptJournal,
            last_seq: Some(1),
            bytes: None,
        }),
        "the record is corrupt at the last complete entry, not at the torn one",
    );
    assert_eq!(read_record(&output).entries.len(), 2);
}

#[test]
fn an_end_line_that_disagrees_with_the_walk_is_a_corrupt_journal() {
    // The count exists to be disagreed with: a record that holds fewer entries than the
    // recorder says it wrote is missing some in the middle, which no walk can see.
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(end(7));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(
        assembly.truncation,
        Some(GgSessionTruncation {
            reason: GgSessionTruncationReason::CorruptJournal,
            last_seq: Some(1),
            bytes: None,
        }),
    );
}

// --- damage that is refused -------------------------------------------------

#[test]
fn a_pool_index_that_skips_is_refused_rather_than_assembled() {
    // The failure this prevents is silent: with a hole in the pool, the entry asking for
    // message 1 would be handed message 0's body and the record would read as complete.
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    for line in &mut lines {
        if let GgJournalLine::Message { index, .. } = line
            && *index == 1
        {
            *index = 2;
        }
    }
    lines.push(end(2));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let error = assemble_journal_to_gz(&journal, &output).expect_err("a gap is refused");

    assert!(
        error.to_string().contains("gap in its message pool"),
        "the error should name the pool that skipped: {error}",
    );
    assert!(
        !output.exists(),
        "no artifact at all is better than one that describes a conversation that never happened",
    );
}

#[test]
fn an_entry_referencing_past_a_pool_is_refused_rather_than_assembled() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = vec![header()];
    lines.push(entry(
        0,
        GgSessionEntryKind::Git {
            command: GgSessionCommand {
                command: "git status".to_string(),
                cwd: GgShellCwd::Workspace,
                exit_code: 0,
                // Nothing has been interned, so both streams dangle.
                stdout: 0,
                stderr: 1,
            },
        },
    ));
    lines.push(end(1));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let error = assemble_journal_to_gz(&journal, &output).expect_err("a dangling ref is refused");

    assert!(
        error.to_string().contains("dangling reference"),
        "the error should say what is missing: {error}",
    );
    assert!(!output.exists());
}

#[test]
fn a_journal_from_a_newer_gg_is_refused() {
    // Refused rather than guessed at: a newer journal may hold entry kinds this build has
    // never heard of, and half a session's inputs is not a reconstruction.
    let dir = tempfile::tempdir().expect("scratch");
    let lines = vec![GgJournalLine::Header {
        format_version: GG_SESSION_FORMAT_VERSION + 1,
        session_id: "run-1".to_string(),
        capability_set: Box::new(GgCapabilitySet::default()),
        recorder: GgSessionRecorder::default(),
    }];
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let error = assemble_journal_to_gz(&journal, &output).expect_err("a newer format is refused");

    assert!(
        error.to_string().contains("does not assemble"),
        "the error should say the format is not this build's: {error}",
    );
    assert!(!output.exists());
}

#[test]
fn a_journal_with_no_header_is_refused() {
    // Without the header there is no session id and no capability set, so there is no
    // record to write — not even an empty one.
    let dir = tempfile::tempdir().expect("scratch");
    let journal = write_journal(dir.path(), &[end(0)]);
    let output = output_in(dir.path());

    let error = assemble_journal_to_gz(&journal, &output).expect_err("a headerless journal");

    assert!(
        error.to_string().contains("no header line"),
        "the error should say the session is unknown: {error}",
    );
}

// --- the scratch files ------------------------------------------------------

#[test]
fn the_scratch_directory_is_on_the_output_volume_and_does_not_survive() {
    // R17: segments cost the journal's size again, so they must never land on a `/tmp`
    // that is a small tmpfs. Deriving the location from the output is the enforcement.
    let dir = tempfile::tempdir().expect("scratch");
    let output = output_in(dir.path());

    let scratch = scratch_beside(&output).expect("a scratch directory");
    assert_eq!(
        scratch.path().parent(),
        output.parent(),
        "scratch must sit beside the artifact, on the same volume as the run tree",
    );
    let path = scratch.path().to_path_buf();
    drop(scratch);
    assert!(!path.exists(), "scratch is transient and cleans itself up");
}

#[test]
fn assembly_leaves_nothing_behind_but_the_artifact() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(end(2));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    assemble_journal_to_gz(&journal, &output).expect("assemble");

    let left: Vec<String> = std::fs::read_dir(output.parent().expect("a run dir"))
        .expect("list the run dir")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert_eq!(left, vec![GG_SESSION_TREE_ARTIFACT.to_string()]);
}

// --- the stage --------------------------------------------------------------

/// A run request for `harness`, with everything else at its least interesting.
fn request(harness: crate::HarnessSlug) -> crate::RunRequest {
    crate::RunRequest {
        test_case_slug: "carom".to_string(),
        test_case_version: Some("v1.0.0".to_string()),
        variant: "base".to_string(),
        harness,
        model_id: "some/model".to_string(),
        orchestrator: crate::OrchestratorSelection::default(),
        engine: crate::EngineSelection::default(),
        max_runtime_override: None,
        container_image: None,
        gg_capability_set: None,
        gg_model_windows: std::collections::BTreeMap::new(),
        gg_model_modalities: std::collections::BTreeMap::new(),
    }
}

/// A resolved case and variant the stage never reads, built through `serde` so a field
/// added to either does not drag this fixture along with it.
fn case() -> (crate::test_case::TestCaseVersion, crate::test_case::Variant) {
    let version = serde_json::from_value(json!({
        "slug": "carom",
        "version": "v1.0.0",
        "name": "Carom",
        "difficulty": "easy",
        "tags": [],
        "summary": null,
        "descriptionPath": null,
        "root": "/tmp/carom",
        "promptPath": "/tmp/carom/prompt.hbs",
        "maxRuntimeSeconds": 3600,
        "commonSpecs": [],
        "commonWorkspace": {},
        "engines": ["none"],
        "init": null,
        "assetPaths": [],
        "packages": [],
        "variants": [],
        "commonReferences": [],
        "commonProofs": [],
        "checks": [],
        "commonReviewItems": [],
        "domains": [],
        "cases": [],
        "errata": [],
    }))
    .expect("a resolved case");
    let variant = serde_json::from_value(json!({
        "slug": "base",
        "name": "Base",
        "specs": [],
        "references": [],
        "proofs": [],
        "reviewItems": [],
        "domains": [],
    }))
    .expect("a variant");
    (version, variant)
}

/// Drive the stage over a run whose collected tree is `repo_path` and whose run
/// directory is `run_dir`.
async fn drive_stage(
    harness: crate::HarnessSlug,
    repo_path: &Path,
    run_dir: &Path,
) -> Result<PostRunReport> {
    let (version, variant) = case();
    let request = request(harness);
    let artifacts = crate::execution::ArtifactCollection::new(repo_path.to_path_buf());
    GgSessionAssembler
        .run(&PostRunContext {
            run_id: "run-1",
            run_dir,
            artifacts: &artifacts,
            seed_commit: "0123456789abcdef0123456789abcdef01234567",
            test_case: &version,
            variant: &variant,
            request: &request,
            canceled: false,
        })
        .await
}

#[tokio::test]
async fn the_stage_ignores_a_run_from_another_harness() {
    // The seam invokes every wired stage unconditionally, so "this run is not mine" is
    // the stage's own decision — and a Claude Code run's tree has no journal to read.
    let dir = tempfile::tempdir().expect("scratch");
    let repo = dir.path().join("implementation");
    let mut lines = session();
    lines.push(end(2));
    write_journal_at(&repo.join(GG_SESSION_JOURNAL_PATH), &lines);
    let run_dir = dir.path().join("run-1");

    let report = drive_stage(crate::HarnessSlug::Claude, &repo, &run_dir)
        .await
        .expect("the stage");

    assert_eq!(report, PostRunReport::empty());
    assert!(!run_dir.join(GG_SESSION_TREE_ARTIFACT).exists());
}

#[tokio::test]
async fn a_gg_run_that_captured_nothing_is_not_a_failure() {
    let dir = tempfile::tempdir().expect("scratch");
    let repo = dir.path().join("implementation");
    std::fs::create_dir_all(&repo).expect("a tree");
    let run_dir = dir.path().join("run-1");
    std::fs::create_dir_all(&run_dir).expect("a run dir");

    let report = drive_stage(crate::HarnessSlug::Gg, &repo, &run_dir)
        .await
        .expect("a missing journal is an absence, not an error");

    assert_eq!(report, PostRunReport::empty());
}

#[tokio::test]
async fn the_stage_lifts_the_journal_out_of_the_collected_tree() {
    // The tree is copied verbatim into the run's `implementation/` and from there into
    // the public per-run repository, so a conversation transcript left inside it would be
    // published — and counted as code the model wrote.
    let dir = tempfile::tempdir().expect("scratch");
    let repo = dir.path().join("implementation");
    let mut lines = session();
    lines.push(end(2));
    write_journal_at(&repo.join(GG_SESSION_JOURNAL_PATH), &lines);
    let run_dir = dir.path().join("run-1");
    std::fs::create_dir_all(&run_dir).expect("a run dir");

    let report = drive_stage(crate::HarnessSlug::Gg, &repo, &run_dir)
        .await
        .expect("the stage");

    let artifact = run_dir.join(GG_SESSION_TREE_ARTIFACT);
    assert_eq!(report.artifacts, vec![artifact.clone()]);
    assert!(
        !repo.join(GG_SESSION_JOURNAL_PATH).exists(),
        "the journal must not survive into the published tree",
    );
    assert_eq!(read_record(&artifact).entries.len(), 2);
}

#[tokio::test]
async fn the_stage_reports_an_unusable_journal_as_a_failure() {
    // Which the seam turns into a warning and a run with no replay artifact — never a
    // failed run.
    let dir = tempfile::tempdir().expect("scratch");
    let repo = dir.path().join("implementation");
    std::fs::create_dir_all(repo.join(".gg")).expect("a tree");
    std::fs::write(repo.join(GG_SESSION_JOURNAL_PATH), "not a journal\n").expect("a bad journal");
    let run_dir = dir.path().join("run-1");

    let error = drive_stage(crate::HarnessSlug::Gg, &repo, &run_dir)
        .await
        .expect_err("an unusable journal");

    assert!(
        error.to_string().contains("no header line"),
        "the failure should say what was wrong: {error}",
    );
    assert!(
        repo.join(GG_SESSION_JOURNAL_PATH).exists(),
        "a journal that could not be assembled is left where it is, for a human to read",
    );
}

/// `GgShellOrigin` is part of the entry vocabulary assembly walks; naming it here keeps
/// the reference-checking match's coverage of shell entries honest.
#[test]
fn a_shell_entrys_streams_are_checked_against_the_text_pool() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut interner = GgJournalInterner::new();
    let stdout = interner.intern_text("hello");
    let stderr = interner.intern_text("");
    let mut lines = vec![header()];
    lines.extend(interner.take_pending());
    lines.push(entry(
        0,
        GgSessionEntryKind::Shell {
            origin: GgShellOrigin::Tool,
            command: GgSessionCommand {
                command: "echo hello".to_string(),
                cwd: GgShellCwd::Workspace,
                exit_code: 0,
                stdout,
                stderr,
            },
        },
    ));
    lines.push(end(1));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(assembly.entries, 1);
    assert_eq!(
        read_record(&output).texts,
        vec!["hello".to_string(), String::new()]
    );
}

/// The clip table reaches the assembled record, in ascending pool order.
///
/// The journal carries a clip on the same line as the text it describes — a clip that could be
/// separated from its payload is a clip that can go missing, and a record silently claiming a
/// 32 KiB tail is a whole payload is exactly the lie the table exists to prevent — so assembly's
/// job is to lift them into the record's own sparse table without reordering them.
#[test]
fn a_clipped_journal_assembles_into_a_record_that_says_which_texts_are_clips() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    let mut interner = GgJournalInterner::new();
    let mut lines = vec![header()];

    let whole = "a short outcome";
    let huge = "x".repeat(128);
    let output = interner.intern_text(whole);
    let clipped = interner.intern_text_clipped(&huge, Some(32));
    lines.extend(interner.take_pending());
    lines.push(entry(
        0,
        GgSessionEntryKind::Shell {
            origin: GgShellOrigin::Hook,
            command: GgSessionCommand {
                command: "npm test".to_string(),
                cwd: GgShellCwd::Workspace,
                exit_code: 1,
                stdout: clipped,
                stderr: output,
            },
        },
    ));
    lines.push(end(1));

    let journal = write_journal(dir.path(), &lines);
    let output_path = output_in(dir.path());
    assemble_journal_to_gz(&journal, &output_path).expect("assembles");
    let record = read_record(&output_path);

    assert_eq!(record.texts[clipped as usize].len(), 32);
    assert_eq!(record.texts[output as usize], whole);
    assert_eq!(record.clips.len(), 1, "only the clipped payload has a row");
    let clip = record
        .clip(clipped)
        .expect("the clipped text is found by its index");
    assert_eq!(clip.original_bytes, 128);
    assert!(
        record.clip(output).is_none(),
        "and a whole payload is not reported as one"
    );
}
