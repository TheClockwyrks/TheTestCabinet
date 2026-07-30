//! The gg **thread archive**: the searchable store behind
//! [agent-managed context](https://docs.testcabinet.ai/gg/agent-managed-context/)'s
//! `archive_thread` / `search_archive` pair.
//!
//! When the agent archives a section of its thread, the removed thread material is dropped
//! from the **live** context window (reclaiming tokens) but is **not** lost: it is moved
//! here, into an [`ArchiveStore`], where `search_archive` can retrieve it on demand. This is
//! the model-facing complement to [compaction](crate::compaction): compaction summarizes the
//! history irreversibly, whereas archival keeps the full text recoverable without occupying
//! the window.
//!
//! The store is deliberately simple — an append-only list of [`ArchiveEntry`]s and a
//! case-insensitive substring [search](ArchiveStore::search). It carries no model or network
//! dependency (search is a pure, deterministic scan), so the whole feature runs offline. Like
//! the memory and task stores, it lives behind an `Arc<Mutex<…>>` the `search_archive` tool
//! shares with the [loop](crate::agent), which moves archived items into it.

use std::sync::{Arc, Mutex};

use test_cabinet_core::gg::{GgAgentConfig, GgContextSource, GgTelemetryKind};

use crate::model::{Message, Role};
use crate::modules::{
    AdoptError, Module, ModuleHandle, ModuleKind, ModuleResolveCtx, Ownership, Refresh,
};

/// One archived thread item — a message that was removed from the live window and kept here so
/// [`search_archive`](crate::tools) can recover it.
///
/// It records the [`seq`](Self::seq) it was archived at (a stable, monotonic ordinal so the
/// search can present matches in original order), the [`source`](Self::source) band and
/// [`role`](Self::role) it had in the window, and the searchable [`text`](Self::text) (a
/// message's content plus a rendering of any tool calls it made).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveEntry {
    /// A monotonic ordinal assigned when the item was archived — the original thread order.
    pub seq: usize,
    /// The context source the item was attributed to in the live window.
    pub source: GgContextSource,
    /// The conversational role the archived message had.
    pub role: Role,
    /// The searchable text of the item (content plus any tool-call rendering).
    pub text: String,
}

impl ArchiveEntry {
    /// A short one-line label for the entry — its ordinal and a human role name — used to
    /// preface each hit in a `search_archive` result so the model can tell matches apart.
    pub fn label(&self) -> String {
        let role = match self.role {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tool => "tool",
        };
        format!("#{} ({role})", self.seq)
    }
}

/// The append-only, searchable store of [archived](ArchiveEntry) thread material.
///
/// `archive_thread` moves removed thread items in via [`archive`](Self::archive); `search_archive`
/// reads them back via [`search`](Self::search). Entries are never evicted from the archive —
/// its whole purpose is to be the durable, out-of-window record — so it only grows.
///
/// [`Clone`] is a **deep copy that carries [`next_seq`](Self::next_seq) forward**, which is what an
/// [archive module](crate::modules::ArchiveRuntime)'s fork needs: restarting the ordinal would make
/// two different entries both print as `#0`, and the ordinal is the only handle a model has on
/// where an archived item sat in its thread.
#[derive(Debug, Default, Clone)]
pub struct ArchiveStore {
    /// The archived entries, in the order they were archived.
    entries: Vec<ArchiveEntry>,
    /// The next ordinal to assign, so ordinals stay monotonic across archival batches.
    next_seq: usize,
}

impl ArchiveStore {
    /// A new, empty archive.
    pub fn new() -> Self {
        Self::default()
    }

    /// The number of entries currently archived.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the archive holds no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Archive a batch of `(source, message)` items, assigning each a fresh monotonic
    /// [`seq`](ArchiveEntry::seq) and recording its searchable text. Items with no searchable
    /// text at all (neither content nor tool calls) are skipped so the archive holds only
    /// recoverable material. Returns the number of entries actually archived.
    pub fn archive<'a>(
        &mut self,
        items: impl IntoIterator<Item = (GgContextSource, &'a Message)>,
    ) -> usize {
        let mut added = 0;
        for (source, message) in items {
            let text = message_search_text(message);
            if text.trim().is_empty() {
                continue;
            }
            self.entries.push(ArchiveEntry {
                seq: self.next_seq,
                source,
                role: message.role,
                text,
            });
            self.next_seq += 1;
            added += 1;
        }
        added
    }

    /// Every archived entry that contains `query` as a case-insensitive substring, in
    /// archival order, capped at `limit` hits. An empty/whitespace query matches nothing
    /// (a `search_archive` with no query is a usage error the tool reports, not a request
    /// for the whole archive).
    pub fn search(&self, query: &str, limit: usize) -> Vec<&ArchiveEntry> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }
        self.entries
            .iter()
            .filter(|entry| entry.text.to_lowercase().contains(&needle))
            .take(limit)
            .collect()
    }
}

/// The loop's live view of the thread archive: whether
/// [agent-managed context](test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT) is on for this
/// agent, and the shared [`ArchiveStore`] behind `archive_thread` / `search_archive`.
///
/// It exists so the archive is a [module](crate::modules::Module) like every other piece of
/// per-agent state rather than the bare `Arc<Mutex<…>>` the loop used to carry: an archive is
/// exactly the sort of thing a successor agent should be able to inherit (the thread it can no
/// longer see is still the thread it worked) or deliberately not (a fresh state that starts clean),
/// and that decision has to be expressible.
///
/// Unlike the other capability modules it contributes **nothing** to the prompt — no pinned block,
/// no system-prompt section of its own — so its [ownership](crate::modules::Ownership) is recorded
/// for uniformity and changes nothing about how it behaves. What the model is told about archival
/// belongs to the agent-managed-context prose, which is about the tools, not about the store.
#[derive(Debug)]
pub struct ArchiveRuntime {
    /// Whether the agent-managed-context capability is enabled for this agent.
    enabled: bool,
    /// Whether this module is carried in its holder's prompt. Recorded for uniformity; the
    /// archive pins nothing either way.
    ownership: Ownership,
    /// The shared, mutable store — the same handle `search_archive` reads and the loop's
    /// `archive_thread` reclaim fills.
    store: Arc<Mutex<ArchiveStore>>,
}

impl ArchiveRuntime {
    /// An enabled runtime over a fresh, empty archive.
    pub fn new() -> Self {
        Self {
            enabled: true,
            ownership: Ownership::Owned,
            store: Arc::new(Mutex::new(ArchiveStore::new())),
        }
    }

    /// A disabled runtime (agent-managed context is off): no tools, and nothing ever archived.
    /// The store still exists — an empty one costs nothing and spares every reader an `Option` —
    /// but nothing can reach it, since the tools that would were never offered.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ..Self::new()
        }
    }

    /// An enabled runtime over an **existing** archive — how a caller that already holds the store
    /// (the loop's agent-managed-context setup, and the tests that assert on what was archived)
    /// binds the same one into a module set.
    #[allow(dead_code)] // bound by the tests and by a future incarnation's module set.
    pub fn from_store(store: Arc<Mutex<ArchiveStore>>) -> Self {
        Self {
            enabled: true,
            ownership: Ownership::Owned,
            store,
        }
    }

    /// This runtime with its [ownership](Ownership) set — the builder
    /// [`ModuleSet::resolve`](crate::modules::ModuleSet::resolve) applies the capability's
    /// `ownership` param through.
    pub fn with_ownership(mut self, ownership: Ownership) -> Self {
        self.ownership = ownership;
        self
    }

    /// Whether agent-managed context is on for this agent, and so whether the archive tools are
    /// offered and the loop's reclaim has anywhere to put what it removes.
    pub fn offers_archive(&self) -> bool {
        self.enabled
    }

    /// The shared store, for binding into `search_archive` and the loop's reclaim.
    pub fn store(&self) -> Arc<Mutex<ArchiveStore>> {
        Arc::clone(&self.store)
    }

    /// The number of entries archived so far — a read surface for the tests and for the
    /// module's own reporting.
    #[allow(dead_code)] // a read surface for the module tests; the loop reaches the store directly.
    pub fn len(&self) -> usize {
        self.store.lock().expect("archive store lock").len()
    }

    /// An **independent** archive holding a copy of everything this one holds, with the ordinal
    /// counter carried forward so the two copies never reissue the same `#n`. What a
    /// [fork](Module::fork) takes.
    #[allow(dead_code)] // reached through `Module::fork`, which arrives with `fork`/`exec`.
    pub fn forked(&self) -> Self {
        Self {
            enabled: self.enabled,
            ownership: self.ownership,
            store: Arc::new(Mutex::new(
                self.store.lock().expect("archive store lock").clone(),
            )),
        }
    }

    /// A **linked** handle onto the same archive: what one holder archives, the other can search.
    /// What a [share](Module::share) takes, and what an agent that succeeds another in place
    /// receives.
    #[allow(dead_code)] // reached through `Module::share`, which arrives with `fork`/`exec`.
    pub fn shared(&self) -> Self {
        Self {
            enabled: self.enabled,
            ownership: self.ownership,
            store: Arc::clone(&self.store),
        }
    }
}

impl Default for ArchiveRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for ArchiveRuntime {
    fn kind(&self) -> ModuleKind {
        ModuleKind::Archive
    }

    fn enabled(&self) -> bool {
        self.enabled
    }

    fn ownership(&self) -> Ownership {
        self.ownership
    }

    fn context_source(&self) -> Option<GgContextSource> {
        None
    }

    fn refresh(&self) -> Refresh {
        Refresh::Never
    }

    fn context_block(&self) -> Option<Message> {
        None
    }

    fn state_events(&self) -> Vec<GgTelemetryKind> {
        Vec::new()
    }

    fn drain_events(&mut self) -> Vec<GgTelemetryKind> {
        Vec::new()
    }

    fn retained(&self) -> u64 {
        // The archive is by definition *out* of the window, so it retains nothing across a
        // compaction boundary — the retention proof counts what crossed, not what was set aside.
        0
    }

    fn fork(&self) -> ModuleHandle {
        ModuleHandle::Archive(self.forked())
    }

    fn share(&self) -> ModuleHandle {
        ModuleHandle::Archive(self.shared())
    }

    fn adopt(
        &mut self,
        profile: &GgAgentConfig,
        ctx: &ModuleResolveCtx<'_>,
    ) -> Result<(), AdoptError> {
        let _ = ctx;
        if !profile.is_enabled(test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT) {
            return Err(AdoptError::Disabled);
        }
        self.enabled = true;
        self.ownership = crate::modules::resolve_ownership(
            profile,
            test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT,
        )
        .0;
        Ok(())
    }
}

/// Render a [`Message`] to the plain text `search_archive` matches against: its content
/// followed by a compact rendering of any tool calls it made (name + arguments), so a match
/// can find both what the agent said and what it did.
pub fn message_search_text(message: &Message) -> String {
    let mut text = message.content.clone().unwrap_or_default();
    for call in &message.tool_calls {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&format!("called `{}`({})", call.name, call.arguments));
    }
    text
}

#[cfg(test)]
#[path = "archive.test.rs"]
mod tests;
