//! The documentation carve-out's runtime state.
//!
//! Under [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) the system prompt no
//! longer lists every tool signature. It names the API objects a program has (`fs`, `project`, …)
//! and tells the model two things it can always do: call `object.list()` to see an object's
//! functions, and `view.openDocsView(fn)` to read one function's full documentation. This is the
//! host state behind those two calls.
//!
//! It is deliberately **not** a capability. Like [`finish`](crate::sandbox), documentation lookup is
//! a carve-out: no toolset offers it, no ablation withholds it, and it is bound into every program's
//! scope whatever a run enables — because a model must always be able to discover the functions it
//! *does* have. So this runtime is created for every code-mode agent, not gated on a capability.
//!
//! # Why the host, and not the guest
//!
//! Both answers depend on facts only gg holds: which tools this run enabled, and which
//! [ending role](EndingRole) this agent has. A directory baked into the guest would list functions
//! the scope did not bind, which is the one thing a directory must never do.
//!
//! # Why a lookup is self-contained
//!
//! [`read`](DocsRuntime::read) returns the signature, the description, **and** every type
//! declaration the function refers to, every time — no dedup against what the model has already
//! been shown. That is a consequence of documentation being a
//! [view](crate::context::ViewKind::Docs): a view can be closed, and it can be replaced, so a block
//! that omitted a declaration on the grounds that some *other* block already carried it would be a
//! block that stopped making sense the moment the model tidied up. A view has to read correctly on
//! its own.

use std::collections::BTreeSet;

use crate::ending::EndingRole;
use crate::sandbox::{CatalogueFunction, FunctionSummary, catalogue_functions, type_declaration};

/// The name the `list()` meta function is bound and looked up under. Named once here because it is
/// not the catalogue's to name: the guest binds `list` on every object it creates, this runtime
/// answers and documents it, and the [surface](test_cabinet_core::gg::GgTelemetryKind::AgentSurface)
/// reports it as bound — three places that must agree on one string.
pub const LIST_FUNCTION: &str = "list";

/// The `list()` meta function's one-line summary — it is added to **every** object's directory.
const LIST_SUMMARY: &str = "List this object's functions, each with a one-line summary.";

/// The `list()` meta function's signature and documentation, rendered by a `view.openDocsView("list")` lookup.
const LIST_SIGNATURE: &str = "list(): FunctionSummary[]";
const LIST_DOC: &str = "List the functions available on this API object, each as `{ name, summary }`. Only the \
     functions this run actually bound are returned. Call `view.openDocsView(name)` to see a \
     function's full signature and documentation.";

/// The per-agent state behind `object.list()` and `view.openDocsView()`: the run's enabled tools and
/// this agent's ending role, which together decide which functions exist to be documented.
pub struct DocsRuntime {
    /// The run's enabled gg tool names — the gate on which catalogue functions are bound, and so on
    /// which functions a directory lists and a lookup will document.
    enabled: BTreeSet<String>,
    /// This agent's [ending role](EndingRole), the second gate: an ending call belonging to another
    /// role is not in this agent's scope, so documenting it would describe a function the model
    /// cannot call. The catalogue's `ending` tag is what this is matched against.
    role: &'static str,
    /// Whether this agent keeps a [program library](crate::programs) — the third gate, and the one
    /// neither of the others can express: the `programs` object is bound or absent as a whole, from
    /// a capability rather than from a tool or a role.
    library: bool,
}

impl DocsRuntime {
    /// A fresh runtime for an agent whose scope binds `enabled`'s tools and `role`'s ending calls,
    /// and — when `library` — the [program library](crate::programs)'s three.
    pub fn new(enabled: Vec<String>, role: EndingRole, library: bool) -> Self {
        Self {
            enabled: enabled.into_iter().collect(),
            role: match role {
                EndingRole::Standard => "standard",
                EndingRole::Review => "review",
                EndingRole::Judge { .. } => "judge",
            },
            library,
        }
    }

    /// The directory for one API object: its bound functions with one-line summaries, plus the
    /// `list` meta function every object carries. An unknown object lists `list` alone.
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
            name: LIST_FUNCTION.to_string(),
            summary: LIST_SUMMARY.to_string(),
        });
        out
    }

    /// One function's full documentation by the name it is called by, or `None` for a name this run
    /// did not bind. The `list` meta function is answered from its own text; every other name is a
    /// catalogue function, gated by the enabled set.
    ///
    /// Takes `&self`: a lookup is a pure projection of the catalogue through this agent's scope, and
    /// nothing about having read one changes what the next one says.
    pub fn read(&self, name: &str) -> Option<String> {
        match name {
            LIST_FUNCTION => Some(format!("{LIST_SIGNATURE}\n\n{LIST_DOC}")),
            _ => {
                let function = catalogue_functions()
                    .into_iter()
                    .find(|function| function.name == name && self.bound(function))?;
                Some(assemble(&function))
            }
        }
    }

    /// Whether a function is bound this run, by whichever of the three gates decides it: a
    /// [library](crate::programs) function by the capability, a `Some(tool)` gate by that tool being
    /// enabled, an ending call by this agent's role, and a `None`/`None` carve-out always.
    fn bound(&self, function: &CatalogueFunction) -> bool {
        // The program library first, because it is the one family neither of the two gates below
        // describes: it carries no tool name and belongs to no role, so without this it would fall
        // into the ungated arm and be documented for an agent that has no `programs` object.
        if function.library {
            return self.library;
        }
        match (function.gate, function.ending) {
            // A tool or helper: bound when the run enables it.
            (Some(tool), _) => self.enabled.contains(tool),
            // An ending call: bound when it is this agent's role's.
            (None, Some(ending)) => ending == self.role,
            // Neither gate: an ungated carve-out, which today is `view.openText` / `view.close` /
            // `view.current` — bound to every program whatever a run enables, because a run that
            // offers no tools at all must still be able to show its model something.
            (None, None) => true,
        }
    }
}

/// Assemble a catalogue function's documentation: its signature, its description, and the
/// declarations of every type it refers to.
///
/// Every type, every time — see the module's *Why a lookup is self-contained*.
fn assemble(function: &CatalogueFunction) -> String {
    let mut text = format!("{}\n\n{}", function.signature, function.doc);
    let types: Vec<&'static str> = function
        .types
        .iter()
        .filter_map(|name| type_declaration(name))
        .collect();
    if !types.is_empty() {
        text.push_str("\n\n");
        text.push_str(&types.join("\n\n"));
    }
    text
}

#[cfg(test)]
#[path = "docs.test.rs"]
mod tests;
