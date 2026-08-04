//! The gg **replay record**, format v2: the content-addressed lockstep input log a
//! recorded gg session is reconstructed from.
//!
//! A replay record pins the non-deterministic inputs a [gg](crate::gg) session consumed
//! so the session can be re-run afterward. Format v1 (still readable — see
//! [below](#reading-a-v1-record)) was a *transcript*: every turn re-serialized the whole
//! conversation and the whole offered-tool array, which is quadratic in messages and
//! linear-times-`N` in tool definitions, with full base64 image bytes inside the
//! quadratic term. Format v2 replaces it with the shape
//!
//! > [`seed`](GgReplayRecord::seed) (fixed identity) + four content-addressed pools + an
//! > ordered [input log](GgReplayRecord::entries)
//!
//! so a record costs `O(unique bytes) + O(Σ window items)` instead. That is what makes
//! capture affordable enough to be always-on rather than a debugging opt-in.
//!
//! # The four pools
//!
//! [Messages](GgReplayMessage), [toolsets](GgReplayToolset), [texts](GgReplayRecord::texts)
//! and [image blobs](GgReplayBlob). Each entry is stored once and referenced by **index**
//! into its pool. Interning is done exclusively through [`GgReplayPools`] — one function,
//! used by the recorder, by the v1 upgrade below, and by a playback recomputing a
//! fingerprint from a live request, so no two sides can compute a content address
//! differently.
//!
//! # Identity, and what a reader may branch on
//!
//! The record carries three identities because they answer three different questions,
//! and conflating them is how a version check becomes the bug:
//!
//! | Field | Question | May a reader branch on it? |
//! | --- | --- | --- |
//! | [`format_version`](GgReplayRecord::format_version) | Can this build parse this record at all? | **Yes** — this is the compatibility contract |
//! | [`recorder.gg_version`](GgReplayRecorder::gg_version) | Which build wrote it? | No — explanatory only |
//! | [`recorder.commit`](GgReplayRecorder::commit) | Which *exact* build wrote it? | Only to verify a resolved binary is the one that recorded |
//!
//! Gating on the gg version is wrong in **both** directions: a version bump with no
//! prompt change must not invalidate every record on every release, and an uncommitted
//! prompt edit *within* one build must not pass.
//!
//! # Reading a v1 record
//!
//! [`format_version`](GgReplayRecord::format_version) is `#[serde(default)]` and its
//! absence means **1**, because every record captured before v2 has no version field at
//! all: the backend stores and serves them as opaque bytes and both the CLI and the
//! console deserialize them directly, so a required field would fail to parse the entire
//! existing corpus. A v1 body is **upgraded into the v2 shape on read** — its per-turn
//! conversations are interned into the pools and its turns gain the fingerprints they
//! never carried — so every consumer has exactly one code path and there is no data
//! migration. A record from a *newer* gg is refused rather than guessed at.
//!
//! Like the rest of the contract these types are the source of truth: the TypeScript
//! bindings (`packages/run-record/src/gg-replay.ts`) and the JSON Schemas
//! (`apps/docs/public/schema/gg/replay-record.schema.json`) are generated from them by
//! `crates/contract-codegen` and are never edited by hand. JSON is camelCase.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::gg::{GgAgentStatus, GgCapabilitySet, GgContextSource, GgLimitBreach};

#[cfg(test)]
#[path = "gg_replay.test.rs"]
mod tests;

/// The replay-record format version this build writes and is the newest it can read.
pub const GG_REPLAY_FORMAT_VERSION: u32 = 2;

/// The format version an **absent** `formatVersion` means: 1, the pre-versioning
/// transcript format.
///
/// Deliberately not a separate "unversioned" sentinel. The upgrade below normalizes
/// every legacy record into the v2 shape, so a second pre-versioning value would only
/// add a code path that says the same thing as `1`.
pub const GG_REPLAY_FORMAT_V1: u32 = 1;

/// The object key a pooled [message body](GgReplayMessage::body) uses in place of an
/// inline image payload: `{"$blob": 3}`, an index into
/// [`blobs`](GgReplayRecord::blobs).
///
/// Substitution happens **after** the message's content address is computed, so the id
/// still covers the exact image bytes (see [`GgReplayPools::intern_message`]) while the
/// bytes themselves are stored once no matter how many turns the message survives.
pub const GG_REPLAY_BLOB_REF_KEY: &str = "$blob";

/// The number of lowercase-hex characters a pooled content address is truncated to: 32,
/// i.e. the leading **128 bits** of a SHA-256 digest.
///
/// A 128-bit address makes an accidental collision across a single run's pools
/// impossible in practice while keeping the ids — which the fingerprint folds over, so
/// they appear once per pooled body *and* once per turn — a third the size of a full
/// digest.
pub const GG_REPLAY_ID_HEX_LEN: usize = 32;

/// The **content address** of `bytes`: the leading 128 bits of its SHA-256 digest, as
/// lowercase hex.
///
/// This is the one address function for the whole format. It is deliberately *not*
/// gg's telemetry `fingerprint`, which is a 64-bit `DefaultHasher` over image
/// *descriptors*: two different pictures of the same media type and decoded size hash
/// identically there, which is harmless for a telemetry log that discards the pixels and
/// catastrophic for a replay that must send them again.
pub fn fingerprint_exact(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(&digest[..GG_REPLAY_ID_HEX_LEN / 2])
}

/// How many bytes of one pooled **subprocess stream** a [standard](GgReplayFidelity::Standard)
/// capture keeps: 32 KiB.
///
/// The ceiling exists because a raw process stream is the one payload class unbounded by anything
/// gg controls. A message is bounded by the model's context window and an image by the file that
/// produced it, but a `git diff` over a tree the model has been building for forty minutes, or a
/// failing test suite's output, is bounded only by what the subprocess felt like printing — and a
/// run has hundreds of them. Clipping them is what keeps a *standard* record the
/// well-under-a-megabyte artifact that justifies capturing every run.
///
/// Sized at twice the 16 KiB cap gg's own [shell tool](https://docs.testcabinet.ai/gg/tools/)
/// applies to the output it shows the model, so the clip always covers everything the model saw of
/// the command plus as much again of what it did not.
pub const GG_REPLAY_STANDARD_STREAM_MAX_BYTES: usize = 32 * 1024;

/// How many bytes of one pooled **tool payload** a [standard](GgReplayFidelity::Standard) capture
/// keeps: 256 KiB.
///
/// Eight times the [stream ceiling](GG_REPLAY_STANDARD_STREAM_MAX_BYTES), and deliberately so:
/// these two seams record different things and only one of them is bounded by a cap the model's
/// own view shares. A recorded stream is what the process printed, of which `shell` shows the model
/// the last 16 KiB; a recorded tool payload **is** what the model was shown, and the largest such
/// payload gg hands over is a whole-file `read_file`, capped at 256 KiB by the filesystem tool
/// itself. Sizing this ceiling at that cap is what keeps the invariant a reader depends on: *a
/// payload the model was shown in full is recorded in full*, so a clip in the tool pool means the
/// tool layer had already clipped it too.
///
/// A single 32 KiB ceiling across both seams broke that. It recorded a 100 KB source file the model
/// read in its entirety as a 32 KiB tail, cut mid-file — a reconstruction feeding that back would
/// present the model with a different file than the run did, and report the resulting divergence as
/// model drift.
pub const GG_REPLAY_STANDARD_TOOL_MAX_BYTES: usize = 256 * 1024;

/// The two ceilings are separate numbers with separate reasons, and the tool one is deliberately
/// the larger; collapsing them back to a single value is the regression this fails the build on.
/// The tie that matters most — tool ceiling ≥ `read_file`'s own cap — is asserted the same way in
/// `gg`'s `replay` module, which is the one place both of *those* numbers are in scope.
const _: () = assert!(GG_REPLAY_STANDARD_TOOL_MAX_BYTES > GG_REPLAY_STANDARD_STREAM_MAX_BYTES);

/// The [content address](fingerprint_exact) of a JSON value, over its compact
/// serialization.
///
/// Stable across processes and across the recorder/playback boundary because
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
/// of any individual input. Both members are optional because a
/// [v1 record](self#reading-a-v1-record) predates them and an upgraded one honestly
/// reports "unknown" instead of inventing a version.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayRecorder {
    /// The `gg --version` of the build that captured this record (for example `0.7.0`).
    /// Explanatory only — never the compatibility gate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gg_version: Option<String>,
    /// The exact commit the capturing build was made from, when it is known. The only
    /// thing that can tell an uncommitted prompt edit *within* one version from the
    /// released build of that version, so it is what a playback checks when it resolves
    /// a binary to reconstruct with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub commit: Option<String>,
}

/// How completely a capture pinned the session it observed.
///
/// Capture is **always on**: pooling collapsed a projected 200-turn record from ~187 MB to
/// well under a megabyte gzipped, and at that price gating it buys nothing while costing
/// the one thing that matters — an opt-in capture is, by construction, never armed for the
/// surprising run it exists to explain. So the
/// [`replay`](crate::gg::CAPABILITY_REPLAY) capability stopped being the switch that
/// decides *whether* a run is recorded and became the one that decides *how much*.
///
/// It is recorded on the record rather than re-derived from the
/// [capability set](GgReplayRecord::capability_set) because a reader that cannot tell the
/// two fidelities apart reads an absent full-only input as evidence the session never had
/// one — which is exactly the inference a record exists to make safe.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReplayFidelity {
    /// Every input that **changes control flow**: model I/O and model errors, tool
    /// outcomes, the orchestrator's own `git`, the cancel probe, the deadline clock, the
    /// prompt frame. This is what a reconstruction needs, and it is what every run gets
    /// for free.
    ///
    /// Text payloads are [clipped](GG_REPLAY_STANDARD_STREAM_MAX_BYTES) here, and a clipped one
    /// says so — see [`clips`](GgReplayRecord::clips). Nothing else is withheld: the difference
    /// between the two fidelities is deliberately small, because a capture that is on for every
    /// run is only worth having if what it captures is enough on its own.
    #[default]
    Standard,
    /// Standard, plus what is only worth its bytes when someone is going to reconstruct
    /// or audit the run in detail. Selected by enabling
    /// [`replay`](crate::gg::CAPABILITY_REPLAY) on **any** agent — see
    /// [`resolve`](Self::resolve) for why the root alone is not enough.
    ///
    /// # What it adds
    ///
    /// - **No payload clipping.** Every pooled text is the whole payload, so
    ///   [`clips`](GgReplayRecord::clips) is empty by construction and a reconstruction that
    ///   re-executes a command can compare its output against the entire recorded one rather
    ///   than against a tail.
    /// - **Latency clocks.** Each model call's measured wall-clock latency is recorded on its
    ///   [`ModelIo`](GgReplayEntryKind::ModelIo) /
    ///   [`ModelError`](GgReplayEntryKind::ModelError) entry. It changes no control flow — it is
    ///   the one clock read that does not — which is exactly why it is here and not in the
    ///   standard set: a reconstruction runs with model latency removed, so recording it always
    ///   would spend bytes on the one number a playback deliberately does not reproduce.
    ///
    /// # What it does not add, and why
    ///
    /// The original design named a third category, "the startup filesystem (skills, memories,
    /// autoloaded files, templates) verbatim rather than digested". Implementing it established
    /// that it decomposes into four parts, **none** of which is a fidelity distinction:
    ///
    /// - **Prompt templates** are `include_str!`-embedded in the gg binary. They are never read
    ///   from a filesystem, so there is nothing to digest; which templates a run used is exactly
    ///   what [`recorder.commit`](GgReplayRecorder::commit) answers, and a
    ///   [turn fingerprint](GgTurnFingerprint) is what detects one having changed.
    /// - **Memories** are created during the session, not loaded at startup. Every mutation is
    ///   already a recorded tool outcome and every rendered index is already a pooled message.
    /// - **Autoloaded specification files** belong to the [seed](GgReplaySeed::provided_files) as
    ///   blob references, verbatim at *both* fidelities and for zero additional bytes — they were
    ///   sent to the model, so they are in the [blob pool](GgReplayRecord::blobs) either way.
    ///   Withholding them at standard would make a record less self-contained while saving
    ///   nothing.
    /// - **Skills** are a real directory read, but every skill body that influences the run
    ///   reaches the record verbatim regardless: the description listing is part of the pooled
    ///   system message, and reading one is a recorded tool outcome. What a verbatim capture
    ///   would add is the body of a skill the session *never read* — inventory rather than input,
    ///   and not something a reconstruction can diverge on.
    ///
    /// # A build can only record what it has a seam for
    ///
    /// A seam that does not exist contributes nothing at *either* fidelity, so a `full` record
    /// from such a build carries the standard set. That is a statement about the build, not about
    /// the session — which is the other reason [`recorder`](GgReplayRecord::recorder) is on the
    /// record beside this.
    Full,
}

impl GgReplayFidelity {
    /// The ceiling one pooled **subprocess stream** is recorded under: the
    /// [stream ceiling](GG_REPLAY_STANDARD_STREAM_MAX_BYTES), or `None` for
    /// [`Full`](Self::Full), which clips nothing.
    pub fn stream_max_bytes(self) -> Option<usize> {
        match self {
            Self::Standard => Some(GG_REPLAY_STANDARD_STREAM_MAX_BYTES),
            Self::Full => None,
        }
    }

    /// The ceiling one pooled **tool payload** is recorded under: the
    /// [tool ceiling](GG_REPLAY_STANDARD_TOOL_MAX_BYTES), or `None` for [`Full`](Self::Full).
    ///
    /// Separate from [`stream_max_bytes`](Self::stream_max_bytes) because the two seams record
    /// payloads with different provenance — see the two constants. Both live here so that a
    /// recorder, a test and a reader cannot hold three opinions about what a record of either
    /// fidelity promises.
    pub fn tool_max_bytes(self) -> Option<usize> {
        match self {
            Self::Standard => Some(GG_REPLAY_STANDARD_TOOL_MAX_BYTES),
            Self::Full => None,
        }
    }

    /// The fidelity a run configured with `capability_set` captures at.
    ///
    /// Reads [`replay`](crate::gg::CAPABILITY_REPLAY) across **every** agent, not just the
    /// [root](GgCapabilitySet::root). The gate this replaced was a root-only read, so
    /// enabling `replay` on a subagent profile — the natural thing to do when it is one
    /// specific worker whose turns are under suspicion — silently did nothing at all. An
    /// escalation is a property of the run, so any agent asking for it escalates the run.
    pub fn resolve(capability_set: &GgCapabilitySet) -> Self {
        if capability_set.any_agent_enabled(crate::gg::CAPABILITY_REPLAY) {
            Self::Full
        } else {
            Self::Standard
        }
    }
}

/// The **fixed identity** a recorded session started from: everything a reconstruction
/// needs before it consumes its first [entry](GgReplayEntry).
///
/// Recording the seed is what makes a record self-contained rather than only meaningful
/// beside the run tree it came from. It costs almost nothing: an
/// [autoloaded](https://docs.testcabinet.ai/gg/autoload-specifications/) case's reference
/// mockups are *already* in the [blob pool](GgReplayRecord::blobs) — they were sent to
/// the model — so [`provided_files`](Self::provided_files) references them rather than
/// carrying a second copy.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplaySeed {
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
    #[serde(default)]
    pub prompt: String,
    /// The context window, in tokens, resolved for each bound model slot. Recorded
    /// because the window is what the fullness signal and compaction thresholds are
    /// computed against, so a reconstruction that guessed it would compact at a
    /// different turn than the run did.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_windows: BTreeMap<String, u64>,
    /// The **final, resolved** modality state of each bound slot.
    ///
    /// Resolved, not initial, and that distinction is load-bearing: vision recovery can
    /// call the model twice for one turn and only the successful stripped call is
    /// recorded, so a reconstruction that started from an un-denied vision state would
    /// send images on the first image turn and drift for a reason that has nothing to do
    /// with any real change.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_modalities: BTreeMap<String, GgReplayModalities>,
    /// Files placed into the workspace before the session began — a case's seeded
    /// inputs and autoloaded specification images — each referencing the
    /// [blob pool](GgReplayRecord::blobs).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub provided_files: Vec<GgReplaySeedFile>,
}

/// Which input modalities a bound model slot was resolved to accept.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayModalities {
    /// Whether the slot's model accepts image input. `false` once a provider has
    /// refused an image for this model and the loop has stripped images from the
    /// context.
    #[serde(default)]
    pub vision: bool,
}

/// One file the workspace was [seeded](GgReplaySeed::provided_files) with, as a
/// reference into the [blob pool](GgReplayRecord::blobs).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplaySeedFile {
    /// The workspace-relative path the file was placed at.
    pub path: String,
    /// The index into [`blobs`](GgReplayRecord::blobs) holding the file's bytes.
    pub blob: u32,
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

/// One distinct message body in the [message pool](GgReplayRecord::messages).
///
/// A single message is typically re-sent on every turn it survives — the measured
/// redundancy on a 12-turn single-agent session was 6.4× — so pooling it is the largest
/// single win in the format after the toolset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayMessage {
    /// The message's [content address](fingerprint_exact), computed over the body
    /// **including its exact image payloads** — before those payloads were replaced by
    /// [blob references](GG_REPLAY_BLOB_REF_KEY). Computing it over the pre-substitution
    /// body is what makes it position-independent: two runs that interned the same
    /// message into differently-ordered pools still produce the same id, which is the
    /// property the [turn fingerprint](GgTurnFingerprint) rests on.
    pub id: String,
    /// The message as the client sent it — the `gg` binary's `Message`, camelCase, with
    /// every inline image payload replaced by a
    /// [blob reference](GG_REPLAY_BLOB_REF_KEY). Carried as free-form JSON because its
    /// concrete shape is owned by the `gg` binary rather than by this contract crate.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub body: Value,
}

/// One distinct offered tool-definition array in the
/// [toolset pool](GgReplayRecord::toolsets).
///
/// The finding that reshaped this format: on a real record the re-serialized tool array
/// was **52%** of the bytes — larger than the messages — and its redundancy is exactly
/// the turn count, because a run's offered toolset almost never changes. Pooling
/// collapses `N` copies to one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayToolset {
    /// The toolset's [content address](fingerprint_exact) over the serialized array.
    /// Used verbatim as the [`tools`](GgTurnFingerprint::tools) component of every turn
    /// fingerprint that offered it.
    pub id: String,
    /// The tool definitions offered, in the order they were offered — the `gg` binary's
    /// `ToolDefinition[]`, camelCase.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>[]"))]
    pub tools: Value,
}

/// One pooled text that is a **clip** of the payload the session actually saw, rather than the
/// whole of it.
///
/// A [standard](GgReplayFidelity::Standard) capture clips a payload past
/// [its ceiling](GgReplayFidelity::stream_max_bytes). The clip has to be self-describing, and the
/// text pool is a bare `Vec<String>` with nowhere to say so — a reader handed a 32 KiB string
/// cannot tell a command that printed exactly that much from one that printed forty megabytes, and
/// the difference is the whole of whether a reconstruction comparing its own output against it is
/// entitled to call a mismatch drift. Hence this table, keyed by pool index, holding what the
/// stored string is missing.
///
/// # Why the whole payload's content address is on it
///
/// [`original_id`](Self::original_id) is what makes a clipped record still *checkable*: a
/// reconstruction that re-executes the command has the whole output in hand, and hashing it
/// answers "is this the same output?" exactly, from a record that kept 32 KiB of it. Without that
/// the clip would be evidence of nothing — a matching tail proves very little about a payload
/// whose head was dropped.
///
/// It is also what makes the pool's dedup unambiguous. Interning keys on the address of the
/// **original** rather than of the stored clip, so two different payloads that happen to share a
/// tail occupy two pool entries with two clip rows, instead of collapsing into one entry whose
/// single row could only describe one of them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayTextClip {
    /// The index into [`texts`](GgReplayRecord::texts) whose entry is a clip.
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

/// One binary payload in the [blob pool](GgReplayRecord::blobs).
///
/// Images are what the pool was built for and are most of what it holds — the catastrophic
/// case v1 had no answer for was a view's base64 payload being re-serialized on every turn
/// it survived, so one 500 KB PNG cost ~67 MB across 100 turns; pooled, it costs 500 KB
/// once, flat. But it is a pool of *bytes*, not of images: the
/// [seed](GgReplaySeed::provided_files) stores every provided file here too, whatever its
/// type, which is what makes an empty directory plus a record a runnable session. A seeded
/// file that is an image and was also sent to the model dedupes against it exactly, because
/// the pool is keyed by content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayBlob {
    /// The blob's [content address](fingerprint_exact) over its base64 bytes.
    pub id: String,
    /// The IANA media type (`image/png`, `image/jpeg`, …), or `application/octet-stream`
    /// for a seeded file whose type the sniffer did not recognize.
    pub media_type: String,
    /// The decoded size in bytes — what the file on disk measured.
    #[serde(default)]
    pub bytes: u64,
    /// The payload's bytes, base64-encoded (no `data:` prefix).
    pub data_base64: String,
}

// ---------------------------------------------------------------------------
// Agent provenance
// ---------------------------------------------------------------------------

/// One agent the record captured, and how it came to exist — the table a driving replay
/// binds live agents through. **One row per agent, not per turn**: repeating a
/// provenance tuple on every entry would defeat the pooling thesis outright.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayAgent {
    /// The id the recorded run minted for this agent (`"root"` for the root agent).
    /// Every [entry](GgReplayEntry::agent_id) is stamped with it.
    pub agent_id: String,
    /// The name of the [agent profile](crate::gg::GgAgentConfig) it ran under.
    pub profile: String,
    /// How the agent came to exist, carrying the keys it is bound by. This — not
    /// [`agent_id`](Self::agent_id) — is what a reconstruction matches on, because
    /// subagent ids come off a global counter in the order agents reach their spawn and a
    /// playback removes model latency entirely, so the live interleaving of two
    /// concurrent agents *will* differ from the recorded one.
    pub origin: GgReplayAgentOrigin,
    /// The status the agent's turn loop ended in, when it ended. Compared against the
    /// reconstructed one and reported as terminal drift when they differ.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub terminal_status: Option<GgAgentStatus>,
    /// The ceiling that stopped this agent, when one did. Cost and turn ceilings are
    /// honored as recorded by a playback — reproducing a limit-hit is a feature — so this
    /// is both an input and something to compare against.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub limit_hit: Option<GgLimitBreach>,
}

/// How an [agent](GgReplayAgent) was created, carrying the keys that identify it
/// deterministically.
///
/// Every variant's payload is a key that is a function of something the reconstruction
/// re-derives on its own — a parent's own ordered turn loop, or board state — and never
/// of the global agent counter, whose values a playback legitimately assigns differently.
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
pub enum GgReplayAgentOrigin {
    /// The run's root agent. Bound trivially — there is exactly one.
    Root,
    /// Spawned by another agent: a delegated subagent, a workflow step, a
    /// [speculation](https://docs.testcabinet.ai/gg/speculative-execution/) arm, or a
    /// [fork](https://docs.testcabinet.ai/gg/fork-and-exec/).
    Spawn {
        /// The [`agent_id`](GgReplayAgent::agent_id) of the spawner.
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
        /// The [`agent_id`](GgReplayAgent::agent_id) of the agent it succeeded.
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
        /// different agents one identical origin — and a reconstruction binding on
        /// provenance would then serve both of them the first one's turns.
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
// Requests and fingerprints
// ---------------------------------------------------------------------------

/// Which of gg's two model clients issued a request.
///
/// The discriminator is what makes a **second queue** representable. Without it a
/// [handoff-compaction](https://docs.testcabinet.ai/gg/compaction/) summarizer call and
/// the agent's own next turn interleave into one indistinguishable queue, and a
/// reconstruction consumes the wrong one. `#[serde(default)]` to
/// [`Agent`](Self::Agent), which is what every request in a
/// [v1 record](self#reading-a-v1-record) was.
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

/// Which model-client call shape a [request](GgReplayRequest) was issued under.
///
/// Recorded because the two shapes are not interchangeable: `complete_requiring` forces
/// the model to call the one offered tool. Without this field a driver replaying a
/// required tool call silently downgrades it to an ordinary offered one, and the
/// reconstructed run is not the run that happened.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReplayRequestShape {
    /// `ModelClient::complete` — the tools were *offered*.
    #[default]
    Complete,
    /// `ModelClient::complete_requiring` — the single pooled tool was *required*.
    CompleteRequiring,
}

/// One model request, as pool references plus the [fingerprint](GgTurnFingerprint) that
/// says what question was being asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayRequest {
    /// Which client issued it. Absent in a [v1 record](self#reading-a-v1-record), where
    /// it reads as [`Agent`](GgClientRole::Agent).
    #[serde(default)]
    pub role: GgClientRole,
    /// Whether the offered tool was required.
    #[serde(default)]
    pub shape: GgReplayRequestShape,
    /// The conversation sent this turn, as ordered indices into
    /// [`messages`](GgReplayRecord::messages).
    #[serde(default)]
    pub messages: Vec<u32>,
    /// The offered tool definitions, as an index into
    /// [`toolsets`](GgReplayRecord::toolsets). `None` for a call that offered no tools
    /// at all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub toolset: Option<u32>,
    /// The content fingerprint of this request, so a reconstruction can prove a recorded
    /// response is still an answer to the question the loop is asking.
    pub fingerprint: GgTurnFingerprint,
}

/// A **fold over pool ids** proving what a turn asked — the staleness detector a
/// reconstruction compares its live request against.
///
/// A recorded model response is only a valid input while gg's prompt construction is
/// unchanged: edit a system-prompt template and every recorded response becomes an
/// answer to a question gg no longer asks, silently, if nothing checks.
///
/// # Why it is a fold, not a second hash
///
/// The pooled [message](GgReplayMessage::id) and [toolset](GgReplayToolset::id) ids
/// **already are** SHA-256 content addresses, computed at intern time by
/// [`GgReplayPools`]. Folding over them costs a hash of a few hundred bytes of hex per
/// turn instead of a second pass over the whole conversation, and — the property that
/// actually matters — it makes recorder-side and playback-side computation *trivially*
/// identical, because both go through [`GgReplayPools::intern_request`]. Two
/// implementations of one fingerprint would drift, and the detector would become the bug.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgTurnFingerprint {
    /// How many messages the request carried. The cheapest and most informative
    /// component: if it moved, the loop is asking a different *number* of questions and
    /// nothing after it is worth reading.
    pub messages: u32,
    /// The pooled id of the **first `system`-role message**, or `None` for a request
    /// that carried none. Isolated from the conversation because the system prompt is
    /// what a template edit moves, and naming it separately is what lets a report say
    /// "your system prompt changed" rather than "something changed".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub system: Option<String>,
    /// The [toolset's pooled id](GgReplayToolset::id), verbatim, or `None` when no tools
    /// were offered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub tools: Option<String>,
    /// A [content address](fingerprint_exact) over the **ordered message-pool id
    /// strings** — the whole conversation, including the system message, reduced to one
    /// value.
    pub conversation: String,
}

/// Which component of a [turn fingerprint](GgTurnFingerprint) differs, in the order a
/// comparison reports them.
///
/// The order is deliberate and is the reason this is an enum rather than a set: the
/// first component that moves is the most informative, so a report names *it* rather
/// than listing every downstream consequence. A changed system prompt necessarily
/// changes the conversation too, and saying so twice helps nobody.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgFingerprintComponent {
    /// The number of messages in the request moved.
    Messages,
    /// The system prompt moved.
    System,
    /// The offered toolset moved.
    Tools,
    /// The conversation's transcript moved.
    Conversation,
}

impl GgTurnFingerprint {
    /// Fold `message_ids` (the ordered [pooled ids](GgReplayMessage::id) of the request's
    /// conversation), the id of its first system-role message, and the
    /// [toolset id](GgReplayToolset::id) into a fingerprint.
    ///
    /// Prefer [`GgReplayPools::intern_request`], which interns and folds in one call so a
    /// caller cannot pair the wrong ids with the wrong toolset.
    pub fn fold(message_ids: &[String], system: Option<&str>, tools: Option<&str>) -> Self {
        let mut hasher = Sha256::new();
        for id in message_ids {
            hasher.update(id.as_bytes());
            // A separator, so `["ab", "cd"]` and `["abc", "d"]` cannot fold to one value.
            hasher.update(b"\n");
        }
        let digest = hasher.finalize();
        Self {
            messages: message_ids.len() as u32,
            system: system.map(str::to_string),
            tools: tools.map(str::to_string),
            conversation: hex::encode(&digest[..GG_REPLAY_ID_HEX_LEN / 2]),
        }
    }

    /// The first component in which `self` differs from `other`, or `None` when the two
    /// are identical.
    ///
    /// Compared in the order [message count → system → tools → conversation](GgFingerprintComponent).
    pub fn first_difference(&self, other: &Self) -> Option<GgFingerprintComponent> {
        if self.messages != other.messages {
            Some(GgFingerprintComponent::Messages)
        } else if self.system != other.system {
            Some(GgFingerprintComponent::System)
        } else if self.tools != other.tools {
            Some(GgFingerprintComponent::Tools)
        } else if self.conversation != other.conversation {
            Some(GgFingerprintComponent::Conversation)
        } else {
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Entry payloads
// ---------------------------------------------------------------------------

/// Why a model call failed.
///
/// v1 dropped model errors entirely, which is a straight defect rather than an omission:
/// a vision refusal strips images and re-runs the turn, and a retry exhaustion counts
/// against an error ceiling, so **both change control flow** — and a reconstruction
/// diverged precisely where a developer was most likely to be looking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayModelError {
    /// The error's class — what the loop branched on.
    pub kind: GgReplayModelErrorKind,
    /// The message the loop saw, which for a provider error is a truncated copy of its
    /// body.
    #[serde(default)]
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

/// The class of a recorded [model error](GgReplayModelError) — a mirror of the `gg`
/// binary's `ModelError` variants, carried in the contract because the *class* is what
/// the turn loop branches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReplayModelErrorKind {
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
    /// [seed's resolved modalities](GgReplaySeed::model_modalities) matter.
    VisionUnsupported,
    /// A `2xx` response could not be parsed into a model response. Fatal.
    Parse,
    /// Every attempt at the request was abandoned mid-stream by
    /// [loop detection](crate::gg::GgLoopDetection) — the model produced a repetition, not a reply,
    /// on all of them. Retryable at the turn level and counted against the run's error ceiling,
    /// exactly like [`RetryExhausted`](Self::RetryExhausted), and kept apart from it because the
    /// two are diagnosed completely differently: one is the provider failing, the other is the
    /// model failing.
    ///
    /// A reconstruction sees only the attempts that were *returned*, never the discarded ones: the
    /// recorder journals the response a turn actually got, so a reply the guard abandoned never
    /// entered the context and correctly never enters the replay either. The
    /// [`attempts`](GgReplayModelError::attempts) count is how many were discarded before the loop
    /// gave up.
    ResponseLoop,
}

/// A tool call the agent (or a [responses-as-code](crate::gg::CAPABILITY_RESPONSES_AS_CODE)
/// program) made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayToolCall {
    /// The call id the loop minted. A program-composed call arrives under a synthetic id
    /// carrying the program prefix, which is the only thing distinguishing the two.
    pub id: String,
    /// The tool's name.
    pub name: String,
    /// The call's arguments — free-form JSON, since each tool owns its own schema.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub arguments: Value,
    /// The directory the call was dispatched in, for a tool that runs a subprocess.
    /// Typed rather than an absolute path string so a reconstruction in a different
    /// workspace can still compare it — see [`GgShellCwd`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub cwd: Option<GgShellCwd>,
}

/// The exact outcome a tool dispatch returned, with its bulky payloads pooled.
///
/// Interning the output against the [text pool](GgReplayRecord::texts) is not merely a
/// size win: a tool's output is quoted **verbatim** into the `tool` message that carries
/// it into the window, so the outcome and the message body are duplicates of one another.
/// One table collapses the pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayToolOutcome {
    /// Whether the call succeeded.
    pub ok: bool,
    /// The text fed back to the model, as an index into
    /// [`texts`](GgReplayRecord::texts).
    pub output: u32,
    /// The short human-readable summary, when the call recorded one, as an index into
    /// [`texts`](GgReplayRecord::texts).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub summary: Option<u32>,
    /// Images the call produced, as indices into [`blobs`](GgReplayRecord::blobs).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<u32>,
    /// The structured facts a responses-as-code program branches on, when the tool
    /// produced them — with the one unbounded text field lifted out into
    /// [`data_text`](Self::data_text).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional, type = "Record<string, unknown>"))]
    pub data: Option<Value>,
    /// The bulky text lifted out of [`data`](Self::data), as an index into
    /// [`texts`](GgReplayRecord::texts).
    ///
    /// Two of gg's structured tool payloads carry the *whole* of what the tool returned a second
    /// time: a `read_file`'s `contents` (up to 256 KiB) and a `shell`'s `body`. Left inline they
    /// would be the largest thing in the record and the one thing in it that is neither pooled nor
    /// clipped — five reads of the same 100 KB file would store it five times, uncompressed, in a
    /// format whose entire premise is that v1's per-turn re-serialization of payloads was the
    /// defect worth fixing. Worse, an inline copy disagrees with a clipped
    /// [`output`](Self::output), leaving the entry with two answers to what the tool returned.
    ///
    /// Pooling it fixes all three at once: the bytes are stored once, under the same ceiling
    /// `output` is clipped at, and — because a `read_file`'s `contents` and its `output` are
    /// usually the identical string — they normally dedup to the *same* pool entry, so the second
    /// copy costs nothing at all.
    ///
    /// Which field it belongs to is determined by `data`'s own variant, so nothing has to be
    /// recorded twice to say. Absent on a record whose tool produced no such payload, and on every
    /// record written before the lift, whose `data` still carries its text inline.
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
/// An absolute path is not portable across a reconstruction: a playback builds in a
/// different (and deliberately empty) directory, so a recorded `/work/impl/web` would
/// never match the live one and every command would fall through to a cross-agent search
/// or a miss. Recording the *relationship* instead makes a directory mismatch — which is
/// a real signal, since the same command in a different tree is a different command —
/// detectable rather than universal.
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
/// which is why the seam belongs there. Recording *which* path asked is what keeps a
/// [completion](https://docs.testcabinet.ai/gg/completion/) gate's validation commands
/// (which bypass the recorder entirely today) off the agent's ordinary queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgShellOrigin {
    /// The `shell` tool, called by the model.
    Tool,
    /// A [responses-as-code](crate::gg::CAPABILITY_RESPONSES_AS_CODE) program's
    /// `system.shell(…)`.
    Program,
    /// A completion gate's validation command.
    CompletionValidation,
}

/// One subprocess gg ran, with its bulky streams pooled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayCommand {
    /// The command line, inline rather than pooled: it is short, and it is the **check**
    /// half of a recorded-command lookup (position is the key), so it is worth being able
    /// to read without resolving a pool.
    pub command: String,
    /// Where it ran.
    pub cwd: GgShellCwd,
    /// The exit status it returned.
    pub exit_code: i32,
    /// Its standard output, as an index into [`texts`](GgReplayRecord::texts).
    pub stdout: u32,
    /// Its standard error, as an index into [`texts`](GgReplayRecord::texts).
    pub stderr: u32,
}

/// One item of an agent's context window as it stood for a recorded turn.
///
/// These four typed fields exist in gg's window model and are recoverable from
/// **nowhere else** — not the telemetry stream, not the raw output, not a v1 record. The
/// [`slot`](Self::slot) matters more than it looks: a system prompt and a rebuilt
/// context-usage signal are otherwise indistinguishable on the wire, since both are
/// [`System`](GgContextSource::System)-sourced, unlabelled and pinned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayPromptItem {
    /// The item's message, as an index into [`messages`](GgReplayRecord::messages).
    pub message: u32,
    /// Which slot of the window model it came from.
    pub slot: GgReplayPromptSlot,
    /// The band it is attributed to in the per-source breakdown.
    pub source: GgContextSource,
    /// Whether it survives a compaction boundary verbatim.
    pub retention: GgReplayRetention,
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
    pub region: Option<GgReplayFileRegion>,
}

/// Which slot of gg's window model a [prompt item](GgReplayPromptItem) came from.
///
/// The window is not a flat list: two of its three positions are *slots* that are
/// assigned rather than appended, precisely so they cannot accumulate duplicates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReplayPromptSlot {
    /// The system-prompt slot, held apart from the thread and never inherited.
    System,
    /// The conversation thread itself.
    Thread,
    /// The context-usage signal slot, rebuilt and re-assigned after every turn.
    ContextUsage,
}

/// Whether a [prompt item](GgReplayPromptItem) is retained verbatim across a compaction
/// boundary or is ephemeral thread material.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReplayRetention {
    /// Carried across compaction unchanged and never evicted.
    Pinned,
    /// Thread material compaction may summarize and agent-managed context may evict.
    Ephemeral,
}

/// The `offset`/`limit` window a paged file view covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayFileRegion {
    /// The 1-based first line the read returned.
    pub offset: u64,
    /// How many lines it returned.
    pub limit: u64,
}

// ---------------------------------------------------------------------------
// The input log
// ---------------------------------------------------------------------------

/// Which non-deterministic input one [entry](GgReplayEntry) pins.
///
/// The vocabulary is enumerated exhaustively on purpose. v1 captured only the first and
/// third of these and silently dropped four categories that **change control flow**, so a
/// reconstruction diverged exactly where a developer was most likely to be looking.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReplayEntryKind {
    /// One model turn's I/O: the pooled request and the response it returned.
    ModelIo {
        /// What was sent.
        request: GgReplayRequest,
        /// The response the turn yielded — the `gg` binary's `ModelResponse` (`text`,
        /// `toolCalls`, `finishReason`, `usage`, `cost`), carried as free-form JSON
        /// because its shape is owned by the binary. Its recorded `usage` is what makes a
        /// cost ceiling trip at the same turn under a reconstruction.
        #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
        response: Value,
        /// How long the call took, in milliseconds. A
        /// [full-fidelity](GgReplayFidelity::Full) latency clock: absent from a standard
        /// record, and absent even from a full one for a call whose latency was not measured.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        duration_ms: Option<u64>,
    },
    /// One model call that **failed**. Both the request and the error are kept: the
    /// request is what identifies the turn, and the error is what the loop branched on.
    ModelError {
        /// What was sent.
        request: GgReplayRequest,
        /// Why it failed.
        error: GgReplayModelError,
        /// How long the failed call took, in milliseconds — the same
        /// [full-fidelity](GgReplayFidelity::Full) latency clock the successful path carries.
        /// Worth as much as the successful one and sometimes more: a retry exhaustion's
        /// latency is the whole of the backoff the run paid for nothing.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        duration_ms: Option<u64>,
    },
    /// One tool call and the exact outcome the dispatch returned for it.
    ToolResult {
        /// The call.
        call: GgReplayToolCall,
        /// The outcome.
        outcome: GgReplayToolOutcome,
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
        items: Vec<GgReplayPromptItem>,
    },
    /// One shell command gg ran on the agent's behalf. **Stubbed** under a playback:
    /// `sh -c` reaches the network, the clock and the machine's toolchain.
    Shell {
        /// Which of the three command paths issued it.
        origin: GgShellOrigin,
        /// The command and its result.
        command: GgReplayCommand,
    },
    /// One `git` subprocess gg's own orchestration ran — a worktree add, a commit, a
    /// merge, a diff.
    ///
    /// Recorded even though a playback **re-runs it for real**: it is gg's own
    /// bookkeeping rather than model-visible non-determinism, and a merge conflict
    /// changes the run, so the recorded result is what a reconstruction is compared
    /// against. In v1 it bypassed tool dispatch entirely and was captured nowhere.
    Git {
        /// The command and its result.
        command: GgReplayCommand,
    },
    /// One read of the cancel file. It **ends the session**, so a reconstruction that
    /// could not see it would run past the point the run stopped.
    CancelProbe {
        /// Whether the probe found the session canceled.
        canceled: bool,
    },
    /// One read of the wall-clock deadline. Recorded because it changes control flow; a
    /// playback deliberately does **not** honor it (it takes seconds), and reports the
    /// resulting terminal difference rather than faking a clock.
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
/// multi-agent interleaving reconstructs deterministically.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayEntry {
    /// The [agent](GgReplayAgent::agent_id) whose loop consumed this input.
    pub agent_id: String,
    /// The globally monotonic sequence number this entry was recorded at, minted across
    /// **all** agents from one counter.
    ///
    /// It is not merely an ordering hint: because a gg run holds run-global mutable state
    /// (the [board](https://docs.testcabinet.ai/gg/project-management/), inter-agent
    /// messages, collected subagent results) that is rendered into every agent's pinned
    /// prompt each turn, the recorded interleaving **is** an input. A reconstruction
    /// serves a recorded input only once every lower `seq` has been served, which is what
    /// keeps the conversation component of the fingerprint stable across a playback that
    /// removes model latency entirely.
    pub seq: u64,
    /// The pinned input itself, flattened inline so its `type` discriminator and fields
    /// sit alongside `agentId`/`seq`.
    #[serde(flatten)]
    pub kind: GgReplayEntryKind,
}

/// Why a record stops short of the session it observed.
///
/// Capture **degrades, it never fails the run it observes** — so every one of these is a
/// recorded fact rather than an error, and the record is still served.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReplayTruncationReason {
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
    /// [assembly](crate::gg_replay_assembly) refuses it outright and the run carries no
    /// record at all. This reason is for damage whose extent is known.
    CorruptJournal,
    /// The journal writer failed (a stalled disk, a dead writer thread), which stops
    /// capture for the whole run.
    ///
    /// Capture is never dropped *per line*: a hole in a pool would leave positional
    /// assembly silently shifting the wrong message body into a reconstructed prompt.
    WriteFailed,
}

/// What a record is missing, when it is missing something.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayTruncation {
    /// Why capture stopped.
    pub reason: GgReplayTruncationReason,
    /// The [`seq`](GgReplayEntry::seq) of the last entry that made it into the record.
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

/// A gg run's **replay record**: the fixed seed, four content-addressed pools, the agent
/// provenance table, and the ordered log of every non-deterministic input the session
/// consumed.
///
/// See the [module documentation](self) for the shape and for how a
/// [v1 record](self#reading-a-v1-record) is upgraded on read. `Deserialize` accepts both
/// formats and always yields this shape, so every consumer has exactly one code path.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayRecord {
    /// The format **this document** is in. The compatibility contract, and the only
    /// identity a reader may branch on. Absent ⇒ [1](GG_REPLAY_FORMAT_V1).
    ///
    /// A [v1 body](self#reading-a-v1-record) is upgraded as it is read, so the record in
    /// hand is always in the v2 shape and reports
    /// [`GG_REPLAY_FORMAT_VERSION`] once it has been. What the *recorder* wrote is
    /// [`upgraded_from`](Self::upgraded_from), and that — not this — is what says whether
    /// the turns carry recorder-stamped fingerprints. Keeping the two apart is what makes
    /// the record round-trip: a document that said `1` while carrying pooled entries would
    /// be re-upgraded on the next read, and positional re-interning would substitute pool
    /// indices for message bodies.
    #[serde(default = "format_version_v1")]
    pub format_version: u32,
    /// The format the recorder actually wrote, when this record reached the v2 shape
    /// through the [upgrade](self#reading-a-v1-record) rather than being captured in it.
    /// Absent for a record captured at [`format_version`](Self::format_version).
    ///
    /// This is what a *driving* reconstruction refuses on: an upgraded record's
    /// fingerprints were derived from its transcript rather than stamped by the recorder,
    /// and it has no [provenance table](Self::agents), no [seed](Self::seed) and no
    /// [client role](GgClientRole). A passive walk of one is fine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub upgraded_from: Option<u32>,
    /// Which build captured it. Explanatory; never a gate.
    #[serde(default)]
    pub recorder: GgReplayRecorder,
    /// How completely the session was captured. Absent ⇒
    /// [`Standard`](GgReplayFidelity::Standard), which is the honest floor for a
    /// [v1 record](self#reading-a-v1-record): v1 capture was opt-in, so every one of them
    /// *was* opted into, but none of them carries a full-only input — v1 recorded none of
    /// those categories at all — and reporting it as `full` would invite a reader to
    /// conclude the session had no clock reads rather than that the build had no clock
    /// capture.
    #[serde(default)]
    pub fidelity: GgReplayFidelity,
    /// The gg session id this record replays — the run id, matching the
    /// [telemetry](crate::gg::GgTelemetryEvent::session_id) stream's.
    pub session_id: String,
    /// The [capability set](GgCapabilitySet) the run was configured with, so a
    /// reconstruction runs under the recorded configuration verbatim rather than under
    /// one assembled to suit it.
    pub capability_set: GgCapabilitySet,
    /// The fixed identity the session started from.
    #[serde(default)]
    pub seed: GgReplaySeed,
    /// Every agent the session created, and how. One row per agent.
    #[serde(default)]
    pub agents: Vec<GgReplayAgent>,
    /// The message pool. [Entries](GgReplayEntry) reference it by index.
    #[serde(default)]
    pub messages: Vec<GgReplayMessage>,
    /// The offered-toolset pool.
    #[serde(default)]
    pub toolsets: Vec<GgReplayToolset>,
    /// The text pool: every large string payload — a tool outcome's output, a `git`
    /// invocation's stdout, a probe body.
    #[serde(default)]
    pub texts: Vec<String>,
    /// Which [texts](Self::texts) are [clips](GgReplayTextClip) rather than whole payloads, in
    /// ascending pool order. Empty for a [full-fidelity](GgReplayFidelity::Full) record, which
    /// clips nothing, and for a standard one whose payloads all fit.
    ///
    /// A sparse side table rather than a field on each pooled text: the overwhelming majority of
    /// payloads are not clipped, and widening every entry of the pool to say so would cost more
    /// than the clipping saves. Always serialized, like the pools it annotates rather than like
    /// [`truncation`](Self::truncation) — an empty table is the positive statement "nothing was
    /// clipped", which is exactly what a reader of a standard record needs to hear.
    #[serde(default)]
    pub clips: Vec<GgReplayTextClip>,
    /// The image-blob pool.
    #[serde(default)]
    pub blobs: Vec<GgReplayBlob>,
    /// Every pinned non-deterministic input, in globally monotonic
    /// [`seq`](GgReplayEntry::seq) order.
    #[serde(default)]
    pub entries: Vec<GgReplayEntry>,
    /// What the record is missing, when it is missing something. Absent on a complete
    /// capture.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub truncation: Option<GgReplayTruncation>,
}

/// The [format version](GgReplayRecord::format_version) an absent field means.
fn format_version_v1() -> u32 {
    GG_REPLAY_FORMAT_V1
}

impl GgReplayRecord {
    /// An empty v2 record for `session_id` under `capability_set`.
    ///
    /// [`fidelity`](Self::fidelity) is [resolved](GgReplayFidelity::resolve) from the set,
    /// so a record built here cannot contradict the configuration it names.
    /// [Streaming assembly](crate::gg_replay_assembly) does not come through here — it
    /// copies the fidelity the journal's own header recorded, which is what the recorder
    /// actually captured at rather than what a set implies it should have.
    pub fn new(session_id: impl Into<String>, capability_set: GgCapabilitySet) -> Self {
        let fidelity = GgReplayFidelity::resolve(&capability_set);
        Self {
            format_version: GG_REPLAY_FORMAT_VERSION,
            upgraded_from: None,
            recorder: GgReplayRecorder::default(),
            fidelity,
            session_id: session_id.into(),
            capability_set,
            seed: GgReplaySeed::default(),
            agents: Vec::new(),
            messages: Vec::new(),
            toolsets: Vec::new(),
            texts: Vec::new(),
            clips: Vec::new(),
            blobs: Vec::new(),
            entries: Vec::new(),
            truncation: None,
        }
    }

    /// Whether this record was captured before format v2 — so its turns carry
    /// [fingerprints](GgTurnFingerprint) derived from the transcript rather than stamped
    /// by the recorder, and it has no [provenance table](Self::agents), no
    /// [seed](Self::seed) and no [client role](GgClientRole).
    ///
    /// A driving reconstruction refuses such a record; a passive walk of it is fine.
    /// Reads [`upgraded_from`](Self::upgraded_from) as well as
    /// [`format_version`](Self::format_version), so it stays true across a round trip.
    pub fn captured_before_v2(&self) -> bool {
        self.format_version < GG_REPLAY_FORMAT_VERSION
            || self
                .upgraded_from
                .is_some_and(|version| version < GG_REPLAY_FORMAT_VERSION)
    }

    /// The pooled [message](GgReplayMessage) at `index`, if the pool reaches that far.
    pub fn message(&self, index: u32) -> Option<&GgReplayMessage> {
        self.messages.get(index as usize)
    }

    /// The pooled [toolset](GgReplayToolset) at `index`, if the pool reaches that far.
    pub fn toolset(&self, index: u32) -> Option<&GgReplayToolset> {
        self.toolsets.get(index as usize)
    }

    /// The pooled text at `index`, if the pool reaches that far.
    pub fn text(&self, index: u32) -> Option<&str> {
        self.texts.get(index as usize).map(String::as_str)
    }

    /// What the pooled text at `index` is missing, when it is a [clip](GgReplayTextClip) — the
    /// question a reader has to ask before treating a recorded payload as the payload.
    ///
    /// A binary search rather than a map, because [`clips`](Self::clips) is written in ascending
    /// pool order by construction (a clip row is minted when its text is first interned) and a
    /// record is read far more often than it is built.
    pub fn clip(&self, index: u32) -> Option<&GgReplayTextClip> {
        self.clips
            .binary_search_by_key(&index, |clip| clip.text)
            .ok()
            .map(|position| &self.clips[position])
    }

    /// The pooled [blob](GgReplayBlob) at `index`, if the pool reaches that far.
    pub fn blob(&self, index: u32) -> Option<&GgReplayBlob> {
        self.blobs.get(index as usize)
    }

    /// The message at `index` with every [blob reference](GG_REPLAY_BLOB_REF_KEY) in its
    /// body inflated back into the image payload it stands for — the body exactly as the
    /// client sent it, and therefore the body its
    /// [content address](GgReplayMessage::id) covers.
    ///
    /// A dangling reference is left in place rather than dropped: a truncated record's
    /// missing blob is a fact worth seeing, not one worth hiding.
    pub fn message_body(&self, index: u32) -> Option<Value> {
        let mut body = self.message(index)?.body.clone();
        self.inflate_blob_refs(&mut body);
        Some(body)
    }

    /// Replace every [blob reference](GG_REPLAY_BLOB_REF_KEY) in `value` with the pooled
    /// image it names.
    fn inflate_blob_refs(&self, value: &mut Value) {
        if let Some(blob) = blob_ref_index(value).and_then(|index| self.blob(index)) {
            *value = serde_json::json!({
                "mediaType": blob.media_type,
                "dataBase64": blob.data_base64,
                "bytes": blob.bytes,
            });
            return;
        }
        match value {
            Value::Object(map) => {
                for item in map.values_mut() {
                    self.inflate_blob_refs(item);
                }
            }
            Value::Array(items) => {
                for item in items {
                    self.inflate_blob_refs(item);
                }
            }
            _ => {}
        }
    }
}

/// The index a [blob reference](GG_REPLAY_BLOB_REF_KEY) object names, or `None` for any
/// other value.
fn blob_ref_index(value: &Value) -> Option<u32> {
    let map = value.as_object()?;
    if map.len() != 1 {
        return None;
    }
    u32::try_from(map.get(GG_REPLAY_BLOB_REF_KEY)?.as_u64()?).ok()
}

// ---------------------------------------------------------------------------
// Interning
// ---------------------------------------------------------------------------

/// The pooling operations every content address in this format is minted through — the
/// **one** place the addressing, the blob substitution and the
/// [turn fingerprint](GgTurnFingerprint) fold are written.
///
/// It is a trait rather than a set of methods on [`GgReplayPools`] because the two
/// consumers store pooled bodies differently and must not therefore compute addresses
/// differently. `GgReplayPools` **retains** every body, which is what an assembled record
/// and a playback recomputing a fingerprint both need; gg's capture journal retains only
/// ids, streaming each body to disk the moment it is first seen, because a recorder that
/// held the bodies would be the quadratic memory term the format exists to remove. Both
/// implement the six primitives below and inherit
/// [`intern_request`](Self::intern_request) — so a fingerprint mismatch can only ever mean
/// the request really changed, never that two implementations of one hash drifted.
pub trait GgReplayInterner {
    /// Intern one message body, returning its index into the message pool.
    ///
    /// The [id](GgReplayMessage::id) is addressed over `body` **as given**, including any
    /// inline image payloads; the *stored* body then has those payloads replaced by
    /// [blob references](GG_REPLAY_BLOB_REF_KEY) via
    /// [`substitute_blobs`](Self::substitute_blobs). Addressing before substitution is what
    /// keeps the id position-independent — a substituted body embeds pool indices, which
    /// depend on insertion order, so an id over it would differ between a recorder and a
    /// playback that interned the same message in a different order and the whole
    /// fingerprint scheme would collapse.
    fn intern_message(&mut self, body: &Value) -> u32;

    /// The [id](GgReplayMessage::id) of the pooled message at `index`.
    fn message_id(&self, index: u32) -> Option<&str>;

    /// Intern one offered tool-definition array, returning its index.
    fn intern_toolset(&mut self, tools: &Value) -> u32;

    /// The [id](GgReplayToolset::id) of the pooled toolset at `index`.
    fn toolset_id(&self, index: u32) -> Option<&str>;

    /// Intern one string payload, keeping at most `max_bytes` of it, and return its index.
    ///
    /// `max_bytes` is whichever of the fidelity's two ceilings the calling seam records under —
    /// [stream](GgReplayFidelity::stream_max_bytes) or [tool](GgReplayFidelity::tool_max_bytes).
    /// `None` stores the payload whole, and `Some(n)` stores [the last `n` bytes](clip_text) of a
    /// longer one and records a [clip](GgReplayTextClip) saying what was dropped.
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

    /// Intern one image, returning its index.
    fn intern_blob(&mut self, media_type: &str, bytes: u64, data_base64: &str) -> u32;

    /// Intern a whole model request and fold its [fingerprint](GgTurnFingerprint) — the
    /// single call a recorder, the v1 upgrade and a playback all make, so none of them
    /// can pair the wrong ids with the wrong toolset or disagree about which message is
    /// the system one.
    ///
    /// `messages` are the serialized message bodies in send order; `tools` is the
    /// serialized offered tool array, or `None` for a call that offered none.
    fn intern_request(
        &mut self,
        role: GgClientRole,
        shape: GgReplayRequestShape,
        messages: &[Value],
        tools: Option<&Value>,
    ) -> GgReplayRequest {
        let indices: Vec<u32> = messages
            .iter()
            .map(|message| self.intern_message(message))
            .collect();
        let ids: Vec<String> = indices
            .iter()
            .filter_map(|&index| self.message_id(index).map(str::to_string))
            .collect();
        // The *first* system-role message, matching how the window model holds exactly
        // one system slot: a later `system` message is thread material, not the prompt.
        let system = messages
            .iter()
            .position(|message| message.get("role").and_then(Value::as_str) == Some("system"))
            .and_then(|position| ids.get(position).cloned());
        let toolset = tools.map(|tools| self.intern_toolset(tools));
        let toolset_id = toolset.and_then(|index| self.toolset_id(index).map(str::to_string));
        let fingerprint = GgTurnFingerprint::fold(&ids, system.as_deref(), toolset_id.as_deref());
        GgReplayRequest {
            role,
            shape,
            messages: indices,
            toolset,
            fingerprint,
        }
    }

    /// Replace every inline image payload in `value` with a
    /// [blob reference](GG_REPLAY_BLOB_REF_KEY), interning the image on the way.
    ///
    /// An image is recognized structurally — any object carrying both a string
    /// `mediaType` and a string `dataBase64` — rather than by knowing where in a
    /// `Message` gg puts one. The `gg` binary owns that shape; coupling the interner to
    /// it would make the pool silently stop working the day a message gained a second
    /// place to hold a picture.
    fn substitute_blobs(&mut self, value: &mut Value) {
        if let Some(index) = self.intern_image_object(value) {
            *value = serde_json::json!({ GG_REPLAY_BLOB_REF_KEY: index });
            return;
        }
        match value {
            Value::Object(map) => {
                for item in map.values_mut() {
                    self.substitute_blobs(item);
                }
            }
            Value::Array(items) => {
                for item in items {
                    self.substitute_blobs(item);
                }
            }
            _ => {}
        }
    }

    /// Intern `value` as an image and return its index, or `None` if it is not one.
    fn intern_image_object(&mut self, value: &Value) -> Option<u32> {
        let map = value.as_object()?;
        let media_type = map.get("mediaType")?.as_str()?;
        let data_base64 = map.get("dataBase64")?.as_str()?;
        let bytes = map.get("bytes").and_then(Value::as_u64).unwrap_or(0);
        Some(self.intern_blob(media_type, bytes, data_base64))
    }
}

/// The **body-retaining** [interner](GgReplayInterner): the four pools of an assembled
/// record, held in memory.
///
/// Used by the [v1 upgrade](self#reading-a-v1-record) as it reads and by a playback
/// interning the *live* request it is about to issue in order to recompute a
/// [fingerprint](GgTurnFingerprint) and compare. gg's capture journal deliberately does
/// **not** use it — see [`GgReplayInterner`] for why.
#[derive(Debug, Default)]
pub struct GgReplayPools {
    messages: Vec<GgReplayMessage>,
    message_index: HashMap<String, u32>,
    toolsets: Vec<GgReplayToolset>,
    toolset_index: HashMap<String, u32>,
    texts: Vec<String>,
    text_index: HashMap<String, u32>,
    clips: Vec<GgReplayTextClip>,
    blobs: Vec<GgReplayBlob>,
    blob_index: HashMap<String, u32>,
}

impl GgReplayPools {
    /// An empty set of pools.
    pub fn new() -> Self {
        Self::default()
    }

    /// The four pools and the [clip](GgReplayTextClip) table, in the order the
    /// [record](GgReplayRecord) carries them.
    pub fn into_parts(self) -> GgReplayPoolParts {
        GgReplayPoolParts {
            messages: self.messages,
            toolsets: self.toolsets,
            texts: self.texts,
            clips: self.clips,
            blobs: self.blobs,
        }
    }
}

/// What [`GgReplayPools::into_parts`] hands back: the four pools plus the clip table, named rather
/// than positional so a caller cannot silently swap two `Vec`s that a tuple would let it.
#[derive(Debug, Default)]
pub struct GgReplayPoolParts {
    /// The message pool.
    pub messages: Vec<GgReplayMessage>,
    /// The offered-toolset pool.
    pub toolsets: Vec<GgReplayToolset>,
    /// The text pool.
    pub texts: Vec<String>,
    /// Which texts are [clips](GgReplayTextClip).
    pub clips: Vec<GgReplayTextClip>,
    /// The image-blob pool.
    pub blobs: Vec<GgReplayBlob>,
}

impl GgReplayInterner for GgReplayPools {
    fn intern_message(&mut self, body: &Value) -> u32 {
        let id = fingerprint_json(body);
        if let Some(&index) = self.message_index.get(&id) {
            return index;
        }
        let mut stored = body.clone();
        self.substitute_blobs(&mut stored);
        let index = self.messages.len() as u32;
        self.messages.push(GgReplayMessage {
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
        self.toolsets.push(GgReplayToolset {
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
            self.clips.push(GgReplayTextClip {
                text: index,
                original_bytes,
                original_id: id.clone(),
            });
        }
        self.text_index.insert(id, index);
        index
    }

    fn intern_blob(&mut self, media_type: &str, bytes: u64, data_base64: &str) -> u32 {
        let id = fingerprint_exact(data_base64.as_bytes());
        if let Some(&index) = self.blob_index.get(&id) {
            return index;
        }
        let index = self.blobs.len() as u32;
        self.blobs.push(GgReplayBlob {
            id: id.clone(),
            media_type: media_type.to_string(),
            bytes,
            data_base64: data_base64.to_string(),
        });
        self.blob_index.insert(id, index);
        index
    }
}

// ---------------------------------------------------------------------------
// Deserialization: one consumer path for both formats
// ---------------------------------------------------------------------------

/// The shape [`GgReplayRecord`] deserializes through, accepting both formats.
///
/// Hand-written rather than derived (the pattern [`GgCapabilitySet`] already uses) so the
/// legacy transcript form drives deserialization while `Serialize`/`ts_rs`/`schemars`
/// still reflect the canonical v2 struct — a `#[serde(from = …)]` would make `schemars`
/// demand this type implement `JsonSchema` too, leaking the legacy fields into the
/// published schema.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GgReplayRecordRaw {
    #[serde(default = "format_version_v1")]
    format_version: u32,
    #[serde(default)]
    upgraded_from: Option<u32>,
    #[serde(default)]
    recorder: GgReplayRecorder,
    #[serde(default)]
    fidelity: GgReplayFidelity,
    #[serde(default)]
    session_id: String,
    capability_set: GgCapabilitySet,
    #[serde(default)]
    seed: GgReplaySeed,
    #[serde(default)]
    agents: Vec<GgReplayAgent>,
    #[serde(default)]
    messages: Vec<GgReplayMessage>,
    #[serde(default)]
    toolsets: Vec<GgReplayToolset>,
    #[serde(default)]
    texts: Vec<String>,
    #[serde(default)]
    clips: Vec<GgReplayTextClip>,
    #[serde(default)]
    blobs: Vec<GgReplayBlob>,
    /// Left as raw JSON because a v1 entry and a v2 entry share this field name and
    /// nothing else: v1's carries a whole re-serialized conversation, v2's carries pool
    /// indices.
    #[serde(default)]
    entries: Vec<Value>,
    #[serde(default)]
    truncation: Option<GgReplayTruncation>,
}

impl<'de> Deserialize<'de> for GgReplayRecord {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error;

        let raw = GgReplayRecordRaw::deserialize(deserializer)?;
        if raw.format_version > GG_REPLAY_FORMAT_VERSION {
            // Refused rather than guessed at: a record from a newer gg may hold entry
            // kinds this build has never heard of, and reconstructing a session from a
            // partial understanding of its inputs is worse than not reconstructing it.
            return Err(D::Error::custom(format!(
                "replay record format {} is newer than this build supports ({GG_REPLAY_FORMAT_VERSION})",
                raw.format_version
            )));
        }
        if raw.format_version >= GG_REPLAY_FORMAT_VERSION {
            let entries = raw
                .entries
                .into_iter()
                .map(serde_json::from_value::<GgReplayEntry>)
                .collect::<Result<Vec<_>, _>>()
                .map_err(D::Error::custom)?;
            return Ok(GgReplayRecord {
                format_version: raw.format_version,
                upgraded_from: raw.upgraded_from,
                recorder: raw.recorder,
                fidelity: raw.fidelity,
                session_id: raw.session_id,
                capability_set: raw.capability_set,
                seed: raw.seed,
                agents: raw.agents,
                messages: raw.messages,
                toolsets: raw.toolsets,
                texts: raw.texts,
                clips: raw.clips,
                blobs: raw.blobs,
                entries,
                truncation: raw.truncation,
            });
        }

        let mut pools = GgReplayPools::new();
        let entries = raw
            .entries
            .iter()
            .map(|entry| upgrade_v1_entry(entry, &mut pools))
            .collect::<Result<Vec<_>, _>>()
            .map_err(D::Error::custom)?;
        let pools = pools.into_parts();
        Ok(GgReplayRecord {
            // The document in hand is now v2, and says so — see `format_version`.
            format_version: GG_REPLAY_FORMAT_VERSION,
            upgraded_from: Some(raw.format_version),
            recorder: raw.recorder,
            // Not re-resolved from the upgraded record's capability set. A v1 record was
            // captured *because* `replay` was on, so resolving would report every one of
            // them as `full` while none of them carries a single full-only input.
            fidelity: raw.fidelity,
            session_id: raw.session_id,
            capability_set: raw.capability_set,
            seed: raw.seed,
            agents: raw.agents,
            messages: pools.messages,
            toolsets: pools.toolsets,
            texts: pools.texts,
            // A v1 record was captured under a build that clipped nothing, so the upgrade's own
            // interning is unclipped and this is empty — never `raw.clips`, which a v1 document
            // cannot carry.
            clips: pools.clips,
            blobs: pools.blobs,
            entries,
            truncation: raw.truncation,
        })
    }
}

/// Upgrade one v1 entry — `{ agentId, seq, type, … }` with whole re-serialized payloads —
/// into its pooled v2 form.
///
/// A malformed entry is an **error**, not a skip. The lenient step-through walk v1 shipped
/// could afford to drop one because it only ever rendered a debugging view; this is the
/// single path every consumer now reads through, and an input that silently vanishes here
/// would shift every following pool index in a reconstruction.
fn upgrade_v1_entry(entry: &Value, pools: &mut GgReplayPools) -> Result<GgReplayEntry, String> {
    let object = entry
        .as_object()
        .ok_or_else(|| "a v1 replay entry is a JSON object".to_string())?;
    let agent_id = string_field(object, "agentId")?;
    let seq = object
        .get("seq")
        .and_then(Value::as_u64)
        .ok_or_else(|| "a v1 replay entry carries a numeric `seq`".to_string())?;
    let kind = match string_field(object, "type")?.as_str() {
        "model_io" => {
            let request = object
                .get("request")
                .ok_or_else(|| "a v1 `model_io` entry carries a `request`".to_string())?;
            let messages = request
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            // Defence in depth against reading a *pooled* request under a v1 version tag:
            // its `messages` are indices, and interning a bare number as a message body
            // would silently substitute `0` for the system prompt.
            if messages.iter().any(|message| !message.is_object()) {
                return Err(
                    "a v1 `model_io` request carries whole message objects, not pool indices"
                        .to_string(),
                );
            }
            // An absent tool array is not an empty one: v1 recorded `tools: []` for a
            // turn that genuinely offered none, and a missing key only ever means a
            // record written before the field existed.
            let tools = request.get("tools").filter(|tools| tools.is_array());
            GgReplayEntryKind::ModelIo {
                request: pools.intern_request(
                    GgClientRole::Agent,
                    GgReplayRequestShape::Complete,
                    &messages,
                    tools,
                ),
                response: object.get("response").cloned().unwrap_or(Value::Null),
                // v1 recorded no clock of any kind, and a latency is a full-fidelity input a
                // v1 capture had no seam for. Absent, not zero.
                duration_ms: None,
            }
        }
        "tool_result" => {
            let call = object
                .get("call")
                .and_then(Value::as_object)
                .ok_or_else(|| "a v1 `tool_result` entry carries a `call` object".to_string())?;
            let outcome = object
                .get("outcome")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    "a v1 `tool_result` entry carries an `outcome` object".to_string()
                })?;
            GgReplayEntryKind::ToolResult {
                call: GgReplayToolCall {
                    id: call
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    name: string_field(call, "name")?,
                    arguments: call.get("arguments").cloned().unwrap_or(Value::Null),
                    // v1 recorded no working directory at all, and inventing
                    // `Workspace` would assert something the record does not say.
                    cwd: None,
                },
                outcome: GgReplayToolOutcome {
                    ok: outcome.get("ok").and_then(Value::as_bool).unwrap_or(false),
                    output: pools
                        .intern_text(outcome.get("output").and_then(Value::as_str).unwrap_or("")),
                    summary: outcome
                        .get("summary")
                        .and_then(Value::as_str)
                        .map(|summary| pools.intern_text(summary)),
                    images: outcome
                        .get("images")
                        .and_then(Value::as_array)
                        .map(|images| {
                            images
                                .iter()
                                .filter_map(|image| pools.intern_image_object(image))
                                .collect()
                        })
                        .unwrap_or_default(),
                    data: outcome.get("data").cloned().filter(|data| !data.is_null()),
                    // v1 inlined the whole of a tool's structured payload, so an upgraded record's
                    // `data` is already complete and nothing was lifted out of it. Interning it
                    // here would be a rewrite of what the session recorded, which upgrade never
                    // does — it re-shapes, it does not re-decide.
                    data_text: None,
                    failure: outcome
                        .get("failure")
                        .cloned()
                        .filter(|failure| !failure.is_null()),
                },
            }
        }
        other => return Err(format!("unknown v1 replay entry type `{other}`")),
    };
    Ok(GgReplayEntry {
        agent_id,
        seq,
        kind,
    })
}

/// A required string member of a v1 entry object.
fn string_field(object: &Map<String, Value>, key: &str) -> Result<String, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("a v1 replay entry carries a string `{key}`"))
}
