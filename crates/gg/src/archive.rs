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

use test_cabinet_core::gg::GgContextSource;

use crate::model::{Message, Role};

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
#[derive(Debug, Default)]
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
