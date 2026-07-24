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

use crate::model::{Message, ToolCall};

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
        let tokens = self.estimator.estimate_message(&message);
        self.items.push(ContextItem {
            source,
            retention,
            message,
            tokens,
        });
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
