//! The documentation carve-out's runtime state.
//!
//! Under [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) the system prompt no
//! longer lists every tool signature. It names the API objects a program has (`fs`, `project`, …)
//! and tells the model two things it can always do: call `object.list()` to see an object's
//! functions, and `fn.docs()` (or `harness.readDocs(fn)`) to read one function's full
//! documentation. This is the host state behind those two calls.
//!
//! It is deliberately **not** a capability. Like [`finish`](crate::sandbox), documentation lookup is
//! a carve-out: no toolset offers it, no ablation withholds it, and it is bound into every program's
//! scope whatever a run enables — because a model must always be able to discover the functions it
//! *does* have. So this runtime is created for every code-mode agent, not gated on a capability.
//!
//! # Why the host, and not the guest
//!
//! `object.list()` could be answered from baked data, but `fn.docs()` cannot: it must show the
//! declarations of the types a function refers to, and **only the ones the model has not already
//! been shown this session** — which is a fact only gg holds. So both are serviced here, against a
//! [`DocsRuntime`] that remembers what it has already emitted, and a fresh doc block is pinned into
//! the agent's context exactly as a read skill is, so the model keeps it across turns.

use std::collections::BTreeSet;

use crate::ending::EndingRole;
use crate::sandbox::{CatalogueFunction, FunctionSummary, catalogue_functions, type_declaration};

/// The API object `readDocs` and every object's `list()` are grouped under.
const HARNESS_OBJECT: &str = "harness";

/// The `list()` meta function's one-line summary — it is added to **every** object's directory.
const LIST_SUMMARY: &str = "List this object's functions, each with a one-line summary.";

/// The `list()` meta function's signature and documentation, rendered by a `list.docs()` lookup.
const LIST_SIGNATURE: &str = "list(): FunctionSummary[]";
const LIST_DOC: &str = "List the functions available on this API object, each as `{ name, summary }`. Only the \
     functions this run actually bound are returned. Call a function's `.docs()` for its full \
     signature and documentation.";

/// The `readDocs()` meta function's one-line summary — added to the `harness` object's directory.
const READDOCS_SUMMARY: &str =
    "Read a function's full documentation, given the function or its name.";

/// The `readDocs()` meta function's signature and documentation.
const READDOCS_SIGNATURE: &str = "readDocs(fn: Function | string): string";
const READDOCS_DOC: &str = "Read one function's full documentation — its signature, description, and the declarations of \
     any types it refers to that you have not already been shown. Pass the function itself \
     (`harness.readDocs(fs.readFile)`) or its name (`harness.readDocs(\"readFile\")`); the \
     equivalent of calling `fn.docs()`. The documentation is also added to your context, so it \
     stays available across turns.";

/// One documentation lookup's result: the text handed back to the program, and whether it is the
/// first time this function's docs were read this session (so the loop pins the block into context).
pub struct DocRead {
    /// The documentation text: the signature, the description, and — the first time a referenced
    /// type is shown — its declaration.
    pub text: String,
    /// Whether this is a fresh read whose block the loop should pin into context. A repeat read
    /// hands back the text but pins nothing, exactly as a repeat `read_skill` does.
    pub fresh: bool,
}

/// The per-agent state behind `object.list()` and `fn.docs()`: the run's enabled tools (which gate
/// which functions are documented), and what has already been shown this session.
pub struct DocsRuntime {
    /// The run's enabled gg tool names — the gate on which catalogue functions are bound, and so on
    /// which functions a directory lists and a lookup will document.
    enabled: BTreeSet<String>,
    /// This agent's [ending role](EndingRole), the second gate: an ending call belonging to another
    /// role is not in this agent's scope, so documenting it would describe a function the model
    /// cannot call. The catalogue's `ending` tag is what this is matched against.
    role: &'static str,
    /// Type names already emitted in a doc block this session, so a later lookup omits a declaration
    /// the model has already seen — the dedup the guest cannot do because only gg knows the context.
    shown_types: BTreeSet<String>,
    /// Function names whose docs have already been pinned this session, so a repeat read pins
    /// nothing while still handing the text back.
    shown_functions: BTreeSet<String>,
}

impl DocsRuntime {
    /// A fresh runtime for an agent whose scope binds `enabled`'s tools and `role`'s ending calls.
    pub fn new(enabled: Vec<String>, role: EndingRole) -> Self {
        Self {
            enabled: enabled.into_iter().collect(),
            role: match role {
                EndingRole::Standard => "standard",
                EndingRole::Review => "review",
                EndingRole::Judge { .. } => "judge",
            },
            shown_types: BTreeSet::new(),
            shown_functions: BTreeSet::new(),
        }
    }

    /// The directory for one API object: its bound functions with one-line summaries, plus the
    /// `list` meta function every object carries and the `readDocs` one `harness` does. An unknown
    /// object still lists its meta functions if it is `harness`, and is otherwise empty.
    pub fn list(&self, object: &str) -> Vec<FunctionSummary> {
        let mut out: Vec<FunctionSummary> = catalogue_functions()
            .into_iter()
            .filter(|function| function.object == object && self.bound(function))
            .map(|function| FunctionSummary {
                name: function.name.to_string(),
                summary: function.summary.to_string(),
            })
            .collect();
        out.push(FunctionSummary {
            name: "list".to_string(),
            summary: LIST_SUMMARY.to_string(),
        });
        if object == HARNESS_OBJECT {
            out.push(FunctionSummary {
                name: "readDocs".to_string(),
                summary: READDOCS_SUMMARY.to_string(),
            });
        }
        out
    }

    /// One function's full documentation by the name it is called by, or `None` for a name this run
    /// did not bind. The meta functions (`list`, `readDocs`) are answered from their own text; every
    /// other name is a catalogue function, gated by the enabled set.
    pub fn read(&mut self, name: &str) -> Option<DocRead> {
        match name {
            "list" => Some(self.meta("list", LIST_SIGNATURE, LIST_DOC)),
            "readDocs" => Some(self.meta("readDocs", READDOCS_SIGNATURE, READDOCS_DOC)),
            _ => {
                let function = catalogue_functions()
                    .into_iter()
                    .find(|function| function.name == name && self.bound(function))?;
                Some(self.assemble(&function))
            }
        }
    }

    /// Whether a function gated by `gate` is bound this run — a `None` gate is a carve-out, always
    /// bound; a `Some(tool)` gate is bound exactly when that tool is enabled.
    fn bound(&self, function: &CatalogueFunction) -> bool {
        match (function.gate, function.ending) {
            // A tool or helper: bound when the run enables it.
            (Some(tool), _) => self.enabled.contains(tool),
            // An ending call: bound when it is this agent's role's.
            (None, Some(ending)) => ending == self.role,
            // Neither gate — nothing in the committed catalogue is shaped this way.
            (None, None) => true,
        }
    }

    /// Assemble a catalogue function's documentation: its signature and description, followed by the
    /// declarations of any types it refers to that have not already been shown this session.
    fn assemble(&mut self, function: &CatalogueFunction) -> DocRead {
        let mut text = format!("{}\n\n{}", function.signature, function.doc);
        let new_types: Vec<&'static str> = function
            .types
            .iter()
            .filter(|name| self.shown_types.insert((*name).clone()))
            .filter_map(|name| type_declaration(name))
            .collect();
        if !new_types.is_empty() {
            text.push_str("\n\n");
            text.push_str(&new_types.join("\n\n"));
        }
        let fresh = self.shown_functions.insert(function.name.to_string());
        DocRead { text, fresh }
    }

    /// A meta function's documentation — no referenced types, just its signature and description.
    fn meta(&mut self, name: &str, signature: &str, doc: &str) -> DocRead {
        let fresh = self.shown_functions.insert(name.to_string());
        DocRead {
            text: format!("{signature}\n\n{doc}"),
            fresh,
        }
    }
}

#[cfg(test)]
#[path = "docs.test.rs"]
mod tests;
