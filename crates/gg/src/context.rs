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

/// One item of the live window as [`prompt_items`](ContextModel::prompt_items) hands it to
/// the [message log](crate::message_log): the message that is sent, the band it occupies,
/// what it is estimated to cost, and its [selector tag](ContextItem::label).
///
/// A borrowed, read-only view of a [`ContextItem`] rather than the item itself — the log
/// records what was *sent*, so it needs no access to the item's retention class or its
/// mutability.
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

/// What an [`evict_file_views`](ContextModel::evict_file_views) call reclaimed: how many
/// file-view items were removed, the tokens they occupied, and the distinct workspace paths
/// they showed (for the tool result and telemetry `detail`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EvictionResult {
    /// The number of [`FileView`](GgContextSource::FileView) items removed.
    pub items: usize,
    /// The estimated tokens the removed items occupied.
    pub tokens: u64,
    /// The distinct paths of the evicted file views, in first-seen order (a view whose path
    /// was unknown contributes nothing here).
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
/// [`Clone`] duplicates every item, the usage-signal slot and the turn counter, and shares only
/// the [estimator](TokenEstimator) — which is process-wide and stateless, so two windows measured
/// by it agree. It is what backs the [`history` module](crate::modules::HistoryModule)'s
/// [fork](crate::modules::Module::fork): the copy and the original diverge from the moment they
/// are made, and neither can see the other's pushes. Nothing in a `ContextModel` is shared
/// mutable state, so there is no "linked window" — see
/// [`HistoryModule::share`](crate::modules::HistoryModule) for why two agents cannot write one.
#[derive(Clone)]
pub struct ContextModel {
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
        let message = self.headed(source, message);
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
    fn headed(&self, source: GgContextSource, message: Message) -> Message {
        apply_code_heading(self.code_mode, source, message)
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
            (Some(item), Some(message)) => item.message == self.headed(source, message.clone()),
            _ => false,
        }
    }

    /// Seed the pinned [`System`](GgContextSource::System) prompt.
    pub fn push_system(&mut self, content: impl Into<String>) {
        self.push(
            GgContextSource::System,
            Retention::Pinned,
            Message::system(content),
        );
    }

    /// Seed the pinned [`UserPrompt`](GgContextSource::UserPrompt) (the build prompt).
    pub fn push_user_prompt(&mut self, content: impl Into<String>) {
        self.push(
            GgContextSource::UserPrompt,
            Retention::Pinned,
            Message::user(content),
        );
    }

    /// Replace the window's opening pair — the [system prompt](Self::push_system) and the
    /// [build prompt](Self::push_user_prompt) — **in place**, leaving every item behind them
    /// exactly where it is.
    ///
    /// This is what makes a window legal for a different agent profile to continue. A system
    /// prompt states the toolset, the roster, the ending calls and the capability prose of the
    /// agent it was rendered for; when a module transfer hands this window to a *different*
    /// profile, item 0 is the one thing that must not be inherited, or the successor is reading
    /// instructions written for someone else. The thread behind it is exactly what the successor
    /// is meant to keep.
    ///
    /// A `None` `user_prompt` leaves the existing build prompt alone (an agent continuing on the
    /// same task); `Some` replaces it. Both replacements are done through
    /// [`replace_source`](Self::replace_source), so a byte-identical rebase is a no-op — the
    /// common case when an agent re-incarnates as itself — and a changed one supersedes rather
    /// than deletes, keeping the render append-only for the prompt cache.
    ///
    /// Everything else — the [turn counter](Self::begin_turn), the usage-signal slot, the pinned
    /// blocks, the file views — is untouched. In particular the turn counter is **never** reset:
    /// a model that read `Turn #37` and later archives turns 12–20 must be naming the turns it
    /// saw, whichever incarnation showed them to it.
    #[allow(dead_code)] // the successor half of a module transfer; see `crate::modules::HistoryModule`.
    pub fn rebase(&mut self, system: impl Into<String>, user_prompt: Option<String>) {
        self.replace_source(
            GgContextSource::System,
            Retention::Pinned,
            Some(Message::system(system)),
        );
        if let Some(prompt) = user_prompt {
            self.replace_source(
                GgContextSource::UserPrompt,
                Retention::Pinned,
                Some(Message::user(prompt)),
            );
        }
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

    /// Every item that is part of the live window, in the order it is sent: the conversation items
    /// followed by the [context-usage signal](Self::refresh_context_usage_signal), which is always
    /// last.
    fn window_items(&self) -> impl Iterator<Item = &ContextItem> {
        self.items.iter().chain(self.usage_signal.iter())
    }

    /// Render the model to the ordered `Vec<Message>` the client consumes — the faithful
    /// Phase 0 transcript, in item order, with the context-usage signal appended at the end.
    pub fn messages(&self) -> Vec<Message> {
        self.window_items()
            .map(|item| item.message.clone())
            .collect()
    }

    /// The per-item view of the current prompt for the [message log](crate::message_log):
    /// each item's [`source`](GgContextSource) band, its [`Message`], its cached token
    /// estimate, and its [selector tag](ContextItem::label), in the order they are sent.
    /// This is the itemized form of [`messages`](Self::messages) — the same messages the
    /// client consumes, each carrying the band, token estimate, and tag the console needs
    /// to line a request's messages up with the per-source
    /// [breakdown](Self::breakdown_event) and attribute a file view to its path.
    ///
    /// The [context-usage signal](Self::refresh_context_usage_signal) is included, last, because it
    /// is part of the request that went out — a log that omitted it would not add up to the prompt
    /// the provider was billed for.
    pub fn prompt_items(&self) -> impl Iterator<Item = PromptItem<'_>> {
        self.window_items().map(|item| PromptItem {
            source: item.source,
            message: &item.message,
            tokens: item.tokens,
            label: item.label.as_deref(),
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
    /// The pinned prefix (the system prompt, the build prompt, read skills, in-play memories,
    /// the task list, and the epic/issue board) is retained unchanged and in order; all ephemeral
    /// thread material (assistant turns, tool output, file views, process guidance, and any prior
    /// summary) is dropped.
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
    /// The figures are computed over the conversation items only — the signal's own cost is excluded,
    /// so the block never accounts for itself and computing it is idempotent.
    fn context_usage_text(&self, options: UsageSignalOptions) -> Option<String> {
        let limit = self.window_limit?;
        if limit == 0 {
            return None;
        }
        let percent = |tokens: u64| format!("{:.1}%", (tokens as f64 / limit as f64) * 100.0);
        let total: u64 = self.items.iter().map(|item| item.tokens as u64).sum();

        // One entry per source that is actually holding something, in `GgContextSource::ALL` order
        // so the block reads the same way from turn to turn. A category at zero is left out rather
        // than listed as `0.0%`: the point of the block is where the window is going.
        let categories: Vec<UsageCategoryView> = GgContextSource::ALL
            .iter()
            .filter_map(|&source| {
                let tokens: u64 = self
                    .items
                    .iter()
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
        let mut result = EvictionResult::default();
        self.items.retain(|item| {
            if item.source != GgContextSource::FileView {
                return true;
            }
            // A locked (pinned) autoloaded spec is kept in the window by definition — eviction
            // does not touch it.
            if item.retention.is_pinned() {
                return true;
            }
            // A targeted eviction spares views of other paths.
            if let Some(wanted) = path
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
    /// eligible, so the pinned prefix (the system prompt, the build prompt, read skills, memories,
    /// the task list, the board) is never touched however wide a range is — and neither is the
    /// [context-usage signal](Self::refresh_context_usage_signal), which is not a thread item at all.
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
        GgContextSource::Skill => Some("Documentation"),
        GgContextSource::Memory => Some("Memories"),
        GgContextSource::TaskList => Some("Tasks"),
        GgContextSource::Board => Some("Board"),
        GgContextSource::History => Some("Summary"),
        GgContextSource::System => Some("Notice"),
        GgContextSource::Assistant => None,
    }
}

/// Prefix a `user` `message` with its [heading](code_heading) when `code_mode` is on — the pure core
/// of [`ContextModel::headed`], factored out so [`clear_ephemeral`](ContextModel::clear_ephemeral)
/// can head a re-framed item without a `&self` borrow it cannot take mid-iteration.
///
/// A no-op off the code path, on a non-`user` message, and on a source [`code_heading`] does not
/// name — so calling it on any message is safe, and only the ones that should be headed are.
fn apply_code_heading(code_mode: bool, source: GgContextSource, message: Message) -> Message {
    if !code_mode || message.role != Role::User {
        return message;
    }
    let Some(heading) = code_heading(source) else {
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
fn source_label(source: GgContextSource) -> &'static str {
    match source {
        GgContextSource::System => "System Prompt",
        GgContextSource::UserPrompt => "Task Prompt",
        GgContextSource::Assistant => "Your Messages",
        GgContextSource::ToolOutput => "Tool Output",
        GgContextSource::FileView => "File Views",
        GgContextSource::Skill => "Documentation",
        GgContextSource::Memory => "Memories",
        GgContextSource::TaskList => "Tasks",
        GgContextSource::Board => "Board",
        GgContextSource::History => "History",
    }
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
    /// The items, in conversation order.
    pub fn items(&self) -> &[ContextItem] {
        &self.items
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
