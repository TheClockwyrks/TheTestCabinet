//! The **structured half of a tool result**: [`ToolData`] (what a call produced) and
//! [`ToolFailure`] (why one did not).
//!
//! Every gg tool has always computed two things and kept only one. `shell` knows the exit code, the
//! merged output and whether the 16 KiB cap cut it — and then `format!`s all three into
//! `"exit code: 0\n…"`. `list_dir` knows which entries are directories — and then throws that fact
//! away into a `/` suffix. `read_file` knows the window it returned and the file's length — and
//! spells them out in a bracketed footer. For the native tool-calling path that is exactly right:
//! the consumer is a language model reading prose, and prose is the richest thing it can be handed.
//!
//! It is exactly wrong for a consumer that is a **program**. Under the
//! [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) capability the model
//! writes code over the tools, and code wants to branch on `exitCode !== 0` and filter on
//! `entry.kind === "file"` — not to re-parse the sentence gg just wrote. A typed membrane over
//! prose payloads would be a typed API over untyped data, which is the one thing worth avoiding
//! here.
//!
//! So each tool now emits its facts **alongside** its prose, as a [`ToolData`] sidecar on the
//! [`ToolOutcome`](super::ToolOutcome) it already returned. This is purely additive: `ok`, `output`
//! and `summary` are byte-for-byte what they were, the native path keeps reading `output`, and the
//! sidecar is the only thing a structured consumer reads. The two never disagree because they are
//! computed from the same locals in the same function.
//!
//! # Why a typed enum rather than a `serde_json::Value` sidecar
//!
//! Three reasons, in order of how often they save someone:
//!
//! 1. **The compiler says so when a shape changes.** Adding a field to a payload, or changing a
//!    tool's data shape, breaks every consumer at compile time rather than at run time in a
//!    container nobody is watching.
//! 2. **Conversion has no parse-failure path at all.** A consumer turning this into some other
//!    representation writes one exhaustive `match`; there is no "the JSON did not have the shape I
//!    expected" arm to invent behaviour for.
//! 3. **`cargo doc` documents the shape next to the tool that produces it**, so "what does
//!    `search_archive` actually return?" is answered by the type, not by reading a `format!`.
//!
//! The rule this enforces: **prose is never parsed back into data**. If it were, a copy-edit to
//! `"exit code: 0"` would silently change what every program sees — the one design guaranteed to
//! drift, because the person improving the wording has no reason to suspect they are editing an
//! API.
//!
//! # Why failures are classified where they are raised
//!
//! [`ToolFailure`] is the same argument for the error direction. A consumer that wants to know
//! *why* a call failed must not infer it by matching on the message text, so every tool classifies
//! its own failures **at the point it raises them** — one `match` per store error type, one
//! classification per `std::io::Error`, one per argument diagnostic — and never by guessing from a
//! string afterwards. A failure raised outside a tool implementation stays unclassified (`None`),
//! which is honest: nothing invented a class for it.
//!
//! # Numbers
//!
//! Counts and line numbers are held as `u32` and byte sizes as `u64` — the widths the structured
//! consumers are declared in — so the conversion from gg's `usize` locals happens **once**, here at
//! the producing tool, via [`saturating_u32`]. A consumer therefore never has to decide what to do
//! with a count that does not fit, and a pathological input (a file with more than four billion
//! lines) saturates rather than wrapping into a small, plausible, wrong number.

use serde::{Deserialize, Serialize};
use test_cabinet_core::gg::GgToolFailure;

use crate::model::Role;

/// A `usize` count as the `u32` the structured payloads are declared in, **saturating** at
/// [`u32::MAX`] rather than wrapping.
///
/// Every count gg produces here (lines in a file, memories held, tokens reclaimed) is far below
/// four billion in every realistic run, so this conversion is a formality — but a formality with
/// two possible spellings, and `as u32` picks the wrong one: it would turn a 2^32 + 3 line count
/// into `3`, a number that looks entirely reasonable and is entirely false. Saturating is the
/// failure mode that stays obviously wrong.
pub fn saturating_u32(count: usize) -> u32 {
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// A `u128` count as the `u64` the structured payloads are declared in, **saturating** at
/// [`u64::MAX`] rather than wrapping — [`saturating_u32`]'s wider sibling, and there for exactly
/// the same reason.
///
/// The one caller is a [`Duration::as_millis`](std::time::Duration::as_millis), whose `u128` cannot
/// overflow a `u64` in any run that finishes before the heat death of the universe. It is converted
/// deliberately anyway, because the alternative spelling is `as u64`, and picking a spelling that
/// silently wraps for a value that cannot wrap is how the next value — one that can — gets the same
/// treatment.
pub fn saturating_u64(count: u128) -> u64 {
    u64::try_from(count).unwrap_or(u64::MAX)
}

/// The structured facts one tool call produced — the sidecar described in this
/// [module's docs](self).
///
/// One variant per *shape*, not per tool: the five task/board tools that report how full their
/// store is share one payload, because a consumer that reads a usage figure does not care which
/// mutation produced it. Tools whose result is a bare confirmation (`edit_file`, `update_task`,
/// `send_message`, …) emit **no** data at all rather than an empty payload — "this call has nothing
/// structured to say" is a real answer and is worth being able to state.
///
/// The serde representation is **adjacently tagged** (`{"kind": "shell", "data": {…}}`). The tag
/// keeps the JSON self-describing for the replay recorder, which captures the whole
/// [`ToolOutcome`](super::ToolOutcome) verbatim; adjacent rather than internal tagging because two
/// variants wrap something that is not a map ([`BytesWritten`](Self::BytesWritten) wraps a number,
/// [`DirEntries`](Self::DirEntries) a list), and serde's internally tagged representation cannot
/// serialize those at all.
///
/// It derives `Eq` — no payload holds a float — so the outcome that carries it keeps the
/// `PartialEq, Eq` every existing tool test compares with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "data")]
pub enum ToolData {
    /// What a `shell` command reported: [`ShellData`]. Present whenever the process actually ran,
    /// **including when it exited non-zero** — that is a completed call, not a failed one, and its
    /// presence is what distinguishes it from a command that could not be launched.
    Shell(ShellData),
    /// The text (or window of text) a `read_file` returned: [`FileTextData`].
    FileText(FileTextData),
    /// The picture a `read_file` found, described: [`FileImageData`]. The bytes themselves travel
    /// on [`ToolOutcome::images`](super::ToolOutcome::images), not here.
    FileImage(FileImageData),
    /// How many bytes a `write_file` wrote.
    BytesWritten(u64),
    /// What a `list_dir` found, in the order it reported them.
    DirEntries(Vec<DirEntryData>),
    /// How full the memory store is after any memory mutation.
    MemoryUsage(MemoryUsageData),
    /// What a `search_memories` matched, best first — empty when nothing did.
    MemoryHits(Vec<MemoryHitData>),
    /// How full the task list is after an `add_task`/`remove_task`.
    TaskUsage(UsagePair),
    /// How full the board is after a `remove_epic`/`remove_issue`.
    BoardUsage(BoardUsageData),
    /// The id a `create_epic`/`create_issue` was assigned, with the same usage: [`BoardNodeData`].
    /// Its own shape because these are the two board mutations whose *result* — the id — the caller
    /// could not have known, and it needs it to reference what it just filed.
    BoardNode(BoardNodeData),
    /// What an `evict_file_view`/`archive_thread` actually freed from the live context window.
    ///
    /// Produced by the [loop](crate::agent) rather than by the tool: the two reclaim tools only
    /// validate their arguments, and the loop — which owns the live window — performs the reclaim
    /// and rewrites the outcome with what it really did.
    Reclaim(ReclaimData),
    /// What a `search_archive` found, keeping the distinction the prose makes between an empty
    /// archive and a search that ran and matched nothing.
    ArchiveSearch(ArchiveSearchData),
    /// The child agent a `spawn_subagent` scheduled.
    SubagentSpawned(SubagentHandleData),
    /// The results a `wait_for_subagents` collected, in the order it reports them.
    SubagentResults(Vec<SubagentResultData>),
}

/// What a completed process reported — the facts behind `shell`'s `"exit code: …"` prose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellData {
    /// The exit status, or `None` when a signal terminated the process (which is why this is an
    /// option rather than a sentinel `-1`: "killed" and "exited 255" are different events).
    pub exit_code: Option<i32>,
    /// The merged stdout-then-stderr, **without** the `exit code:` header the model-facing output
    /// prefixes and without the truncation note it appends — the process's own output and nothing
    /// gg wrapped around it.
    pub body: String,
    /// Whether the 16 KiB output cap cut `body` (the head was dropped, the tail kept).
    pub truncated: bool,
}

/// A text file, or the window of one a capped [read policy](super::ReadPolicy) returned.
///
/// The line numbers are what the model-facing footer says in prose (`[showing lines 251-500 of
/// 1000]`), which is exactly what a caller needs to decide whether to page again — so it is
/// reported as three numbers instead of a sentence to re-parse.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTextData {
    /// The file's text: under a capped policy the requested window only, and in every case
    /// **footer-free** — no `[showing lines …]`, no `[truncated: …]`. The window is described by
    /// the fields below instead, so nothing has to be stripped back off.
    pub contents: String,
    /// The 1-based first line returned. `1` for an empty file, whose window is empty rather than
    /// absent.
    pub first_line: u32,
    /// The 1-based last line returned — `0` for an empty file, the one case where it precedes
    /// [`first_line`](Self::first_line).
    pub last_line: u32,
    /// The file's total line count, so a caller knows whether there is more to read.
    pub total_lines: u32,
    /// Whether the 256 KiB byte ceiling cut the returned text. Distinct from a line window: a
    /// single enormous line is truncated in bytes even when the whole file was asked for.
    pub byte_truncated: bool,
}

/// A picture `read_file` recognised, described.
///
/// The bytes are deliberately absent: an image is attached to the tool result itself (see
/// [`ToolOutcome::images`](super::ToolOutcome::images)) so a model can *look* at it, which is worth
/// far more than the same bytes base64'd into a variable. What belongs here is everything a caller
/// might branch on — what it is, how big it is, and whether it is actually being shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileImageData {
    /// The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`), detected from
    /// the file's magic bytes rather than its extension.
    pub media_type: String,
    /// The short format label the prose uses (`PNG`, `JPEG`, `GIF`, `WebP`).
    pub label: String,
    /// The file's size in bytes.
    pub bytes: u64,
    /// Whether the picture is being attached to this result for the model to look at.
    pub shown: bool,
    /// Why it is not being shown — a text-only model, a provider refusal, or gg's 8 MiB attach cap.
    /// `None` exactly when [`shown`](Self::shown) is true.
    pub not_shown_reason: Option<String>,
}

/// What kind of thing a directory entry is — the fact `list_dir` renders as a trailing `/`.
///
/// Three cases rather than a `bool`, because a symlink, a socket or a device node is genuinely
/// neither a file nor a directory, and a caller filtering for `File` should not be handed one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirEntryKind {
    /// A regular file.
    File,
    /// A directory — the entry the prose suffixes with `/`.
    Directory,
    /// Anything else (a symlink, a socket, a device node), or an entry whose type could not be
    /// read. Reported honestly rather than guessed at.
    Other,
}

/// One entry of a listed directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryData {
    /// The entry's name — **not** a path, and without the `/` the prose adds to a directory. Join
    /// it with the directory that was listed.
    pub name: String,
    /// Whether it is a file, a directory, or something else.
    pub kind: DirEntryKind,
}

/// How full a single-axis, capped store is after a mutation — today the task list.
///
/// Shared rather than per-tool because "how many, out of how many allowed" is one shape; a caller
/// checking whether it is near a ceiling asks the same question of every tool that has one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePair {
    /// How many are held now.
    pub count: u32,
    /// The most this run allows.
    pub max: u32,
}

/// How full the memory store is after a mutation.
///
/// Memories are bounded on **several** axes — how many, how many characters of body in total, and
/// (under the [markdown](crate::memories::MemoryStrategy::Markdown) strategy) how long the pinned
/// index has grown — and any of them can refuse the next write, so all of them are reported. (This
/// is why memories do not share [`UsagePair`]: a caller told only the count would have no way to
/// see the budget it was about to breach.)
///
/// Each maximum is optional, because each is independently disableable and because a strategy
/// applies only some of them. `None` means "no limit here", which is a different fact from a large
/// one and is worth being able to state; a program that wants to know how much room is left asks
/// whether there is a limit before subtracting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUsageData {
    /// Memories currently held.
    pub count: u32,
    /// The most memories this run allows, if it limits the count.
    pub max_count: Option<u32>,
    /// Characters of body currently held, across all memories.
    pub total_chars: u32,
    /// The most characters of body this run allows in total, if it limits the aggregate.
    pub max_total_chars: Option<u32>,
    /// Characters the pinned index currently occupies, under a strategy that keeps one.
    pub index_chars: Option<u32>,
    /// The most characters the index may occupy, if it is limited.
    pub max_index_chars: Option<u32>,
}

/// One memory a `search_memories` matched: what to read next, and why it ranked where it did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHitData {
    /// The memory's slug — what `read_memory` takes.
    pub name: String,
    /// The memory's description, or empty when it was created without one.
    pub description: String,
    /// How many of the caller's distinct keywords this memory matched — the primary ranking.
    pub matched: u32,
    /// How many times those keywords occur in it — the tiebreak.
    pub occurrences: u32,
    /// A short window of the memory around its first match.
    pub excerpt: String,
}

/// How full the epic/issue board is after a mutation — two independently capped populations, so
/// four numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardUsageData {
    /// Epics currently held.
    pub epics: u32,
    /// The most epics this run allows.
    pub max_epics: u32,
    /// Issues currently held.
    pub issues: u32,
    /// The most issues this run allows.
    pub max_issues: u32,
}

/// The epic or issue a `create_epic`/`create_issue` filed: the id **gg assigned** it, and the board
/// usage every board mutation reports.
///
/// The id is the point. Neither id is the model's to choose — an epic's is its prefix upper-cased, an
/// issue's is numbered under that prefix — so a program that files one has no other way to name it
/// afterwards, whether to group an issue under the epic, block a later issue on it, or wait for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardNodeData {
    /// The id the board assigned the new epic (`AUTH`) or issue (`AUTH-1`).
    pub id: String,
    /// How full the board is now.
    pub board: BoardUsageData,
}

/// What a context reclaim actually freed from the live window.
///
/// Produced by the [loop](crate::agent), which owns the window; the tools themselves only validate
/// their arguments. The numbers are the point: "reclaimed something" and "reclaimed nothing because
/// there was nothing to reclaim" are very different answers to the same call, and only the counts
/// tell them apart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReclaimData {
    /// How many context items were dropped from the live window.
    pub items: u32,
    /// Approximately how many tokens that freed.
    pub reclaimed_tokens: u32,
    /// The workspace paths whose file views were evicted. Empty for a thread archival.
    pub paths: Vec<String>,
    /// The same prose the native tool-calling path shows the model.
    pub detail: String,
}

/// One archived message a `search_archive` matched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveHitData {
    /// The archived message's sequence number — its position in the original thread, which is what
    /// makes two hits orderable.
    pub seq: u32,
    /// Who said it.
    pub role: Role,
    /// The message text.
    pub text: String,
}

/// What a `search_archive` found.
///
/// [`archive_empty`](Self::archive_empty) is kept as its own flag rather than collapsed into an
/// empty [`hits`](Self::hits) list because the prose already distinguishes the two, and collapsing
/// them would make a caller archive its thread a second time in the belief that the first
/// `archive_thread` had failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSearchData {
    /// Nothing has been archived yet, so there was nothing to search.
    pub archive_empty: bool,
    /// The matches, capped at gg's 8-hit ceiling. Empty when the search ran and matched nothing.
    pub hits: Vec<ArchiveHitData>,
}

/// A child agent a `spawn_subagent` scheduled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentHandleData {
    /// The child's id — what a later wait or message names it by.
    pub id: String,
    /// The model slot it was placed on.
    pub slot: String,
    /// The model actually bound to that slot, which is not always the one that was asked for (a
    /// slot request is honoured only when multi-model is enabled).
    pub model_id: String,
}

/// How a child agent's loop ended.
///
/// gg records an agent's ending as one of a fixed set of strings ([`parse`](Self::parse) is the
/// single place that vocabulary is interpreted), so a caller branching on "did it actually finish?"
/// compares values rather than spellings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatusData {
    /// The agent's loop finished normally.
    Completed,
    /// It hit the per-run turn ceiling.
    Exhausted,
    /// It passed its wall-clock deadline.
    TimedOut,
    /// A model turn failed (retry-exhausted or fatal).
    ModelError,
    /// The run's credential was refused.
    AuthError,
    /// An execution ceiling stopped it — consecutive errors, error rate, or cost.
    ///
    /// Like [`Exhausted`](Self::Exhausted) it means the agent was cut off partway rather than that it
    /// failed at the work, which is why a caller reading a child's result must be able to tell the
    /// two apart: the summary of a limit-stopped child describes real work, and treating it as "no
    /// status" would send its spawner looking for a failure that did not happen.
    LimitExceeded,
}

impl AgentStatusData {
    /// Parse gg's recorded status string (`"completed"`, `"exhausted"`, `"timed_out"`,
    /// `"model_error"`, `"auth_error"`, `"limit_exceeded"`).
    ///
    /// Returns `None` for anything else — including the empty string a child that produced no
    /// return value at all leaves behind. An unrecognised ending is reported as "no status" rather
    /// than as a plausible-looking wrong one, since a caller that sees `None` will look at the
    /// summary, whereas one told `Completed` will not.
    pub fn parse(status: &str) -> Option<Self> {
        match status {
            "completed" => Some(Self::Completed),
            "exhausted" => Some(Self::Exhausted),
            "timed_out" => Some(Self::TimedOut),
            "model_error" => Some(Self::ModelError),
            "auth_error" => Some(Self::AuthError),
            "limit_exceeded" => Some(Self::LimitExceeded),
            _ => None,
        }
    }
}

/// One child agent's collected result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentResultData {
    /// The child's id.
    pub id: String,
    /// How it finished; `None` when it produced no recognisable ending at all.
    pub status: Option<AgentStatusData>,
    /// Its final message.
    pub summary: String,
}

/// Why a tool call failed, in the vocabulary a caller branches on.
///
/// Every variant is set **where the failure is raised** — inside the `match` on a store's error
/// type, at the `std::io::Error` that came back, in the argument helper that rejected the value —
/// never by inspecting the message afterwards. That is the whole point: the message is written for
/// a human to read and is revised whenever it reads badly, so anything that branches on it is one
/// copy-edit away from being wrong.
///
/// Its serde spelling is kebab-case (`"invalid-argument"`), matching how the failure classes are
/// named on the wire to a structured consumer, so a recorded outcome reads the same in both places.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolFailure {
    /// The arguments were malformed, ill-typed, or out of range — including a path that is
    /// absolute or climbs out of the workspace.
    InvalidArgument,
    /// The named file, skill, memory, task, epic, issue, or subagent does not exist.
    NotFound,
    /// Well-formed, but in conflict with the current state: an ambiguous edit, a dependency cycle,
    /// a duplicate id, a subagent that already returned.
    Conflict,
    /// gg refused the call: a compaction the loop is waiting for, the delegation depth cap, or a
    /// completion gate the call did not satisfy.
    Refused,
    /// The tool exists but this run's capability set does not offer it.
    Unavailable,
    /// A gg-side ceiling was hit: a shell timeout, a memory/task/board cap, or the run's
    /// wall-clock budget running out.
    LimitExceeded,
    /// The underlying I/O or process failed.
    IoError,
}

impl ToolFailure {
    /// Classify a [`std::io::Error`] raised by a tool's filesystem or process work.
    ///
    /// A missing path is [`NotFound`](Self::NotFound) — the single most common failure a caller
    /// wants to branch on, and the one the "does not exist" class exists for — and everything else
    /// (permissions, a full disk, a directory where a file was expected) is
    /// [`IoError`](Self::IoError). The split is made on
    /// [`ErrorKind`](std::io::ErrorKind), never on the error's rendered text.
    pub fn from_io(err: &std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => Self::NotFound,
            _ => Self::IoError,
        }
    }

    /// This class as the contract publishes it on a failed call's telemetry.
    ///
    /// Written out by hand rather than through a `From`, for the reason
    /// [`TurnOutcome::wire`](crate::limits::TurnOutcome::wire) gives: gg's vocabulary and the
    /// published one must not become interchangeable, and the contract carries an eighth value
    /// ([`Other`](GgToolFailure::Other)) that this enum deliberately does not — an unclassified
    /// failure is an *absent* `ToolFailure` here and a present `other` there, because the wire has
    /// to distinguish "this call failed and nobody said why" from "this call did not fail".
    pub fn wire(self) -> GgToolFailure {
        match self {
            Self::InvalidArgument => GgToolFailure::InvalidArgument,
            Self::NotFound => GgToolFailure::NotFound,
            Self::Conflict => GgToolFailure::Conflict,
            Self::Refused => GgToolFailure::Refused,
            Self::Unavailable => GgToolFailure::Unavailable,
            Self::LimitExceeded => GgToolFailure::LimitExceeded,
            Self::IoError => GgToolFailure::IoError,
        }
    }
}

#[cfg(test)]
#[path = "data.test.rs"]
mod tests;
