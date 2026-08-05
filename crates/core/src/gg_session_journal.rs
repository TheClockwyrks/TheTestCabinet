//! The gg **session capture journal**: the append-only NDJSON stream a recording session
//! writes inside the run container, and the vocabulary the host folds back into a
//! [session record](crate::gg_session_record::GgSessionRecord).
//!
//! [Format v2](crate::gg_session_record) splits capture from assembly. gg appends one JSON object
//! per line to [`GG_SESSION_JOURNAL_PATH`] as the run proceeds and **never holds a message
//! body in memory**; the host, after collecting the run tree,
//! [streams those lines into the served record](crate::gg_session_assembly). That split is
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
//! later reference by one and substituting the wrong message body into a recorded
//! prompt. It is the on-disk half of the same guarantee capture enforces in memory — pools
//! are always a **contiguous prefix**, because minting an index and queueing its line
//! happen under one critical section and any failure stops capture for the whole run.
//!
//! # Why the `End` line is mandatory
//!
//! A killed gg cannot write a self-reported truncation marker, so completeness is read from
//! the *presence* of a terminating [`End`](GgJournalLine::End) line rather than from any
//! claim a record makes about itself. No `End` ⇒ the record is
//! [killed](crate::gg_session_record::GgSessionTruncationReason::SessionKilled). An `End` that
//! carries a [truncation](crate::gg_session_record::GgSessionTruncation) is a capture that stopped
//! deliberately and said why.
//!
//! Unlike the [record](crate::gg_session_record), this vocabulary is **not** part of the published
//! contract: the journal never leaves the boundary between the run container and the host
//! that assembles it, so it has no TypeScript binding and no JSON Schema.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::gg::GgCapabilitySet;
use crate::gg_session_record::{
    GgSessionAgent, GgSessionEntry, GgSessionInterner, GgSessionMessage, GgSessionRecorder,
    GgSessionSeed, GgSessionTextClip, GgSessionToolset, GgSessionTruncation, clip_text,
    fingerprint_exact, fingerprint_json,
};

/// Where a recording gg session writes its [journal](self), relative to the run workspace.
///
/// Under `.gg/` for the same reason the assembled sidecar is: seeding adds `/.gg/` to the
/// workspace's `.git/info/exclude`, so a journal growing *inside the model's working tree
/// during the run* stays out of the seed commit, out of every diff a speculation judge or
/// an issue reviewer reads, and out of the model's own `git add -A`.
pub const GG_SESSION_JOURNAL_PATH: &str = ".gg/replay.ndjson";

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
        /// The [record format](crate::gg_session_record::GG_SESSION_FORMAT_VERSION) this journal
        /// assembles into. Carried here rather than inferred at assembly so a journal
        /// written by a newer gg is refused on the same terms a newer *record* is.
        format_version: u32,
        /// The gg session id — the run id, matching the telemetry stream's.
        session_id: String,
        /// The capability set the run was configured with. Boxed because it dwarfs every
        /// other line and this enum is passed by value.
        capability_set: Box<GgCapabilitySet>,
        /// Which build is capturing.
        recorder: GgSessionRecorder,
    },
    /// The run's **invocation envelope**: the fixed identity the session started from — the
    /// prompt, the resolved windows and modalities, and the baseline commit.
    ///
    /// Written at launch rather than at the end, for the reason every other line is written as
    /// it happens: the sessions whose envelope is most worth having are the ones that were
    /// killed, and a seed assembled at teardown is exactly the seed those runs never get.
    ///
    /// It may be written **again**, and assembly keeps the **last** one. One field of the
    /// envelope is not final until the session is: a provider that refuses an image
    /// [denies](crate::gg_session_record::GgSessionModalities::vision) that model for the rest of the
    /// run, and a reader that started from the un-denied state would send images on
    /// the first image turn and drift for a reason that has nothing to do with any real
    /// change. Rewriting the one line is how a streaming journal expresses a value that is
    /// only resolved at the end while still carrying it from the start.
    Seed {
        /// The envelope. Boxed because it carries the whole build prompt.
        seed: Box<GgSessionSeed>,
    },
    /// One agent the session created, and how it came to exist.
    ///
    /// Written when the agent **comes into existence** — before it takes a scheduler slot, let
    /// alone a turn — and again when its loop ends, carrying the terminal state. Assembly
    /// **upserts** by [`agent_id`](GgSessionAgent::agent_id), so the terminal row supersedes the
    /// opening one and an agent that never reached an ending keeps the row it was born with.
    ///
    /// That ordering is the whole point of the line. Deriving the agent set from the entries
    /// instead loses precisely the agents worth explaining: one parked behind the parallelism
    /// cap when the run was killed, one whose first model call never returned, one spawned
    /// into a session that ended before it spoke. Every one of them recorded nothing, and every
    /// one of them ran.
    Agent {
        /// The row. Boxed for the same reason [`Entry`](Self::Entry) is: one large variant
        /// should not size every line.
        agent: Box<GgSessionAgent>,
    },
    /// One newly interned message body, at the message pool index it occupies.
    Message {
        /// Its index into the assembled record's message pool.
        index: u32,
        /// The pooled body, with image payloads already reduced to descriptors.
        message: GgSessionMessage,
    },
    /// One newly interned offered tool-definition array, at the toolset pool index it
    /// occupies.
    Toolset {
        /// Its index into the assembled record's toolset pool.
        index: u32,
        /// The pooled toolset.
        toolset: GgSessionToolset,
    },
    /// One newly interned string payload, at the text pool index it occupies.
    Text {
        /// Its index into the assembled record's text pool.
        index: u32,
        /// The payload, or its [kept tail](crate::gg_session_record::clip_text) when the capture
        /// clipped it.
        text: String,
        /// What the payload is missing, when this line carries a clip of it rather than the whole.
        ///
        /// Carried on the same line rather than as a line of its own, for the reason the index is
        /// carried at all: a clip that could be separated from its text is a clip that can go
        /// missing, and a record silently claiming a 32 KiB tail is a whole payload is precisely
        /// the lie the table exists to prevent. Its
        /// [`text`](crate::gg_session_record::GgSessionTextClip::text) repeats this line's `index` for the
        /// same reason every pool line already names its own.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        clip: Option<GgSessionTextClip>,
    },
    /// One pinned non-deterministic input. Boxed so the enum is not sized by its largest
    /// payload on every line.
    Entry {
        /// The entry, exactly as the assembled record carries it.
        entry: Box<GgSessionEntry>,
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
        truncation: Option<GgSessionTruncation>,
    },
}

/// The **streaming** [interner](GgSessionInterner) a capture journal is written through:
/// it holds pooled *ids*, never pooled bodies, and emits a
/// [line](GgJournalLine) the first time each body is seen.
///
/// This is the half of the format that makes always-on capture affordable. The
/// body-retaining [`GgSessionPools`](crate::gg_session_record::GgSessionPools) is the right shape
/// for assembly and for reading, where the whole record is in hand anyway; a *recorder*
/// that retained bodies would reinstate exactly the memory term v2 exists to remove — a
/// run's images and every distinct message held for the life of the session, in a process
/// that is also running the model loop.
///
/// What it does retain is each pool entry's 32-character
/// [content address](fingerprint_exact), which is what dedup keys on. At a few tens of bytes per
/// *distinct* body that is bounded by the record's own pool count, not by the run's length.
#[derive(Debug, Default)]
pub struct GgJournalInterner {
    /// The pooled message ids, indexed by pool position.
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

impl GgSessionInterner for GgJournalInterner {
    fn intern_message(&mut self, body: &Value) -> u32 {
        let id = fingerprint_json(body);
        if let Some(&index) = self.message_index.get(&id) {
            return index;
        }
        let mut stored = body.clone();
        Self::withhold_image_bytes(&mut stored);
        let index = self.message_ids.len() as u32;
        self.message_ids.push(id.clone());
        self.message_index.insert(id.clone(), index);
        self.pending.push(GgJournalLine::Message {
            index,
            message: GgSessionMessage { id, body: stored },
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
            toolset: GgSessionToolset {
                id,
                tools: tools.clone(),
            },
        });
        index
    }

    fn toolset_id(&self, index: u32) -> Option<&str> {
        self.toolset_ids.get(index as usize).map(String::as_str)
    }

    fn intern_text_clipped(&mut self, text: &str, max_bytes: Option<usize>) -> u32 {
        let id = fingerprint_exact(text.as_bytes());
        if let Some(&index) = self.text_index.get(&id) {
            return index;
        }
        let index = self.texts;
        self.texts += 1;
        self.text_index.insert(id.clone(), index);
        let clipped = max_bytes.and_then(|max| clip_text(text, max));
        self.pending.push(GgJournalLine::Text {
            index,
            text: clipped.map_or_else(|| text.to_string(), |(kept, _)| kept.to_string()),
            clip: clipped.map(|(_, original_bytes)| GgSessionTextClip {
                text: index,
                original_bytes,
                original_id: id,
            }),
        });
        index
    }
}

#[cfg(test)]
#[path = "gg_session_journal.test.rs"]
mod tests;
