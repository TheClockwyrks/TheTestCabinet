//! The documentation carve-out's runtime state.
//!
//! Under [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) the system prompt no
//! longer lists every tool signature. It names the API objects a program has (`fs`, `project`, …)
//! and tells the model two things it can always do: call `object.list()` to see an object's
//! functions, and `view.openDocsView(name)` to read what one of them is. This is the host state
//! behind those two calls.
//!
//! **Looking something up is deliberately not a capability.** Like [`finish`](crate::sandbox), it is
//! a carve-out: no toolset offers it, no ablation withholds it, and it is bound into every program's
//! scope whatever a run enables — because a model must always be able to discover the functions it
//! *does* have. So this runtime is created for every code-mode agent, not gated on a capability.
//!
//! Taking a documentation view back **out** of the window is the exception, and it is gated on
//! [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE) — refused at the
//! [membrane](crate::sandbox) rather than answered here, since this runtime describes the surface
//! and does not touch the window. Nothing about that reaches this file; it is named because the
//! asymmetry is otherwise surprising. Opening only ever appends to the prompt, closing rewrites its
//! middle, and those are different enough trades to be different decisions.
//!
//! # Why the host, and not the guest
//!
//! Both answers depend on facts only gg holds: which tools this run enabled, which
//! [ending role](EndingRole) this agent has, and which capabilities it was granted. A directory
//! baked into the guest would list functions the scope did not bind, which is the one thing a
//! directory must never do.
//!
//! Which of those three decides a given function is not a fact the guest holds either, and — since
//! the [operations table](crate::sandbox::operation_of) — it is no longer a fact each arm's
//! committed catalogue asserts about itself. gg states it once, and
//! [`bound`](DocsRuntime::bound) is where it is read.
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
//! # A function and a type are two views, not one block
//!
//! [`read`](DocsRuntime::read) renders one **function**: every shape it may be called in with a line
//! per argument, and the description. It does **not** carry the declarations of the types the
//! signature mentions. Those are [views of their own](DocsRuntime::read_type), addressed by the
//! type's name, and one open of a function [places](crate::context::ContextModel::open_docview) them
//! beside it according to the agent's [`DocViewTypes`] mode.
//!
//! Folding them in was the older shape, and it made two things impossible. The declarations were
//! repeated in full in every function view that mentioned the type, so an agent reading five
//! functions over one record read the record five times and could reclaim none of the copies. And
//! there was nothing to *measure*: whether a model does better shown a return type up front, shown
//! every type in the signature, or shown none until it asks, is a question with three arms, and a
//! block that always carries all of them answers it with one.
//!
//! Each view still reads correctly on its own, which is the property the older shape was protecting.
//! A function view names its types in its signature; a type view declares one type with a line per
//! member. Neither depends on the other being open, which is exactly why closing one never disturbs
//! the other.
//!
//! # Why a miss answers with names
//!
//! A lookup that finds nothing is answered by [`suggest`](DocsRuntime::suggest) as well as by
//! `None`: the same scope that decided the name is unbound is the only thing that knows which bound
//! names it is nearly. See [`suggest`](self::suggest) for what "nearly" means and why the candidates
//! are the bound ones alone.

use std::collections::BTreeSet;

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgProgramLanguage};

use crate::ending::EndingRole;
use crate::sandbox::{
    Binding, CatalogueFunction, FunctionSummary, Parameter, ParameterKind, ProgramLanguage, Prose,
    SignatureEntry, TypeDeclaration, catalogue_functions, language, meta_function, operation_of,
    type_declaration,
};

#[path = "docs.suggest.rs"]
mod suggest;

#[path = "docs.search.rs"]
mod search;

// The search surface, re-exported so `docs` is the single name the loop and the membrane import
// from — the same rule `sandbox` follows. `DocHit` and `DocKind` are fields of a `DocSearch` and the
// two limits are what a caller compares a page against, so they are named here even where the crate
// reaches them through the type that owns them: a type a reader has to guess the module of is a type
// nobody reads, and the crate denies warnings.
#[allow(unused_imports)]
pub use search::{DEFAULT_SEARCH_LIMIT, DocHit, DocKind, DocQuery, DocSearch, MAX_SEARCH_LIMIT};

/// Which of the SDK types a function's signature mentions are opened as
/// [documentation views](crate::context::ViewKind::Docs) beside it, when the model opens that
/// function's own.
///
/// # Why this is a knob rather than a decision
///
/// Every arm of it is defensible and none is obviously right, which is the definition of something
/// worth measuring rather than choosing. Opening the **return** type lands the agent on what it can
/// do with the value it is about to get, which is the case for it — and is not automatically the
/// cheaper arm, because a function returning a list of records opens the record, whose own fields
/// may reference further types the agent then has to ask for one at a time: three round trips where
/// one open of everything in the signature would have been one. Opening **nothing** is cheapest per
/// open and costs a turn whenever the model needs a shape it was not given. So gg holds all three
/// and reports which one a run was configured with.
///
/// It is per **agent**, like the [program language](crate::sandbox::resolve_program_language) it
/// sits beside, so one run can hold two agents at two languages *and* two modes.
///
/// # What it is not
///
/// It is not a *depth*. Whichever mode is chosen, exactly one level is opened: a type view never
/// opens another type view, not even for a field whose type is itself catalogued. There is
/// therefore no closure to compute, no cycle to detect and no termination rule — and an agent that
/// wants the second level opens it by name, which is one call and is visible in the record as a
/// thing the model chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DocViewTypes {
    /// Open no type views at all. The function's signature names its types; reading one is a call
    /// the model makes for itself.
    Off,
    /// Open the types in the function's **return** position, and no others. The default.
    #[default]
    ReturnOnly,
    /// Open every SDK type the function's own signature **names** — the return position and the
    /// arguments both. Still one level: a type named only by a *field* of one of those types is not
    /// named by the signature, so it is not opened.
    ReturnAndParameters,
}

/// The `docViewTypes` param's spelling of [`DocViewTypes::Off`].
const DOC_VIEW_TYPES_OFF: &str = "off";
/// The `docViewTypes` param's spelling of [`DocViewTypes::ReturnOnly`].
const DOC_VIEW_TYPES_RETURN: &str = "return";
/// The `docViewTypes` param's spelling of [`DocViewTypes::ReturnAndParameters`].
const DOC_VIEW_TYPES_RETURN_AND_PARAMETERS: &str = "return-and-parameters";

impl DocViewTypes {
    /// The mode's stable id — what the run was configured with, and what a replay reads to tell one
    /// arm of the comparison from another.
    pub fn id(self) -> &'static str {
        match self {
            Self::Off => DOC_VIEW_TYPES_OFF,
            Self::ReturnOnly => DOC_VIEW_TYPES_RETURN,
            Self::ReturnAndParameters => DOC_VIEW_TYPES_RETURN_AND_PARAMETERS,
        }
    }
}

/// Resolve the [documentation-view type mode](DocViewTypes) from this agent's
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `docViewTypes` param.
///
/// | `params.docViewTypes` | Mode |
/// | --- | --- |
/// | absent / `null` / `"return"` | [`ReturnOnly`](DocViewTypes::ReturnOnly) — the return position (the default) |
/// | `"off"` | [`Off`](DocViewTypes::Off) |
/// | `"return-and-parameters"` | [`ReturnAndParameters`](DocViewTypes::ReturnAndParameters) |
/// | anything else | [`ReturnOnly`](DocViewTypes::ReturnOnly), and the value is reported |
///
/// Read literally and reported on mismatch for the reason
/// [`resolve_assistant_messages`](crate::healing::resolve_assistant_messages) is: the value is
/// contract-visible, so a typo must change nothing silently rather than quietly pick the arm the
/// study did not ask for. A capability that is present but **disabled** configures nothing.
pub fn resolve_doc_view_types(profile: &GgAgentConfig) -> ResolvedDocViewTypes {
    let mut resolved = ResolvedDocViewTypes {
        mode: DocViewTypes::default(),
        unknown_params: Vec::new(),
    };
    let Some(capability) = profile
        .capability(CAPABILITY_RESPONSES_AS_CODE)
        .filter(|capability| capability.enabled)
    else {
        return resolved;
    };
    let Some(value) = capability.params.get("docViewTypes") else {
        return resolved;
    };

    match value {
        Value::Null => {}
        Value::String(mode) if mode == DOC_VIEW_TYPES_RETURN => {}
        Value::String(mode) if mode == DOC_VIEW_TYPES_OFF => resolved.mode = DocViewTypes::Off,
        Value::String(mode) if mode == DOC_VIEW_TYPES_RETURN_AND_PARAMETERS => {
            resolved.mode = DocViewTypes::ReturnAndParameters;
        }
        _ => resolved.unknown_params.push("docViewTypes".to_string()),
    }
    resolved
}

/// A resolved [type mode](DocViewTypes) together with the `docViewTypes` value gg could not read, if
/// any — the same shape every other per-agent resolution takes, and reported the same way at launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedDocViewTypes {
    /// The mode this agent's documentation opens under.
    pub mode: DocViewTypes,
    /// The `docViewTypes` value that named no mode gg knows. Reported at `warn` when the run starts.
    pub unknown_params: Vec<String>,
}

/// The **key** the `list()` meta function is catalogued, bound and looked up under. Named once here
/// because it is gg's own identity for the carve-out rather than any language's spelling of it: the
/// guest binds `list` on every object it creates, this runtime answers and documents it, and the
/// [surface](test_cabinet_core::gg::GgTelemetryKind::AgentSurface) reports it as bound — three
/// places that must agree on one string.
pub const LIST_FUNCTION: &str = "list";

// `list`'s spelling, its signature, its documentation and its one-line summary are **not** here, and
// are not authored anywhere in this crate. They are reflected out of the declaration in each
// language's own SDK and arrive in that language's committed catalogue's `meta` section, exactly as
// every other model-facing function's do — because a description of an SDK function written on gg's
// side is a description nothing can compare against the code. Only the *key* stays here, above.

/// The per-agent state behind `object.list()` and `view.openDocsView()`: the run's enabled tools and
/// this agent's ending role, which together decide which functions exist to be documented.
pub struct DocsRuntime {
    /// The run's enabled gg tool names — the gate on which catalogue functions are bound, and so on
    /// which functions a directory lists and a lookup will document.
    enabled: BTreeSet<String>,
    /// This agent's [ending role](EndingRole), the second gate: an ending call belonging to another
    /// role is not in this agent's scope, so documenting it would describe a function the model
    /// cannot call.
    role: EndingRole,
    /// The gg capability ids this agent holds that buy it part of the surface — the third gate, and
    /// the one neither of the others can express, because nothing dispatches a capability and no
    /// role decides one.
    ///
    /// A set rather than the single `library` flag it grew out of: the
    /// [program library](crate::programs) is the only family bought this way today, and it is
    /// already not the last, so what the runtime holds is *which* capabilities rather than *whether*
    /// one particular capability.
    capabilities: BTreeSet<&'static str>,
    /// The [program language](test_cabinet_core::gg::GgProgramLanguage) this agent writes in.
    ///
    /// It is not a gate — every language offers the same functions under the same gates — but it
    /// decides how each of them is **spelled**, and a directory or a lookup that answered in a
    /// language the model is not writing would be describing calls it cannot make.
    language: &'static dyn ProgramLanguage,
}

impl DocsRuntime {
    /// A fresh runtime for an agent whose scope binds `enabled`'s tools, `role`'s ending calls and
    /// whatever `capabilities` buys — answering in `program_language`'s spellings.
    ///
    /// `capabilities` is the agent's own resolved set, not its profile's: an agent whose profile
    /// asks for a [program library](crate::programs) it was not given keeps neither the object nor
    /// its documentation, and the caller is the only thing that knows which it ended up with.
    pub fn new(
        enabled: Vec<String>,
        role: EndingRole,
        capabilities: &[&'static str],
        program_language: GgProgramLanguage,
    ) -> Self {
        Self {
            enabled: enabled.into_iter().collect(),
            role,
            capabilities: capabilities.iter().copied().collect(),
            language: language(program_language),
        }
    }

    /// The [program language](ProgramLanguage) this runtime answers in.
    ///
    /// Exposed because the one thing gg *generates* rather than quotes — the
    /// [built-in family skills](crate::skills)' on-use script, a whole program that opens a
    /// documentation view per function — is written from the same directory this runtime produces,
    /// and must be written in the same language it answers in.
    pub fn language(&self) -> &'static dyn ProgramLanguage {
        self.language
    }

    /// The directory for one API object: its bound functions with one-line summaries, plus the
    /// `list` meta function every object carries. An unknown object lists `list` alone.
    pub fn list(&self, object: &str) -> Vec<FunctionSummary> {
        let mut out: Vec<FunctionSummary> = catalogue_functions(self.language)
            .into_iter()
            .filter(|function| function.object == object && self.bound(function))
            .map(|function| FunctionSummary {
                name: function.name.to_string(),
                summary: function.prose.brief.to_string(),
            })
            .collect();
        if let Some(meta) = meta_function(self.language, LIST_FUNCTION) {
            out.push(FunctionSummary {
                name: meta.name.clone(),
                summary: Prose::from_paragraph(&meta.doc).brief.to_string(),
            });
        }
        out
    }

    /// One **function's** documentation by the name it is called by, or `None` for a name this run
    /// did not bind. The `list` meta function is answered from its own text; every other name is a
    /// catalogue function, gated by the enabled set.
    ///
    /// Takes `&self`: a lookup is a pure projection of the catalogue through this agent's scope, and
    /// nothing about having read one changes what the next one says. That is the property the whole
    /// docview mechanism rests on — a view's body is a function of its key, so a
    /// [compaction](crate::compaction) or a [restore](crate::persistence) can re-derive it rather
    /// than replay a stored copy.
    pub fn read(&self, name: &str) -> Option<String> {
        // The meta functions first, and by the name this language spells them: `list` is bound on
        // every object, so it can never be shadowed by a catalogue entry and never needs a gate.
        if let Some(meta) = meta_function(self.language, LIST_FUNCTION)
            && meta.name == name
        {
            return Some(assemble(&meta.signatures, &meta.doc));
        }
        let function = self.function(name)?;
        Some(assemble(function.signatures, &function.prose.rendered()))
    }

    /// One **type's** documentation by the name a signature writes it under: its declaration, the
    /// paragraph explaining it, and a line per member. `None` for a name this language's catalogue
    /// does not declare, and `None` for a type **no function this agent binds** refers to.
    ///
    /// # Why a type is gated at all, and why this gate is not the function gate
    ///
    /// A type is not a call, so nothing is withheld by being able to read what a record's fields
    /// mean — and an agent that may call `readFile` must be able to read the declaration of what
    /// `readFile` hands back, which is why the gate is *reachability from a bound function* rather
    /// than a gate of the type's own. That much is unchanged.
    ///
    /// What is not acceptable is the ungated version: a type body **names its member functions and
    /// the calls that produce it**, so an agent whose run withheld the delegation family could read
    /// `SubagentHandle` by name and learn `sendMessage` and `waitForSubagents` from it — discovering,
    /// through documentation, exactly the calls the permission filter exists to keep out of its
    /// sight. [`search`](Self::search) already refuses that name for this agent; a by-name lookup
    /// that answered it would be the same surface leaking through its other half, so the two answer
    /// the same predicate.
    ///
    /// A refused type is answered with `None` — the same answer a name that does not exist gets — so
    /// a withheld type reads as *there is no documentation for that* rather than as *there is, and
    /// you may not have it*, which would itself be the disclosure.
    pub fn read_type(&self, name: &str) -> Option<String> {
        let declaration = type_declaration(self.language, name)?;
        self.type_is_reachable(&declaration.name)
            .then(|| declare(declaration))
    }

    /// Whether some function this agent's scope binds refers to the type called `name` — the
    /// visibility predicate [`read_type`](Self::read_type) and [`search`](Self::search) share.
    ///
    /// It reads the catalogue's own transitively-closed
    /// [`types`](CatalogueFunction::types) list rather than the depth-one narrowing
    /// [`types_to_open`](Self::types_to_open) applies, and the difference is deliberate: this asks
    /// *can this agent reach a value of this shape at all*, which a type buried two levels inside a
    /// bound function's return value plainly can be. Narrowing it to depth one would refuse an agent
    /// the declaration of a field of something it holds.
    ///
    /// The `list` meta function counts, and has to: it is the carve-out bound on every object
    /// whatever a run enables, so the type it hands back is reachable by an agent with no tools at
    /// all. It has no catalogue entry to be found among the others, which is the only reason it is
    /// named here separately rather than falling out of the same fold.
    fn type_is_reachable(&self, name: &str) -> bool {
        let catalogued = catalogue_functions(self.language)
            .into_iter()
            .any(|function| {
                function
                    .types
                    .iter()
                    .any(|referenced| referenced.fqn() == name)
                    && self.bound(&function)
            });
        catalogued
            || meta_function(self.language, LIST_FUNCTION)
                .is_some_and(|meta| meta.types.iter().any(|referenced| referenced.fqn() == name))
    }

    /// One key's documentation, whichever kind of thing it addresses — a function first, a type
    /// otherwise.
    ///
    /// The single entry point everything that re-derives a [docview](crate::context::OpenDocview)
    /// from its key goes through, so a re-seeded window cannot come back holding a different kind of
    /// block than the one it lost. Functions win a collision because a function is what a model
    /// calls, and a name it can write into a program is the one it more likely meant; on today's
    /// bare-name catalogue that is a judgement, and it stops being one as soon as keys are
    /// module-qualified and the two namespaces cannot meet.
    pub fn read_any(&self, key: &str) -> Option<String> {
        self.read(key).or_else(|| self.read_type(key))
    }

    /// The SDK types to open beside the function called `name`, under `mode` — the whole of the
    /// transitive rule, and **exactly one level deep**.
    ///
    /// Empty for [`Off`](DocViewTypes::Off), for a name that is not a bound function (a type has no
    /// signature to read types out of, which is what makes the rule non-recursive by construction
    /// rather than by a depth counter), and for a function whose signature names no catalogued
    /// type. Names are returned in catalogue order and deduplicated, so the views land in a stable
    /// order whatever the model asked for.
    ///
    /// # Why the catalogue's own `types` list cannot be used as it stands
    ///
    /// [`CatalogueFunction::types`] is **transitively closed** — it is gathered so that a consumer
    /// can declare every type a run's surface can reach, which is a different question from *what
    /// does this one signature say*. Read raw it is a closure, not a depth: `read_file`'s entry on
    /// the Rust arm carries `ToolErrorCode` (a field of `ToolError`), `TextFile` and `ImageFile`
    /// (variants of `FileRead`), none of which the signature
    /// `read_file(path: &str, options: ReadOptions) -> Result<FileRead, ToolError>` writes down.
    /// Opening those would be depth 2 and beyond, which is exactly what the one-level rule forbids —
    /// and it would do it silently, since a closure that happens to be shallow on one arm (the two
    /// ECMAScript arms) is four times as deep on the compiled ones, so the same rule would cost four
    /// times as much context for reasons that have nothing to do with the model.
    ///
    /// So the closure is **narrowed to the names the function's own shapes write**: the rendered
    /// signature text of each shape, plus each documented parameter's declared type (which is the
    /// same set on the arms that render types into the signature, and the only source of them on the
    /// arms that do not). A field's type is a second level and is never read, which is what keeps
    /// this from re-widening into the closure it started from.
    ///
    /// # How the return position is told from the arguments
    ///
    /// By elimination, over that narrowed set: a catalogued type named by one of the function's own
    /// documented **parameters** is an argument type, and every other type the signature names is
    /// reached through what it hands back. The catalogue records no return position of its own, so
    /// this is the closest honest reading of it available — and it errs toward *showing* rather than
    /// withholding, since a type named only by a field of an argument's type is not named by the
    /// argument itself. The [normalized schema](crate::sandbox::SchemaVersion::V2) carries a real
    /// return position — [`CatalogueFunction::returns`](crate::sandbox::CatalogueFunction) — and an
    /// arm that has been converted to it replaces this inference with a field lookup;
    /// [`ReturnAndParameters`](DocViewTypes::ReturnAndParameters) and [`Off`](DocViewTypes::Off) are
    /// exact today and are unaffected either way.
    pub fn types_to_open(&self, name: &str, mode: DocViewTypes) -> Vec<&'static str> {
        if mode == DocViewTypes::Off {
            return Vec::new();
        }
        let Some(function) = self.function(name) else {
            return Vec::new();
        };
        let mut names: Vec<&'static str> = Vec::new();
        for referenced in function.types {
            let declaration = match type_declaration(self.language, referenced.fqn()) {
                Some(declaration) => declaration,
                // A referenced name this language's catalogue does not declare has nothing to
                // render, so there is no view to open for it. The agreement gate holds every arm to
                // declaring what it references, so this is drift rather than a run-time condition.
                None => continue,
            };
            // Depth one, applied before the mode split: a referenced type no shape of this function
            // writes down was reached through some *other* type, and is a level the rule does not
            // reach. See *Why the catalogue's own `types` list cannot be used as it stands*.
            if !names_a_signature(&function, &declaration.name) {
                continue;
            }
            if mode == DocViewTypes::ReturnOnly && names_a_parameter(&function, &declaration.name) {
                continue;
            }
            let name = declaration.name.as_str();
            if !names.contains(&name) {
                names.push(name);
            }
        }
        names
    }

    /// The bound catalogue function called `name`, or `None` — the lookup [`read`](Self::read) and
    /// [`types_to_open`](Self::types_to_open) share, so the two cannot disagree about which entry a
    /// name resolves to.
    fn function(&self, name: &str) -> Option<CatalogueFunction> {
        catalogue_functions(self.language)
            .into_iter()
            .find(|function| function.name == name && self.bound(function))
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
            .chain(meta_function(self.language, LIST_FUNCTION).map(|meta| meta.name.as_str()))
            .collect();
        suggest::nearest(name, bound)
    }

    /// **Whether this agent's scope binds a function** — the one predicate deciding what a model may
    /// be shown, and the reason nothing else may grow a second copy of it.
    ///
    /// It answers from gg's [operations table](crate::sandbox::operation_of) rather than from the
    /// catalogue entry's own gate fields, and that is a deliberate reversal. The three gates the
    /// module header describes are all still here — a tool this run enabled, this agent's ending
    /// role, a capability it holds — but which of them applies to a given function is now gg's
    /// answer, stated once, instead of a claim eleven committed catalogues each make about
    /// themselves. An arm has nothing left to be wrong about, and the three gates read as the three
    /// arms of one [`Binding`] instead of a boolean, a pair and a fall-through.
    ///
    /// A function gg has **no** operation for is not bound. That is drift rather than a run-time
    /// condition — an arm binding something gg has no identity for — and refusing to document it is
    /// the safe direction: a directory that lists a call the scope did not bind is the one thing a
    /// directory must never do. `every_catalogued_function_has_an_operation` proves the case
    /// unreachable for every registered language.
    ///
    /// Public because the [agent surface](test_cabinet_core::gg::GgTelemetryKind::AgentSurface)
    /// reports the very same set and used to answer it with a verbatim copy of this predicate. Two
    /// copies of "may this agent call X" is one copy too many the moment either grows a gate.
    pub fn bound(&self, function: &CatalogueFunction) -> bool {
        match operation_of(function) {
            Some(operation) => match operation.binding {
                Binding::Tool(tool) => self.enabled.contains(tool),
                Binding::Ending(role) => role == self.role,
                Binding::Capability(id) => self.capabilities.contains(id),
                Binding::Always => true,
            },
            None => false,
        }
    }
}

/// Assemble one function's documentation: how it may be called, what each argument is for, and its
/// description.
///
/// The types the signature mentions are **not** here; they are views of their own — see the module's
/// *A function and a type are two views, not one block*.
///
/// A function is rendered with **every** signature the language offers it in, because for some
/// languages that is how an optional argument is spelled: an overload pair reads as two ways to call
/// one function, and showing only the first would tell a model half of what it may write. Under a
/// language that spells options with a default there is exactly one, and the rendering is the single
/// line it always was.
///
/// It takes the two fields rather than a [`CatalogueFunction`] because the
/// [meta functions](crate::sandbox::MetaSignature) are documented by exactly this rendering and have
/// no object to hang off — one assembly for the whole surface, so a lookup of `list` cannot come out
/// looking like a different kind of thing than a lookup of `fs.readFile`.
fn assemble(signatures: &[SignatureEntry], doc: &str) -> String {
    let mut text = String::new();
    for entry in signatures {
        text.push_str(&entry.signature);
        text.push('\n');
        for parameter in &entry.parameters {
            describe(&mut text, parameter, 1);
        }
    }
    text.push('\n');
    text.push_str(doc);
    text
}

/// Whether any shape of `function` **names** `type_name` in what it writes down: the rendered
/// signature text, or one of its documented parameters' declared types.
///
/// This is the depth-one test, and it is what stops
/// [`types_to_open`](DocsRuntime::types_to_open) from inheriting the transitive closure that
/// [`CatalogueFunction::types`] is. Both halves are read because neither covers every arm: most
/// render their parameter types into the signature line, and the arms that render an untyped call
/// shape (Ruby's `read_file(path, offset:, limit:)`) carry the types only on the parameters — and an
/// arm read through the signature alone would silently collapse
/// [`ReturnAndParameters`](DocViewTypes::ReturnAndParameters) into
/// [`ReturnOnly`](DocViewTypes::ReturnOnly).
///
/// A parameter's inline [fields](Parameter::fields) are deliberately **not** read: a field's type is
/// a second level, and reading it here would put back one of the levels this test exists to remove.
fn names_a_signature(function: &CatalogueFunction, type_name: &str) -> bool {
    function.signatures.iter().any(|entry| {
        mentions(&entry.signature, type_name)
            || entry
                .parameters
                .iter()
                .any(|parameter| mentions(&parameter.r#type, type_name))
    })
}

/// Whether any shape of `function` takes an argument whose declared type **names** `type_name` —
/// the test that sorts an argument type from a returned one, for
/// [`types_to_open`](DocsRuntime::types_to_open).
///
/// The match is on whole identifiers rather than on substrings, because a bare `contains` would read
/// `FileRead` out of `FileReadOptions` and quietly reclassify a return as an argument. Only the
/// parameter's own declared type is read, never its inline [fields](Parameter::fields): a field's
/// type is a *second* level, and treating one as named by the argument would make
/// [`ReturnOnly`](DocViewTypes::ReturnOnly) withhold a type the return position also uses.
fn names_a_parameter(function: &CatalogueFunction, type_name: &str) -> bool {
    function.signatures.iter().any(|entry| {
        entry
            .parameters
            .iter()
            .any(|parameter| mentions(&parameter.r#type, type_name))
    })
}

/// Whether `text` contains `name` as a whole identifier — not as part of a longer one.
///
/// A declared type is written into prose-free syntax (`Vec<DirEntry>`, `option<file-read>`,
/// `ReadOptions?`), so the delimiters are anything that cannot continue an identifier. `_` counts as
/// a continuation, which is what keeps `read` from matching `read_file`.
fn mentions(text: &str, name: &str) -> bool {
    let is_identifier = |c: char| c.is_alphanumeric() || c == '_';
    let mut from = 0;
    while let Some(offset) = text[from..].find(name) {
        let start = from + offset;
        let end = start + name.len();
        let before = text[..start].chars().next_back().is_some_and(is_identifier);
        let after = text[end..].chars().next().is_some_and(is_identifier);
        if !before && !after {
            return true;
        }
        // Advance by one character rather than by the match, so an overlapping occurrence that
        // *would* stand alone is still found.
        from = start + text[start..].chars().next().map_or(1, char::len_utf8);
    }
    false
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
        ParameterKind::Block => " (given as a block)",
    };
    text.push_str(&format!(
        "{indent}{}{optional}: {}{default}{passing} — {}\n",
        parameter.name, parameter.r#type, parameter.doc
    ));
    for field in &parameter.fields {
        describe(text, field, depth + 1);
    }
}

/// One type declaration, with a line per member — the whole body of a **type** docview.
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

#[cfg(test)]
#[path = "docs.mode.test.rs"]
mod mode_tests;

#[cfg(test)]
#[path = "docs.discoverability.test.rs"]
mod discoverability_tests;
