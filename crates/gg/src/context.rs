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

use crate::model::{Message, Role, ToolCall};

/// A small fixed per-message token allowance approximating the role tag and message
/// framing a provider adds around the content (chat formats wrap each message in a few
/// tokens of delimiters). Added to every item's estimate so short messages are not
/// counted as ~zero. An approximation, like the rest of the accounting.
const MESSAGE_FRAMING_TOKENS: usize = 4;

/// The [`label`](ContextItem::label) sentinel marking the fullness-signal item — the
/// rebuilt-each-turn, system-adjacent line telling the agent how full its window is (see
/// [`ContextModel::refresh_fullness_signal`]). It lets the signal be refreshed in place
/// without disturbing the base system prompt (both are [`System`](GgContextSource::System)
/// items, distinguished only by this tag). Not a value any real content would collide with.
const FULLNESS_SIGNAL_LABEL: &str = "\u{0}gg:fullness-signal";

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
    /// [`FileView`](GgContextSource::FileView) shows (so `evict_file_view { path }` can target
    /// it) and the sentinel marking the rebuilt-each-turn fullness signal (so it can be
    /// refreshed without touching the base system prompt). `None` for ordinary items.
    label: Option<String>,
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

    /// The item's selector tag, when it carries one (a file view's path, or the fullness
    /// signal's sentinel).
    pub fn label(&self) -> Option<&str> {
        self.label.as_deref()
    }
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
        MESSAGE_FRAMING_TOKENS + self.estimate_str(&text)
    }
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

/// What an [`archive_thread`](ContextModel::archive_thread) call removed: the archived items
/// (oldest first) and the tokens reclaimed.
#[derive(Debug, Clone, Default)]
pub struct ArchiveResult {
    /// The removed thread items, in original order.
    pub items: Vec<ArchivedItem>,
    /// The estimated tokens the removed items occupied.
    pub tokens: u64,
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
pub struct ContextModel {
    /// The context items, in conversation order.
    items: Vec<ContextItem>,
    /// The estimator every pushed item is measured with.
    estimator: Arc<dyn TokenEstimator>,
    /// The active model's context-window limit, when known — the denominator of
    /// [`fullness`](Self::fullness).
    window_limit: Option<u64>,
}

impl ContextModel {
    /// A new, empty model measuring with `estimator` against an optional `window_limit`.
    pub fn new(estimator: Arc<dyn TokenEstimator>, window_limit: Option<u64>) -> Self {
        Self {
            items: Vec::new(),
            estimator,
            window_limit,
        }
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
        let tokens = self.estimator.estimate_message(&message);
        self.items.push(ContextItem {
            source,
            retention,
            message,
            tokens,
            label,
        });
    }

    /// Replace every item currently attributed to `source` with a single new item (or
    /// with nothing, when `message` is `None`), pushed at the end.
    ///
    /// This is how the loop keeps a **mutable, single-block** source in sync with its
    /// backing state — notably the [`Memory`](GgContextSource::Memory) block, which the
    /// model rewrites through `write_memory`/`update_memory`/`delete_memory` as it works:
    /// each turn the loop rebuilds the block from the memory store so the window always
    /// reflects the current memories (and Phase 2 compaction retains them). Because the old
    /// block is removed and the new one appended, the rebuild must happen at a turn
    /// boundary (before this turn's assistant message and its tool results), never between
    /// an assistant tool-call message and the tool results answering it.
    pub fn replace_source(
        &mut self,
        source: GgContextSource,
        retention: Retention,
        message: Option<Message>,
    ) {
        self.items.retain(|item| item.source != source);
        if let Some(message) = message {
            self.push(source, retention, message);
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
        self.push(
            source,
            Retention::Ephemeral,
            Message::tool_result(tool_call_id, content),
        );
    }

    /// Record a `read_file` result as an ephemeral [`FileView`](GgContextSource::FileView)
    /// tagged with the file's `path`, so [agent-managed context](https://docs.testcabinet.ai/gg/agent-managed-context/)
    /// can target it with `evict_file_view { path }`. A file view whose path is unknown
    /// (a malformed call) is tagged `None` and is only reachable by a blanket eviction.
    pub fn push_file_view(
        &mut self,
        path: Option<String>,
        tool_call_id: impl Into<String>,
        content: impl Into<String>,
    ) {
        self.push_labeled(
            GgContextSource::FileView,
            Retention::Ephemeral,
            Message::tool_result(tool_call_id, content),
            path,
        );
    }

    /// Render the model to the ordered `Vec<Message>` the client consumes — the faithful
    /// Phase 0 transcript, in item order.
    pub fn messages(&self) -> Vec<Message> {
        self.items.iter().map(|item| item.message.clone()).collect()
    }

    /// The estimated total tokens across every item.
    pub fn total_tokens(&self) -> u64 {
        self.items.iter().map(|item| item.tokens as u64).sum()
    }

    /// The estimated tokens attributed to `source`.
    pub fn tokens_for(&self, source: GgContextSource) -> u64 {
        self.items
            .iter()
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

    /// The messages fed to a [summarizer](https://docs.testcabinet.ai/gg/compaction/)
    /// before a compaction: the pinned build prompt (for grounding — what the run set out
    /// to do) followed by every ephemeral item, in conversation order. The pinned prompt
    /// is included for context but is **not** removed by compaction; only the ephemeral
    /// items it accompanies here are replaced by the summary.
    pub fn summary_source_messages(&self) -> Vec<Message> {
        self.items
            .iter()
            .filter(|item| {
                item.source == GgContextSource::UserPrompt || !item.retention.is_pinned()
            })
            .map(|item| item.message.clone())
            .collect()
    }

    /// Replace the ephemeral history with a single `summary` item, keeping every pinned
    /// item verbatim — the core rewrite of a [compaction](https://docs.testcabinet.ai/gg/compaction/)
    /// boundary.
    ///
    /// The pinned prefix (the system prompt, the build prompt, read skills, in-play
    /// memories, and the task list) is retained unchanged and in order; all ephemeral
    /// thread material (assistant turns, tool output, file views, and any prior summary)
    /// is dropped and a single [`History`](GgContextSource::History)-sourced,
    /// [`Ephemeral`](Retention::Ephemeral) summary item is appended — ephemeral so a later
    /// compaction folds it into the next summary rather than letting summaries pile up.
    ///
    /// A retained skill body is pinned as the `tool` result that answered its `read_skill`
    /// call; once the assistant turn that made that call is dropped, that `tool` message
    /// would dangle (a provider requires a `tool` message to follow the assistant
    /// `tool_calls` it answers). So a retained `tool`-role item is re-framed as a
    /// standalone `user` message carrying the **identical body** — the retained content is
    /// verbatim; only the message envelope changes so the post-compaction sequence is
    /// valid. Its [`source`](GgContextSource) tag (and thus its accounting band) is
    /// unchanged, and its token estimate is recomputed for the new envelope.
    pub fn compact_history(&mut self, summary: Message) {
        let estimator = Arc::clone(&self.estimator);
        self.items.retain(|item| item.retention.is_pinned());
        for item in &mut self.items {
            if item.message.role == Role::Tool {
                let content = item.message.content.take().unwrap_or_default();
                let message = Message::user(content);
                item.tokens = estimator.estimate_message(&message);
                item.message = message;
            }
        }
        self.push(GgContextSource::History, Retention::Ephemeral, summary);
    }

    // -----------------------------------------------------------------------
    // Agent-managed context: the fullness signal, file-view eviction, and
    // thread archival.
    // -----------------------------------------------------------------------

    /// Rebuild the pinned **fullness signal** — a concise, system-adjacent line telling the
    /// agent how full its window is and what is consuming it — from the *current* window
    /// state, so the model sees an up-to-date signal it can act on each turn (the model-facing
    /// half of [agent-managed context](https://docs.testcabinet.ai/gg/agent-managed-context/)).
    ///
    /// The prior signal is removed first and the numbers are computed **without** it, so the
    /// line never accounts for itself and cannot ratchet the window up turn over turn; it is a
    /// single short line, kept cheap by design. It is a [`System`](GgContextSource::System)
    /// pinned item tagged with [`FULLNESS_SIGNAL_LABEL`] so it refreshes in place without
    /// disturbing the base system prompt, and — being pinned — it survives compaction (and is
    /// rebuilt fresh the next turn regardless). A no-op when no window limit is known (there is
    /// no fullness to report).
    pub fn refresh_fullness_signal(&mut self) {
        self.remove_fullness_signal();
        if let Some(text) = self.fullness_signal_text() {
            self.push_labeled(
                GgContextSource::System,
                Retention::Pinned,
                Message::system(text),
                Some(FULLNESS_SIGNAL_LABEL.to_string()),
            );
        }
    }

    /// Remove the current fullness-signal item, if any (matched by its source and sentinel
    /// label, so the base system prompt is untouched).
    fn remove_fullness_signal(&mut self) {
        self.items.retain(|item| !is_fullness_signal(item));
    }

    /// The text of the fullness signal for the current window, or `None` when no window limit
    /// is known. Reports `used/limit tokens (P% full)` plus the two or three largest consuming
    /// sources, and a short hint that the agent can reclaim space itself.
    fn fullness_signal_text(&self) -> Option<String> {
        let limit = self.window_limit?;
        if limit == 0 {
            return None;
        }
        let total = self.total_tokens();
        let percent = ((total as f64 / limit as f64) * 100.0).round() as u64;

        // The largest non-empty consumers, most first, for an at-a-glance hint of where the
        // window is going.
        let mut bands: Vec<(GgContextSource, u64)> = self
            .usage_by_source()
            .into_iter()
            .filter(|usage| usage.tokens > 0)
            .map(|usage| (usage.source, usage.tokens))
            .collect();
        // Stable sort by tokens descending; ties keep `GgContextSource::ALL` order (the
        // order `usage_by_source` produced), so the hint is deterministic.
        bands.sort_by_key(|&(_, tokens)| std::cmp::Reverse(tokens));
        let top: Vec<String> = bands
            .iter()
            .take(3)
            .map(|(source, tokens)| format!("{} {tokens}", source_label(*source)))
            .collect();

        let consumers = if top.is_empty() {
            String::new()
        } else {
            format!(" Largest consumers (tokens): {}.", top.join(", "))
        };
        Some(format!(
            "Context window: {total}/{limit} tokens ({percent}% full).{consumers} \
             If it is getting full, reclaim space yourself: `evict_file_view` drops file \
             contents you no longer need (you can re-read them), and `archive_thread` moves \
             older thread history out of the window while keeping it searchable with \
             `search_archive`.",
        ))
    }

    /// Evict [`FileView`](GgContextSource::FileView) items from the live window, reclaiming
    /// their tokens — safe because the agent can re-read a file at any time. With `path`
    /// `Some`, only views of that workspace path are removed; with `None`, **every** file view
    /// is removed. Returns what was reclaimed (count, tokens, and the distinct paths), for the
    /// tool result and the [`ContextManaged`](test_cabinet_core::gg::GgTelemetryKind::ContextManaged)
    /// telemetry. The next [breakdown](Self::breakdown_event) shows the file-view band drop.
    pub fn evict_file_views(&mut self, path: Option<&str>) -> EvictionResult {
        let mut result = EvictionResult::default();
        self.items.retain(|item| {
            if item.source != GgContextSource::FileView {
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

    /// Archive the oldest ephemeral thread material, keeping the most recent
    /// `keep_recent_turns` assistant turns live: the removed items are returned (for the caller
    /// to move into the searchable [archive](crate::archive::ArchiveStore)) and their tokens
    /// are reclaimed from the window.
    ///
    /// **Selection model.** Only [`Ephemeral`](Retention::Ephemeral) items are eligible; the
    /// pinned prefix (system prompt, build prompt, read skills, memories, task list, the
    /// fullness signal) is never archived. The eligible items are grouped into *turns* — a new
    /// turn begins at each [`Assistant`](GgContextSource::Assistant) item and includes the tool
    /// results and file views that follow it — and the newest `keep_recent_turns` turns are
    /// kept live while every older item is archived (a leading run of items with no preceding
    /// assistant, such as a prior compaction summary, forms the oldest turn). `keep_recent_turns`
    /// of `0` archives all ephemeral history; a value at least the number of turns archives
    /// nothing (an empty result). This is a clean, predictable "section" the agent can reason
    /// about: "everything but my most recent turn(s)".
    pub fn archive_thread(&mut self, keep_recent_turns: usize) -> ArchiveResult {
        // Assign each ephemeral item a turn-group index, in order.
        let mut group_of: Vec<usize> = Vec::new();
        let mut group = 0usize;
        let mut seen_assistant = false;
        for item in &self.items {
            if item.retention.is_pinned() {
                continue;
            }
            if item.source == GgContextSource::Assistant {
                if seen_assistant {
                    group += 1;
                }
                seen_assistant = true;
            }
            group_of.push(group);
        }
        let total_groups = if group_of.is_empty() { 0 } else { group + 1 };
        // Groups strictly below this cutoff are archived; the newest `keep_recent_turns`
        // groups (at or above it) stay live.
        let cutoff = total_groups.saturating_sub(keep_recent_turns);

        let mut result = ArchiveResult::default();
        if cutoff == 0 {
            return result; // Nothing old enough to archive.
        }
        let mut ephemeral_index = 0usize;
        self.items.retain(|item| {
            if item.retention.is_pinned() {
                return true;
            }
            let keep = group_of[ephemeral_index] >= cutoff;
            ephemeral_index += 1;
            if !keep {
                result.tokens += item.tokens as u64;
                result.items.push(ArchivedItem {
                    source: item.source,
                    message: item.message.clone(),
                });
            }
            keep
        });
        result
    }
}

/// A short, human-facing name for a [`GgContextSource`], used in the fullness signal's
/// "largest consumers" hint.
fn source_label(source: GgContextSource) -> &'static str {
    match source {
        GgContextSource::System => "system",
        GgContextSource::UserPrompt => "prompt",
        GgContextSource::Assistant => "assistant",
        GgContextSource::ToolOutput => "tool output",
        GgContextSource::FileView => "file views",
        GgContextSource::Skill => "skills",
        GgContextSource::Memory => "memories",
        GgContextSource::TaskList => "tasks",
        GgContextSource::History => "history",
    }
}

/// Whether `item` is the pinned fullness-signal line (a [`System`](GgContextSource::System)
/// item carrying the [`FULLNESS_SIGNAL_LABEL`] sentinel), as opposed to the base system prompt.
fn is_fullness_signal(item: &ContextItem) -> bool {
    item.source == GgContextSource::System && item.label.as_deref() == Some(FULLNESS_SIGNAL_LABEL)
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
