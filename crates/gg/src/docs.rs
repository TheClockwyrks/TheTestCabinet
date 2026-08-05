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
//! # Whose spellings it answers in
//!
//! Which functions exist, and which of them this agent binds, are the same in every
//! [program language](test_cabinet_core::gg::GgProgramLanguage) — that is what makes a
//! cross-language study a measurement of the language rather than of the surface. What differs is
//! how each is **spelled**, and a signature is nothing but a spelling. So a runtime is built for one
//! language and reads its catalogue and its `list` documentation from that language alone: a
//! directory answering in a language the model is not writing would be naming calls it cannot make.
//!
//! # Why a lookup is self-contained
//!
//! [`read`](DocsRuntime::read) returns every shape the function may be called in with a line per
//! argument, the description, **and** every type it refers to with a line per member — every time,
//! and with no dedup against what the model has already been shown. That is a consequence of
//! documentation being a
//! [view](crate::context::ViewKind::Docs): a view can be closed, and it can be replaced, so a block
//! that omitted a declaration on the grounds that some *other* block already carried it would be a
//! block that stopped making sense the moment the model tidied up. A view has to read correctly on
//! its own.
//!
//! # Why a miss answers with names
//!
//! A lookup that finds nothing is answered by [`suggest`](DocsRuntime::suggest) as well as by
//! `None`: the same scope that decided the name is unbound is the only thing that knows which bound
//! names it is nearly. See [`suggest`](self::suggest) for what "nearly" means and why the candidates
//! are the bound ones alone.

use std::collections::BTreeSet;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::ending::EndingRole;
use crate::sandbox::{
    CatalogueFunction, FunctionSummary, Parameter, ParameterKind, ProgramLanguage, TypeDeclaration,
    catalogue_functions, language, type_declaration,
};

#[path = "docs.suggest.rs"]
mod suggest;

/// The name the `list()` meta function is bound and looked up under. Named once here because it is
/// not the catalogue's to name: the guest binds `list` on every object it creates, this runtime
/// answers and documents it, and the [surface](test_cabinet_core::gg::GgTelemetryKind::AgentSurface)
/// reports it as bound — three places that must agree on one string.
pub const LIST_FUNCTION: &str = "list";

// `list`'s summary, signature and documentation are **not** here. They are prose written in one
// program language's syntax — a signature is a spelling — so they live on that language's
// [prompt dialect](crate::sandbox::PromptDialect) beside its system prompt, and this module reads
// them from whichever language the agent writes in. Only the *name* stays here, above, because the
// name is the carve-out's identity rather than a spelling of it.

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
    /// The [program language](test_cabinet_core::gg::GgProgramLanguage) this agent writes in.
    ///
    /// It is not a gate — every language offers the same functions under the same gates — but it
    /// decides how each of them is **spelled**, and a directory or a lookup that answered in a
    /// language the model is not writing would be describing calls it cannot make.
    language: &'static dyn ProgramLanguage,
}

impl DocsRuntime {
    /// A fresh runtime for an agent whose scope binds `enabled`'s tools and `role`'s ending calls,
    /// and — when `library` — the [program library](crate::programs)'s three, answering in
    /// `program_language`'s spellings.
    pub fn new(
        enabled: Vec<String>,
        role: EndingRole,
        library: bool,
        program_language: GgProgramLanguage,
    ) -> Self {
        Self {
            enabled: enabled.into_iter().collect(),
            role: match role {
                EndingRole::Standard => "standard",
                EndingRole::Review => "review",
            },
            library,
            language: language(program_language),
        }
    }

    /// The directory for one API object: its bound functions with one-line summaries, plus the
    /// `list` meta function every object carries. An unknown object lists `list` alone.
    pub fn list(&self, object: &str) -> Vec<FunctionSummary> {
        let mut out: Vec<FunctionSummary> = catalogue_functions(self.language)
            .into_iter()
            .filter(|function| function.object == object && self.bound(function))
            .map(|function| FunctionSummary {
                name: function.name.to_string(),
                summary: function.summary.to_string(),
            })
            .collect();
        out.push(FunctionSummary {
            name: LIST_FUNCTION.to_string(),
            summary: self.language.prompt().list_summary.to_string(),
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
        let prompt = self.language.prompt();
        match name {
            LIST_FUNCTION => Some(format!("{}\n\n{}", prompt.list_signature, prompt.list_doc)),
            _ => {
                let function = catalogue_functions(self.language)
                    .into_iter()
                    .find(|function| function.name == name && self.bound(function))?;
                Some(assemble(&function, self.language))
            }
        }
    }

    /// The bound names nearest `name`, for the hint a failed lookup carries — empty when nothing is
    /// close enough to be worth offering.
    ///
    /// It answers from the same three gates [`read`](Self::read) failed against, and that is the
    /// whole reason it lives here rather than beside the refusal it feeds: a candidate list drawn
    /// from the catalogue instead of from this agent's scope would offer names the program cannot
    /// call. The `list` meta function is a candidate like any other, since it is bound on every
    /// object and answerable by [`read`](Self::read).
    ///
    /// What counts as *near* is [`suggest`](self::suggest)'s to decide; what is *available* to be
    /// near is this method's.
    pub fn suggest(&self, name: &str) -> Vec<String> {
        let bound: Vec<&'static str> = catalogue_functions(self.language)
            .into_iter()
            .filter(|function| self.bound(function))
            .map(|function| function.name)
            .chain(std::iter::once(LIST_FUNCTION))
            .collect();
        suggest::nearest(name, bound)
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

/// Assemble a catalogue function's documentation: how it may be called and what each argument is
/// for, its description, and the declarations of every type it refers to with a line per member.
///
/// Every type, every time — see the module's *Why a lookup is self-contained*.
///
/// A function is rendered with **every** signature the language offers it in, because for some
/// languages that is how an optional argument is spelled: an overload pair reads as two ways to call
/// one function, and showing only the first would tell a model half of what it may write. Under a
/// language that spells options with a default there is exactly one, and the rendering is the single
/// line it always was.
fn assemble(function: &CatalogueFunction, language: &'static dyn ProgramLanguage) -> String {
    let mut text = String::new();
    for entry in function.signatures {
        text.push_str(&entry.signature);
        text.push('\n');
        for parameter in &entry.parameters {
            describe(&mut text, parameter, 1);
        }
    }
    text.push('\n');
    text.push_str(function.doc);
    let types: Vec<String> = function
        .types
        .iter()
        .filter_map(|name| type_declaration(language, name))
        .map(declare)
        .collect();
    if !types.is_empty() {
        text.push_str("\n\n");
        text.push_str(&types.join("\n\n"));
    }
    text
}

/// One argument, indented under the signature that takes it, and its fields indented under it.
///
/// A **keyword** argument says so, because it is the one property of an argument that changes what
/// the model has to type: under Python or Kotlin the call site writes the argument's name as well as
/// its value, and a model that read only the name and the type would write it positionally. It is
/// silent for a positional argument rather than labelled, since that is every argument in every
/// language that passes by position and a label on all of them would say nothing.
fn describe(text: &mut String, parameter: &Parameter, depth: usize) {
    let indent = "  ".repeat(depth);
    let optional = if parameter.optional { "?" } else { "" };
    let default = match &parameter.default {
        Some(value) => format!(" = {value}"),
        None => String::new(),
    };
    let passing = match parameter.kind {
        ParameterKind::Positional => "",
        ParameterKind::Keyword => " (passed by name)",
    };
    text.push_str(&format!(
        "{indent}{}{optional}: {}{default}{passing} — {}\n",
        parameter.name, parameter.r#type, parameter.doc
    ));
    for field in &parameter.fields {
        describe(text, field, depth + 1);
    }
}

/// One type declaration, with a line per member.
///
/// The declaration alone says what fields a record has and nothing about what any of them *means*,
/// and `shown: boolean` on a `FileRead` is not a thing a model can infer. A union arm carries no type
/// of its own — the arm is the value — so it is rendered as the bare literal.
fn declare(declaration: &'static TypeDeclaration) -> String {
    let mut text = format!("{}\n{}", declaration.declaration, declaration.doc);
    for member in &declaration.members {
        match &member.r#type {
            Some(kind) => text.push_str(&format!("\n  {}: {kind} — {}", member.name, member.doc)),
            None => text.push_str(&format!("\n  {} — {}", member.name, member.doc)),
        }
    }
    text
}

#[cfg(test)]
#[path = "docs.test.rs"]
mod tests;
