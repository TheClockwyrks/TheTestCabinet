//! The gg **replay capture journal**: the append-only NDJSON stream a recording session
//! writes inside the run container, and the vocabulary the host folds back into a
//! [replay record](crate::gg_replay::GgReplayRecord).
//!
//! [Format v2](crate::gg_replay) splits capture from assembly. gg appends one JSON object
//! per line to [`GG_REPLAY_JOURNAL_PATH`] as the run proceeds and **never holds a message
//! body in memory**; the host, after collecting the run tree,
//! [streams those lines into the served record](crate::gg_replay_assembly). That split is
//! what satisfies gg's budget constraint — gg assembles
//! nothing — and it is why the journal is a distinct vocabulary rather than a partially
//! written record: a record is a document with four arrays in it, and a document cannot be
//! appended to.
//!
//! # Why the line carries its own index
//!
//! Every pool line names the [index](GgJournalLine::Message) it occupies even though the
//! index is implied by position. That redundancy is the gap detector: assembly hard-errors
//! on a pool line whose index is not the next one, rather than silently shifting every
//! later reference by one and substituting the wrong message body into a reconstructed
//! prompt. It is the on-disk half of the same guarantee capture enforces in memory — pools
//! are always a **contiguous prefix**, because minting an index and queueing its line
//! happen under one critical section and any failure stops capture for the whole run.
//!
//! # Why the `End` line is mandatory
//!
//! A killed gg cannot write a self-reported truncation marker, so completeness is read from
//! the *presence* of a terminating [`End`](GgJournalLine::End) line rather than from any
//! claim a record makes about itself. No `End` ⇒ the record is
//! [killed](crate::gg_replay::GgReplayTruncationReason::SessionKilled). An `End` that
//! carries a [truncation](crate::gg_replay::GgReplayTruncation) is a capture that stopped
//! deliberately and said why.
//!
//! Unlike the [record](crate::gg_replay), this vocabulary is **not** part of the published
//! contract: the journal never leaves the boundary between the run container and the host
//! that assembles it, so it has no TypeScript binding and no JSON Schema.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::gg::GgCapabilitySet;
use crate::gg_replay::{
    GgReplayBlob, GgReplayEntry, GgReplayInterner, GgReplayMessage, GgReplayRecorder,
    GgReplayToolset, GgReplayTruncation, fingerprint_exact, fingerprint_json,
};

/// Where a recording gg session writes its [journal](self), relative to the run workspace.
///
/// Under `.gg/` for the same reason the assembled sidecar is: seeding adds `/.gg/` to the
/// workspace's `.git/info/exclude`, so a journal growing *inside the model's working tree
/// during the run* stays out of the seed commit, out of every diff a speculation judge or
/// an issue reviewer reads, and out of the model's own `git add -A`.
pub const GG_REPLAY_JOURNAL_PATH: &str = ".gg/replay.ndjson";

/// One line of a [capture journal](self).
///
/// Internally tagged on `type`, one object per line, each line complete in itself: a torn
/// final line is discardable without disturbing anything before it, which is what lets a
/// record survive a container that died mid-write.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum GgJournalLine {
    /// The **first** line: the fixed identity of the capture, written before any input is
    /// recorded so that even a journal with no entries at all identifies the session it
    /// belongs to and the build that wrote it.
    Header {
        /// The [record format](crate::gg_replay::GG_REPLAY_FORMAT_VERSION) this journal
        /// assembles into. Carried here rather than inferred at assembly so a journal
        /// written by a newer gg is refused on the same terms a newer *record* is.
        format_version: u32,
        /// The gg session id — the run id, matching the telemetry stream's.
        session_id: String,
        /// The capability set the run was configured with. Boxed because it dwarfs every
        /// other line and this enum is passed by value.
        capability_set: Box<GgCapabilitySet>,
        /// Which build is capturing.
        recorder: GgReplayRecorder,
    },
    /// One newly interned message body, at the message pool index it occupies.
    Message {
        /// Its index into the assembled record's message pool.
        index: u32,
        /// The pooled body, with image payloads already replaced by
        /// [blob references](crate::gg_replay::GG_REPLAY_BLOB_REF_KEY).
        message: GgReplayMessage,
    },
    /// One newly interned offered tool-definition array, at the toolset pool index it
    /// occupies.
    Toolset {
        /// Its index into the assembled record's toolset pool.
        index: u32,
        /// The pooled toolset.
        toolset: GgReplayToolset,
    },
    /// One newly interned string payload, at the text pool index it occupies.
    Text {
        /// Its index into the assembled record's text pool.
        index: u32,
        /// The payload.
        text: String,
    },
    /// One newly interned image, at the blob pool index it occupies.
    Blob {
        /// Its index into the assembled record's blob pool.
        index: u32,
        /// The pooled image.
        blob: GgReplayBlob,
    },
    /// One pinned non-deterministic input. Boxed so the enum is not sized by its largest
    /// payload on every line.
    Entry {
        /// The entry, exactly as the assembled record carries it.
        entry: Box<GgReplayEntry>,
    },
    /// The **mandatory** terminating line. Its absence — not any field on it — is what
    /// tells assembly the session died mid-capture.
    End {
        /// How many [entries](GgJournalLine::Entry) the journal carries, so assembly can
        /// report a torn tail as a count mismatch rather than by trusting its own walk.
        entries: u64,
        /// Why capture stopped short of the session, when it did. Absent on a complete
        /// capture.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        truncation: Option<GgReplayTruncation>,
    },
}

/// The **streaming** [interner](GgReplayInterner) a capture journal is written through:
/// it holds pooled *ids*, never pooled bodies, and emits a
/// [line](GgJournalLine) the first time each body is seen.
///
/// This is the half of the format that makes always-on capture affordable. The
/// body-retaining [`GgReplayPools`](crate::gg_replay::GgReplayPools) is the right shape
/// for assembly and for playback, where the whole record is in hand anyway; a *recorder*
/// that retained bodies would reinstate exactly the memory term v2 exists to remove — a
/// run's images and every distinct message held for the life of the session, in a process
/// that is also running the model loop.
///
/// What it does retain is each pool entry's 32-character
/// [content address](fingerprint_exact), because the
/// [turn fingerprint](crate::gg_replay::GgTurnFingerprint) is a fold over exactly those.
/// At a few tens of bytes per *distinct* body that is bounded by the record's own pool
/// count, not by the run's length.
#[derive(Debug, Default)]
pub struct GgJournalInterner {
    /// The pooled message ids, indexed by pool position — what the fingerprint folds over.
    message_ids: Vec<String>,
    /// Message content address → pool index.
    message_index: HashMap<String, u32>,
    /// The pooled toolset ids, indexed by pool position.
    toolset_ids: Vec<String>,
    /// Toolset content address → pool index.
    toolset_index: HashMap<String, u32>,
    /// Text content address → pool index. Keyed on the **address** rather than on the text
    /// (as the body-retaining pool is), because keying on the text would hold every tool
    /// output for the life of the run — the one thing this interner exists not to do.
    text_index: HashMap<String, u32>,
    /// How many texts have been interned, i.e. the next text index.
    texts: u32,
    /// Blob content address → pool index.
    blob_index: HashMap<String, u32>,
    /// How many blobs have been interned, i.e. the next blob index.
    blobs: u32,
    /// The lines minted since the last [`take_pending`](Self::take_pending) — the bodies
    /// interned for the entry currently being recorded, in the order their indices were
    /// assigned.
    pending: Vec<GgJournalLine>,
}

impl GgJournalInterner {
    /// A fresh interner with empty pools.
    pub fn new() -> Self {
        Self::default()
    }

    /// Take the [lines](GgJournalLine) minted since the last call.
    ///
    /// The caller queues these **together with** the entry that references them, as one
    /// indivisible batch: a batch that lands writes every body its entry names, and a
    /// batch that does not land is followed by no further batch at all. That is what keeps
    /// the written pools a contiguous prefix with no dangling reference, without any
    /// rollback path.
    pub fn take_pending(&mut self) -> Vec<GgJournalLine> {
        std::mem::take(&mut self.pending)
    }

    /// How many distinct messages have been interned — the next message index, and the
    /// count assembly expects the message pool to reach.
    pub fn message_count(&self) -> u32 {
        self.message_ids.len() as u32
    }
}

impl GgReplayInterner for GgJournalInterner {
    fn intern_message(&mut self, body: &Value) -> u32 {
        let id = fingerprint_json(body);
        if let Some(&index) = self.message_index.get(&id) {
            return index;
        }
        // Substituted *before* the index is minted, so the blob lines its images produce
        // are queued ahead of the message line that references them.
        let mut stored = body.clone();
        self.substitute_blobs(&mut stored);
        let index = self.message_ids.len() as u32;
        self.message_ids.push(id.clone());
        self.message_index.insert(id.clone(), index);
        self.pending.push(GgJournalLine::Message {
            index,
            message: GgReplayMessage { id, body: stored },
        });
        index
    }

    fn message_id(&self, index: u32) -> Option<&str> {
        self.message_ids.get(index as usize).map(String::as_str)
    }

    fn intern_toolset(&mut self, tools: &Value) -> u32 {
        let id = fingerprint_json(tools);
        if let Some(&index) = self.toolset_index.get(&id) {
            return index;
        }
        let index = self.toolset_ids.len() as u32;
        self.toolset_ids.push(id.clone());
        self.toolset_index.insert(id.clone(), index);
        self.pending.push(GgJournalLine::Toolset {
            index,
            toolset: GgReplayToolset {
                id,
                tools: tools.clone(),
            },
        });
        index
    }

    fn toolset_id(&self, index: u32) -> Option<&str> {
        self.toolset_ids.get(index as usize).map(String::as_str)
    }

    fn intern_text(&mut self, text: &str) -> u32 {
        let id = fingerprint_exact(text.as_bytes());
        if let Some(&index) = self.text_index.get(&id) {
            return index;
        }
        let index = self.texts;
        self.texts += 1;
        self.text_index.insert(id, index);
        self.pending.push(GgJournalLine::Text {
            index,
            text: text.to_string(),
        });
        index
    }

    fn intern_blob(&mut self, media_type: &str, bytes: u64, data_base64: &str) -> u32 {
        let id = fingerprint_exact(data_base64.as_bytes());
        if let Some(&index) = self.blob_index.get(&id) {
            return index;
        }
        let index = self.blobs;
        self.blobs += 1;
        self.blob_index.insert(id.clone(), index);
        self.pending.push(GgJournalLine::Blob {
            index,
            blob: GgReplayBlob {
                id,
                media_type: media_type.to_string(),
                bytes,
                data_base64: data_base64.to_string(),
            },
        });
        index
    }
}

#[cfg(test)]
#[path = "gg_replay_journal.test.rs"]
mod tests;
