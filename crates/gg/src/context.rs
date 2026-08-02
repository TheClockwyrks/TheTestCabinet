//! The gg **context model**: a source-tagged, token-accounted view of everything that
//! fills the active model's context window.
//!
//! # Why not a flat transcript
//!
//! The Phase 0 loop drove the model off a flat `Vec<Message>`. That is enough to *run*,
//! but it cannot answer the two questions the rest of gg is built on:
//!
//! - **What is filling the window?** [Context visibility](https://docs.testcabinet.ai/gg/context-visibility/)
//!   reports the window broken down by *source* (skills, memories, file views, the
//!   thread, tool output, …) and the console renders it as a stacked line graph.
//! - **How full is the window, and what must survive when it overflows?**
//!   [Compaction](https://docs.testcabinet.ai/gg/compaction/) (Phase 2) triggers on
//!   fullness and summarizes the *history* while carrying **pinned** state (read skills,
//!   memories, the task list) across the boundary verbatim.
//!
//! Both need the same thing: every contribution to the window tagged with a
//! [`GgContextSource`] and an estimated token count, and a per-item flag for whether it
//! is [`Pinned`](Retention::Pinned) (retained/evict-proof) or
//! [`Ephemeral`](Retention::Ephemeral) (summarizable/evictable). This module is that
//! model. It replaces the flat transcript with an ordered [`ContextModel`] of
//! [`ContextItem`]s that still [renders](ContextModel::messages) to the exact
//! `Vec<Message>` the [client](crate::model::ModelClient) consumes, so Phase 0 behavior
//! is preserved while the accounting and the retention seams exist underneath.
//!
//! # Seams left for later phases (not built here)
//!
//! - **Compaction (Phase 2)** summarizes [`Retention::Ephemeral`] items and keeps
//!   [`Retention::Pinned`] ones verbatim. The [`ContextModel`] already partitions items
//!   by retention ([`pinned`](ContextModel::pinned) / [`ephemeral`](ContextModel::ephemeral)),
//!   so compaction is a rewrite of the item vector, not a new data model.
//! - **Agent-managed context (Phase 2)** evicts [`GgContextSource::FileView`] items; the
//!   source tag makes them selectable.
//! - **Skills / memories / tasks (this phase, later stages)** attach as
//!   [`Retention::Pinned`] items with the [`Skill`](GgContextSource::Skill) /
//!   [`Memory`](GgContextSource::Memory) / [`TaskList`](GgContextSource::TaskList)
//!   sources via [`ContextModel::push`].
//!
//! # Token estimation
//!
//! Counts are **estimates**: exact per-provider token counts are not available
//! cross-provider, so gg counts every item with one [`TokenEstimator`]. The default,
//! [`BpeTokenEstimator`], is a real BPE tokenizer (`o200k_base`) used as a documented
//! cross-model approximation; the trait keeps it swappable so a later phase can refine
//! per model family. A model's window **limit** (for the fullness ratio) comes from a
//! capability param or a small built-in table — see [`crate::agent`].

use std::sync::Arc;

use test_cabinet_core::gg::{GgContextSource, GgContextSourceUsage, GgTelemetryKind};

use crate::model::{ImageContent, Message, Role, ToolCall};
use crate::prompts::{self, ContextPressureContext, UsageCategoryView, UsageFileView};

/// A small fixed per-message token allowance approximating the role tag and message
/// framing a provider adds around the content (chat formats wrap each message in a few
/// tokens of delimiters). Added to every item's estimate so short messages are not
/// counted as ~zero. An approximation, like the rest of the accounting.
const MESSAGE_FRAMING_TOKENS: usize = 4;

/// Whether a [`ContextItem`] is retained verbatim across a
/// [compaction](https://docs.testcabinet.ai/gg/compaction/) boundary and shielded from
/// agent-managed eviction, or is ephemeral thread material a later phase may summarize
/// or evict.
///
/// This is the flag compaction (Phase 2) reads: it summarizes the [`Ephemeral`](Self::Ephemeral)
/// history and carries the [`Pinned`](Self::Pinned) items — read skills, memories, the
/// task list, and the fixed prompt prefix — across the boundary unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Retention {
    /// Retained across compaction verbatim and never evicted: the system prompt, the
    /// build prompt, and (in later stages) read skills, memories, and the task list.
    Pinned,
    /// Ephemeral thread material — assistant turns, tool output, file views — that
    /// Phase 2 compaction may summarize and agent-managed context may evict.
    Ephemeral,
}

impl Retention {
    /// Whether this is [`Pinned`](Self::Pinned).
    pub fn is_pinned(self) -> bool {
        matches!(self, Retention::Pinned)
    }
}

/// One contribution to the context window: the [`Message`] rendered to the client, the
/// [`GgContextSource`] that produced it, its [`Retention`] class, and a cached token
/// estimate.
///
/// The token estimate is computed once, when the item is [pushed](ContextModel::push),
/// against the model's [`TokenEstimator`] — the same item is rendered to the client and
/// counted in the breakdown, so the two can never disagree.
#[derive(Debug, Clone)]
pub struct ContextItem {
    /// The source this contribution is attributed to, for the per-source breakdown.
    source: GgContextSource,
    /// Whether the item survives compaction verbatim or is ephemeral.
    retention: Retention,
    /// The message rendered to the model client for this contribution.
    message: Message,
    /// The estimated tokens this item occupies (computed at push time).
    tokens: usize,
    /// An optional selector tag used by agent-managed context: the workspace path a
    /// [`FileView`](GgContextSource::FileView) shows, so `evict_file_view { path }` can target it
    /// and the [context-usage signal](ContextModel::refresh_context_usage_signal) can break the
    /// file-view band down by file. `None` for ordinary items.
    label: Option<String>,
    /// For a [`FileView`](GgContextSource::FileView) produced by a **paged** read, the
    /// `offset`/`limit` window it covers; `None` for a whole-file view and for every other kind of
    /// item. Carried beside the [`label`](Self::label) rather than folded into it because the label
    /// is a selector `evict_file_view { path }` matches on exactly — a tag that sometimes read
    /// `src/main.rs` and sometimes `src/main.rs@200+50` would make the same file un-evictable
    /// depending on how it had been read.
    region: Option<FileRegion>,
    /// The [session turn](ContextModel::begin_turn) this item was pushed on — the number
    /// [`archive_thread`](ContextModel::archive_thread) selects ranges of, and the number a tool
    /// result's [turn header](ContextModel::turn_header) shows the model. `0` for everything seeded
    /// before the first turn (the system prompt, the build prompt, autoloaded specs, re-opened
    /// views), which is why turn numbering the model sees starts at `1`.
    turn: u64,
}

// Accessors for tests and the Phase 2 compaction/eviction consumers (the loop reads the
// fields internally); kept as the item's read surface even where P1a does not call them.
#[allow(dead_code)]
impl ContextItem {
    /// The source this item is attributed to.
    pub fn source(&self) -> GgContextSource {
        self.source
    }

    /// The item's retention class.
    pub fn retention(&self) -> Retention {
        self.retention
    }

    /// The message this item renders to.
    pub fn message(&self) -> &Message {
        &self.message
    }

    /// The estimated tokens this item occupies.
    pub fn tokens(&self) -> usize {
        self.tokens
    }

    /// The item's selector tag, when it carries one (a file view's path).
    pub fn label(&self) -> Option<&str> {
        self.label.as_deref()
    }

    /// The [session turn](ContextModel::begin_turn) this item was pushed on.
    pub fn turn(&self) -> u64 {
        self.turn
    }

    /// The `offset`/`limit` window a paged [file view](GgContextSource::FileView) covers, when this
    /// item is one and the read was paged.
    pub fn region(&self) -> Option<FileRegion> {
        self.region
    }
}

/// The line window a **paged** `read_file` covered, as `offset`/`limit` — kept so a view can be
/// re-opened over the same lines rather than from the top of the file.
///
/// It is what the read **actually returned**, not what the call asked for. The two differ often
/// enough to matter: an `offset`/`limit` on a call made under an
/// [unlimited](crate::tools::ReadPolicy::Unlimited) policy is ignored by the tool and the whole file
/// comes back, and a `limit` above a [hard cap](crate::tools::ReadPolicy::HardCap) is reduced to it.
/// Recording the ask rather than the answer would give a view a window it does not have — two
/// whole-file views recorded as two *different* windows, or a re-opened page that silently covers
/// fewer lines than the one it replaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileRegion {
    /// The 1-based first line the read returned.
    pub offset: u64,
    /// How many lines it returned.
    pub limit: u64,
}

impl FileRegion {
    /// The region a read covered, given the window it reported (`first_line`/`last_line`, both
    /// 1-based and inclusive) and the file's `total_lines` — or `None` when it covered the **whole
    /// file**, which needs no region because re-reading the path re-opens it exactly.
    ///
    /// An empty file (`last_line` of `0`) and a read that ran to the end of the file are both
    /// whole-file views. A view that starts at line 1 but stops short is a genuine window: it is the
    /// first page of a capped read, and re-opening it without the limit would pull in the rest of the
    /// file.
    pub fn covered(first_line: u64, last_line: u64, total_lines: u64) -> Option<Self> {
        if first_line <= 1 && last_line >= total_lines {
            return None;
        }
        Some(Self {
            offset: first_line.max(1),
            limit: last_line.saturating_sub(first_line.max(1)) + 1,
        })
    }
}

/// One [file view](GgContextSource::FileView) **open in the window**: the workspace path it shows and
/// the [region](FileRegion) of it the read covered.
///
/// What [`ContextModel::open_file_views`] reports and what
/// [agent persistence](test_cabinet_core::gg::CAPABILITY_AGENT_PERSISTENCE) records against a profile
/// — deliberately the *reference* to a read rather than the bytes it returned, so re-opening it reads
/// the file as it stands then instead of replaying a stale copy of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenFileView {
    /// The workspace-relative path read.
    pub path: String,
    /// The `offset`/`limit` window the read covered, or `None` for a whole-file read.
    pub region: Option<FileRegion>,
}

/// Which of the two [view](ContextModel::open_views) kinds a view is — the whole taxonomy, and
/// closed on purpose.
///
/// Everything on disk is a file and everything a program can compute is a string, so a directory
/// listing, a shell result, a subagent's answer, a computed diff and an assembled table are all
/// [`Text`](Self::Text) views. A third kind for any of them would hand the model a taxonomy question
/// to answer before it could show gg anything, in exchange for a distinction nothing downstream
/// reads. An **image** is not a kind either: it is a [`File`](Self::File) view of an image file,
/// whose item carries the picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewKind {
    /// A [file view](GgContextSource::FileView), keyed by `(path, region)`.
    File,
    /// A [text view](GgContextSource::TextView), keyed by the label the agent gave it.
    Text,
}

/// One [text view](GgContextSource::TextView) open in the window: the label it is keyed by and the
/// body the agent composed for it.
///
/// The counterpart of [`OpenFileView`] for [agent persistence](ContextModel::open_text_views) — and,
/// unlike it, it carries **the material itself**. That module's "record the reference, never the
/// bytes" principle exists because a file's on-disk truth can move under a stored snapshot, leaving
/// a restored profile showing a file that no longer says that. A text view has no on-disk truth to
/// go stale against: the window *is* the only copy, so a reference to it would restore nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenTextView {
    /// The label the view is keyed by — its selector for supersession and for `view.close`.
    pub label: String,
    /// The body the agent supplied, without the [heading](code_heading) the window prefixes it with.
    pub body: String,
}

/// One view of either kind open in the window, as [`open_views`](ContextModel::open_views) reports
/// it — what backs the model-facing `view.current()`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenViewInfo {
    /// Whether this is a file or a text view.
    pub kind: ViewKind,
    /// The view's selector: a file view's workspace path, or a text view's label.
    pub selector: String,
    /// The estimated tokens the view occupies. Views that share a selector *and* a region are
    /// reported as one entry carrying their combined cost, because that is what closing the
    /// selector reclaims.
    pub tokens: u64,
    /// The `offset`/`limit` window a **paged** file view covers; `None` for a whole-file view and
    /// for every text view.
    pub region: Option<FileRegion>,
}

/// What opening a view did to the window: whether it replaced a view that was already open, whether
/// that replacement happened inside the current turn (so nothing was ever sent), and what the new
/// item costs.
///
/// The turn report reads this to tell the model what its own call did — "opened" and "replaced" are
/// different facts, and a model that re-opened a view believing it had opened a second one would
/// mis-read its own accounting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewOpened {
    /// Whether a view with this selector was already open and has been superseded.
    pub superseded: bool,
    /// Whether the superseded copy was itself pushed on the **current** turn and so was replaced in
    /// place rather than left behind as history. See
    /// [`supersede_view`](ContextModel::supersede_view).
    pub replaced_in_turn: bool,
    /// The estimated tokens the newly opened view occupies.
    pub tokens: usize,
}

/// What [`supersede_view`](ContextModel::supersede_view) did to the copy of a selector that was
/// already open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ViewSupersede {
    /// Nothing carried this selector; the new view is simply appended.
    None,
    /// The previous copy had already been sent, so it was retagged as history in place and the new
    /// copy is appended at the tail.
    Retagged,
    /// The previous copy was pushed on this same turn and was removed outright; the new copy takes
    /// its index.
    ReplacedAt(usize),
}

/// Which position of the window a [`PromptItem`] was rendered from — the structure the
/// [rendered order](ContextModel::messages) imposes, made legible to a consumer that only ever
/// sees the flattened list.
///
/// The window is not one list: two of its three positions are **slots** that are assigned
/// rather than appended ([`set_system`](ContextModel::set_system) and
/// [`refresh_context_usage_signal`](ContextModel::refresh_context_usage_signal)), precisely so
/// they cannot accumulate duplicates. Which slot an item came from is otherwise unrecoverable
/// downstream, and it distinguishes two things that are identical on the wire: a system prompt
/// and a rebuilt context-usage signal are both [`System`](GgContextSource::System)-sourced,
/// both unlabelled and both pinned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptSlot {
    /// The [system-prompt slot](ContextModel::set_system), always first.
    System,
    /// The conversation thread itself — everything [pushed](ContextModel::push) into it, in
    /// the order it entered.
    Thread,
    /// The [context-usage signal](ContextModel::refresh_context_usage_signal) slot, rebuilt and
    /// re-assigned after every turn, always last.
    ContextUsage,
}

/// One item of the live window as [`prompt_items`](ContextModel::prompt_items) hands it to
/// the [message log](crate::message_log) and to [replay capture](crate::replay): the message
/// that is sent, the band it occupies, what it is estimated to cost, its
/// [selector tag](ContextItem::label), and the four typed fields describing *where in the
/// window model it came from*.
///
/// A borrowed, read-only view of a [`ContextItem`] rather than the item itself — both
/// consumers record what was *sent*, so neither needs the item's mutability.
///
/// # Why the window-model fields are here
///
/// [`slot`](Self::slot), [`retention`](Self::retention), [`turn`](Self::turn) and
/// [`region`](Self::region) are recoverable from **nowhere else** once a turn has gone out:
/// not from the rendered `Vec<Message>`, not from the telemetry stream, not from gg's raw
/// output. They are what lets a
/// [reconstruction](https://docs.testcabinet.ai/gg/analysis/replay-records/) compare the window
/// it *builds* against the one the record pinned — a drift in which items a compaction kept, or
/// which page of a file a view covers, is otherwise invisible until it changes what the model
/// says.
#[derive(Debug, Clone, Copy)]
pub struct PromptItem<'a> {
    /// The band this message occupies in the window this turn.
    pub source: GgContextSource,
    /// The message as the client will send it.
    pub message: &'a Message,
    /// The estimated tokens the message occupies.
    pub tokens: usize,
    /// The item's selector tag, when it carries one — a file view's workspace path, or the
    /// fullness signal's sentinel. This is what lets the console attribute a window's
    /// tokens to the *file* that filled it rather than only to the `file_view` band.
    pub label: Option<&'a str>,
    /// Which [slot](PromptSlot) of the window this item was rendered from.
    pub slot: PromptSlot,
    /// Whether the item survives a compaction boundary verbatim.
    pub retention: Retention,
    /// The [session turn](ContextModel::begin_turn) it was pushed on — `0` for everything
    /// seeded before the first turn.
    pub turn: u64,
    /// The `offset`/`limit` window a **paged** [file view](GgContextSource::FileView) covers,
    /// when this item is one and the read was paged.
    pub region: Option<FileRegion>,
}

/// Estimates the token cost of context items. A trait so the estimator is **swappable**:
/// the default is a real BPE tokenizer used as a cross-model approximation, but a later
/// phase can bind a per-model-family estimator without touching the [`ContextModel`].
///
/// `Send + Sync` so a shared `Arc<dyn TokenEstimator>` can back the async loop and be
/// handed to spawned subagents in later phases.
pub trait TokenEstimator: Send + Sync {
    /// Estimate the number of tokens `text` occupies. An approximation (see the module
    /// docs): exact per-provider counts are not available cross-provider.
    fn estimate_str(&self, text: &str) -> usize;

    /// Estimate the tokens a whole [`Message`] occupies — its content, the name and
    /// arguments of any tool calls, and a small fixed framing allowance. Provided in
    /// terms of [`estimate_str`](Self::estimate_str) so an implementation only supplies
    /// the raw-text estimate.
    fn estimate_message(&self, message: &Message) -> usize {
        let mut text = String::new();
        if let Some(content) = &message.content {
            text.push_str(content);
        }
        for call in &message.tool_calls {
            text.push_str(&call.name);
            text.push_str(&call.arguments.to_string());
        }
        if let Some(id) = &message.tool_call_id {
            text.push_str(id);
        }
        let images: usize = message
            .images
            .iter()
            .map(|image| estimate_image(image.bytes))
            .sum();
        MESSAGE_FRAMING_TOKENS + self.estimate_str(&text) + images
    }
}

/// Estimate the tokens an inline image of `bytes` occupies.
///
/// Not a `TokenEstimator` method, because an image is not text and no tokenizer can
/// answer it: every provider charges images by its own tiling of the decoded
/// **dimensions**, which gg does not decode. This is a deliberately coarse stand-in —
/// roughly the tile count a ~1024×1024 picture costs at the common ~750 tokens, scaled
/// by file size — and its job is only to keep an attached mockup from being accounted as
/// *free*, which would let a run's fullness figure drift below the truth and delay
/// compaction. It is floored so even a tiny icon is charged something.
pub fn estimate_image(bytes: u64) -> usize {
    /// Tokens charged per KiB of encoded image, chosen so a typical few-hundred-KB
    /// reference mockup lands in the high hundreds of tokens.
    const TOKENS_PER_KIB: u64 = 2;
    /// The floor: no image is cheaper than this, however small the file.
    const MIN_TOKENS: u64 = 85;
    ((bytes / 1024) * TOKENS_PER_KIB).max(MIN_TOKENS) as usize
}

/// The default [`TokenEstimator`]: a real BPE tokenizer (`o200k_base`, the base OpenAI's
/// GPT-4o/o-series models use) applied as a **documented cross-model approximation**.
///
/// Different providers tokenize differently and exact counts are not exposed
/// cross-provider, so gg counts with one fixed base and treats the result as an
/// estimate. The vocab is embedded in the `tiktoken-rs` crate (no network, no system
/// deps) and initialized once as a process-wide singleton, so constructing this
/// estimator is cheap.
#[derive(Debug, Clone, Copy, Default)]
pub struct BpeTokenEstimator;

impl BpeTokenEstimator {
    /// A new estimator over the `o200k_base` BPE.
    pub fn new() -> Self {
        Self
    }
}

impl TokenEstimator for BpeTokenEstimator {
    fn estimate_str(&self, text: &str) -> usize {
        if text.is_empty() {
            return 0;
        }
        // The singleton is lazily built from embedded vocab on first use; encoding
        // without special-token handling is the plain BPE token count.
        tiktoken_rs::o200k_base_singleton()
            .encode_ordinary(text)
            .len()
    }
}

/// A lightweight, dependency-free [`TokenEstimator`] approximating ~4 characters per
/// token. Deterministic and fast — used as an offline fallback and in tests where
/// building the BPE vocab would only add cost, not signal.
// A fallback/test estimator: not wired into the default production path (which uses the
// BPE estimator), so the binary build sees it as unconstructed.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Default)]
pub struct HeuristicTokenEstimator;

#[allow(dead_code)]
impl HeuristicTokenEstimator {
    /// A new heuristic estimator.
    pub fn new() -> Self {
        Self
    }
}

impl TokenEstimator for HeuristicTokenEstimator {
    fn estimate_str(&self, text: &str) -> usize {
        if text.is_empty() {
            return 0;
        }
        // ceil(chars / 4), a common rough token-count approximation.
        text.chars().count().div_ceil(4)
    }
}

/// What an [`evict_file_views`](ContextModel::evict_file_views) or
/// [`close_text_views`](ContextModel::close_text_views) call reclaimed: how many view items were
/// removed, the tokens they occupied, and the distinct selectors they showed (for the tool result
/// and telemetry `detail`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EvictionResult {
    /// The number of view items removed.
    pub items: usize,
    /// The estimated tokens the removed items occupied.
    pub tokens: u64,
    /// The distinct selectors of the removed views, in first-seen order — a
    /// [file view](GgContextSource::FileView)'s workspace path or a
    /// [text view](GgContextSource::TextView)'s label. A view whose selector was unknown (a
    /// malformed read, tagged `None`) contributes nothing here.
    pub paths: Vec<String>,
}

/// One thread item removed by [`archive_thread`](ContextModel::archive_thread), carrying the
/// [`source`](GgContextSource) band it had and the [`Message`] itself, so the loop can move it
/// into the searchable [archive](crate::archive::ArchiveStore).
#[derive(Debug, Clone)]
pub struct ArchivedItem {
    /// The context source the item was attributed to in the live window.
    pub source: GgContextSource,
    /// The message that was removed.
    pub message: Message,
}

/// What the [context-usage signal](ContextModel::refresh_context_usage_signal) may say, resolved
/// from the agent's own configuration and toolset.
///
/// The block only ever reports something the reading agent can *do* something about, so what it
/// contains is a function of what that agent was given rather than a fixed layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsageSignalOptions {
    /// Whether this agent has `evict_file_view`. On, the file-view category is broken down into the
    /// individual files behind it (which is the list eviction acts on); off, that breakdown is
    /// omitted entirely — a ranked list of reads it cannot drop is exactly the noise this block was
    /// rewritten to remove.
    pub can_evict: bool,
    /// Whether this agent has `archive_thread`, which decides whether the block closes by pointing at
    /// it — and, upstream of that, whether tool results carry
    /// [turn headers](ContextModel::turn_header) at all.
    pub can_archive: bool,
    /// How many individual files the file-view breakdown names, most expensive first. Configured per
    /// agent, because how many reads a window holds at once differs enormously between an agent that
    /// reads two specs and one crawling a codebase.
    pub top_file_views: usize,
}

/// An **inclusive** range of [session turns](ContextModel::begin_turn), the unit
/// [`archive_thread`](ContextModel::archive_thread) selects by.
///
/// Turn numbers are the ones the model reads off the [turn header](ContextModel::turn_header) on
/// every tool result, so `{ from: 3, to: 7 }` means exactly "the turns I can see numbered 3 through
/// 7" — no arithmetic, no counting backwards from the present, and no dependence on how many turns
/// have happened since.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TurnRange {
    /// The first turn in the range.
    pub from: u64,
    /// The last turn in the range, inclusive.
    pub to: u64,
}

impl TurnRange {
    /// Whether `turn` falls inside this range. A reversed range (`from > to`) contains nothing
    /// rather than being silently normalized — the parsers refuse one, so this only has to be
    /// harmless.
    pub fn contains(&self, turn: u64) -> bool {
        turn >= self.from && turn <= self.to
    }
}

/// What an [`archive_thread`](ContextModel::archive_thread) call removed: the archived items
/// (oldest first), the tokens reclaimed, and how many messages were dropped without being archived.
#[derive(Debug, Clone, Default)]
pub struct ArchiveResult {
    /// The removed thread items that went **into** the archive, in original order — the tool
    /// results of the archived turns.
    pub items: Vec<ArchivedItem>,
    /// The estimated tokens every removed item occupied, archived or dropped.
    pub tokens: u64,
    /// How many assistant messages were removed from the window **without** being archived (see
    /// [`archive_thread`](ContextModel::archive_thread)).
    pub dropped: usize,
    /// The turns that actually contributed something, ascending — what the tool result reports back,
    /// so a range naming turns that were already archived says so rather than reading as a success.
    pub turns: Vec<u64>,
}

/// The source-tagged, token-accounted model of a session's context window.
///
/// An ordered list of [`ContextItem`]s that (a) [renders](Self::messages) to the exact
/// `Vec<Message>` the client consumes, order-preserving; (b) reports a
/// [per-source breakdown](Self::breakdown_event) plus total and fullness; and (c) tracks
/// each item's [`Retention`] so compaction and eviction (Phase 2) have a clean seam.
///
/// Items are appended in the order they enter the conversation, so the rendered messages
/// match the Phase 0 transcript exactly (system, build prompt, then per turn the
/// assistant message followed by its tool results).
///
/// # Cloning is a deep copy of the window
///
/// [`Clone`] duplicates every item, the system-prompt and usage-signal slots and the turn counter,
/// and shares only the [estimator](TokenEstimator) — which is process-wide and stateless, so two
/// windows measured by it agree. It is what backs the [`history` module](crate::modules::HistoryModule)'s
/// [fork](crate::modules::Module::fork): the copy and the original diverge from the moment they
/// are made, and neither can see the other's pushes. Nothing in a `ContextModel` is shared
/// mutable state, so there is no "linked window" — see
/// [`HistoryModule::share`](crate::modules::HistoryModule) for why two agents cannot write one.
#[derive(Clone)]
pub struct ContextModel {
    /// The [system prompt](Self::set_system), held in a slot of its own rather than among the
    /// [`items`](Self::items) — see that method for why.
    system: Option<ContextItem>,
    /// The context items, in conversation order.
    items: Vec<ContextItem>,
    /// The estimator every pushed item is measured with.
    estimator: Arc<dyn TokenEstimator>,
    /// The active model's context-window limit, when known — the denominator of
    /// [`fullness`](Self::fullness).
    window_limit: Option<u64>,
    /// Whether this run is in [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE)
    /// mode, where every user message gg synthesizes is prefixed with a [heading](code_heading) so a
    /// model reading a plain-text transcript can tell the task from the program's output from a
    /// rebuilt state block. Off on the tool-calling path, where those distinctions are carried by the
    /// message role and the tool-call structure instead, and no heading is added.
    code_mode: bool,
    /// The [context-usage signal](Self::refresh_context_usage_signal), held in a slot of its own
    /// rather than among the [`items`](Self::items) — see that method for why.
    usage_signal: Option<ContextItem>,
    /// The session turn items are currently being pushed on, set by [`begin_turn`](Self::begin_turn).
    /// `0` until the first turn opens, which is what leaves the opening context unnumbered.
    turn: u64,
    /// Whether every tool result carries a [turn header](Self::turn_header) — on exactly when the
    /// agent can [archive](Self::archive_thread) turns, since the header exists to give it the turn
    /// numbers to name.
    turn_headers: bool,
}

impl ContextModel {
    /// A new, empty model measuring with `estimator` against an optional `window_limit`. `code_mode`
    /// arms the [per-message headings](code_heading) responses-as-code prefixes every synthesized
    /// user message with.
    pub fn new(
        estimator: Arc<dyn TokenEstimator>,
        window_limit: Option<u64>,
        code_mode: bool,
    ) -> Self {
        Self {
            system: None,
            items: Vec::new(),
            estimator,
            window_limit,
            code_mode,
            usage_signal: None,
            turn: 0,
            turn_headers: false,
        }
    }

    /// Arm the per-tool-result [turn headers](Self::turn_header).
    ///
    /// Called once, at setup, when the agent can [archive turns](Self::archive_thread): the header
    /// is what gives it the turn numbers to name and the per-result cost to choose between them, and
    /// without archival it would be a per-result tax on the window buying the model nothing.
    pub fn enable_turn_headers(&mut self) {
        self.turn_headers = true;
    }

    /// Open session turn `turn` — every item pushed from here until the next call is
    /// [tagged](ContextItem::turn) with it, and (when [armed](Self::enable_turn_headers)) every tool
    /// result pushed carries a header naming it.
    ///
    /// The number is the agent's **session** turn: it increases monotonically for the whole life of
    /// the agent and is never renumbered — not by a [compaction](Self::clear_ephemeral), not by an
    /// [archival](Self::archive_thread). A model that read `Turn #37` and later archived turns 12–20
    /// has to be naming the same turns it saw, and a counter that restarted at a compaction boundary
    /// would silently point that call at different material.
    pub fn begin_turn(&mut self, turn: u64) {
        self.turn = turn;
    }

    /// Append `message` as an item tagged with `source` and `retention`, estimating and
    /// caching its token cost. The generic entry point every convenience method routes
    /// through — and how later stages attach skills, memories, and tasks as pinned items.
    pub fn push(&mut self, source: GgContextSource, retention: Retention, message: Message) {
        self.push_labeled(source, retention, message, None);
    }

    /// Like [`push`](Self::push) but attaching a [`label`](ContextItem::label) selector tag —
    /// how agent-managed context tags a [`FileView`](GgContextSource::FileView) with its path
    /// and marks the fullness-signal item.
    pub fn push_labeled(
        &mut self,
        source: GgContextSource,
        retention: Retention,
        message: Message,
        label: Option<String>,
    ) {
        self.push_tagged(source, retention, message, label, None);
    }

    /// The one push every other one routes through: [`push_labeled`](Self::push_labeled) plus the
    /// [region](FileRegion) a paged [file view](Self::push_file_view) covers.
    fn push_tagged(
        &mut self,
        source: GgContextSource,
        retention: Retention,
        message: Message,
        label: Option<String>,
        region: Option<FileRegion>,
    ) {
        let message = self.headed(source, label.as_deref(), message);
        let tokens = self.estimator.estimate_message(&message);
        self.items.push(ContextItem {
            source,
            retention,
            message,
            tokens,
            label,
            region,
            turn: self.turn,
        });
    }

    /// Prefix a tool result's body with its **turn header** — the two lines that tell the model
    /// which [session turn](Self::begin_turn) produced this result and roughly what holding it costs:
    ///
    /// ```text
    /// Turn #123
    /// 1,234 tokens
    /// ----
    /// ```
    ///
    /// This is what makes [`archive_thread`](Self::archive_thread) usable. Without it the agent can
    /// see that its window is full but has no way to name *which* part of the thread to move out of
    /// it: the turns are unnumbered, and what each one costs is invisible. With it, "archive turns 4
    /// through 19" is a decision the model can make from what is in front of it.
    ///
    /// A no-op until the headers are [armed](Self::enable_turn_headers) and until the first turn has
    /// [opened](Self::begin_turn), so the opening context — the autoloaded specs and the file views
    /// [persistence](crate::persistence) re-opens — is not labelled with a turn that never happened.
    ///
    /// The token figure is the estimate of the result **without** its header, so the header does not
    /// have to account for itself; it understates the item by the header's own dozen or so tokens,
    /// which is well inside what "estimate" already means here.
    fn turn_header(&self, message: Message) -> Message {
        if !self.turn_headers || self.turn == 0 {
            return message;
        }
        let tokens = self.estimator.estimate_message(&message);
        let Message {
            role,
            content,
            tool_calls,
            tool_call_id,
            images,
        } = message;
        let header = format!(
            "Turn #{}\n{} tokens\n----\n",
            self.turn,
            thousands(tokens as u64)
        );
        Message {
            role,
            content: Some(format!("{header}{}", content.unwrap_or_default())),
            tool_calls,
            tool_call_id,
            images,
        }
    }

    /// Prefix a synthesized `user` message with its [code-mode heading](code_heading) when this run
    /// is in [code mode](Self::code_mode) — the transform every stored user message goes through, so
    /// what a code run sends, logs, and pools all carry the same headed body.
    ///
    /// A no-op off the code path, on a non-`user` message (the real system prompt and the assistant's
    /// own programs are never headed), and on a source with no heading. Applied at the single
    /// [`push_labeled`](Self::push_labeled) choke point rather than at render time so the heading is
    /// part of the message's identity: its token estimate accounts for it, its [message-log
    /// fingerprint](crate::message_log::fingerprint) is stable across the turns it is pooled over, and
    /// the append-only equality check ([`source_block_is`](Self::source_block_is)) — which heads the
    /// *incoming* candidate the same way — compares like against like.
    ///
    /// `label` is the item's selector tag, which qualifies the heading of the one source whose
    /// heading alone would not say *which* piece of material this is — see [`item_heading`].
    fn headed(&self, source: GgContextSource, label: Option<&str>, message: Message) -> Message {
        apply_code_heading(self.code_mode, source, label, message)
    }

    /// Bring the **mutable, single-block** `source` up to date with `message` (or with
    /// nothing, when `message` is `None`), so exactly one *live* block carries that source.
    ///
    /// This is how the loop keeps such a source in sync with its backing state — notably the
    /// [`TaskList`](GgContextSource::TaskList) block, which the model rewrites through the task
    /// tools as it works: each turn the loop rebuilds the block from the task store so the window
    /// always reflects the current plan (and
    /// [compaction](https://docs.testcabinet.ai/gg/compaction/) retains it). The rebuild must
    /// happen at a turn boundary (before this turn's assistant message and its tool results),
    /// never between an assistant tool-call message and the tool results answering it.
    ///
    /// The [`Memory`](GgContextSource::Memory) block goes through here too, but on a different
    /// schedule: it is rebuilt only at a compaction boundary, because between boundaries the
    /// model's own memory calls and their confirmations already tell it what it holds. See
    /// [`MemoriesRuntime::context_block`](crate::memories::MemoriesRuntime::context_block).
    ///
    /// # The rendered prompt only ever grows
    ///
    /// The rule this follows is that a turn's message list must **extend** the previous
    /// turn's, because that is the only thing a provider prompt cache can read: it serves a
    /// prefix of a request it has already seen, so any edit *behind* the end of the prompt
    /// costs the run everything after the edit. On a long run that is most of its token bill.
    /// Two rules together keep the render append-only:
    ///
    /// - **An unchanged block does not move.** When the rebuilt block is byte-identical to the
    ///   live one, this is a no-op and the existing item keeps its position, rather than being
    ///   lifted to the tail behind the history accumulated since. Re-appending an unchanged
    ///   block rewrites the prompt just before its end *every turn*, so no turn would ever
    ///   extend the last one.
    /// - **A changed block is superseded, not removed.** The live item is
    ///   [retagged](Self::supersede_source) as ordinary ephemeral
    ///   [`History`](GgContextSource::History) — left exactly where it sits, since deleting it
    ///   would invalidate every message after it — and the new block is appended at the tail.
    ///   Removing it instead would be at its most expensive precisely when the block had held
    ///   still longest, which is when the most history sits behind it.
    ///
    /// A superseded copy is the honest record of what the model was told at that point in the
    /// thread, no different from a tool result, and the model reads the newest block as
    /// current. It costs one block's worth of tokens per real change, is accounted as history
    /// rather than inflating the source's own band, and a compaction summarizes it away.
    pub fn replace_source(
        &mut self,
        source: GgContextSource,
        retention: Retention,
        message: Option<Message>,
    ) {
        if self.source_block_is(source, message.as_ref()) {
            return;
        }
        self.supersede_source(source);
        if let Some(message) = message {
            self.push(source, retention, message);
        }
    }

    /// Retag every item currently attributed to `source` as ordinary ephemeral
    /// [`History`](GgContextSource::History), in place.
    ///
    /// This is how a mutable block is retired without touching the rendered message list: the
    /// item keeps its position and its message, so the prompt is unchanged behind its end (see
    /// [`replace_source`](Self::replace_source)), while the source's own accounting band drops
    /// back to just its live block and the superseded copy becomes summarizable, evictable
    /// history like any other thread material.
    fn supersede_source(&mut self, source: GgContextSource) {
        for item in self.items.iter_mut().filter(|item| item.source == source) {
            item.source = GgContextSource::History;
            item.retention = Retention::Ephemeral;
            // The label was a selector for the live block (the fullness-signal sentinel); a
            // superseded copy must not answer to it.
            item.label = None;
        }
    }

    /// Whether `source` is already represented by exactly the single-block state
    /// `message` describes — one item carrying that exact message, or (for `None`) no item
    /// at all. The equality test [`replace_source`](Self::replace_source) uses to leave an
    /// unchanged block in place.
    fn source_block_is(&self, source: GgContextSource, message: Option<&Message>) -> bool {
        let mut live = self.items.iter().filter(|item| item.source == source);
        let current = live.next();
        // More than one item for this source is not the single-block shape, so fall through
        // to the rebuild that collapses it back to one.
        if live.next().is_some() {
            return false;
        }
        match (current, message) {
            (None, None) => true,
            // The stored block was headed at push, so the candidate is headed the same way before
            // the comparison — otherwise a code-mode block would never match its own rebuild and
            // would supersede every turn, thrashing the prompt cache the append-only rule protects.
            (Some(item), Some(message)) => {
                item.message == self.headed(source, None, message.clone())
            }
            _ => false,
        }
    }

    /// Set the [`System`](GgContextSource::System) prompt — the `system`-role message rendered
    /// **first** on every request this window produces.
    ///
    /// # It lives in a slot, not in the thread
    ///
    /// Exactly like the [context-usage signal](Self::refresh_context_usage_signal) at the other end
    /// of the window, and for the mirror-image reason. The signal is not conversation because it
    /// describes the window; the system prompt is not conversation because it describes the
    /// **agent** — its toolset, its roster, its ending calls, the prose for the capabilities *it*
    /// has. That is a property of whoever is holding the window this turn, not of the thread the
    /// window carries, and the two come apart the moment an agent hands its thread on:
    /// [`exec`](https://docs.testcabinet.ai/gg/fork-and-exec/), an [FSM](crate::fsm) edge and a
    /// fork all give a *different* profile the predecessor's conversation.
    ///
    /// Holding it as item 0 of the thread made that a thing the succession had to remember to undo,
    /// and got two things structurally wrong that a slot cannot get wrong at all:
    ///
    /// - **There can only ever be one.** A window carrying two `system`-role messages is not a
    ///   hypothetical: any of the ordinary in-thread rewrites (supersede-in-place, a re-seed onto a
    ///   window that already had one) leaves the stale text behind, still `system`-role, still sent.
    ///   A provider that flattens them — Anthropic's shape concatenates every system message into
    ///   one field — then hands the model one instruction block naming two toolsets, two rosters and
    ///   two sets of ending calls, half of which it does not have. Assigning a slot overwrites.
    /// - **It is never inherited.** A transferred window arrives [with the slot
    ///   cleared](crate::modules::HistoryModule), and the successor's loop sets its own before its
    ///   first turn. The predecessor's prompt cannot reach it, because it is not in what was
    ///   transferred.
    ///
    /// Nothing else moves: the thread behind it, the [turn counter](Self::begin_turn), the pinned
    /// blocks and the file views are untouched, and a successor re-setting a byte-identical prompt
    /// (an agent re-incarnating as itself) leaves the provider's cached prefix intact.
    pub fn set_system(&mut self, content: impl Into<String>) {
        let message = Message::system(content);
        let tokens = self.estimator.estimate_message(&message);
        self.system = Some(ContextItem {
            source: GgContextSource::System,
            retention: Retention::Pinned,
            message,
            tokens,
            label: None,
            region: None,
            turn: self.turn,
        });
    }

    /// Empty the [system-prompt slot](Self::set_system), leaving the thread untouched.
    ///
    /// What a window crossing to a **different holder** goes through, so the successor cannot be
    /// handed instructions written for the agent it succeeded — see
    /// [`HistoryModule::adopt`](crate::modules::HistoryModule).
    pub fn clear_system(&mut self) {
        self.system = None;
    }

    /// Seed the pinned [`UserPrompt`](GgContextSource::UserPrompt) (the build prompt).
    pub fn push_user_prompt(&mut self, content: impl Into<String>) {
        self.push(
            GgContextSource::UserPrompt,
            Retention::Pinned,
            Message::user(content),
        );
    }

    /// Re-point the [fullness](Self::fullness) denominator at a different model's context window.
    ///
    /// A property of the *holder's model*, not of the conversation, so it is re-resolved whenever
    /// a different agent adopts this window — an agent moving from a 1M-token model to a 32k one
    /// is over its window the instant it arrives, which is precisely the fact the successor's
    /// compaction check needs to see.
    #[allow(dead_code)] // re-resolved by `HistoryModule::adopt`, which a transfer reaches.
    pub fn set_window_limit(&mut self, limit: Option<u64>) {
        self.window_limit = limit;
    }

    /// Arm or disarm the [responses-as-code headings](code_heading) gg prefixes synthesized user
    /// messages with.
    ///
    /// Like the [window limit](Self::set_window_limit) this is a property of the holder — its
    /// execution mode — and is re-resolved on adoption. Note that the heading is baked into a
    /// message's **body** when it is pushed, so changing this affects only messages pushed after
    /// the change: a window that crosses from a code-mode agent to a tool-calling one keeps the
    /// headings on the messages it already carries, which is the honest record of what that model
    /// was actually shown.
    #[allow(dead_code)] // re-resolved by `HistoryModule::adopt`, which a transfer reaches.
    pub fn set_code_mode(&mut self, code_mode: bool) {
        self.code_mode = code_mode;
    }

    /// Move the window out, leaving an **empty** one with the same configuration (estimator,
    /// window limit, code mode, turn number, turn headers) behind.
    ///
    /// The [responses-as-code](crate::sandbox) turn needs the window *by value*: a program's calls
    /// run on a `spawn_blocking` thread and act on the live window there, so it is moved in and
    /// handed back. This is the seam that lets the loop do that while the window lives inside a
    /// [`ModuleSet`](crate::modules::ModuleSet) — the vacated model is a placeholder the loop
    /// overwrites the moment the turn returns, and on the one path it cannot come back (a host
    /// fault inside the sandbox) the loop ends the session without reading the window again.
    pub fn take(&mut self) -> ContextModel {
        let mut vacant = ContextModel::new(
            Arc::clone(&self.estimator),
            self.window_limit,
            self.code_mode,
        );
        vacant.turn_headers = self.turn_headers;
        vacant.turn = self.turn;
        std::mem::replace(self, vacant)
    }

    /// Record an assistant turn (its text and tool calls) as an ephemeral
    /// [`Assistant`](GgContextSource::Assistant) item.
    pub fn push_assistant(&mut self, text: Option<String>, tool_calls: Vec<ToolCall>) {
        self.push(
            GgContextSource::Assistant,
            Retention::Ephemeral,
            Message::assistant(text, tool_calls),
        );
    }

    /// Record a tool result answering `tool_call_id`, tagged with `source` (a file read
    /// is a [`FileView`](GgContextSource::FileView); other tools are
    /// [`ToolOutput`](GgContextSource::ToolOutput) — see [`tool_output_source`]). Tool
    /// results are ephemeral working material.
    pub fn push_tool_result(
        &mut self,
        source: GgContextSource,
        tool_call_id: impl Into<String>,
        content: impl Into<String>,
    ) {
        let message = self.turn_header(Message::tool_result(tool_call_id, content));
        self.push(source, Retention::Ephemeral, message);
    }

    /// Like [`push_tool_result`](Self::push_tool_result) but attaching `images` to the
    /// result — a `read_file` of a picture the model can see.
    pub fn push_tool_result_with_images(
        &mut self,
        source: GgContextSource,
        tool_call_id: impl Into<String>,
        content: impl Into<String>,
        images: Vec<ImageContent>,
    ) {
        let message =
            self.turn_header(Message::tool_result(tool_call_id, content).with_images(images));
        self.push(source, Retention::Ephemeral, message);
    }

    /// Record a `read_file` result as an ephemeral [`FileView`](GgContextSource::FileView)
    /// tagged with the file's `path`, so [agent-managed context](https://docs.testcabinet.ai/gg/agent-managed-context/)
    /// can target it with `evict_file_view { path }`. A file view whose path is unknown
    /// (a malformed call) is tagged `None` and is only reachable by a blanket eviction.
    ///
    /// `images` is what a read of a **reference mockup** carries. The picture is part of
    /// the same file view as its text, so `evict_file_view { path }` reclaims both, and
    /// the [image's estimated cost](estimate_image) is what gets reclaimed.
    ///
    /// `region` is the `offset`/`limit` window a **paged** read covered (`None` for a whole-file
    /// read), recorded so [agent persistence](Self::open_file_views) can re-open the view over the
    /// same lines.
    pub fn push_file_view(
        &mut self,
        path: Option<String>,
        region: Option<FileRegion>,
        tool_call_id: impl Into<String>,
        content: impl Into<String>,
        images: Vec<ImageContent>,
    ) {
        self.push_file_view_with_retention(
            path,
            region,
            tool_call_id,
            content,
            images,
            Retention::Ephemeral,
        );
    }

    /// Like [`push_file_view`](Self::push_file_view) but recording the view with an explicit
    /// [`Retention`]. An ordinary `read_file` is [`Ephemeral`](Retention::Ephemeral) working
    /// material; a **locked** [autoloaded specification](https://docs.testcabinet.ai/gg/autoload-specifications/)
    /// is [`Pinned`](Retention::Pinned) instead, so it is kept in the window verbatim across a
    /// [compaction](Self::compact_history) boundary (its `tool` message re-framed to a `user`
    /// message that carries its text *and* its image) and is spared by
    /// [`evict_file_views`](Self::evict_file_views).
    pub fn push_file_view_with_retention(
        &mut self,
        path: Option<String>,
        region: Option<FileRegion>,
        tool_call_id: impl Into<String>,
        content: impl Into<String>,
        images: Vec<ImageContent>,
        retention: Retention,
    ) {
        let message =
            self.turn_header(Message::tool_result(tool_call_id, content).with_images(images));
        self.push_tagged(GgContextSource::FileView, retention, message, path, region);
    }

    /// Drop every attached image from the window, re-estimating the items that carried
    /// one, and return how many messages were stripped.
    ///
    /// The recovery step when a provider turns out to refuse image input: the pictures
    /// go, the text and the `tool_call_id` pairing stay, and the turn can be re-run
    /// against the same conversation. Each stripped message additionally gains a line
    /// telling the model *why* its picture vanished, so the transcript stays coherent
    /// (a tool result that silently changed shape between turns would read as a glitch)
    /// and the model stops reading images it will never see.
    pub fn strip_images(&mut self, note: &str) -> usize {
        let mut stripped = 0;
        for item in &mut self.items {
            if !item.message.strip_images() {
                continue;
            }
            match &mut item.message.content {
                Some(content) => {
                    content.push_str("\n\n");
                    content.push_str(note);
                }
                slot @ None => *slot = Some(note.to_string()),
            }
            item.tokens = self.estimator.estimate_message(&item.message);
            stripped += 1;
        }
        stripped
    }

    /// Every item that is part of the live window, in the order it is sent: the
    /// [system prompt](Self::set_system), which is always first, then the conversation items, then
    /// the [context-usage signal](Self::refresh_context_usage_signal), which is always last.
    ///
    /// The two ends are slots rather than thread items, so their position is a property of this
    /// iterator rather than something the pushes have to maintain.
    fn window_items(&self) -> impl Iterator<Item = &ContextItem> {
        self.slotted_window_items().map(|(_, item)| item)
    }

    /// [`window_items`](Self::window_items), each item paired with the [slot](PromptSlot) it was
    /// rendered from.
    ///
    /// The window's order is defined **here**, once, and `window_items` drops the tags — rather
    /// than the two iterators chaining the same three sources side by side, where a later change
    /// to one could silently mis-tag every item of the other.
    fn slotted_window_items(&self) -> impl Iterator<Item = (PromptSlot, &ContextItem)> {
        self.system
            .iter()
            .map(|item| (PromptSlot::System, item))
            .chain(self.items.iter().map(|item| (PromptSlot::Thread, item)))
            .chain(
                self.usage_signal
                    .iter()
                    .map(|item| (PromptSlot::ContextUsage, item)),
            )
    }

    /// The items the window's **own** figures are computed over: the
    /// [system prompt](Self::set_system) and the conversation, but not the
    /// [context-usage signal](Self::refresh_context_usage_signal) — which reports those figures and
    /// so must not be one of them, or computing it would change them.
    fn accounted_items(&self) -> impl Iterator<Item = &ContextItem> {
        self.system.iter().chain(self.items.iter())
    }

    /// Render the model to the ordered `Vec<Message>` the client consumes — the faithful
    /// Phase 0 transcript: the system prompt, then the items in order, with the context-usage
    /// signal appended at the end.
    pub fn messages(&self) -> Vec<Message> {
        self.window_items()
            .map(|item| item.message.clone())
            .collect()
    }

    /// The per-item view of the current prompt for the [message log](crate::message_log) and
    /// for [replay capture](crate::replay): each item's [`source`](GgContextSource) band, its
    /// [`Message`], its cached token estimate, its [selector tag](ContextItem::label), and the
    /// [slot](PromptSlot), [retention](Retention), [turn](Self::begin_turn) and
    /// [region](FileRegion) it carries in the window model — in the order they are sent.
    /// This is the itemized form of [`messages`](Self::messages) — the same messages the
    /// client consumes, each carrying the band, token estimate, and tag the console needs
    /// to line a request's messages up with the per-source
    /// [breakdown](Self::breakdown_event) and attribute a file view to its path.
    ///
    /// The last four are the window-model fields a rendered message no longer carries; see
    /// [`PromptItem`] for why they are worth the width. The message log ignores them.
    ///
    /// The [context-usage signal](Self::refresh_context_usage_signal) is included, last, because it
    /// is part of the request that went out — a log that omitted it would not add up to the prompt
    /// the provider was billed for.
    pub fn prompt_items(&self) -> impl Iterator<Item = PromptItem<'_>> {
        self.slotted_window_items().map(|(slot, item)| PromptItem {
            source: item.source,
            message: &item.message,
            tokens: item.tokens,
            label: item.label.as_deref(),
            slot,
            retention: item.retention,
            turn: item.turn,
            region: item.region,
        })
    }

    /// Estimate the tokens `message` would occupy under this model's estimator — used to
    /// charge the assistant reply in the [message log](crate::message_log) with the same
    /// estimator the window's items are counted by, so the reply's figure is comparable to
    /// the request's.
    pub fn estimate(&self, message: &Message) -> usize {
        self.estimator.estimate_message(message)
    }

    /// The estimated total tokens across every item of the live window, the signal included.
    pub fn total_tokens(&self) -> u64 {
        self.window_items().map(|item| item.tokens as u64).sum()
    }

    /// The estimated tokens attributed to `source`.
    pub fn tokens_for(&self, source: GgContextSource) -> u64 {
        self.window_items()
            .filter(|item| item.source == source)
            .map(|item| item.tokens as u64)
            .sum()
    }

    /// Window fullness — `total_tokens / window_limit` — when a limit is known. May
    /// exceed `1.0` once the window is overflowing (the state compaction resolves).
    pub fn fullness(&self) -> Option<f64> {
        self.window_limit
            .and_then(|limit| (limit > 0).then(|| self.total_tokens() as f64 / limit as f64))
    }

    /// The per-source usage, one entry per [`GgContextSource`] in
    /// [`GgContextSource::ALL`] order (a source that contributed nothing is present with
    /// `0`), so the console's stacked graph keeps stable bands across turns.
    pub fn usage_by_source(&self) -> Vec<GgContextSourceUsage> {
        GgContextSource::ALL
            .iter()
            .map(|&source| GgContextSourceUsage {
                source,
                tokens: self.tokens_for(source),
            })
            .collect()
    }

    /// Assemble the [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) telemetry
    /// event for the current context — the per-source usage, the total, the window
    /// limit, and the fullness ratio.
    pub fn breakdown_event(&self) -> GgTelemetryKind {
        GgTelemetryKind::ContextBreakdown {
            by_source: self.usage_by_source(),
            total_tokens: self.total_tokens(),
            window_limit: self.window_limit,
            fullness: self.fullness(),
        }
    }

    /// Whether the model holds any [`Ephemeral`](Retention::Ephemeral) item — the
    /// history [compaction](https://docs.testcabinet.ai/gg/compaction/) would summarize.
    /// Compaction is a no-op with none (there is nothing to reclaim), so the loop only
    /// fires it when this is `true`.
    pub fn has_ephemeral(&self) -> bool {
        self.items.iter().any(|item| !item.retention.is_pinned())
    }

    /// Drop every [`Ephemeral`](Retention::Ephemeral) item, keeping the pinned prefix verbatim
    /// and re-framing any pinned `tool`-role item to a standalone `user` message — the shared
    /// **context-reset primitive** behind
    /// [compaction](crate::compaction::apply_compaction), which then seeds the files the model
    /// asked to keep and appends the summary.
    ///
    /// The pinned prefix (the build prompt, read skills, in-play memories, the task list, and the
    /// epic/issue board) is retained unchanged and in order; all ephemeral thread material
    /// (assistant turns, tool output, file views, process guidance, and any prior summary) is
    /// dropped. The [system prompt](Self::set_system) is not a thread item at all, so it survives
    /// a reset by not being part of one.
    ///
    /// A retained skill body is pinned as the `tool` result that answered its `read_skill`
    /// call; once the assistant turn that made that call is dropped, that `tool` message would
    /// dangle (a provider requires a `tool` message to follow the assistant `tool_calls` it
    /// answers). So a retained `tool`-role item is re-framed as a standalone `user` message
    /// carrying the **identical body** — the retained content is verbatim; only the message
    /// envelope changes so the post-reset sequence is valid. Any **attached image** the item
    /// carried travels with it (a locked, autoloaded reference mockup is pinned as an image
    /// `tool` result, and a `user` message carries images just as a `tool` result does), so a
    /// picture kept across a compaction boundary stays a picture rather than degrading to its
    /// caption. Its [`source`](GgContextSource) tag (and thus its accounting band) is
    /// unchanged, and its token estimate is recomputed for the new envelope.
    pub fn clear_ephemeral(&mut self) {
        // The context-usage signal describes the window as it stood *before* the reset, so carrying
        // it across would leave the model reading a fullness figure for a window that no longer
        // exists. It is rebuilt from the post-reset window at the next turn boundary.
        self.usage_signal = None;
        let estimator = Arc::clone(&self.estimator);
        let code_mode = self.code_mode;
        self.items.retain(|item| item.retention.is_pinned());
        for item in &mut self.items {
            if item.message.role == Role::Tool {
                let content = item.message.content.take().unwrap_or_default();
                let images = std::mem::take(&mut item.message.images);
                // The re-framed item is now a `user` message, so under code mode it earns the same
                // heading a `user` block of its source would have carried had it been pushed as one
                // (its `tool` form was headingless because only `user` messages are headed).
                let message = apply_code_heading(
                    code_mode,
                    item.source,
                    item.label.as_deref(),
                    Message::user(content).with_images(images),
                );
                item.tokens = estimator.estimate_message(&message);
                item.message = message;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Agent-managed context: the context-usage signal, file-view eviction, and
    // thread archival.
    // -----------------------------------------------------------------------

    /// Rebuild the **context-usage signal** — the block telling the agent how full its window is and
    /// which categories (and which *files*) are filling it — from the *current* window state, so the
    /// model acts each turn on figures that are true this turn (the model-facing half of
    /// [agent-managed context](https://docs.testcabinet.ai/gg/agent-managed-context/)).
    ///
    /// A no-op when no window limit is known: there is no fullness to report against.
    ///
    /// # It lives in a slot, not in the thread
    ///
    /// The signal is held in a **single slot** appended after every conversation item rather than
    /// pushed into them, and that is what makes it correct on both counts it used to get wrong:
    ///
    /// - **There can only ever be one.** As a thread item it had to be retired in place each turn
    ///   (deleting from the middle of a prompt invalidates everything after it), so every refresh
    ///   left the previous line behind as history — and being *pinned*, the live one also crossed
    ///   every [compaction](Self::clear_ephemeral) boundary, so a compacted window opened with a
    ///   stale reading and then gained a second one. A slot cannot accumulate: assigning it
    ///   overwrites, and [`clear_ephemeral`](Self::clear_ephemeral) empties it.
    /// - **The prompt stays append-only anyway.** Everything a provider's prompt cache reads — the
    ///   whole conversation — sits *before* the signal, so rewriting the signal every turn only ever
    ///   changes the last message. The old design had to round its figures to hold its position;
    ///   this one can report them exactly.
    pub fn refresh_context_usage_signal(&mut self, options: UsageSignalOptions) {
        let Some(text) = self.context_usage_text(options) else {
            return;
        };
        let message = Message::system(text);
        let tokens = self.estimator.estimate_message(&message);
        self.usage_signal = Some(ContextItem {
            source: GgContextSource::System,
            retention: Retention::Pinned,
            message,
            tokens,
            label: None,
            region: None,
            turn: self.turn,
        });
    }

    /// The text of the [context-usage signal](Self::refresh_context_usage_signal) for the current
    /// window, or `None` when no window limit is known.
    ///
    /// It reports the share of the window each [source](GgContextSource) holds, as a percentage —
    /// and, when the agent can act on it, breaks the file-view band down into the
    /// [`top_file_views`](UsageSignalOptions::top_file_views) individual files inside it.
    ///
    /// **Why percentages of named categories, and why files.** The line this replaces reported raw
    /// token counts for the two or three largest bands, which is a number the agent could read but
    /// not use: most of what it named — the system prompt, the build prompt, the task list — is not
    /// something the agent is able to reclaim, so being told they are large is noise. What it can act
    /// on is precisely the file views it has open (`evict_file_view { path }` takes a path, so the
    /// per-*file* split is the actionable unit) and its own thread (`archive_thread`). Reporting
    /// every category as a share of the window says how much of the problem each one *is*, and the
    /// nested file list says which reads to drop first.
    ///
    /// The figures are computed over the [accounted items](Self::accounted_items) — the system
    /// prompt and the conversation — with the signal's own cost excluded, so the block never
    /// accounts for itself and computing it is idempotent.
    fn context_usage_text(&self, options: UsageSignalOptions) -> Option<String> {
        let limit = self.window_limit?;
        if limit == 0 {
            return None;
        }
        let percent = |tokens: u64| format!("{:.1}%", (tokens as f64 / limit as f64) * 100.0);
        let total: u64 = self.accounted_items().map(|item| item.tokens as u64).sum();

        // One entry per source that is actually holding something, in `GgContextSource::ALL` order
        // so the block reads the same way from turn to turn. A category at zero is left out rather
        // than listed as `0.0%`: the point of the block is where the window is going.
        let categories: Vec<UsageCategoryView> = GgContextSource::ALL
            .iter()
            .filter_map(|&source| {
                let tokens: u64 = self
                    .accounted_items()
                    .filter(|item| item.source == source)
                    .map(|item| item.tokens as u64)
                    .sum();
                if tokens == 0 {
                    return None;
                }
                Some(UsageCategoryView {
                    label: source_label(source).to_string(),
                    percent: percent(tokens),
                    // Only the file-view band breaks down further, and only for an agent that can
                    // evict: naming the files to an agent with no `evict_file_view` is a list it
                    // cannot act on, which is the defect this whole block exists to fix.
                    top_files: if source == GgContextSource::FileView && options.can_evict {
                        self.top_file_views(options.top_file_views)
                            .into_iter()
                            .map(|(path, tokens)| UsageFileView {
                                path,
                                percent: percent(tokens),
                            })
                            .collect()
                    } else {
                        Vec::new()
                    },
                })
            })
            .collect();

        Some(prompts::render_context_pressure(&ContextPressureContext {
            overall: percent(total),
            categories,
            can_evict: options.can_evict,
            can_archive: options.can_archive,
        }))
    }

    /// The `limit` most expensive **evictable** file views, as `(path, tokens)` pairs, largest first
    /// — the per-file breakdown of the file-view band.
    ///
    /// Views of the same path are summed, because `evict_file_view { path }` reclaims all of them at
    /// once: reporting three reads of one file as three entries would understate what dropping it
    /// buys. A [pinned](Retention::Pinned) view (a locked, autoloaded specification) is excluded —
    /// eviction is exactly what locking prevents — and so is a view whose path is unknown, which no
    /// targeted call could name.
    fn top_file_views(&self, limit: usize) -> Vec<(String, u64)> {
        let mut totals: Vec<(String, u64)> = Vec::new();
        for item in &self.items {
            if item.source != GgContextSource::FileView || item.retention.is_pinned() {
                continue;
            }
            let Some(path) = item.label.as_deref() else {
                continue;
            };
            match totals.iter_mut().find(|(seen, _)| seen == path) {
                Some((_, tokens)) => *tokens += item.tokens as u64,
                None => totals.push((path.to_string(), item.tokens as u64)),
            }
        }
        // Descending by cost; ties keep first-read order, so the list is deterministic.
        totals.sort_by_key(|&(_, tokens)| std::cmp::Reverse(tokens));
        totals.truncate(limit);
        totals
    }

    /// The [file views](GgContextSource::FileView) currently **open** in the window — each path the
    /// agent has read and still has in front of it, with the [region](FileRegion) the read covered —
    /// in the order they were opened, with exact duplicates collapsed.
    ///
    /// What [agent persistence](test_cabinet_core::gg::CAPABILITY_AGENT_PERSISTENCE) records against a
    /// profile when one of its instances finishes, so the next instance can re-open the same desk.
    /// Two deliberate exclusions:
    ///
    /// - A [`Pinned`](Retention::Pinned) view is **not** reported. The only pinned views are **locked**
    ///   [autoloaded specifications](https://docs.testcabinet.ai/gg/autoload-specifications/), which
    ///   the next instance's own autoload re-seeds — reporting them would have persistence re-open,
    ///   as ordinary evictable reads, files the capability that put them there is about to pin again.
    /// - A view whose path is unknown (a malformed call, tagged `None`) is not reported either: there
    ///   is nothing to re-open.
    pub fn open_file_views(&self) -> Vec<OpenFileView> {
        let mut open: Vec<OpenFileView> = Vec::new();
        for item in &self.items {
            if item.source != GgContextSource::FileView || item.retention.is_pinned() {
                continue;
            }
            let Some(path) = item.label.clone() else {
                continue;
            };
            let view = OpenFileView {
                path,
                region: item.region,
            };
            if !open.contains(&view) {
                open.push(view);
            }
        }
        open
    }

    /// Evict [`FileView`](GgContextSource::FileView) items from the live window, reclaiming
    /// their tokens — safe because the agent can re-read a file at any time. With `path`
    /// `Some`, only views of that workspace path are removed; with `None`, **every** file view
    /// is removed. Returns what was reclaimed (count, tokens, and the distinct paths), for the
    /// tool result and the [`ContextManaged`](test_cabinet_core::gg::GgTelemetryKind::ContextManaged)
    /// telemetry. The next [breakdown](Self::breakdown_event) shows the file-view band drop.
    ///
    /// A [`Pinned`](Retention::Pinned) file view — a **locked**
    /// [autoloaded specification](https://docs.testcabinet.ai/gg/autoload-specifications/) — is
    /// spared even by a blanket `None` eviction: locking it means it is kept in the window, and
    /// eviction is exactly the removal locking exists to prevent. Ordinary file reads are
    /// ephemeral and evict as before.
    pub fn evict_file_views(&mut self, path: Option<&str>) -> EvictionResult {
        self.remove_views(GgContextSource::FileView, path)
    }

    /// Remove the items of one **view band** from the live window, reclaiming their tokens: the
    /// shared body of [`evict_file_views`](Self::evict_file_views) and
    /// [`close_text_views`](Self::close_text_views).
    ///
    /// One implementation rather than two copies, because the two must agree on every rule they
    /// share — the pinned carve-out, the targeted/blanket split, the first-seen selector list — and
    /// a divergence between them would show up as a band that quietly refuses to shrink.
    ///
    /// A [`Pinned`](Retention::Pinned) item is spared even by a blanket `None` removal: pinning is
    /// exactly what says an item is kept in the window, and removal is what pinning prevents.
    fn remove_views(&mut self, source: GgContextSource, selector: Option<&str>) -> EvictionResult {
        let mut result = EvictionResult::default();
        self.items.retain(|item| {
            if item.source != source {
                return true;
            }
            // A locked (pinned) autoloaded spec is kept in the window by definition — eviction
            // does not touch it.
            if item.retention.is_pinned() {
                return true;
            }
            // A targeted removal spares views with a different selector.
            if let Some(wanted) = selector
                && item.label.as_deref() != Some(wanted)
            {
                return true;
            }
            result.items += 1;
            result.tokens += item.tokens as u64;
            if let Some(label) = &item.label
                && !result.paths.contains(label)
            {
                result.paths.push(label.clone());
            }
            false
        });
        result
    }

    /// Archive the named **[turn](Self::begin_turn) ranges** out of the live window: every eligible
    /// item whose turn falls inside any of `ranges` is removed, the tool results among them are
    /// returned (for the caller to move into the searchable
    /// [archive](crate::archive::ArchiveStore)), and their tokens are reclaimed.
    ///
    /// **Selection model.** Ranges are **inclusive** on both ends and name the turn numbers the model
    /// reads off each result's [turn header](Self::turn_header), so `{from: 4, to: 19}` is exactly
    /// "the turns I can see numbered 4 to 19". They may be given in any order and may overlap; an
    /// item is removed if any range contains it. Only [`Ephemeral`](Retention::Ephemeral) items are
    /// eligible, so the pinned prefix (the build prompt, read skills, memories, the task list, the
    /// board) is never touched however wide a range is — and neither are the
    /// [system prompt](Self::set_system) or the
    /// [context-usage signal](Self::refresh_context_usage_signal), which are not thread items at all.
    ///
    /// **Only the results are kept.** An archived turn's [`Assistant`](GgContextSource::Assistant)
    /// message is removed from the window but **not** written to the archive; everything else in the
    /// turn is. What is worth recovering later is what the turn *found* — the file it read, the
    /// command's output, the error — not the model's own narration of what it was about to do, which
    /// is the half of the thread that ages worst and would otherwise be what a `search_archive` query
    /// mostly matched.
    pub fn archive_thread(&mut self, ranges: &[TurnRange]) -> ArchiveResult {
        let mut result = ArchiveResult::default();
        if ranges.is_empty() {
            return result;
        }
        self.items.retain(|item| {
            if item.retention.is_pinned() || !ranges.iter().any(|range| range.contains(item.turn)) {
                return true;
            }
            result.tokens += item.tokens as u64;
            if let Err(at) = result.turns.binary_search(&item.turn) {
                result.turns.insert(at, item.turn);
            }
            if item.source == GgContextSource::Assistant {
                result.dropped += 1;
            } else {
                result.items.push(ArchivedItem {
                    source: item.source,
                    message: item.message.clone(),
                });
            }
            false
        });
        result
    }
}

// The view surface the responses-as-code sandbox membrane drives: `LoopToolApi` services a
// program's `view.*` calls against the window it holds by value for the turn.
impl ContextModel {
    /// Close [`TextView`](GgContextSource::TextView) items from the live window, reclaiming their
    /// tokens. With `label` `Some`, only the view keyed by that label is closed; with `None`,
    /// **every** text view is. Returns what was reclaimed, for the tool result and the
    /// [`ContextManaged`](test_cabinet_core::gg::GgTelemetryKind::ContextManaged) telemetry, which
    /// reports it as [`CloseTextViews`](test_cabinet_core::gg::GgContextAction::CloseTextViews).
    ///
    /// The mirror of [`evict_file_views`](Self::evict_file_views) — the same removal, the same
    /// sparing of [`Pinned`](Retention::Pinned) items, over the other band — but **not** the same
    /// trade for the agent making it. An evicted file view is recoverable: the file is unchanged on
    /// disk and a re-read re-opens it. A closed text view held the agent's only copy of something it
    /// composed, so closing one discards it unless the agent wrote it down somewhere. That
    /// difference is why the two are separate calls and separate telemetry actions rather than one
    /// `close_view` over both bands.
    pub fn close_text_views(&mut self, label: Option<&str>) -> EvictionResult {
        self.remove_views(GgContextSource::TextView, label)
    }

    /// Open (or re-open) the [text view](GgContextSource::TextView) keyed by `label`: agent-composed
    /// material — a computed summary, a diff, a table, a subagent's answer — pushed into the window
    /// as its own attributable item.
    ///
    /// This is the counterpart of one tool result per tool call for a
    /// [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) program, which has no
    /// tool calls to attach material to. Re-opening the same `label`
    /// [supersedes](Self::supersede_view) the copy that was there: `openText` names an **intent** —
    /// *this should be visible* — and re-stating an intent replaces it, so a program that recomputes
    /// a summary in a loop leaves one view behind rather than one per iteration.
    ///
    /// # Envelope
    ///
    /// Pushed as a `user` message, never as a `tool` result. A code turn's assistant message carries
    /// **no** `tool_calls` at all, so a `tool`-role message would quote a call id that dangles from
    /// the moment it is pushed and an OpenAI-shaped provider rejects the whole request — the same
    /// constraint that makes `pin_read_skill` and compaction's file re-seed use a `user` envelope.
    /// Under code mode the body is headed `View: {label}` so the model can tell its views apart.
    ///
    /// The view is [`Ephemeral`](Retention::Ephemeral): it is the agent's own working material, it
    /// can be [closed](Self::close_text_views), and a
    /// [compaction](https://docs.testcabinet.ai/gg/compaction/) drops it like any other ephemeral
    /// item.
    pub fn open_text_view(&mut self, label: String, body: String) -> ViewOpened {
        let superseded = self.supersede_view(GgContextSource::TextView, &label, None);
        let item = self.view_item(GgContextSource::TextView, Message::user(body), label, None);
        self.place_view(item, superseded)
    }

    /// Open (or re-open) the [file view](GgContextSource::FileView) keyed by `(path, region)` —
    /// what a program's `view.openFile` pushes, and the one place the code path deliberately *does*
    /// put a file in the window.
    ///
    /// # The key is `(path, region)`, and why
    ///
    /// Two pages of one file are two views and must coexist: opening `a.ts` at `offset 1` and again
    /// at `offset 201` is a program paging through a file, not a program changing its mind.
    /// Re-opening the **same** page [supersedes](Self::supersede_view) it. `region` is `None` for a
    /// whole-file read ([`FileRegion::covered`]), so a whole-file view and a paged view of the same
    /// file are distinct keys and the whole-file one supersedes itself on re-read.
    ///
    /// Closing, by contrast, is by **path**: [`evict_file_views`](Self::evict_file_views) drops
    /// every page of it. That asymmetry is deliberate and is the established eviction semantics —
    /// an agent that wants a file gone wants the whole file gone.
    ///
    /// # It supersedes; a native `read_file` does not
    ///
    /// [`push_file_view`](Self::push_file_view) appends a fresh view per read, because a
    /// `read_file` result is a snapshot of the file *as it was read* and naming an **action** is
    /// what that tool does. `view.openFile` names an intent, so it supersedes. Only this path
    /// changed; the native one is untouched.
    ///
    /// `images` is what a read of a reference mockup carries — a picture is not a third view kind,
    /// it is a file view of an image file — and rides in the same item as the text, so closing the
    /// path reclaims both.
    pub fn open_file_view_deduped(
        &mut self,
        path: String,
        region: Option<FileRegion>,
        content: String,
        images: Vec<ImageContent>,
    ) -> ViewOpened {
        let superseded = self.supersede_view(GgContextSource::FileView, &path, region);
        let item = self.view_item(
            GgContextSource::FileView,
            Message::user(content).with_images(images),
            path,
            region,
        );
        self.place_view(item, superseded)
    }

    /// Build the [`ContextItem`] a view is pushed as: [headed](Self::headed) for its selector,
    /// measured, tagged with the current [turn](Self::begin_turn), and always
    /// [`Ephemeral`](Retention::Ephemeral).
    ///
    /// Both kinds are ephemeral without exception. A view is material the agent chose to hold in
    /// front of itself *now*; the pinned classes are the ones gg keeps on the agent's behalf (the
    /// prompts, read skills, memories, the task list, a locked autoloaded specification), and a view
    /// the agent could not reclaim would be a hole in the accounting this feature exists to give it.
    fn view_item(
        &self,
        source: GgContextSource,
        message: Message,
        selector: String,
        region: Option<FileRegion>,
    ) -> ContextItem {
        let message = self.headed(source, Some(&selector), message);
        let tokens = self.estimator.estimate_message(&message);
        ContextItem {
            source,
            retention: Retention::Ephemeral,
            message,
            tokens,
            label: Some(selector),
            region,
            turn: self.turn,
        }
    }

    /// Put a freshly built view `item` into the window, honouring what
    /// [`supersede_view`](Self::supersede_view) did to the copy it replaces, and report the result.
    fn place_view(&mut self, item: ContextItem, superseded: ViewSupersede) -> ViewOpened {
        let tokens = item.tokens;
        match superseded {
            // The copy this replaces was removed from `index`, so the new one takes the position it
            // held: a program looping over a set of views re-opens them in a stable order rather
            // than rotating the tail of its own window every iteration.
            ViewSupersede::ReplacedAt(index) => self.items.insert(index, item),
            _ => self.items.push(item),
        }
        ViewOpened {
            superseded: !matches!(superseded, ViewSupersede::None),
            replaced_in_turn: matches!(superseded, ViewSupersede::ReplacedAt(_)),
            tokens,
        }
    }

    /// Retire whatever is already open under `(source, selector, region)` so the caller can push a
    /// fresh copy, and report which of the two ways it did that.
    ///
    /// # Why re-opening supersedes at all
    ///
    /// The window renders as an append-only prompt, and superseding — rather than editing in place
    /// — is how a mutable block is retired without invalidating everything after it (see
    /// [`replace_source`](Self::replace_source)). A view re-opened under the same selector is
    /// exactly that shape: one live copy, an honest record of what the model was told before it.
    ///
    /// # The two cases
    ///
    /// - **The existing copy was pushed on an earlier turn.** It has been sent, and a provider has
    ///   cached the prefix containing it, so removing it would cost the run every cached token
    ///   after its position. It stays where it is, retagged to
    ///   [`History`](GgContextSource::History) + [`Ephemeral`](Retention::Ephemeral) with its
    ///   selector cleared — precisely what [`supersede_source`](Self::supersede_source) does to a
    ///   mutable block — and the new copy is appended at the tail.
    /// - **The existing copy was pushed on the current turn** (`turn == self.turn`): the same
    ///   program opened it moments ago and *nothing has been sent*. There is no cached prefix to
    ///   protect and no history worth recording, so it is removed outright. A program that refines
    ///   a view in a loop must not leave a corpse per iteration — that would make the precise
    ///   accounting this feature exists to deliver worse than the anonymous blob it replaced. A view
    ///   opened and then closed inside one program therefore reaches the window not at all.
    ///
    /// The region is part of the key, so a paged view supersedes only the same page. Older copies
    /// beyond the newest — which only a native `read_file` can leave, since every view open
    /// supersedes — are retagged too: they show the same material and leaving them in the band would
    /// double-count it.
    ///
    /// A [`Pinned`](Retention::Pinned) copy is not a candidate at all. The only pinned views are
    /// **locked** [autoloaded specifications](https://docs.testcabinet.ai/gg/autoload-specifications/),
    /// and retagging one out of its band is the removal locking exists to prevent; re-opening such a
    /// path appends an ordinary evictable view beside it instead.
    fn supersede_view(
        &mut self,
        source: GgContextSource,
        selector: &str,
        region: Option<FileRegion>,
    ) -> ViewSupersede {
        let matches: Vec<usize> = self
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| {
                item.source == source
                    && !item.retention.is_pinned()
                    && item.label.as_deref() == Some(selector)
                    && item.region == region
            })
            .map(|(index, _)| index)
            .collect();
        let Some((&newest, older)) = matches.split_last() else {
            return ViewSupersede::None;
        };
        for &index in older {
            self.retire_view(index);
        }
        if self.items[newest].turn == self.turn {
            self.items.remove(newest);
            return ViewSupersede::ReplacedAt(newest);
        }
        self.retire_view(newest);
        ViewSupersede::Retagged
    }

    /// Retag the item at `index` as ordinary ephemeral [`History`](GgContextSource::History) in
    /// place, dropping its selector — the per-item form of
    /// [`supersede_source`](Self::supersede_source).
    ///
    /// The [region](FileRegion) goes with the label: it only ever qualifies a selector, and a
    /// region on an item nothing can select is a fragment of a key that no longer exists.
    fn retire_view(&mut self, index: usize) {
        let item = &mut self.items[index];
        item.source = GgContextSource::History;
        item.retention = Retention::Ephemeral;
        item.label = None;
        item.region = None;
    }

    /// Every view **open** in the window, in the order it was opened — what backs the model-facing
    /// `view.current()`.
    ///
    /// Views sharing a selector *and* a region are reported as one entry carrying their combined
    /// cost, because that is what closing the selector reclaims. (Only a native `read_file` can
    /// produce such a pair; the view API supersedes instead.)
    ///
    /// A [`Pinned`](Retention::Pinned) view is left out, for the same reason
    /// [`open_file_views`](Self::open_file_views) and [`top_file_views`](Self::top_file_views) leave
    /// it out: this is the list `view.close` acts on, and a locked autoloaded specification cannot
    /// be closed. Offering the model an entry whose close silently reclaims nothing is worse than
    /// not listing it.
    pub fn open_views(&self) -> Vec<OpenViewInfo> {
        let mut open: Vec<OpenViewInfo> = Vec::new();
        for item in &self.items {
            if item.retention.is_pinned() {
                continue;
            }
            let kind = match item.source {
                GgContextSource::FileView => ViewKind::File,
                GgContextSource::TextView => ViewKind::Text,
                _ => continue,
            };
            // A view whose selector is unknown (a malformed native read) is unnameable, so there is
            // nothing useful to report about it.
            let Some(selector) = item.label.clone() else {
                continue;
            };
            match open.iter_mut().find(|view| {
                view.kind == kind && view.selector == selector && view.region == item.region
            }) {
                Some(existing) => existing.tokens += item.tokens as u64,
                None => open.push(OpenViewInfo {
                    kind,
                    selector,
                    tokens: item.tokens as u64,
                    region: item.region,
                }),
            }
        }
        open
    }

    /// The [text views](GgContextSource::TextView) currently open, **with their bodies**, newest
    /// copy per label — what [agent persistence](crate::persistence) records against a profile so
    /// the next instance can be handed back what this one had composed.
    ///
    /// The bodies are here on purpose, and the contrast with
    /// [`open_file_views`](Self::open_file_views) is the whole reason: that one records a
    /// *reference* because a file's on-disk truth can move under a stored snapshot, so replaying
    /// the bytes would show the next instance a file that no longer says that. A text view has no
    /// on-disk truth to go stale against — the window is the only copy — so a reference would
    /// restore nothing at all.
    ///
    /// The body is reported as the agent supplied it, without the `View: {label}` heading the window
    /// prefixes it with, so re-opening it through [`open_text_view`](Self::open_text_view)
    /// reproduces the same item rather than heading it twice.
    pub fn open_text_views(&self) -> Vec<OpenTextView> {
        let mut open: Vec<OpenTextView> = Vec::new();
        for item in &self.items {
            if item.source != GgContextSource::TextView {
                continue;
            }
            let Some(label) = item.label.clone() else {
                continue;
            };
            let body = text_view_body(item);
            match open.iter_mut().find(|view| view.label == label) {
                // Superseding retags the older copy out of this band, so a duplicate label here is
                // not reachable today; the newest copy wins if one ever is.
                Some(existing) => existing.body = body,
                None => open.push(OpenTextView { label, body }),
            }
        }
        open
    }
}

/// The model-facing **heading** a synthesized `user` message of `source` carries under
/// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE), or `None` for a source
/// whose messages are never headed.
///
/// On the code path every model reply is a program and everything gg says back is plain-text `user`
/// content, so — unlike the tool-calling path, where a tool result is structurally distinct from the
/// task — the model has only the prose to tell the task from a program's output from a rebuilt state
/// block. The heading is that signal: gg prefixes each user message with `<heading>\n----\n`, and the
/// [system prompt](crate::prompts) names every heading a run's enabled capabilities can produce so
/// the model knows the vocabulary up front.
///
/// [`Assistant`](GgContextSource::Assistant) is `None` because an assistant turn is the model's own
/// program, never gg's synthesis; [`System`](GgContextSource::System) maps to a heading for the
/// process *notices* pushed as `user` guidance, but the base system prompt and the context-usage
/// signal are `system`-role and so are never headed regardless.
///
/// The strings are the closed vocabulary the prompt documents, so a new source must be given a
/// heading here and listed there in the same change.
pub fn code_heading(source: GgContextSource) -> Option<&'static str> {
    match source {
        GgContextSource::UserPrompt => Some("Task"),
        GgContextSource::ToolOutput => Some("Output"),
        GgContextSource::FileView => Some("File"),
        GgContextSource::TextView => Some("View"),
        GgContextSource::Skill => Some("Documentation"),
        GgContextSource::Memory => Some("Memories"),
        GgContextSource::TaskList => Some("Tasks"),
        GgContextSource::Board => Some("Board"),
        GgContextSource::History => Some("Summary"),
        GgContextSource::System => Some("Notice"),
        GgContextSource::Assistant => None,
    }
}

/// The full heading an item of `source` carrying the selector tag `label` is prefixed with — the
/// [word](code_heading) for its band, qualified by the selector for the one band where the word
/// alone is not enough to say *which* piece of material the body is.
///
/// A [`TextView`](GgContextSource::TextView) is that band. Its selector is the only thing telling
/// two of them apart: the bodies are whatever the agent composed, and a window holding four of them
/// under four identical `View` headings would be four anonymous blocks the model could neither
/// match to its own `view.openText` calls nor name in a `view.close`. So a text view reads
/// `View: {label}`.
///
/// Every other band keeps the bare word, including [`FileView`](GgContextSource::FileView) —
/// deliberately, because a file view's body opens with the read's own path header, so `File` plus
/// the path would say the path twice.
fn item_heading(source: GgContextSource, label: Option<&str>) -> Option<String> {
    let heading = code_heading(source)?;
    match (source, label) {
        (GgContextSource::TextView, Some(label)) => Some(format!("{heading}: {label}")),
        _ => Some(heading.to_string()),
    }
}

/// Prefix a `user` `message` with its [heading](item_heading) when `code_mode` is on — the pure core
/// of [`ContextModel::headed`], factored out so [`clear_ephemeral`](ContextModel::clear_ephemeral)
/// can head a re-framed item without a `&self` borrow it cannot take mid-iteration.
///
/// A no-op off the code path, on a non-`user` message, and on a source [`code_heading`] does not
/// name — so calling it on any message is safe, and only the ones that should be headed are.
fn apply_code_heading(
    code_mode: bool,
    source: GgContextSource,
    label: Option<&str>,
    message: Message,
) -> Message {
    if !code_mode || message.role != Role::User {
        return message;
    }
    let Some(heading) = item_heading(source, label) else {
        return message;
    };
    let body = message.content.unwrap_or_default();
    Message {
        content: Some(format!("{heading}\n----\n{body}")),
        ..message
    }
}

/// The category name a [`GgContextSource`] is reported under in the
/// [context-usage signal](ContextModel::refresh_context_usage_signal).
///
/// Title-case and spelled for a reader rather than for the wire, because these are the words the
/// model reads: the block is a short table it acts on, not a dump of enum variants. The file-view
/// label doubles as the heading of its nested per-file list (`Top File Views`), so it is plural.
///
/// [`TextView`](GgContextSource::TextView) is `Text Views` rather than the console's operator-facing
/// "Agent views": the model is the agent, so naming the band after it reads as somebody else's, and
/// `text` is already the word the model meets in `view.openText` and in a `view.current()` entry's
/// `kind`. The two audiences are allowed to differ here — this table already says `Your Messages`
/// where the console says `Assistant`.
fn source_label(source: GgContextSource) -> &'static str {
    match source {
        GgContextSource::System => "System Prompt",
        GgContextSource::UserPrompt => "Task Prompt",
        GgContextSource::Assistant => "Your Messages",
        GgContextSource::ToolOutput => "Tool Output",
        GgContextSource::FileView => "File Views",
        GgContextSource::TextView => "Text Views",
        GgContextSource::Skill => "Documentation",
        GgContextSource::Memory => "Memories",
        GgContextSource::TaskList => "Tasks",
        GgContextSource::Board => "Board",
        GgContextSource::History => "History",
    }
}

/// The body a [text view](GgContextSource::TextView) item was opened with, with the
/// [heading](item_heading) the window prefixed it with removed.
///
/// The heading is derived from the item's own `(source, label)`, so the prefix stripped here is
/// byte-for-byte the one [`apply_code_heading`] added rather than a guess at its shape. An item
/// pushed outside code mode carries no heading, and one whose body happens not to start with its
/// heading (a window that crossed from a code-mode agent to a tool-calling one and back) is
/// returned untouched.
fn text_view_body(item: &ContextItem) -> String {
    let content = item.message.content.clone().unwrap_or_default();
    let Some(heading) = item_heading(item.source, item.label.as_deref()) else {
        return content;
    };
    let stripped = content
        .strip_prefix(&format!("{heading}\n----\n"))
        .map(str::to_string);
    stripped.unwrap_or(content)
}

/// `value` written with `,` thousands separators — how a
/// [turn header](ContextModel::turn_header) reports a result's token count, since a five- or
/// six-digit figure is what the model is comparing turns by.
fn thousands(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.char_indices() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

// Read/partition seams for Phase 2 (compaction summarizes the ephemeral history and
// carries the pinned prefix verbatim; agent-managed context evicts file views) and for
// the tests. The P1a loop only builds and renders the model, so the binary build sees
// these as unused — they exist now so Phase 2 is a rewrite of the item vector, not a new
// data model.
#[allow(dead_code)]
impl ContextModel {
    /// The **conversation** items, in order. The [system prompt](Self::set_system) and the
    /// [context-usage signal](Self::refresh_context_usage_signal) are slots rather than thread
    /// items and are not among them; [`messages`](Self::messages) is what renders all three
    /// together.
    pub fn items(&self) -> &[ContextItem] {
        &self.items
    }

    /// The [system prompt](Self::set_system) slot, or `None` on a window that has not been given
    /// one — a window mid-succession, between the transfer that
    /// [cleared](Self::clear_system) it and the successor's loop setting its own.
    pub fn system(&self) -> Option<&ContextItem> {
        self.system.as_ref()
    }

    /// The pinned items — the fixed prefix compaction carries across the boundary
    /// verbatim.
    pub fn pinned(&self) -> impl Iterator<Item = &ContextItem> {
        self.items.iter().filter(|item| item.retention.is_pinned())
    }

    /// The ephemeral items — the thread material compaction summarizes and agent-managed
    /// context may evict.
    pub fn ephemeral(&self) -> impl Iterator<Item = &ContextItem> {
        self.items.iter().filter(|item| !item.retention.is_pinned())
    }

    /// The active model's context-window limit, when known.
    pub fn window_limit(&self) -> Option<u64> {
        self.window_limit
    }
}

/// The [`GgContextSource`] a tool's result should be tagged with: a file read is a
/// [`FileView`](GgContextSource::FileView) (evictable working material a later phase can
/// drop and the model re-read), and every other tool is generic
/// [`ToolOutput`](GgContextSource::ToolOutput). Centralized here so the file-view seam
/// has one home.
pub fn tool_output_source(tool_name: &str) -> GgContextSource {
    match tool_name {
        "read_file" => GgContextSource::FileView,
        _ => GgContextSource::ToolOutput,
    }
}

#[cfg(test)]
#[path = "context.test.rs"]
mod tests;

#[cfg(test)]
#[path = "context.views.test.rs"]
mod view_tests;
