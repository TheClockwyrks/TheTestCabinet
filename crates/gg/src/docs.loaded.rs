//! **The documentation a loaded code module contributes**: one entry for the module a
//! [skill or memory](crate::knowledge) brought into use, and one for each declaration it exports.
//!
//! The [SDK's half](super) of this surface is a `&'static` index over a catalogue compiled into the
//! binary, because gg's own functions are the same on every run. A loaded module is the opposite of
//! that in every respect: its text arrived at a turn, it belongs to the one agent instance that
//! loaded it, and it disappears with that instance. So it cannot be folded into the static index,
//! and it is not a second *surface* either — it is a second **source** the one surface reads, unioned
//! at query time so that [`read_any`](crate::docs::DocsRuntime::read_any), [`search`](crate::docs::DocsRuntime),
//! [`docview_key`](crate::docs::DocsRuntime::docview_key) and [`suggest`](crate::docs::DocsRuntime::suggest)
//! answer about an author's helper on exactly the terms they answer about `readFile`.
//!
//! # One registry, two readers, no copy
//!
//! The state is owned by the agent's [`KnowledgeModules`](crate::knowledge::KnowledgeModules),
//! beside the loaded module itself, because the two are the same fact: what a program may call and
//! what a model may read about it are written by one event, the load. The
//! [documentation runtime](crate::docs::DocsRuntime) reads it through a **handle** to that one allocation
//! rather than through a copy taken at construction — a copy would go stale on the very next load,
//! and a documentation surface that describes what was loaded a turn ago is worse than one that
//! describes nothing.
//!
//! # Everything is rendered at the load
//!
//! An entry carries its finished body, its brief and its lowercased search text, all computed when
//! the module was registered. That is where the arm's [spellings](ProgramLanguage) are in hand — the
//! [line that reaches the module](ProgramLanguage::lib_import), the
//! [spelling of one export](ProgramLanguage::lib_member), the
//! [separator](ProgramLanguage::member_separator) a key is built with — and re-deriving them at each
//! read would mean carrying a language into every reader of a registry that already knows the
//! answer.

use std::sync::{Arc, Mutex};

use super::search::DocKind;
use super::suggest::fold;
use crate::sandbox::{ModuleExport, ModuleExportKind, ProgramLanguage};

/// **The key one export is filed under**: the module's key and the export's name, joined the way
/// this arm joins a member to the thing it hangs off.
///
/// One function rather than two spellings, because the string built at registration and the string a
/// lookup builds to resolve a type name have to be the same string — an entry filed under one and
/// asked for under the other is an entry nothing can open.
pub fn member_key(language: &dyn ProgramLanguage, module: &str, name: &str) -> String {
    format!("{module}{}{name}", language.member_separator())
}

/// One entry a loaded module puts on the agent's documentation surface — the module itself, or one
/// of its declarations.
///
/// It is a flat record of *finished* text rather than a reference back into the module, for the
/// reason on the module header: the arm that could answer these questions is in hand exactly once,
/// at the load.
#[derive(Debug, Clone)]
pub struct LoadedEntry {
    /// What an open takes and a search reports — the module's own key (`csvTools`), or
    /// [the export's](member_key) (`csvTools.parseCsv`).
    pub key: String,
    /// Which of the three searchable kinds this is. See [`kind_of`].
    pub kind: DocKind,
    /// The loaded key of the module this belongs to. A module entry's own module is itself, which is
    /// what makes a `module` filter and the hit it returns agree — the same rule the SDK half
    /// follows.
    pub module: String,
    /// The name a program writes: the export's, or the module's key for the module entry.
    pub name: String,
    /// The one line a search hit shows.
    pub brief: String,
    /// The whole documentation view, ready to place in the window.
    pub body: String,
    /// The type names the declaration writes in return position, as the arm read them — the source
    /// [`use_views`](super::DocsRuntime::use_views) selects from under
    /// [`Return`](super::DocViewType::Return).
    pub returns: Vec<String>,
    /// The same in parameter position, under [`Parameters`](super::DocViewType::Parameters).
    pub parameters: Vec<String>,
    /// The name [folded](fold) for matching, so a query for `parse_csv` finds `parseCsv`.
    pub folded: String,
    /// The declaration text, lowercased — the signature tier's evidence.
    pub signature: String,
    /// [`brief`](Self::brief), lowercased.
    pub brief_folded: String,
    /// Everything the documentation says under its first line, lowercased.
    pub detail_folded: String,
}

impl LoadedEntry {
    /// Whether this entry is, or its declaration names, the type `filter` names — the loaded half of
    /// the `type` filter's question, *what can I do with a value of this shape*.
    ///
    /// A type entry answers for itself. A function answers from the names its declaration writes,
    /// which is the only thing about a loaded declaration gg has read; an arm that reads no type
    /// names off a declaration therefore narrows this to the type's own entry, which is honest —
    /// silence about a function's types is not evidence that it has none.
    pub fn concerns_type(&self, filter: &str) -> bool {
        if self.kind == DocKind::Type && self.name.eq_ignore_ascii_case(filter) {
            return true;
        }
        self.returns
            .iter()
            .chain(&self.parameters)
            .any(|named| named.eq_ignore_ascii_case(filter))
    }

    /// Whether `filter` names the module this entry belongs to, by the only name it has.
    ///
    /// A loaded module has one spelling rather than the SDK's two: gg's cross-arm id for a module
    /// and the path an arm writes it under are one string here, because the key *is* what the model
    /// was given and gg has no second vocabulary for a module it did not write.
    pub fn in_module(&self, filter: &str) -> bool {
        self.module.eq_ignore_ascii_case(filter)
    }
}

/// **Every loaded module's documentation, for one agent instance** — a handle to the one registry
/// its [`KnowledgeModules`](crate::knowledge::KnowledgeModules) owns.
///
/// Cloning it clones the handle and not the entries: the [documentation runtime](super::DocsRuntime)
/// and the knowledge registry hold the same allocation, so a module loaded mid-turn is searchable on
/// the same turn and no reader can be looking at a set another reader has moved on from.
///
/// A [`default`](Default) one is a registry nothing writes to, which is exactly what every reader of
/// this surface that is not a live session holds: the [bootstrap](crate::bootstrap)'s placeholder,
/// the [console reference](crate::reference), the generator behind the
/// [built-in family skills](crate::skills). All three describe the SDK, and none of them belongs to
/// an agent that has loaded anything.
#[derive(Debug, Clone, Default)]
pub struct LoadedDocs {
    /// The entries, in registration order — a module's own entry first, then its exports in the
    /// order the arm read them. Guarded because the two halves of one agent hold the same handle,
    /// not because two agents share one registry: they never do.
    entries: Arc<Mutex<Vec<LoadedEntry>>>,
}

impl LoadedDocs {
    /// A registry with nothing in it.
    pub fn new() -> Self {
        Self::default()
    }

    /// **Put a loaded module on the surface**: its own entry, then one per export, replacing whatever
    /// was filed under this key before.
    ///
    /// Replacing rather than appending is what makes a second use of a revised module honest. A
    /// [memory](crate::memories)'s code is the model's to rewrite and a skill's is re-read on every
    /// use, so a key can be registered again with a different set of exports — and an entry left
    /// standing for a declaration the module no longer has would document a call that no longer
    /// compiles.
    ///
    /// `origin` and `name` are what the module entry says about itself: the noun for the thing that
    /// carried the code and the name it was used under. They are the only words in this registry gg
    /// writes rather than quotes, and they are here because the model is otherwise handed a key with
    /// no account of where it came from.
    pub fn register(
        &self,
        language: &dyn ProgramLanguage,
        key: &str,
        origin: &str,
        name: &str,
        exports: &[ModuleExport],
    ) {
        let import = language.lib_import(key);
        let mut fresh = vec![module_entry(
            language,
            key,
            origin,
            name,
            exports,
            import.as_deref(),
        )];
        for export in exports {
            fresh.push(export_entry(language, key, export, import.as_deref()));
        }
        let mut entries = self.entries.lock().expect(LOCK);
        entries.retain(|entry| entry.module != key);
        entries.extend(fresh);
    }

    /// Read the entries under `read`, which is handed them as a slice.
    ///
    /// A closure rather than a cloned list because the two hot readers — a
    /// [search](super::DocsRuntime) over every entry and a lookup for one — would otherwise clone
    /// the whole registry to ask one question of it. The lock is not reentrant, so `read` must not
    /// reach back into this registry; the callers that need a second lookup collect what they need
    /// and resolve it afterwards.
    pub fn read<T>(&self, read: impl FnOnce(&[LoadedEntry]) -> T) -> T {
        read(&self.entries.lock().expect(LOCK))
    }

    /// **The entry `name` addresses**, read through `read`, or `None` when nothing loaded answers to
    /// it.
    ///
    /// The full key first and the bare export name second, the same leniency and the same
    /// canonicalization the SDK half applies: a model reads `csvTools.parseCsv` in a search hit and
    /// types `parseCsv` at a call site, and both have to reach one page filed under one key.
    ///
    /// One lookup rather than one per question asked of an entry, so a key, a body and the type
    /// names a declaration writes cannot come from three different entries for one spelling. `read`
    /// runs under the registry's lock, so it must not reach back into this registry.
    pub fn find<T>(&self, name: &str, read: impl FnOnce(&LoadedEntry) -> T) -> Option<T> {
        self.read(|entries| {
            entries
                .iter()
                .find(|entry| entry.key == name)
                .or_else(|| entries.iter().find(|entry| entry.name == name))
                .map(read)
        })
    }

    /// The **canonical key** whatever `name` addresses, or `None` when nothing loaded answers to it.
    pub fn key_of(&self, name: &str) -> Option<String> {
        self.find(name, |entry| entry.key.clone())
    }

    /// One entry's whole documentation view, by either of the two names it answers to.
    pub fn body(&self, name: &str) -> Option<String> {
        self.find(name, |entry| entry.body.clone())
    }

    /// Every name a loaded entry answers to, for the hint a failed lookup carries.
    ///
    /// Both spellings, because both are things a model reads and either can be the one it mistyped.
    pub fn candidates(&self) -> Vec<String> {
        self.read(|entries| {
            entries
                .iter()
                .flat_map(|entry| [entry.key.clone(), entry.name.clone()])
                .collect()
        })
    }
}

/// What the lock is called when it is poisoned, which is a panic in another reader of this agent's
/// own registry and not a condition anything here can recover from.
const LOCK: &str = "loaded documentation registry lock";

/// Which searchable kind an export is filed under.
///
/// The surface has three kinds and a module has four kinds of declaration, so
/// [`Value`](ModuleExportKind::Value) — a constant, a `mod`, a `namespace` — is filed as a
/// [`Type`](DocKind::Type). That is the direction the compromise has to go: the one distinction the
/// `kind` filter must keep exact is **callable**, since a model narrowing to `function` is narrowing
/// to what it can write a call against, and filing a constant there would answer that query with a
/// name no program can call. Filed as a type it is merely in the company of the other things a
/// program writes rather than calls.
fn kind_of(kind: ModuleExportKind) -> DocKind {
    match kind {
        ModuleExportKind::Function => DocKind::Function,
        ModuleExportKind::Type | ModuleExportKind::Value => DocKind::Type,
    }
}

/// The module's own entry: what it is, how a program reaches it, and a line per declaration.
///
/// It is rendered on [`read_module`](super::DocsRuntime::read_module)'s shape — the name, the line
/// that brings it into scope, the prose, then the members — because a model meets an SDK module and
/// a loaded one in the same band under the same heading, and two shapes for one kind of page would
/// be a difference the model has to learn for nothing.
fn module_entry(
    language: &dyn ProgramLanguage,
    key: &str,
    origin: &str,
    name: &str,
    exports: &[ModuleExport],
    import: Option<&str>,
) -> LoadedEntry {
    let brief = format!("The code the {origin} `{name}` carries.");
    let mut body = format!(
        "{key}\n\n{}\n\n{brief}",
        reached(key, import, &language.lib_access(key))
    );
    if exports.is_empty() {
        body.push_str("\n\nIt exports nothing.");
    }
    for export in exports {
        body.push_str(&format!("\n  {} — {}", export.name, summarize(export)));
    }
    let detail: String = exports
        .iter()
        .map(|export| format!("{} {}\n", export.name, summarize(export)))
        .collect();
    LoadedEntry {
        key: key.to_string(),
        kind: DocKind::Module,
        module: key.to_string(),
        name: key.to_string(),
        folded: fold(key),
        signature: format!(
            "{} {}",
            import.unwrap_or_default(),
            language.lib_access(key)
        )
        .to_lowercase(),
        brief_folded: brief.to_lowercase(),
        detail_folded: detail.to_lowercase(),
        brief,
        body,
        returns: Vec::new(),
        parameters: Vec::new(),
    }
}

/// One export's entry, on [`read`](super::DocsRuntime::read)'s shape: the declaration its author
/// wrote, where it lives and how a program reaches it, and the prose above it.
fn export_entry(
    language: &dyn ProgramLanguage,
    module: &str,
    export: &ModuleExport,
    import: Option<&str>,
) -> LoadedEntry {
    let access = language.lib_member(module, &export.name);
    let brief = summarize(export);
    let mut body = format!(
        "{}\n\n{}",
        export.declaration,
        reached(module, import, &access)
    );
    if let Some(doc) = &export.doc {
        body.push_str(&format!("\n\n{doc}"));
    }
    LoadedEntry {
        key: member_key(language, module, &export.name),
        kind: kind_of(export.kind),
        module: module.to_string(),
        name: export.name.clone(),
        folded: fold(&export.name),
        signature: export.declaration.to_lowercase(),
        brief_folded: brief.to_lowercase(),
        detail_folded: detail_of(export).to_lowercase(),
        brief,
        body,
        returns: export.returns.clone(),
        parameters: export.parameters.clone(),
    }
}

/// **Where a loaded symbol lives and how a program reaches it** — the loaded half of the one line
/// [every SDK view carries](super::DocsRuntime::defined_in), written on the same two states.
///
/// An arm whose module system needs a line to resolve the key quotes that line; an arm where the
/// module lands somewhere a program can already name says so. What is added on both is the
/// **access**, and it is added because it is the one thing about a loaded module a model cannot look
/// up anywhere else: an SDK symbol is reached by the name its own signature prints, and a loaded one
/// is reached through a spelling only the arm knows.
fn reached(key: &str, import: Option<&str>, access: &str) -> String {
    match import {
        Some(line) => {
            format!("Defined in `{key}`, brought into scope with `{line}`, and written `{access}`.")
        }
        None => format!("Defined in `{key}`, in scope already, and written `{access}`."),
    }
}

/// The one line a hit shows for an export: the first line of its documentation, or — for a
/// declaration whose author wrote none, or whose comment this arm's scan could not see — the
/// declaration itself.
///
/// Falling back to the declaration rather than to a sentence gg composes keeps the author speaking.
/// A brief is the only thing a search result shows, and `parse(text: string): Row[]` tells a model
/// more about whether this is the entry it wanted than any paraphrase of it would.
fn summarize(export: &ModuleExport) -> String {
    export
        .doc
        .as_deref()
        .and_then(|doc| doc.lines().find(|line| !line.trim().is_empty()))
        .map(|line| line.trim().to_string())
        .unwrap_or_else(|| export.declaration.clone())
}

/// Everything the export's documentation says **after** its first line — the weakest tier's
/// evidence, and empty for an export documented in one line or not at all.
fn detail_of(export: &ModuleExport) -> String {
    let Some(doc) = export.doc.as_deref() else {
        return String::new();
    };
    let mut lines = doc.lines().skip_while(|line| line.trim().is_empty());
    lines.next();
    lines.collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
#[path = "docs.loaded.test.rs"]
mod tests;
