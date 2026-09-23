//! The gg **session record**: the content-addressed input log a gg session is captured into.
//!
//! A session record pins what a [gg](crate::gg) session consumed, so a run that explains nothing
//! on its own — one that hung, or outran its cap, and was torn down before its tree was ever
//! collected — can still be explained. Its shape is
//!
//! > [`seed`](GgSessionRecord::seed) (fixed identity) + three content-addressed pools + an
//! > ordered [input log](GgSessionRecord::entries)
//!
//! so a record costs `O(unique bytes) + O(Σ window items)` rather than the cost of a plain
//! transcript, which re-serializes the whole conversation and the whole offered-tool array on
//! every turn — quadratic in messages and linear-times-`N` in tool definitions. That is what
//! makes capture affordable enough to be always-on rather than a debugging opt-in.
//!
//! # The three pools
//!
//! [Messages](GgSessionMessage), [toolsets](GgSessionToolset) and
//! [texts](GgSessionRecord::texts). Each entry is stored once and referenced by **index** into its
//! pool. Interning goes through [`GgSessionInterner`], which gg's streaming journal and this
//! crate's assembly both implement, so the two cannot compute a content address differently.
//!
//! # A picture is a descriptor, never a payload
//!
//! An image a turn carried is recorded as its media type and decoded size and **never as its
//! bytes** — the same thing the [telemetry stream](crate::gg::GgTelemetryKind::ContextMessage)
//! records of the same turn, so the two cannot disagree about what a message was. A message's
//! [content address](GgSessionMessage::id) is still computed over the payload, which is what keeps
//! two different pictures of one media type and size two different messages.
//!
//! # Identity, and what a reader may branch on
//!
//! The record carries three identities because they answer three different questions,
//! and conflating them is how a version check becomes the bug:
//!
//! | Field | Question | May a reader branch on it? |
//! | --- | --- | --- |
//! | [`format_version`](GgSessionRecord::format_version) | Can this build parse this record at all? | **Yes** — this is the compatibility contract |
//! | [`recorder.gg_version`](GgSessionRecorder::gg_version) | Which build wrote it? | No — explanatory only |
//! | [`recorder.commit`](GgSessionRecorder::commit) | Which *exact* build wrote it? | Only to verify a build is the one that recorded |
//!
//! Gating on the gg version is wrong in **both** directions: a version bump with no
//! prompt change must not invalidate every record on every release, and an uncommitted
//! prompt edit *within* one build must not pass.
//!
//! [`GG_SESSION_FORMAT_VERSION`] is the one format this build reads, and anything else is
//! refused rather than guessed at: a record stating another format may hold entry kinds this
//! build has never heard of, and reading a session from a partial understanding of its inputs
//! is worse than not reading it. Every record states its format, so one that states none is
//! malformed and does not parse at all.
//!
//! Like the rest of the contract these types are the source of truth: the TypeScript
//! bindings (`packages/run-record/src/gg-session-record.ts`) and the JSON Schemas
//! (`apps/docs/public/schema/gg/session-record.schema.json`) are generated from them by
//! `crates/contract-codegen` and are never edited by hand. JSON is camelCase.
//!
//! Four names keep the word this record used to be called by: the in-container journal's
//! [`.gg/replay.ndjson`](crate::gg_session_journal::GG_SESSION_JOURNAL_PATH), the run tree's
//! `replay.json.gz`, the backend's `replay` artifact slot and the `GET /runs/{id}/replay`
//! route. They are **addresses**, not names: every record already in object storage is filed
//! under them, the driver in a released image posts to that route, and a released `gg` binary
//! writes its journal at that path for a host of this version to salvage. Renaming an address
//! 404s the runs stored at it, or leaves a hung run's journal unfound. The generated bindings and
//! schema above are not addresses — they are rewritten from these types on every build, and they
//! say what the record is.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::gg::{GgAgentStatus, GgCapabilitySet, GgContextSource, GgLimitBreach};

#[cfg(test)]
#[path = "gg_session_record.test.rs"]
mod tests;

/// The session-record format version this build writes, and the only one it reads.
pub const GG_SESSION_FORMAT_VERSION: u32 = 1;

/// The number of lowercase-hex characters a pooled content address is truncated to: 32,
/// i.e. the leading **128 bits** of a SHA-256 digest.
///
/// A 128-bit address makes an accidental collision across a single run's pools impossible in
/// practice while keeping each id a third the size of a full digest.
pub const GG_SESSION_ID_HEX_LEN: usize = 32;

/// The **content address** of `bytes`: the leading 128 bits of its SHA-256 digest, as
/// lowercase hex.
///
/// This is the one address function for the whole format. It is deliberately *not*
/// gg's telemetry `fingerprint`, which is a 64-bit `DefaultHasher` over image
/// *descriptors*: two different pictures of the same media type and decoded size hash
/// identically there, and two different pictures that pooled as one message would put one turn's
/// window in place of another's.
pub fn fingerprint_exact(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(&digest[..GG_SESSION_ID_HEX_LEN / 2])
}

/// How many bytes of one pooled **subprocess stream** a capture keeps: 32 KiB.
///
/// The ceiling exists because a raw process stream is the one payload class unbounded by anything
/// gg controls. A message is bounded by the model's context window and an image by the file that
/// produced it, but a `git diff` over a tree the model has been building for forty minutes, or a
/// failing test suite's output, is bounded only by what the subprocess felt like printing — and a
/// run has hundreds of them. Clipping them is what keeps a record the well-under-a-megabyte
/// artifact that justifies capturing every run.
///
/// Sized at twice the 16 KiB cap gg's own [shell tool](https://docs.testcabinet.ai/gg/tools/)
/// applies to the output it shows the model, so the clip always covers everything the model saw of
/// the command plus as much again of what it did not.
pub const GG_SESSION_STREAM_MAX_BYTES: usize = 32 * 1024;

/// How many bytes of one pooled **tool payload** a capture keeps: 256 KiB.
///
/// Eight times the [stream ceiling](GG_SESSION_STREAM_MAX_BYTES), and deliberately so:
/// these two seams record different things and only one of them is bounded by a cap the model's
/// own view shares. A recorded stream is what the process printed, of which `shell` shows the model
/// the last 16 KiB; a recorded tool payload **is** what the model was shown, and the largest such
/// payload gg hands over is a whole-file `read_file`, capped at 256 KiB by the filesystem tool
/// itself. Sizing this ceiling at that cap is what keeps the invariant a reader depends on: *a
/// payload the model was shown in full is recorded in full*, so a clip in the tool pool means the
/// tool layer had already clipped it too.
///
/// A single 32 KiB ceiling across both seams broke that. It recorded a 100 KB source file the model
/// read in its entirety as a 32 KiB tail, cut mid-file — a reader taking that for the file would
/// present the model with a different file than the run did, and report the resulting divergence as
/// model drift.
pub const GG_SESSION_TOOL_MAX_BYTES: usize = 256 * 1024;

/// The two ceilings are separate numbers with separate reasons, and the tool one is deliberately
/// the larger; collapsing them back to a single value is the regression this fails the build on.
/// The tie that matters most — tool ceiling ≥ `read_file`'s own cap — is asserted the same way in
/// `gg`'s `capture` module, which is the one place both of *those* numbers are in scope.
const _: () = assert!(GG_SESSION_TOOL_MAX_BYTES > GG_SESSION_STREAM_MAX_BYTES);

/// The [content address](fingerprint_exact) of a JSON value, over its compact
/// serialization.
///
/// Stable across processes and across the recorder/assembly boundary because
/// `serde_json`'s object map is ordered (this workspace does not enable
/// `preserve_order`), so the same logical value always serializes to the same bytes
/// regardless of the order its fields were inserted in.
pub fn fingerprint_json(value: &Value) -> String {
    fingerprint_exact(&serde_json::to_vec(value).unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/// Which build of gg wrote a record — the *explanatory* half of the record's
/// [three-part identity](self#identity-and-what-a-reader-may-branch-on).
///
/// Carried once on the record rather than per turn: it is a property of the capture, not
/// of any individual input. Both members are optional because a build that cannot state
/// its own version or commit reports "unknown" rather than inventing one.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionRecorder {
    /// The `gg --version` of the build that captured this record (for example `0.7.0`).
    /// Explanatory only — never the compatibility gate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_version: Option<String>,
    /// The exact commit the capturing build was made from, when it is known. The only
    /// thing that can tell an uncommitted prompt edit *within* one version from the
    /// released build of that version, so it is the only thing that identifies exactly which gg
    /// wrote a record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub commit: Option<String>,
}

/// The **fixed identity** a recorded session started from: everything a reader
/// needs before it consumes its first [entry](GgSessionEntry).
///
/// Recording the seed is what makes a record self-contained rather than only meaningful
/// beside the run tree it came from.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionSeed {
    /// The commit gg observed the seeded workspace at, in the container, before the
    /// session made any change.
    ///
    /// Deliberately kept alongside — not merged with — the host-side
    /// [`RunRecord::seed_commit`](crate::run_record::RunRecord::seed_commit). The host's
    /// value is harness-agnostic and authoritative; this one is gg's own observation.
    /// They should be equal, and a mismatch is a *diagnostic* rather than redundancy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub baseline_commit: Option<String>,
    /// The build prompt the session was invoked with — the rendered test-case
    /// instruction the root agent was given.
    pub prompt: String,
    /// The context window, in tokens, resolved for each bound model slot. Recorded
    /// because the window is what the fullness signal and compaction thresholds are
    /// computed against, so a reader that guessed it would compact at a
    /// different turn than the run did.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_windows: BTreeMap<String, u64>,
    /// The ordered candidate list each bound model may run on. Recorded because a
    /// run's cost is on those providers' price bases, and a reader that guessed the
    /// list would price the run against a different one.
    #[serde(
        default,
        skip_serializing_if = "BTreeMap::is_empty",
        deserialize_with = "crate::gg::provider_lists::read"
    )]
    pub model_providers: BTreeMap<String, Vec<crate::gg::GgProviderCandidate>>,
    /// The **final, resolved** modality state of each bound slot.
    ///
    /// Resolved, not initial, and that distinction is load-bearing: vision recovery can
    /// call the model twice for one turn and only the successful stripped call is
    /// recorded, so a reader that started from an un-denied vision state would
    /// send images on the first image turn and drift for a reason that has nothing to do
    /// with any real change.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_modalities: BTreeMap<String, GgSessionModalities>,
}

/// Which input modalities a bound model slot was resolved to accept.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionModalities {
    /// Whether the slot's model accepts image input. `false` once a provider has
    /// refused an image for this model and the loop has stripped images from the
    /// context.
    pub vision: bool,
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/// One distinct message body in the [message pool](GgSessionRecord::messages).
///
/// A single message is typically re-sent on every turn it survives — the measured
/// redundancy on a 12-turn single-agent session was 6.4× — so pooling it is the largest
/// single win in the format after the toolset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionMessage {
    /// The message's [content address](fingerprint_exact), computed over the body **including
    /// its exact image payloads** — before those payloads were reduced to descriptors.
    ///
    /// Addressing the message as it was *sent* is what keeps two different pictures of the same
    /// media type and decoded size two different messages. Addressing the stored body instead
    /// would collide them, and the pool would then serve one turn's window in place of
    /// another's.
    pub id: String,
    /// The message as the client sent it — the `gg` binary's `Message`, camelCase, with
    /// every inline image payload replaced by a
    /// [descriptor](GgSessionImage). Carried as free-form JSON because its
    /// concrete shape is owned by the `gg` binary rather than by this contract crate.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub body: Value,
}

/// One distinct offered tool-definition array in the
/// [toolset pool](GgSessionRecord::toolsets).
///
/// The finding that reshaped this format: on a real record the re-serialized tool array
/// was **52%** of the bytes — larger than the messages — and its redundancy is exactly
/// the turn count, because a run's offered toolset almost never changes. Pooling
/// collapses `N` copies to one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionToolset {
    /// The toolset's [content address](fingerprint_exact) over the serialized array.
    /// What the pool dedups on, so a run's one offered toolset is written once rather than
    /// once per turn.
    pub id: String,
    /// The tool definitions offered, in the order they were offered — the `gg` binary's
    /// `ToolDefinition[]`, camelCase.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>[]"))]
    pub tools: Value,
}

/// One pooled text that is a **clip** of the payload the session actually saw, rather than the
/// whole of it.
///
/// A capture clips a payload past [its ceiling](GG_SESSION_STREAM_MAX_BYTES). The clip has
/// to be self-describing, and the
/// text pool is a bare `Vec<String>` with nowhere to say so — a reader handed a 32 KiB string
/// cannot tell a command that printed exactly that much from one that printed forty megabytes, and
/// the difference is the whole of whether a reader comparing its own output against it is
/// entitled to call a mismatch drift. Hence this table, keyed by pool index, holding what the
/// stored string is missing.
///
/// # Why the whole payload's content address is on it
///
/// [`original_id`](Self::original_id) is what makes a clipped record still *checkable*: a
/// reader holding the whole output can hash it and answer "is this the same output?" exactly,
/// from a record that kept 32 KiB of it. Without that the clip would be evidence of nothing — a
/// matching tail proves very little about a payload whose head was dropped.
///
/// It is also what makes the pool's dedup unambiguous. Interning keys on the address of the
/// **original** rather than of the stored clip, so two different payloads that happen to share a
/// tail occupy two pool entries with two clip rows, instead of collapsing into one entry whose
/// single row could only describe one of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionTextClip {
    /// The index into [`texts`](GgSessionRecord::texts) whose entry is a clip.
    pub text: u32,
    /// How many bytes the whole payload had.
    pub original_bytes: u64,
    /// The [content address](fingerprint_exact) of the whole payload.
    pub original_id: String,
}

/// Clip `text` to at most `max_bytes`, returning the kept part and the original's length — or
/// `None` when it already fits.
///
/// Keeps the **tail**, matching the rule gg's own shell output cap uses and for the same reason: a
/// command's last lines carry the error, and a clipped payload that reads the way the model saw
/// one is easier to reason about than one clipped from the other end. The cut is moved forward to
/// the next character boundary, so the result is always valid UTF-8 and is never *longer* than the
/// ceiling.
pub fn clip_text(text: &str, max_bytes: usize) -> Option<(&str, u64)> {
    if text.len() <= max_bytes {
        return None;
    }
    let mut start = text.len() - max_bytes;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    Some((&text[start..], text.len() as u64))
}

// ---------------------------------------------------------------------------
// Agent provenance
// ---------------------------------------------------------------------------

/// One agent the record captured, and how it came to exist — the table that tells a reader
/// which agent every [entry](GgSessionEntry) belongs to, and where that agent came from.
/// **One row per agent, not per turn**: repeating a provenance tuple on every entry would
/// defeat the pooling thesis outright.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionAgent {
    /// The id the recorded run minted for this agent (`"root"` for the root agent).
    /// Every [entry](GgSessionEntry::agent_id) is stamped with it.
    pub agent_id: String,
    /// The [id](crate::gg::GgAgentConfig::id) of the agent profile it ran under — what joins
    /// this row to the run's capability set, and to every telemetry event the agent emitted.
    pub profile_id: String,
    /// The [display name](crate::gg::GgCapabilitySet::agent_name) that profile carried at launch,
    /// so a record read on its own still says which agent this was. Display text: two profiles may
    /// share a [name](crate::gg::GgAgentConfig::name), and nothing joins on this.
    pub profile: String,
    /// How the agent came to exist, carrying the keys that explain it. This — not
    /// [`agent_id`](Self::agent_id) — is what identifies an agent across runs, because
    /// subagent ids come off a global counter in the order agents reach their spawn, so two
    /// concurrent agents take different ids from one run to the next.
    pub origin: GgSessionAgentOrigin,
    /// The status the agent's turn loop ended in, when it ended. Absent for an agent that
    /// never reached an ending — one parked behind the parallelism cap when the run was
    /// killed, which is exactly the row a salvaged record is opened for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub terminal_status: Option<GgAgentStatus>,
    /// The ceiling that stopped this agent, when one did — and *which* ceiling, which
    /// [`terminal_status`](Self::terminal_status) cannot answer on its own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub limit_hit: Option<GgLimitBreach>,
}

/// How an [agent](GgSessionAgent) was created, carrying the keys that identify it
/// deterministically.
///
/// Every variant's payload is a key that is a function of the run's own structure — a parent's
/// ordered turn loop, or board state — and never of the global agent counter, whose values say
/// only what order agents happened to reach their spawn in.
///
/// The three board-dispatched variants are why this is an enum rather than a flat
/// `(parent, ordinal)` pair: an [issue attempt](Self::IssueAttempt), a
/// [reviewer](Self::Reviewer) and a [merge agent](Self::Merge) are all created with **no
/// parent**, and a reviewer needs three keys rather than two, so a parent-keyed scheme
/// leaves every one of them unbindable — and an unbound agent dies on its first turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSessionAgentOrigin {
    /// The run's root agent. Bound trivially — there is exactly one.
    Root,
    /// Spawned by another agent: a delegated subagent, a workflow step, a
    /// [speculation](https://docs.testcabinet.ai/gg/speculative-execution/) arm, or a
    /// [fork](https://docs.testcabinet.ai/gg/fork-and-exec/).
    Spawn {
        /// The [`agent_id`](GgSessionAgent::agent_id) of the spawner.
        parent: String,
        /// The spawn's position in the parent's own strictly-ordered turn loop, counted
        /// across **all** spawn kinds rather than per profile — a fork runs the forker's
        /// own profile, so a fork child and a same-profile delegated subagent from one
        /// parent would otherwise compete for the same queue.
        ordinal: u32,
    },
    /// Succeeded another agent (the agent-transition path), which is likewise strictly
    /// ordered within the predecessor.
    Succession {
        /// The [`agent_id`](GgSessionAgent::agent_id) of the agent it succeeded.
        predecessor: String,
        /// The succession's position within that predecessor.
        ordinal: u32,
    },
    /// Dispatched to implement a board [issue](crate::gg::GgBoardIssue).
    IssueAttempt {
        /// The issue's id.
        issue: String,
        /// **Which dispatch of that issue this agent is** — 0 for the first, 1 for the
        /// next, and so on — a function of board state, not of the agent counter.
        ///
        /// Every dispatch, not only every *retry*. The distinction is load-bearing and was
        /// learned the hard way: a review that requests changes re-dispatches the issue to a
        /// fresh agent while deliberately **not** charging the retry budget (rework asked
        /// for by a reviewer is not a failed attempt), so keying on the retry count gave two
        /// different agents one identical origin, which is a provenance table that cannot tell
        /// two agents apart.
        attempt: u32,
    },
    /// Dispatched to review a board issue's attempt.
    Reviewer {
        /// The issue's id.
        issue: String,
        /// The review round.
        round: u32,
        /// The reviewer's position within that round, so two reviewers of one round are
        /// distinguishable.
        position: u32,
    },
    /// Dispatched to merge a board issue's accepted work. The row that proves why
    /// provenance keying is necessary: its live id comes straight off the **global
    /// counter**, so it can only be bound by what it was dispatched *for*.
    Merge {
        /// The issue's id.
        issue: String,
        /// Which merge of that issue this is.
        ordinal: u32,
    },
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/// Which of gg's two model clients issued a request.
///
/// The discriminator is what makes a **second queue** representable. Without it a
/// [handoff-compaction](https://docs.testcabinet.ai/gg/compaction/) summarizer call and
/// the agent's own next turn interleave into one indistinguishable queue, and a reader would
/// attribute the compaction's turn to the agent.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgClientRole {
    /// The agent's own turn loop.
    #[default]
    Agent,
    /// The compaction summarizer, which rewrites the whole window rather than advancing
    /// the conversation.
    Compaction,
}

/// Which model-client call shape a [request](GgSessionRequest) was issued under.
///
/// Recorded because the two shapes are not interchangeable: `complete_requiring` forces
/// the model to call the one offered tool, and a reader that cannot tell the two apart
/// reads a forced call as a choice the model made freely — which is the opposite of what
/// happened, and exactly the thing a stalled run is diagnosed on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSessionRequestShape {
    /// `ModelClient::complete` — the tools were *offered*.
    #[default]
    Complete,
    /// `ModelClient::complete_requiring` — the single pooled tool was *required*.
    CompleteRequiring,
}

/// One model request, as pool references: the conversation that was sent and the toolset
/// that was offered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionRequest {
    /// Which client issued it.
    pub role: GgClientRole,
    /// Whether the offered tool was required.
    pub shape: GgSessionRequestShape,
    /// The conversation sent this turn, as ordered indices into
    /// [`messages`](GgSessionRecord::messages).
    pub messages: Vec<u32>,
    /// The offered tool definitions, as an index into
    /// [`toolsets`](GgSessionRecord::toolsets). `None` for a call that offered no tools
    /// at all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub toolset: Option<u32>,
}

// ---------------------------------------------------------------------------
// Entry payloads
// ---------------------------------------------------------------------------

/// Why a model call failed.
///
/// A failed call is an input like any other: a vision refusal strips images and re-runs the
/// turn, and a retry exhaustion counts against an error ceiling, so **both change control
/// flow** — and a record that dropped them would be blank precisely where a developer is
/// most likely to be looking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionModelError {
    /// The error's class — what the loop branched on.
    pub kind: GgSessionModelErrorKind,
    /// The message the loop saw, which for a provider error is a truncated copy of its
    /// body.
    pub message: String,
    /// The HTTP status, for an error that carried one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub status: Option<u16>,
    /// How many attempts were made before giving up, for a retry exhaustion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub attempts: Option<u32>,
    /// The model that produced the error, for an error that names one (a vision
    /// refusal).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_id: Option<String>,
}

/// The class of a recorded [model error](GgSessionModelError) — a mirror of the `gg`
/// binary's `ModelError` variants, carried in the contract because the *class* is what
/// the turn loop branches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSessionModelErrorKind {
    /// The provider credential was not present in the environment. Fatal, and no request
    /// was attempted.
    MissingApiKey,
    /// The provider returned a non-retryable status. Fatal.
    Fatal,
    /// Every retry of a transient failure was exhausted. Retryable at the turn level, and
    /// counted against the run's error ceiling.
    RetryExhausted,
    /// The request carried an image and the model has no route accepting image input.
    /// Recoverable in a way no other error is — the loop records that the model cannot
    /// see images, strips them, and re-runs the same turn — which is why the
    /// [seed's resolved modalities](GgSessionSeed::model_modalities) matter.
    VisionUnsupported,
    /// A `2xx` response could not be parsed into a model response. Fatal.
    Parse,
    /// The gateway served the call from a provider other than the one the launch pinned. The
    /// reply is unusable: the cost recorded from it on would be on a different price basis, so
    /// the run ends as a harness failure.
    ProviderMismatch,
    /// Every attempt at the request was abandoned mid-stream by
    /// [loop detection](crate::gg::GgLoopDetection) — the model produced a repetition, not a reply,
    /// on all of them. Retryable at the turn level and counted against the run's error ceiling,
    /// exactly like [`RetryExhausted`](Self::RetryExhausted), and kept apart from it because the
    /// two are diagnosed completely differently: one is the provider failing, the other is the
    /// model failing.
    ///
    /// The record carries only the attempts that were *returned*, never the discarded ones: the
    /// recorder journals the response a turn actually got, so a reply the guard abandoned never
    /// entered the context and correctly never enters the record either. The
    /// [`attempts`](GgSessionModelError::attempts) count is how many were discarded before the loop
    /// gave up.
    ResponseLoop,
    /// The call ran into the run's
    /// [**per-call ceiling**](crate::gg::GgRunLimits::model_call_timeout_secs) without producing a
    /// reply — a stalled provider or endpoint. Retryable at the turn level and counted against the run's
    /// error ceiling; unlike every other class it never ends the session on its own.
    Timeout,
}

/// A tool call the agent (or a [responses-as-code](crate::gg::CAPABILITY_RESPONSES_AS_CODE)
/// program) made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionToolCall {
    /// The call id the loop minted. A program-composed call arrives under a synthetic id
    /// carrying the program prefix, which is the only thing distinguishing the two.
    pub id: String,
    /// The tool's name.
    pub name: String,
    /// The call's arguments — free-form JSON, since each tool owns its own schema.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub arguments: Value,
    /// The directory the call was dispatched in, for a tool that runs a subprocess.
    /// Typed rather than an absolute path string, so what is recorded is the part that says
    /// something — see [`GgShellCwd`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub cwd: Option<GgShellCwd>,
}

/// One image a recorded call produced, as a **descriptor**: what it was and how big it was,
/// never its bytes.
///
/// The same shape the [telemetry stream](crate::gg::GgLoggedImage) carries, deliberately — the
/// two are the same fact about the same turn, and a record that carried more would be a record
/// nobody could afford to keep on every run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionImage {
    /// The IANA media type (`image/png`, `image/jpeg`, …).
    pub media_type: String,
    /// The decoded size in bytes.
    pub bytes: u64,
}

/// The exact outcome a tool dispatch returned, with its bulky payloads pooled.
///
/// Interning the output against the [text pool](GgSessionRecord::texts) is not merely a
/// size win: a tool's output is quoted **verbatim** into the `tool` message that carries
/// it into the window, so the outcome and the message body are duplicates of one another.
/// One table collapses the pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionToolOutcome {
    /// Whether the call succeeded.
    pub ok: bool,
    /// The text fed back to the model, as an index into
    /// [`texts`](GgSessionRecord::texts).
    pub output: u32,
    /// The short human-readable summary, when the call recorded one, as an index into
    /// [`texts`](GgSessionRecord::texts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub summary: Option<u32>,
    /// The images the call produced, as **descriptors** — media type and decoded size,
    /// never the bytes.
    ///
    /// The same thing the [telemetry stream](crate::gg::GgTelemetryKind::ContextMessage)
    /// records, and for the same reason: a picture's payload is the one thing in a session
    /// large enough to dominate everything that explains it, and a record that carried them
    /// would be a record nobody could afford to keep on every run.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<GgSessionImage>,
    /// The structured facts a responses-as-code program branches on, when the tool
    /// produced them — with the one unbounded text field lifted out into
    /// [`data_text`](Self::data_text).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional, type = "Record<string, unknown>"))]
    pub data: Option<Value>,
    /// The bulky text lifted out of [`data`](Self::data), as an index into
    /// [`texts`](GgSessionRecord::texts).
    ///
    /// Two of gg's structured tool payloads carry the *whole* of what the tool returned a second
    /// time: a `read_file`'s `contents` (up to 256 KiB) and a `shell`'s `body`. Left inline they
    /// would be the largest thing in the record and the one thing in it that is neither pooled nor
    /// clipped — five reads of the same 100 KB file would store it five times, uncompressed, in a
    /// format whose entire premise is that a payload is stored once. Worse, an inline copy
    /// disagrees with a clipped [`output`](Self::output), leaving the entry with two answers to
    /// what the tool returned.
    ///
    /// Pooling it fixes all three at once: the bytes are stored once, under the same ceiling
    /// `output` is clipped at, and — because a `read_file`'s `contents` and its `output` are
    /// usually the identical string — they normally dedup to the *same* pool entry, so the second
    /// copy costs nothing at all.
    ///
    /// Which field it belongs to is determined by `data`'s own variant, so nothing has to be
    /// recorded twice to say. Absent on a record whose tool produced no such payload.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub data_text: Option<u32>,
    /// Why the call failed, when it failed and the failure was classified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional, type = "Record<string, unknown>"))]
    pub failure: Option<Value>,
}

/// Where a recorded command ran, expressed **relative to the workspace** wherever
/// possible.
///
/// An absolute path says nothing a reader can use: the workspace root is an implementation
/// detail of the container the run happened in, so `/work/impl/web` and `/work` differ by the
/// only part worth recording. Storing the *relationship* is what makes the recorded directory
/// comparable across runs — and the same command in a different tree really is a different
/// command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgShellCwd {
    /// The agent's workspace root itself.
    Workspace,
    /// A path beneath the agent's workspace root (an issue worktree, a subdirectory the
    /// model `cd`-ed into).
    Relative {
        /// The workspace-relative path, with `/` separators and no leading `./`.
        path: String,
    },
    /// A path outside the workspace entirely. Recorded verbatim because there is nothing
    /// to relativize it against, and reported on comparison rather than silently matched.
    Absolute {
        /// The absolute path.
        path: String,
    },
}

/// Which of gg's three command paths issued a recorded shell command.
///
/// All three reach one command line, and the only thing they share is the tool context —
/// which is why the seam belongs there. Recording *which* path asked is what keeps the commands gg
/// runs *without the model asking* — an [agent-stop hook](https://docs.testcabinet.ai/gg/hooks/)'s
/// ending gate, say — distinguishable from the ones it ran because the model asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgShellOrigin {
    /// The `shell` tool, called by the model.
    Tool,
    /// A [responses-as-code](crate::gg::CAPABILITY_RESPONSES_AS_CODE) program's
    /// `system.shell(…)`.
    Program,
    /// A [hook](crate::gg::GgHook) — a command hook's command line, or the script gg materialized
    /// for a script hook and ran with the event as its argument.
    ///
    /// Its own origin rather than folded into [`Tool`](Self::Tool) because a hook's command is
    /// the one gg runs *without the model asking*, and a record that filed it as a `shell` call
    /// would attribute an operator's build to the model.
    Hook,
}

/// One subprocess gg ran, with its bulky streams pooled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionCommand {
    /// The command line, inline rather than pooled: it is short, and it is the **check**
    /// half of a recorded-command lookup (position is the key), so it is worth being able
    /// to read without resolving a pool.
    pub command: String,
    /// Where it ran.
    pub cwd: GgShellCwd,
    /// The exit status it returned.
    pub exit_code: i32,
    /// Its standard output, as an index into [`texts`](GgSessionRecord::texts).
    pub stdout: u32,
    /// Its standard error, as an index into [`texts`](GgSessionRecord::texts).
    pub stderr: u32,
}

/// One item of an agent's context window as it stood for a recorded turn.
///
/// These four typed fields exist in gg's window model and are recoverable from
/// **nowhere else** — not the telemetry stream, not the raw output. The
/// [`slot`](Self::slot) matters more than it looks: a system prompt and a rebuilt
/// context-usage signal are otherwise indistinguishable on the wire, since both are
/// [`System`](GgContextSource::System)-sourced, unlabelled and pinned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionPromptItem {
    /// The item's message, as an index into [`messages`](GgSessionRecord::messages).
    pub message: u32,
    /// Which slot of the window model it came from.
    pub slot: GgSessionPromptSlot,
    /// The band it is attributed to in the per-source breakdown.
    pub source: GgContextSource,
    /// Whether it survives a compaction boundary verbatim.
    pub retention: GgSessionRetention,
    /// The session turn it was pushed on. `0` for everything seeded before the first
    /// turn, which is why the turn numbering the model sees starts at `1`.
    pub turn: u64,
    /// The item's selector tag, when it carries one — a file view's workspace path, or
    /// the fullness signal's sentinel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub label: Option<String>,
    /// For a file view produced by a **paged** read, the window it covers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub region: Option<GgSessionFileRegion>,
}

/// Which slot of gg's window model a [prompt item](GgSessionPromptItem) came from.
///
/// The window is not a flat list: every position but the thread is a *slot* that is
/// assigned rather than appended, precisely so it cannot accumulate duplicates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSessionPromptSlot {
    /// The system-prompt slot, held apart from the thread and never inherited.
    System,
    /// The conversation thread itself.
    Thread,
    /// The context-usage signal slot, rebuilt and re-assigned after every turn.
    ContextUsage,
}

/// Whether a [prompt item](GgSessionPromptItem) is retained verbatim across a compaction
/// boundary or is ephemeral thread material.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSessionRetention {
    /// Carried across compaction unchanged and never evicted.
    Pinned,
    /// Thread material compaction may summarize and agent-managed context may evict.
    Ephemeral,
}

/// The `offset`/`limit` window a paged file view covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionFileRegion {
    /// The 1-based first line the read returned.
    pub offset: u64,
    /// How many lines it returned.
    pub limit: u64,
}

// ---------------------------------------------------------------------------
// The input log
// ---------------------------------------------------------------------------

/// Which non-deterministic input one [entry](GgSessionEntry) pins.
///
/// The vocabulary is enumerated exhaustively on purpose: every category here **changes
/// control flow**, and a capture that dropped one would leave the record blank exactly where
/// a developer is most likely to be looking.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSessionEntryKind {
    /// One model turn's I/O: the pooled request and the response it returned.
    ModelIo {
        /// What was sent.
        request: GgSessionRequest,
        /// The response the turn yielded — the `gg` binary's `ModelResponse` (`text`,
        /// `toolCalls`, `finishReason`, `usage`, `cost`), carried as free-form JSON
        /// because its shape is owned by the binary. Its recorded `usage` is what makes a
        /// cost ceiling trip when it did.
        #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
        response: Value,
        /// How long the call took, in milliseconds. Absent for a call whose latency was not
        /// measured.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        duration_ms: Option<u64>,
    },
    /// One model call that **failed**. Both the request and the error are kept: the
    /// request is what identifies the turn, and the error is what the loop branched on.
    ModelError {
        /// What was sent.
        request: GgSessionRequest,
        /// Why it failed.
        error: GgSessionModelError,
        /// How long the failed call took, in milliseconds. Worth as much as the successful
        /// path's and sometimes more: a retry exhaustion's latency is the whole of the backoff
        /// the run paid for nothing.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        duration_ms: Option<u64>,
    },
    /// One tool call and the exact outcome the dispatch returned for it.
    ToolResult {
        /// The call.
        call: GgSessionToolCall,
        /// The outcome.
        outcome: GgSessionToolOutcome,
    },
    /// One agent's context window as it stood for the turn just recorded.
    ///
    /// The frame lands **after** the model call it describes and before that agent's next
    /// one — the same attachment rule tool results already follow — which handles vision
    /// recovery correctly for free: a refused image turn produces
    /// `model_error → model_io → prompt_frame`, so the frame attaches to the call that was
    /// actually sent.
    PromptFrame {
        /// The window's items, in the order they were rendered to the client.
        items: Vec<GgSessionPromptItem>,
    },
    /// One shell command gg ran on the agent's behalf.
    Shell {
        /// Which of the three command paths issued it.
        origin: GgShellOrigin,
        /// The command and its result.
        command: GgSessionCommand,
    },
    /// One `git` subprocess gg's own orchestration ran — a worktree add, a commit, a
    /// merge, a diff.
    ///
    /// Recorded because its *result* explains a session that went wrong: a merge that
    /// conflicted changes the run, and a speculation judge scores whatever `git diff` printed.
    /// It bypasses tool dispatch entirely, so this is the only place it is captured at all.
    Git {
        /// The command and its result.
        command: GgSessionCommand,
    },
    /// One read of the cancel file. Recorded because it **ends the session**, and a record
    /// that stopped without saying why would look truncated.
    CancelProbe {
        /// Whether the probe found the session canceled.
        canceled: bool,
    },
    /// One read of the wall-clock deadline. Recorded because it changes control flow; a
    /// the one clock read the loop branches on, so a record that lacked it could not say why
    /// a session ended when it did.
    Clock {
        /// Milliseconds elapsed since the session began, as the run observed them.
        elapsed_ms: u64,
        /// Milliseconds remaining before the run's ceiling, when one was configured.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        remaining_ms: Option<u64>,
    },
}

/// One entry in the input log: a single pinned non-deterministic input, tagged so the
/// multi-agent interleaving recovers deterministically.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionEntry {
    /// The [agent](GgSessionAgent::agent_id) whose loop consumed this input.
    pub agent_id: String,
    /// The globally monotonic sequence number this entry was recorded at, minted across
    /// **all** agents from one counter.
    ///
    /// It is not merely an ordering hint: because a gg run holds run-global mutable state
    /// (the [board](https://docs.testcabinet.ai/gg/project-management/), inter-agent
    /// messages, collected subagent results) that is rendered into every agent's pinned
    /// prompt each turn, the recorded interleaving **is** part of what each agent was shown.
    /// Two agents' entries read in `seq` order are the windows the run actually built; read in
    /// any other order they are windows nobody saw.
    pub seq: u64,
    /// The pinned input itself, flattened inline so its `type` discriminator and fields
    /// sit alongside `agentId`/`seq`.
    #[serde(flatten)]
    pub kind: GgSessionEntryKind,
}

/// Why a record stops short of the session it observed.
///
/// Capture **degrades, it never fails the run it observes** — so every one of these is a
/// recorded fact rather than an error, and the record is still served.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSessionTruncationReason {
    /// The run's per-run byte ceiling was crossed and capture stopped.
    ByteCeiling,
    /// The session died mid-capture: the journal has no terminating marker.
    ///
    /// Detected by the marker's **absence** rather than by a self-report, because a
    /// killed gg cannot write a truncation marker either. This is the reason the
    /// terminating marker is mandatory on the normal exit path.
    SessionKilled,
    /// The journal was readable up to a point and then was not — a line torn off
    /// mid-write, or a terminating marker whose entry count disagrees with what the
    /// assembly actually walked. Everything before the last complete entry is kept.
    ///
    /// Deliberately *not* what a mis-indexed pool produces. A journal whose indices do
    /// not line up would assemble into a record that reads as complete and describes a
    /// conversation that never happened, so
    /// [assembly](crate::gg_session_assembly) refuses it outright and the run carries no
    /// record at all. This reason is for damage whose extent is known.
    CorruptJournal,
    /// The journal writer failed (a stalled disk, a dead writer thread), which stops
    /// capture for the whole run.
    ///
    /// Capture is never dropped *per line*: a hole in a pool would leave positional
    /// assembly silently shifting the wrong message body into a recorded prompt.
    WriteFailed,
}

/// What a record is missing, when it is missing something.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionTruncation {
    /// Why capture stopped.
    pub reason: GgSessionTruncationReason,
    /// The [`seq`](GgSessionEntry::seq) of the last entry that made it into the record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub last_seq: Option<u64>,
    /// How many bytes had been written when capture stopped, for a ceiling breach.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub bytes: Option<u64>,
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/// A gg run's **session record**: the fixed seed, four content-addressed pools, the agent
/// provenance table, and the ordered log of every non-deterministic input the session
/// consumed.
///
/// See the [module documentation](self) for the shape and for how a
/// record from a newer gg is refused rather than read on a partial understanding of it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionRecord {
    /// The format **this document** is in. The compatibility contract, and the only
    /// identity a reader may branch on.
    ///
    /// [`GG_SESSION_FORMAT_VERSION`] is the one version this build reads; a record stating any
    /// other is refused rather than read on a partial understanding of its entry kinds.
    /// Required: a record that states no format is malformed, not a record to be guessed at.
    pub format_version: u32,
    /// Which build captured it. Explanatory; never a gate.
    pub recorder: GgSessionRecorder,
    /// The gg session this record is of — the run id, matching the
    /// [telemetry](crate::gg::GgTelemetryEvent::session_id) stream's.
    pub session_id: String,
    /// The run's [routing key](crate::gg::GgTelemetryKind::SessionStarted::routing_key): the
    /// value every request of the run sent as `session_id` and `prompt_cache_key`, which is what
    /// a provider dashboard shows for them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub routing_key: Option<String>,
    /// The [capability set](GgCapabilitySet) the run was configured with, so a
    /// reader has the configuration the run was launched with rather than one assembled to
    /// suit the record.
    pub capability_set: GgCapabilitySet,
    /// The fixed identity the session started from.
    pub seed: GgSessionSeed,
    /// Every agent the session created, and how. One row per agent.
    pub agents: Vec<GgSessionAgent>,
    /// The message pool. [Entries](GgSessionEntry) reference it by index.
    pub messages: Vec<GgSessionMessage>,
    /// The offered-toolset pool.
    pub toolsets: Vec<GgSessionToolset>,
    /// The text pool: every large string payload — a tool outcome's output, a `git`
    /// invocation's stdout, a probe body.
    pub texts: Vec<String>,
    /// Which [texts](Self::texts) are [clips](GgSessionTextClip) rather than whole payloads, in
    /// ascending pool order. Empty for a record whose payloads all fit.
    ///
    /// A sparse side table rather than a field on each pooled text: the overwhelming majority of
    /// payloads are not clipped, and widening every entry of the pool to say so would cost more
    /// than the clipping saves. Always serialized, like the pools it annotates rather than like
    /// [`truncation`](Self::truncation) — an empty table is the positive statement "nothing was
    /// clipped", which is exactly what a reader of a standard record needs to hear.
    pub clips: Vec<GgSessionTextClip>,
    /// Every pinned non-deterministic input, in globally monotonic
    /// [`seq`](GgSessionEntry::seq) order.
    pub entries: Vec<GgSessionEntry>,
    /// What the record is missing, when it is missing something. Absent on a complete
    /// capture.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub truncation: Option<GgSessionTruncation>,
}

impl GgSessionRecord {
    /// An empty record for `session_id` under `capability_set`.
    pub fn new(session_id: impl Into<String>, capability_set: GgCapabilitySet) -> Self {
        Self {
            format_version: GG_SESSION_FORMAT_VERSION,
            recorder: GgSessionRecorder::default(),
            session_id: session_id.into(),
            routing_key: None,
            capability_set,
            seed: GgSessionSeed::default(),
            agents: Vec::new(),
            messages: Vec::new(),
            toolsets: Vec::new(),
            texts: Vec::new(),
            clips: Vec::new(),
            entries: Vec::new(),
            truncation: None,
        }
    }

    /// The pooled [message](GgSessionMessage) at `index`, if the pool reaches that far.
    pub fn message(&self, index: u32) -> Option<&GgSessionMessage> {
        self.messages.get(index as usize)
    }

    /// The pooled [toolset](GgSessionToolset) at `index`, if the pool reaches that far.
    pub fn toolset(&self, index: u32) -> Option<&GgSessionToolset> {
        self.toolsets.get(index as usize)
    }

    /// The pooled text at `index`, if the pool reaches that far.
    pub fn text(&self, index: u32) -> Option<&str> {
        self.texts.get(index as usize).map(String::as_str)
    }

    /// What the pooled text at `index` is missing, when it is a [clip](GgSessionTextClip) — the
    /// question a reader has to ask before treating a recorded payload as the payload.
    ///
    /// A binary search rather than a map, because [`clips`](Self::clips) is written in ascending
    /// pool order by construction (a clip row is minted when its text is first interned) and a
    /// record is read far more often than it is built.
    pub fn clip(&self, index: u32) -> Option<&GgSessionTextClip> {
        self.clips
            .binary_search_by_key(&index, |clip| clip.text)
            .ok()
            .map(|position| &self.clips[position])
    }
}

/// The **capture-side** contract for interning a message, a toolset or a text payload into a
/// record's pools.
///
/// Two implementations, and they must hand out identical indices for identical input: the
/// body-retaining [`GgSessionPools`] that assembly folds a journal into, and gg's own streaming
/// [journal interner](crate::gg_session_journal::GgJournalInterner), which holds pooled *ids* and
/// never pooled bodies. The trait exists so the addressing, the image-byte withholding and the
/// clipping rules are written **once**.
pub trait GgSessionInterner {
    /// Intern one message body, returning its index into the message pool.
    ///
    /// The [id](GgSessionMessage::id) is addressed over `body` **as given**, including any
    /// inline image payloads; the *stored* body then has those payloads reduced to
    /// [descriptors](Self::withhold_image_bytes). Addressing before the reduction is what keeps
    /// the id a statement about the message the model was actually sent, rather than about the
    /// abbreviation of it the record kept.
    fn intern_message(&mut self, body: &Value) -> u32;

    /// The [id](GgSessionMessage::id) of the pooled message at `index`.
    fn message_id(&self, index: u32) -> Option<&str>;

    /// Intern one offered tool-definition array, returning its index.
    fn intern_toolset(&mut self, tools: &Value) -> u32;

    /// The [id](GgSessionToolset::id) of the pooled toolset at `index`.
    fn toolset_id(&self, index: u32) -> Option<&str>;

    /// Intern one string payload, keeping at most `max_bytes` of it, and return its index.
    ///
    /// `max_bytes` is whichever ceiling the calling seam records under —
    /// [stream](GG_SESSION_STREAM_MAX_BYTES) or [tool](GG_SESSION_TOOL_MAX_BYTES).
    /// `None` stores the payload whole, and `Some(n)` stores [the last `n` bytes](clip_text) of a
    /// longer one and records a [clip](GgSessionTextClip) saying what was dropped.
    ///
    /// **Dedup keys on the address of the payload as given**, never on the stored clip. Two
    /// distinct payloads sharing a tail therefore occupy two pool entries rather than collapsing
    /// into one whose clip row could describe only one of them — and an unclipped payload dedups
    /// exactly as it always did.
    fn intern_text_clipped(&mut self, text: &str, max_bytes: Option<usize>) -> u32;

    /// Intern one string payload **whole**, returning its index.
    fn intern_text(&mut self, text: &str) -> u32 {
        self.intern_text_clipped(text, None)
    }

    /// Intern a whole model request — one call, so a caller cannot pair the wrong message
    /// indices with the wrong toolset.
    ///
    /// `messages` are the serialized message bodies in send order; `tools` is the
    /// serialized offered tool array, or `None` for a call that offered none.
    fn intern_request(
        &mut self,
        role: GgClientRole,
        shape: GgSessionRequestShape,
        messages: &[Value],
        tools: Option<&Value>,
    ) -> GgSessionRequest {
        let indices: Vec<u32> = messages
            .iter()
            .map(|message| self.intern_message(message))
            .collect();
        GgSessionRequest {
            role,
            shape,
            messages: indices,
            toolset: tools.map(|tools| self.intern_toolset(tools)),
        }
    }

    /// Strip the bytes out of every inline image payload in `value`, leaving the
    /// [descriptor](GgSessionImage) — media type and decoded size — in place.
    ///
    /// A picture's payload is the one thing in a session large enough to dominate everything
    /// that explains it: a 500 KB PNG that survives a hundred turns is 500 KB the record keeps
    /// on behalf of a fact — *the model was shown this image* — that the descriptor states in
    /// forty bytes. So the record carries what the
    /// [telemetry stream](crate::gg::GgTelemetryKind::ContextMessage) carries, and for the same
    /// reason, and the two cannot disagree about what a message was.
    ///
    /// An image is recognized structurally — any object carrying both a string `mediaType` and a
    /// string `dataBase64` — rather than by knowing where in a `Message` gg puts one. The `gg`
    /// binary owns that shape; coupling this to it would make the stripping silently stop working
    /// the day a message gained a second place to hold a picture.
    fn withhold_image_bytes(value: &mut Value) {
        if let Some(map) = value.as_object_mut()
            && map.contains_key("mediaType")
            && map.get("dataBase64").is_some_and(Value::is_string)
        {
            map.remove("dataBase64");
            return;
        }
        match value {
            Value::Object(map) => {
                for item in map.values_mut() {
                    Self::withhold_image_bytes(item);
                }
            }
            Value::Array(items) => {
                for item in items {
                    Self::withhold_image_bytes(item);
                }
            }
            _ => {}
        }
    }
}

/// The **body-retaining** [interner](GgSessionInterner): the four pools of an assembled
/// record, held in memory.
///
/// What [assembly](crate::gg_session_assembly) folds a journal into. gg's capture journal
/// deliberately does **not** use it — see [`GgSessionInterner`] for why.
#[derive(Debug, Default)]
pub struct GgSessionPools {
    messages: Vec<GgSessionMessage>,
    message_index: HashMap<String, u32>,
    toolsets: Vec<GgSessionToolset>,
    toolset_index: HashMap<String, u32>,
    texts: Vec<String>,
    text_index: HashMap<String, u32>,
    clips: Vec<GgSessionTextClip>,
}

impl GgSessionPools {
    /// An empty set of pools.
    pub fn new() -> Self {
        Self::default()
    }

    /// The three pools and the [clip](GgSessionTextClip) table, in the order the
    /// [record](GgSessionRecord) carries them.
    pub fn into_parts(self) -> GgSessionPoolParts {
        GgSessionPoolParts {
            messages: self.messages,
            toolsets: self.toolsets,
            texts: self.texts,
            clips: self.clips,
        }
    }
}

/// What [`GgSessionPools::into_parts`] hands back: the three pools plus the clip table, named rather
/// than positional so a caller cannot silently swap two `Vec`s that a tuple would let it.
#[derive(Debug, Default)]
pub struct GgSessionPoolParts {
    /// The message pool.
    pub messages: Vec<GgSessionMessage>,
    /// The offered-toolset pool.
    pub toolsets: Vec<GgSessionToolset>,
    /// The text pool.
    pub texts: Vec<String>,
    /// Which texts are [clips](GgSessionTextClip).
    pub clips: Vec<GgSessionTextClip>,
}

impl GgSessionInterner for GgSessionPools {
    fn intern_message(&mut self, body: &Value) -> u32 {
        let id = fingerprint_json(body);
        if let Some(&index) = self.message_index.get(&id) {
            return index;
        }
        let mut stored = body.clone();
        Self::withhold_image_bytes(&mut stored);
        let index = self.messages.len() as u32;
        self.messages.push(GgSessionMessage {
            id: id.clone(),
            body: stored,
        });
        self.message_index.insert(id, index);
        index
    }

    fn message_id(&self, index: u32) -> Option<&str> {
        self.messages.get(index as usize).map(|m| m.id.as_str())
    }

    fn intern_toolset(&mut self, tools: &Value) -> u32 {
        let id = fingerprint_json(tools);
        if let Some(&index) = self.toolset_index.get(&id) {
            return index;
        }
        let index = self.toolsets.len() as u32;
        self.toolsets.push(GgSessionToolset {
            id: id.clone(),
            tools: tools.clone(),
        });
        self.toolset_index.insert(id, index);
        index
    }

    fn toolset_id(&self, index: u32) -> Option<&str> {
        self.toolsets.get(index as usize).map(|t| t.id.as_str())
    }

    /// Keyed on the [content address](fingerprint_exact) of the payload **as given**, exactly as
    /// gg's streaming journal keys it — so the two hand out identical indices, and so a clipped
    /// entry is still found by the payload it stands for rather than only by the tail that was
    /// kept.
    fn intern_text_clipped(&mut self, text: &str, max_bytes: Option<usize>) -> u32 {
        let id = fingerprint_exact(text.as_bytes());
        if let Some(&index) = self.text_index.get(&id) {
            return index;
        }
        let index = self.texts.len() as u32;
        let clipped = max_bytes.and_then(|max| clip_text(text, max));
        self.texts
            .push(clipped.map_or_else(|| text.to_string(), |(kept, _)| kept.to_string()));
        if let Some((_, original_bytes)) = clipped {
            self.clips.push(GgSessionTextClip {
                text: index,
                original_bytes,
                original_id: id.clone(),
            });
        }
        self.text_index.insert(id, index);
        index
    }
}

// ---------------------------------------------------------------------------
// Deserialization: refusing what this build cannot read
// ---------------------------------------------------------------------------

/// The shape [`GgSessionRecord`] deserializes through.
///
/// Hand-written rather than derived (the pattern [`GgCapabilitySet`] already uses) for one
/// reason: a record from a **newer** gg has to be refused rather than partially understood, and
/// a derived `Deserialize` has nowhere to say so.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GgSessionRecordRaw {
    format_version: u32,
    recorder: GgSessionRecorder,
    session_id: String,
    #[serde(default)]
    routing_key: Option<String>,
    capability_set: GgCapabilitySet,
    seed: GgSessionSeed,
    agents: Vec<GgSessionAgent>,
    messages: Vec<GgSessionMessage>,
    toolsets: Vec<GgSessionToolset>,
    texts: Vec<String>,
    clips: Vec<GgSessionTextClip>,
    entries: Vec<GgSessionEntry>,
    #[serde(default)]
    truncation: Option<GgSessionTruncation>,
}

impl<'de> Deserialize<'de> for GgSessionRecord {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error;

        let raw = GgSessionRecordRaw::deserialize(deserializer)?;
        if raw.format_version != GG_SESSION_FORMAT_VERSION {
            // Refused rather than guessed at. A record stating another format may hold entry
            // kinds this build has never heard of, and reading a session from a partial
            // understanding of its inputs is worse than not reading it.
            return Err(D::Error::custom(format!(
                "session record format {} is not the format this build reads ({GG_SESSION_FORMAT_VERSION})",
                raw.format_version
            )));
        }
        Ok(GgSessionRecord {
            format_version: raw.format_version,
            recorder: raw.recorder,
            session_id: raw.session_id,
            routing_key: raw.routing_key,
            capability_set: raw.capability_set,
            seed: raw.seed,
            agents: raw.agents,
            messages: raw.messages,
            toolsets: raw.toolsets,
            texts: raw.texts,
            clips: raw.clips,
            entries: raw.entries,
            truncation: raw.truncation,
        })
    }
}
