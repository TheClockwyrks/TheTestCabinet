//! The documentation carve-out's runtime state.
//!
//! Under [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/views/) the system prompt no
//! longer lists every tool signature — and, since the prompt rewrite, names no function at all. It
//! names the modules a program's surface is divided into and says, in words, that a model can always
//! do two things: search for a function by keyword, and open a documentation view of one to read
//! what it is. This is the host state behind those two calls, and it is the only route to them: the
//! model reads their spellings out of the [bootstrap](crate::bootstrap) turn its session opens with,
//! not out of the prompt.
//!
//! **There is no directory call.** Nothing enumerates a module's functions under a name of its own,
//! and that is a decision rather than an omission: [`search`](DocsRuntime::search) is the only route
//! in, and it is global — one query reaches every module at once, so nothing is discovered by
//! already knowing where to look. A whole-module listing is therefore a *shape* of that one call
//! rather than a second one — an [empty query with a module filter](DocQuery), which is an exact
//! lookup rather than a ranking — and it is the shape the [bootstrap](crate::bootstrap) uses to hand
//! an agent every module it was granted before its first real turn.
//!
//! **Looking something up is deliberately not a capability.** Like [`finish`](crate::sandbox), it is
//! a carve-out: no toolset offers it, no capability withholds it, and it is bound into every program's
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
//! Both answers depend on facts only gg holds: which capabilities this agent's profile switches on,
//! which of the operations they offer its [allowlist](test_cabinet_core::gg::GgAgentConfig::operations)
//! names, and which [ending role](EndingRole) it was dispatched in. A search index baked into the
//! guest would return functions the grant did not cover, which is the one thing a search must never
//! do.
//!
//! Which of those decides a given function is not a fact the guest holds either, and — since
//! the [operations table](crate::sandbox::operation_of) — it is no longer a fact each arm's own
//! catalogue asserts about itself. gg states it once, and
//! [`bound`](DocsRuntime::bound) is where it is read.
//!
//! # Whose spellings it answers in
//!
//! Which functions exist, and which of them this agent binds, are the same in every
//! [program language](test_cabinet_core::gg::GgProgramLanguage) — that is what makes a
//! cross-language study a measurement of the language rather than of the surface. What differs is
//! how each is **spelled**, and a signature is nothing but a spelling. So a runtime is built for one
//! language and reads that language's catalogue alone: an answer in a language the model is not
//! writing would be naming calls it cannot make.
//!
//! # A function and a type are two views, not one block
//!
//! [`read`](DocsRuntime::read) renders one **function**: every shape it may be called in with a line
//! per argument, [where it is defined and how a program reaches it](DocsRuntime::defined_in), and the
//! description. It does **not** carry the declarations of the types the signature mentions. Those are
//! [views of their own](DocsRuntime::read_type), addressed by the type's name, and one open of a
//! function [places](crate::context::ContextModel::open_docview) them beside it according to the
//! agent's [`DocViewTypes`] flags.
//!
//! Folding them in was the older shape, and it made two things impossible. The declarations were
//! repeated in full in every function view that mentioned the type, so an agent reading five
//! functions over one record read the record five times and could reclaim none of the copies. And
//! there was nothing to *measure*: whether a model does better shown a return type up front, shown
//! the types its arguments declare, shown the failures it may have to catch, or shown none until it
//! asks, is a question with a knob per source, and a block that always carries all of them answers
//! it with one.
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
//! names it is nearly. See [`suggest`] for what "nearly" means and why the candidates are the bound
//! ones alone.

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgProgramLanguage};

use crate::ending::EndingRole;
use crate::sandbox::{
    CatalogueFunction, FunctionSummary, Grants, MemberFunction, OperationId, Parameter,
    ParameterKind, ProgramLanguage, TypeDeclaration, TypeReference, catalogue_functions, language,
    module_of, operation_by_id, operation_of, type_declaration,
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

/// **One flag** of an agent's [`docViewTypes`](DocViewTypes): one source of types a documentation
/// view may place beside the function it opens.
///
/// The three are independent of each other, which is what makes them flags rather than the arms of
/// a mode. What each of them places is written on its own variant, and the whole of what an open
/// places is the union of the enabled ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocViewType {
    /// The types the signature writes in the **return** position. On by default.
    Return,
    /// The types the function's **arguments** declare. Off by default.
    Parameters,
    /// The **error** types the function's own documentation comment declares it throws, from the
    /// catalogue's [`throws`](crate::sandbox::CatalogueFunction::throws) list. On by default.
    Errors,
}

/// The `docViewTypes` key naming [`DocViewType::Return`].
const DOC_VIEW_TYPE_RETURN: &str = "return";
/// The `docViewTypes` key naming [`DocViewType::Parameters`].
const DOC_VIEW_TYPE_PARAMETERS: &str = "parameters";
/// The `docViewTypes` key naming [`DocViewType::Errors`].
const DOC_VIEW_TYPE_ERRORS: &str = "errors";

/// The [telemetry id](DocViewTypes::id) of a configuration with **every** flag off — the one state
/// that would otherwise be recorded as an empty string, which no reader could tell from a run that
/// recorded nothing.
const DOC_VIEW_TYPES_NONE: &str = "none";

/// What joins the enabled flags into one [telemetry id](DocViewTypes::id).
const DOC_VIEW_TYPES_JOIN: &str = "+";

impl DocViewType {
    /// The three flags, **in the fixed order** a [telemetry id](DocViewTypes::id) joins them in and
    /// a [refusal](crate::validate) offers them back.
    pub const ALL: [Self; 3] = [Self::Return, Self::Parameters, Self::Errors];

    /// The flag's stable id — the `docViewTypes` key that toggles it, and the word a
    /// [telemetry id](DocViewTypes::id) is assembled from.
    pub fn id(self) -> &'static str {
        match self {
            Self::Return => DOC_VIEW_TYPE_RETURN,
            Self::Parameters => DOC_VIEW_TYPE_PARAMETERS,
            Self::Errors => DOC_VIEW_TYPE_ERRORS,
        }
    }

    /// The flag `id` names, or `None` for a key gg does not know.
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|flag| flag.id() == id)
    }

    /// Whether the flag is on in a configuration that says nothing about it.
    ///
    /// [`Return`](Self::Return) and [`Errors`](Self::Errors) are on and
    /// [`Parameters`](Self::Parameters) is off: what a call hands back and how it fails are the two
    /// things a model has to hold to use the result, while an argument's type is written into the
    /// signature the model is already reading.
    pub fn default_on(self) -> bool {
        match self {
            Self::Return | Self::Errors => true,
            Self::Parameters => false,
        }
    }
}

/// Which of the SDK types a function names are opened as
/// [documentation views](crate::context::ViewKind::Docs) beside it, when the model opens that
/// function's own — **three independent toggles**, not a three-way mode.
///
/// # Why these are knobs rather than decisions
///
/// Every setting of them is defensible and none is obviously right, which is the definition of
/// something worth measuring rather than choosing. Opening the **return** type lands the agent on
/// what it can do with the value it is about to get, which is the case for it — and is not
/// automatically the cheaper arm, because a function returning a list of records opens the record,
/// whose own fields may reference further types the agent then has to ask for one at a time: three
/// round trips where one open of everything in the signature would have been one. Opening
/// **nothing** is cheapest per open and costs a turn whenever the model needs a shape it was not
/// given. So gg holds every combination and reports which one a run was configured with.
///
/// It is per **agent**, like the [program language](crate::sandbox::resolve_program_language) it
/// sits beside, so one run can hold two agents at two languages *and* two sets of flags.
///
/// # What it is not
///
/// It is not a *depth*. Whichever flags are set, exactly one level is opened: a type view never
/// opens another type view, not even for a field whose type is itself catalogued. There is
/// therefore no closure to compute, no cycle to detect and no termination rule — and an agent that
/// wants the second level opens it by name, which is one call and is visible in the record as a
/// thing the model chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DocViewTypes {
    /// [`DocViewType::Return`].
    returns: bool,
    /// [`DocViewType::Parameters`].
    parameters: bool,
    /// [`DocViewType::Errors`].
    errors: bool,
}

impl Default for DocViewTypes {
    /// Each flag at [its own default](DocViewType::default_on) — which is *not* the same thing as
    /// "everything on": `return` and `errors` are on, `parameters` is off.
    ///
    /// Built by folding [`default_on`](DocViewType::default_on) over
    /// [`ALL`](DocViewType::ALL) rather than by listing bools, so a flag's default lives in exactly
    /// one place and a new flag cannot be added here with a silently different one.
    fn default() -> Self {
        let mut types = Self::OFF;
        for flag in DocViewType::ALL {
            types.set(flag, flag.default_on());
        }
        types
    }
}

impl DocViewTypes {
    /// Every flag off — what the master switch (`"docViewTypes": false`) produces. A function's
    /// signature names its types; reading one is then a call the model makes for itself.
    pub const OFF: Self = Self {
        returns: false,
        parameters: false,
        errors: false,
    };

    /// Whether `flag` is on.
    pub fn enabled(&self, flag: DocViewType) -> bool {
        match flag {
            DocViewType::Return => self.returns,
            DocViewType::Parameters => self.parameters,
            DocViewType::Errors => self.errors,
        }
    }

    /// Turn one flag on or off.
    pub fn set(&mut self, flag: DocViewType, on: bool) {
        let field = match flag {
            DocViewType::Return => &mut self.returns,
            DocViewType::Parameters => &mut self.parameters,
            DocViewType::Errors => &mut self.errors,
        };
        *field = on;
    }

    /// **Exactly one flag on**, and the other two off — what the console's reference computes each
    /// flag's own column with, since a column says what that flag alone would place.
    pub fn only(flag: DocViewType) -> Self {
        let mut types = Self::OFF;
        types.set(flag, true);
        types
    }

    /// The enabled flags, in [the fixed order](DocViewType::ALL).
    pub fn on(&self) -> Vec<DocViewType> {
        DocViewType::ALL
            .into_iter()
            .filter(|flag| self.enabled(*flag))
            .collect()
    }

    /// The configuration's stable id — what the run was configured with, and what a replay reads to
    /// tell one arm of the comparison from another.
    ///
    /// The enabled flags joined with `+` in [the fixed order](DocViewType::ALL), so one
    /// configuration has exactly one spelling however an operator wrote the object, and
    /// [`none`](DOC_VIEW_TYPES_NONE) when every flag is off — because an empty string is the one
    /// answer a reader could not tell from a record that carries nothing.
    pub fn id(&self) -> String {
        let on = self.on();
        if on.is_empty() {
            return DOC_VIEW_TYPES_NONE.to_string();
        }
        on.into_iter()
            .map(DocViewType::id)
            .collect::<Vec<_>>()
            .join(DOC_VIEW_TYPES_JOIN)
    }
}

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability param choosing which of a
/// function's types a documentation view opens beside it. Absent takes [`DocViewTypes::default`].
pub const PARAM_DOC_VIEW_TYPES: &str = "docViewTypes";

/// The [locus](crate::validate::param_locus) every `docViewTypes` refusal is filed under, and the
/// stem each per-key refusal appends its key to.
fn doc_view_types_locus() -> String {
    crate::validate::param_locus(CAPABILITY_RESPONSES_AS_CODE, PARAM_DOC_VIEW_TYPES)
}

/// Resolve the [documentation-view type flags](DocViewTypes) from this agent's
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's
/// [`docViewTypes`](PARAM_DOC_VIEW_TYPES) param.
///
/// The param names a **delta against the defaults**, not a whole configuration, exactly as
/// [`healing`](crate::healing::resolve_healing) does. Saying nothing means
/// [the defaults](DocViewTypes::default) — which is *not* "everything on", because
/// [`parameters`](DocViewType::Parameters) is [off by default](DocViewType::default_on).
///
/// | `params.docViewTypes` | Meaning |
/// | --- | --- |
/// | absent / `null` / `true` / `{}` | the **defaults** — `return` and `errors` on, `parameters` off |
/// | `false` | every flag **off** — the master switch |
/// | `{ "parameters": true }` | `parameters` on, the rest at their defaults |
/// | `{ "return": false }` | `return` off, the rest at their defaults |
/// | `{ "return": 0 }` | **refused**: a non-boolean is not a toggle |
/// | `{ "returns": true }` | **refused**: `returns` names no flag |
/// | `5`, `"off"`, `[]` | **refused**: there is no set of toggles here to read |
///
/// A key or value gg cannot act on [refuses the launch](crate::validate) rather than leaving the
/// default standing, for the reason [`resolve_healing`](crate::healing::resolve_healing) refuses
/// one: `{"returns": false}` reads as a run with `return` **on**, which is the arm its author was
/// trying to switch off, and the [agent surface](crate::telemetry) records the *resolved* flags, so
/// a typo read as the default would leave a run whose every record says it ran the arm it did not.
/// The flag ids are **contract-visible** — they are what the console's capability catalogue writes
/// and what persisted run data records — so they are read literally, with only surrounding
/// whitespace forgiven, and never guessed at. The defaults come back anyway to keep the resolver
/// total for the per-turn calls that re-read it.
///
/// The flags are read whether the capability is switched on or off, on the rule the whole params
/// table follows: a disabled capability records the configuration the arm would have used, so the
/// two arms of one comparison stay symmetric, and a typo skipped because a switch happened to be
/// off is a typo that surfaces on the launch where it is flipped.
pub fn resolve_doc_view_types(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> DocViewTypes {
    let mut types = DocViewTypes::default();
    let Some(capability) = profile.capability(CAPABILITY_RESPONSES_AS_CODE) else {
        return types;
    };
    let Some(value) = capability.params.get(PARAM_DOC_VIEW_TYPES) else {
        return types;
    };

    match value {
        // Three spellings of "say nothing", all meaning the default set: a key written out as null,
        // an explicit `true`, and an object that changes nothing.
        Value::Null | Value::Bool(true) => {}
        Value::Bool(false) => types = DocViewTypes::OFF,
        Value::Object(toggles) => {
            for (key, value) in toggles {
                match (DocViewType::from_id(key.trim()), value.as_bool()) {
                    // The one arm that moves a flag off its default, in either direction: `false`
                    // turns off `return` or `errors`, and `true` turns on `parameters`.
                    (Some(flag), Some(on)) => types.set(flag, on),
                    // A known key carrying something that is not a toggle: reading `0` as `false`
                    // would be gg deciding what an operator meant, which is the whole of what this
                    // refusal exists to stop.
                    (Some(flag), None) => report.report(crate::validate::LaunchDefect::run_level(
                        format!("{}.{key}", doc_view_types_locus()),
                        crate::validate::as_written(value),
                        format!(
                            "the `{}` documentation-view type is opened or withheld with `true` or \
                             `false`; gg cannot read this as either, and leaving it at its default \
                             would open a different amount of documentation than this line was \
                             written to ask for.",
                            flag.id()
                        ),
                    )),
                    (None, _) => report.report(
                        crate::validate::LaunchDefect::run_level(
                            format!("{}.{key}", doc_view_types_locus()),
                            crate::validate::as_written(value),
                            format!(
                                "`{key}` names no documentation-view type, so it opens and \
                                 withholds nothing; the agent would read a set of types nobody \
                                 wrote."
                            ),
                        )
                        .known(DocViewType::ALL.map(DocViewType::id)),
                    ),
                }
            }
        }
        other => report.report(
            crate::validate::LaunchDefect::run_level(
                doc_view_types_locus(),
                crate::validate::as_written(other),
                format!(
                    "the `{PARAM_DOC_VIEW_TYPES}` param is `true` (the defaults), `false` (every \
                     type withheld), or an object of per-type toggles; there is nothing here gg \
                     can read a set of types from."
                ),
            )
            .known(DocViewType::ALL.map(DocViewType::id)),
        ),
    }

    types
}

/// The documentation half of one profile's contribution to the
/// [launch pass](crate::validate::validate_launch): the [type flags](DocViewTypes) it declares, read
/// exactly as the run will read it.
pub fn check_launch(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    resolve_doc_view_types(profile, report);
}

/// The per-agent state behind `search` and `view.openDocsView()`: what this agent was
/// [granted](Grants), which is what decides which functions exist to be documented.
pub struct DocsRuntime {
    /// What this agent was granted — the capability ids it holds, its [ending role](EndingRole) and
    /// the operations its own allowlist names — held as the one value the membrane also holds.
    ///
    /// It is deliberately not three fields read by a predicate written here. Every arm's SDK is
    /// static, so the membrane refuses a call this agent was not granted, and a membrane that
    /// permitted what this runtime would not describe (or the reverse) would be lying to the model
    /// in one direction or the other. One type, one reading, both readers.
    grants: Grants,
    /// The [program language](test_cabinet_core::gg::GgProgramLanguage) this agent writes in.
    ///
    /// It is not a gate — every language offers the same functions under the same gates — but it
    /// decides how each of them is **spelled**, and a directory or a lookup that answered in a
    /// language the model is not writing would be describing calls it cannot make.
    language: &'static dyn ProgramLanguage,
}

impl DocsRuntime {
    /// A fresh runtime for an agent holding `capabilities`, dispatched in `role`, and granted
    /// `operations` — answering in `program_language`'s spellings.
    ///
    /// Both halves are the agent's own **resolved** ones rather than its profile's: an agent whose
    /// profile asks for a [program library](crate::programs) it was not given keeps neither the
    /// object nor its documentation, and the caller is the only thing that knows which it ended up
    /// with. `operations` is an allowlist, so an empty one describes nothing a capability gates —
    /// which is the same thing the membrane will do, and the reason the two are built from one value.
    pub fn new(
        capabilities: Vec<String>,
        role: EndingRole,
        operations: &[OperationId],
        program_language: GgProgramLanguage,
    ) -> Self {
        Self {
            grants: Grants::new(capabilities, Some(role), operations.iter().copied()),
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

    /// Every function of one **capability family** this agent binds, with one-line summaries.
    ///
    /// # Why gg's family and not the arm's module
    ///
    /// Because the module a function is filed under is the **arm's**, and a family is **gg's**: the
    /// same functions are filed under `gg::files` on one arm and `Gg.Files` on another, so a caller
    /// passing gg's own word for the grouping would get an empty answer rather than a wrong one.
    ///
    /// Empty is exactly the failure worth designing out here, because the one caller is the
    /// [built-in family skill](crate::skills)'s generated on-use script and an empty family makes it
    /// decline to generate a skill at all. So the family is resolved through the
    /// [operation](crate::sandbox::operation_of) each entry binds, which is an identity gg states,
    /// and no arm's own vocabulary is quoted at it.
    ///
    /// **This is not a directory a model can reach.** It is host-side generation: nothing a program
    /// calls arrives here, and the only thing that does is gg writing a skill's script for it. A
    /// model that wants to find a function [searches](Self::search).
    ///
    /// An [alias](crate::sandbox::CatalogueFunction) is left out: it is a second way to reach an
    /// operation the family already names, and naming both would open two documentation views of
    /// one capability.
    pub fn family(&self, family: &str) -> Vec<FunctionSummary> {
        catalogue_functions(self.language)
            .into_iter()
            .filter(|function| function.alias_of.is_none() && self.bound(function))
            .filter(|function| {
                operation_of(function).is_some_and(|operation| operation.family == family)
            })
            .map(|function| FunctionSummary {
                name: function.name.to_string(),
                summary: function.prose.brief.to_string(),
            })
            .collect()
    }

    /// One **function's** documentation by the name it is called by, or `None` for a name this run
    /// did not bind. Every name is a catalogue function, gated by the enabled set — there is no
    /// carve-out entry answered from anywhere else.
    ///
    /// Takes `&self`: a lookup is a pure projection of the catalogue through this agent's scope, and
    /// nothing about having read one changes what the next one says. That is the property the whole
    /// docview mechanism rests on — a view's body is a function of its key, so a
    /// [compaction](crate::compaction) or a [restore](crate::persistence) can re-derive it rather
    /// than replay a stored copy.
    pub fn read(&self, name: &str) -> Option<String> {
        let function = self.function(name)?;
        Some(self.assemble(&function))
    }

    /// One **module's** documentation by the path a program writes it under: what the module is for,
    /// the line that brings it into scope, and a line per function in it this agent binds. `None` for
    /// a path this language's catalogue does not declare, and `None` for a module **no function this
    /// agent binds** belongs to.
    ///
    /// A module is the first thing a model needs and the last thing it could work out for itself.
    /// Nothing gg offers is in scope until the program has imported the module a symbol lives in, so
    /// a model that has found a module and cannot read it has found the name of a door.
    ///
    /// Gated by reachability rather than on its own account, exactly as a type is: a module is not a
    /// call, and an agent that may call something in it must be able to read where that something
    /// lives. A module whose every function this run withheld is `None`, so the module list a model
    /// can reach never describes a surface it cannot use.
    pub fn read_module(&self, path: &str) -> Option<String> {
        let module = module_of(self.language.catalogue(), path)?;
        let functions: Vec<CatalogueFunction> = catalogue_functions(self.language)
            .into_iter()
            .filter(|function| {
                operation_of(function).is_some_and(|operation| operation.id.namespace == module.id)
                    && self.bound(function)
            })
            .collect();
        if functions.is_empty() {
            return None;
        }
        let mut text = format!(
            "{}\n\n{}\n\n{}",
            module.path,
            // The same sentence a function's and a type's view carry, from the same place, so the
            // one line a model copies to reach anything reads identically wherever it meets it.
            self.defined_in(module.id),
            module.prose.rendered()
        );
        for function in &functions {
            text.push_str(&format!("\n  {} — {}", function.fqn, function.prose.brief));
        }
        Some(text)
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
        // Reachability is asked under the string a reference RESOLVES to rather than under the bare
        // name a signature wrote, because those are two different strings and asking under the
        // wrong one refuses every type the arm declares. See `TypeDeclaration::key`.
        self.type_is_reachable(declaration.key())
            .then(|| self.declare(declaration))
    }

    /// One type declaration, [where it is defined](Self::defined_in), a line per member and then a
    /// line per **member function** this agent binds — the whole body of a **type** docview.
    ///
    /// The declaration alone says what fields a record has and nothing about what any of them
    /// *means*, and `shown: boolean` on a `FileRead` is not a thing a model can infer. A union arm
    /// carries no type of its own — the arm is the value — so it is rendered as the bare literal.
    ///
    /// The definition line sits under the declaration rather than over it, so a view still opens
    /// with the shape the model came for; it is the [same line](Self::defined_in) a function view
    /// carries, because a type is named at a call site under the same module the call is.
    ///
    /// Both the type's own lines and each member's are read through
    /// [`Prose`](crate::sandbox::Prose), which is where the authored brief and the detail under it
    /// live.
    ///
    /// # Why the member functions are here, and why they are gated
    ///
    /// A member function is the *second* way to reach an operation the surface already binds —
    /// `view.close()` on the open view a listing handed back, rather than
    /// `views.close(view.selector)` — and it is discoverable nowhere else on the path a model
    /// actually walks: it opens the declaration of what a call gave it, and the affordance has to be
    /// *in that view* or it is found only by someone who already knew to search for it. One line
    /// each, which is what a [`MemberFunction`] carries: its fully-qualified name, which is the key
    /// that opens its own documentation, and its brief.
    ///
    /// It is gated by the same [`bound`](Self::bound) predicate every other name is, and the gate is
    /// load-bearing rather than defensive: a type is visible when *some* bound function reaches it,
    /// which is a weaker condition than every operation hanging off it being bound. Listing an
    /// unbound helper would hand a model the name of a call its permission filter exists to keep out
    /// of sight — the disclosure [`read_type`](Self::read_type)'s own gate is written to prevent.
    fn declare(&self, declaration: &'static TypeDeclaration) -> String {
        let mut text = format!(
            "{}\n\n{}\n\n{}",
            declaration.declaration,
            self.defined_in(&declaration.module),
            declaration.prose().rendered()
        );
        for member in &declaration.members {
            let prose = member.prose();
            let documented = prose.rendered();
            match &member.r#type {
                Some(kind) => text.push_str(&format!("\n  {}: {kind} — {documented}", member.name)),
                None => text.push_str(&format!("\n  {} — {documented}", member.name)),
            }
        }
        let offered: Vec<&MemberFunction> = declaration
            .member_functions
            .iter()
            .filter(|member| {
                operation_by_id(&member.operation)
                    .is_some_and(|operation| self.grants.permits(operation))
            })
            .collect();
        if !offered.is_empty() {
            text.push_str("\n\nWhat a value of it can do, each openable by the name below:");
            for member in offered {
                text.push_str(&format!("\n  {} — {}", member.fqn, member.brief));
            }
        }
        text
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
    /// Every function this asks about is a catalogue function. There is no longer a carve-out entry
    /// sitting outside the catalogue whose types had to be folded in separately — that was `list`,
    /// and with it gone reachability is one fold over one array.
    fn type_is_reachable(&self, name: &str) -> bool {
        catalogue_functions(self.language)
            .into_iter()
            .any(|function| {
                function
                    .types
                    .iter()
                    .any(|referenced| referenced.fqn() == name)
                    && self.bound(&function)
            })
    }

    /// One key's documentation, whichever kind of thing it addresses — a function first, a type
    /// otherwise.
    ///
    /// The single entry point everything that re-derives a [docview](crate::context::OpenDocview)
    /// from its key goes through, so a re-seeded window cannot come back holding a different kind of
    /// block than the one it lost. Functions win a collision because a function is what a model
    /// calls, and a name it can write into a program is the one it more likely meant. Both halves
    /// are keyed by their module-qualified name and the two namespaces cannot meet, so the
    /// judgement is only ever reached through the *fallback* bare names each half also answers to.
    pub fn read_any(&self, key: &str) -> Option<String> {
        self.read(key)
            .or_else(|| self.read_type(key))
            .or_else(|| self.read_module(key))
    }

    /// **The single key** whatever `name` addresses is filed under, or `None` when this agent binds
    /// nothing under it. Resolution only — nothing is rendered.
    ///
    /// Every entry answers to two strings: its fully-qualified name and its bare one. That is
    /// deliberate — a model reads the first in a search hit and writes the second at a call site,
    /// and refusing either would be refusing documentation over a spelling. What must not follow is
    /// that the two spellings address two different *things*. The
    /// [documentation band](crate::context::OpenDocview) is keyed by the string a view was opened
    /// under, and it rests on a re-open being a total no-op; a lookup spelled one way and then the
    /// other would place the same page twice, so the model pays for one page twice and a study
    /// reading the band counts one page as two — noise landing on the very measurement the band
    /// exists to support.
    ///
    /// So matching stays lenient and *identity* is canonicalized here: a function's
    /// [fully-qualified name](CatalogueFunction), and a type's
    /// [`key`](crate::sandbox::TypeDeclaration::key) — which is the normalization the type half
    /// already applied to itself. A caller that holds a canonical key already (a
    /// [restore](crate::persistence::restore_docviews), a [compaction](crate::compaction)) is
    /// unaffected, because a canonical key resolves to itself.
    ///
    /// It asks the two questions [`read_any`](Self::read_any) asks, in the same order and against
    /// the same gates, so the two agree on what exists and on which of a function and a type wins a
    /// collision.
    pub fn docview_key(&self, name: &str) -> Option<String> {
        if let Some(function) = self.function(name) {
            return Some(function.fqn.to_string());
        }
        if let Some(declaration) = type_declaration(self.language, name)
            && self.type_is_reachable(declaration.key())
        {
            return Some(declaration.key().to_string());
        }
        // A module answers to gg's id and to this arm's path, the same leniency a function and a
        // type get; the path is the canonical one, because it is the string search files the hit
        // under and the string a program writes.
        let module = module_of(self.language.catalogue(), name)?;
        self.read_module(module.path)
            .map(|_| module.path.to_string())
    }

    /// The SDK types to open beside the function called `name`, under `types` — the whole of the
    /// transitive rule, and **exactly one level deep**.
    ///
    /// Empty for [`OFF`](DocViewTypes::OFF), for a name that is not a bound function (a type has no
    /// signature to read types out of, which is what makes the rule non-recursive by construction
    /// rather than by a depth counter), and for a function that names no catalogued type under any
    /// enabled flag. Names are returned in catalogue order and deduplicated, so the views land in a
    /// stable order whatever the model asked for.
    ///
    /// # The three flags are read independently and unioned
    ///
    /// [`Return`](DocViewType::Return) and [`Parameters`](DocViewType::Parameters) both select out
    /// of the narrowed signature set described below, by the two predicates that sort a returned
    /// type from an argument one. [`Errors`](DocViewType::Errors) does not read the signature at
    /// all: a declared failure is written in a documentation comment rather than in a signature, so
    /// its source is the catalogue's own
    /// [`throws`](crate::sandbox::CatalogueFunction::throws) list, which each reflector states from
    /// its arm's own tag for declaring one. Narrowing that list by what a signature writes down
    /// would withhold every error on every arm.
    ///
    /// A type more than one flag selects is placed once, because a view is keyed by the type.
    ///
    /// # Why the catalogue's own `types` list cannot be used as it stands
    ///
    /// [`CatalogueFunction::types`] is **transitively closed** — it is gathered so that a consumer
    /// can declare every type a run's surface can reach, which is a different question from *what
    /// does this one signature say*. Read raw it is a closure, not a depth: `read_file`'s entry on
    /// the Rust arm carries `ApiErrorCode` (a field of `ApiError`), `TextFile` and `ImageFile`
    /// (variants of `FileRead`), none of which the signature
    /// `read_file(path: &str, options: ReadOptions) -> Result<FileRead, ApiError>` writes down.
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
    /// By the catalogue's own [return position](crate::sandbox::CatalogueFunction), which each
    /// reflector resolves out of its arm's type system. A call that returns nothing an SDK type
    /// names states an empty one, and there the answer falls back to elimination over the narrowed
    /// set: a catalogued type named by one of the function's own documented **parameters** is an
    /// argument type, and every other type the signature names is reached through what it hands
    /// back. That fallback errs toward *showing* rather than withholding, since a type named only by
    /// a field of an argument's type is not named by the argument itself.
    /// [`Parameters`](DocViewType::Parameters) asks the mirrored question — does one of this
    /// function's own documented arguments declare it — and the two are asked independently, so a
    /// type in both positions is selected by either flag alone.
    pub fn types_to_open(&self, name: &str, types: DocViewTypes) -> Vec<&'static str> {
        if types == DocViewTypes::OFF {
            return Vec::new();
        }
        let Some(function) = self.function(name) else {
            return Vec::new();
        };
        let mut names: Vec<&'static str> = Vec::new();
        // The key, never the bare name: what comes back from here is handed straight to
        // `read_type`, and a name that is indexed under one string and opened under another is a
        // type this rule would name and that lookup would then miss.
        let mut place = |key: &'static str| {
            if !names.contains(&key) {
                names.push(key);
            }
        };
        if types.enabled(DocViewType::Return) || types.enabled(DocViewType::Parameters) {
            for referenced in function.types {
                let declaration = match type_declaration(self.language, referenced.fqn()) {
                    Some(declaration) => declaration,
                    // A referenced name this language's catalogue does not declare has nothing to
                    // render, so there is no view to open for it. The name rule
                    // (`sandbox/signatures.fqn.rs`) holds every arm to declaring what it
                    // references, so this is drift rather than a run-time condition.
                    None => continue,
                };
                // Depth one, applied before the flags are read: a referenced type no shape of this
                // function writes down was reached through some *other* type, and is a level the
                // rule does not reach. See *Why the catalogue's own `types` list cannot be used as
                // it stands*.
                if !names_a_signature(&function, &declaration.name) {
                    continue;
                }
                let selected = (types.enabled(DocViewType::Return)
                    && returned(&function, referenced, &declaration.name))
                    || (types.enabled(DocViewType::Parameters)
                        && names_a_parameter(&function, &declaration.name));
                if selected {
                    place(declaration.key());
                }
            }
        }
        if types.enabled(DocViewType::Errors) {
            for referenced in function.throws {
                // Unnarrowed by the signature, deliberately: a declared failure is written in a
                // documentation comment and a signature need not mention it at all, so the same
                // depth-one test applied here would withhold every error on every arm. What holds
                // the list honest instead is the name rule, which refuses an arm whose `throws`
                // names a type its own catalogue does not declare.
                if let Some(declaration) = type_declaration(self.language, referenced.fqn()) {
                    place(declaration.key());
                }
            }
        }
        names
    }

    /// The bound catalogue function called `name`, or `None` — the lookup [`read`](Self::read) and
    /// [`types_to_open`](Self::types_to_open) share, so the two cannot disagree about which entry a
    /// name resolves to.
    fn function(&self, name: &str) -> Option<CatalogueFunction> {
        let mut functions = catalogue_functions(self.language);
        // The fully-qualified name first, because that is the key: it is what the catalogue
        // advertises, what search files a hit under, and the only one of the two that two modules
        // offering a `close` could not both claim. The bare name stays as the fallback for the same
        // reason [`type_declaration`](crate::sandbox::type_declaration) keeps one — it is what a
        // model reads at a call site.
        let found = functions
            .iter()
            .position(|function| function.fqn == name && self.bound(function))
            .or_else(|| {
                functions
                    .iter()
                    .position(|function| function.name == name && self.bound(function))
            })?;
        Some(functions.swap_remove(found))
    }

    /// The bound names nearest `name`, for the hint a failed lookup carries — empty when nothing is
    /// close enough to be worth offering.
    ///
    /// It answers from the same three gates [`read`](Self::read) failed against, and that is the
    /// whole reason it lives here rather than beside the refusal it feeds: a candidate list drawn
    /// from the catalogue instead of from this agent's scope would offer names the program cannot
    /// call.
    ///
    /// What counts as *near* is [`suggest`]'s to decide; what is *available* to be near is this
    /// method's.
    ///
    /// **Types are candidates too**, under every name they answer to, because
    /// [`read_any`](Self::read_any) answers a type by name and a hint drawn from functions alone
    /// could never recover a near-miss on one — which is the failure a model reaching for the type it
    /// just read in a signature would hit. They are filtered by the same reachability predicate
    /// [`read_type`](Self::read_type) applies, so a refusal cannot suggest its way around the gate.
    pub fn suggest(&self, name: &str) -> Vec<String> {
        let functions = catalogue_functions(self.language);
        let mut candidates: Vec<&'static str> = Vec::new();
        for function in &functions {
            if self.bound(function) {
                candidates.push(function.name);
                candidates.push(function.fqn);
            }
        }
        for declaration in &self.language.catalogue().types {
            if !self.type_is_reachable(declaration.key()) {
                continue;
            }
            candidates.push(declaration.name.as_str());
            candidates.push(declaration.key());
        }
        // The spelling a signature writes, which is neither of the two above and is the one a model
        // is likeliest to have mistyped, since it is what the signature it just read printed.
        for function in &functions {
            if !self.bound(function) {
                continue;
            }
            for reference in function.returns.iter().chain(function.types) {
                if self.type_is_reachable(reference.fqn()) {
                    candidates.push(reference.spelled());
                }
            }
        }
        candidates.sort_unstable();
        candidates.dedup();
        suggest::nearest(name, candidates)
    }

    /// **Whether this agent's scope binds a function** — the one predicate deciding what a model may
    /// be shown, and the reason nothing else may grow a second copy of it.
    ///
    /// It answers from gg's [operations table](crate::sandbox::operation_of) rather than from the
    /// catalogue entry's own gate fields, and that is a deliberate reversal. The gates the module
    /// header describes are all still here — a capability this agent holds *and* an allowlist that
    /// names the call, or this agent's ending role — but which of them applies to a given function
    /// is now gg's answer, stated once, instead of a claim eleven catalogues each make about
    /// themselves. An arm has nothing left to be wrong about, and asking is one call to
    /// [`Grants::permits`] rather than a boolean, a pair and a fall-through read here.
    ///
    /// **No tool name is consulted.** The tool vocabulary decides nothing on this surface: a program
    /// calls operations, and what a tool-calling agent may call is a different question asked of a
    /// different agent.
    ///
    /// **The membrane asks the identical question of the identical value.** Every arm's SDK is
    /// static, so a program can *write* a call this predicate answers `false` for, and what happens
    /// when it does is the host's refusal — decided by [`Grants::permits`], from an agent's own
    /// grant, in exactly one implementation. That asymmetry (the compile-time surface is the
    /// language's, the discovery surface is the grant's) is intended; the two surfaces disagreeing
    /// about *what the grant is* would not be.
    ///
    /// A function gg has **no** operation for is not bound. That is drift rather than a run-time
    /// condition — an arm binding something gg has no identity for — and refusing to document it is
    /// the safe direction: a directory that lists a call the scope did not bind is the one thing a
    /// directory must never do. `every_catalogued_function_has_an_operation` proves the case
    /// unreachable for every registered language.
    ///
    /// Public because the [agent surface](test_cabinet_core::gg::GgTelemetryKind::AgentSurface)
    /// reports the very same set and answers it through this predicate. Two copies of "may this
    /// agent call X" is one copy too many the moment either grows a gate.
    pub fn bound(&self, function: &CatalogueFunction) -> bool {
        operation_of(function).is_some_and(|operation| self.grants.permits(operation))
    }

    /// Assemble one function's documentation: how it may be called, what each argument is for,
    /// [where it is defined](Self::defined_in), and its description.
    ///
    /// The types the signature mentions are **not** here; they are views of their own — see the
    /// module's *A function and a type are two views, not one block*.
    ///
    /// A function is rendered with **every** signature the language offers it in, because for some
    /// languages that is how an optional argument is spelled: an overload pair reads as two ways to
    /// call one function, and showing only the first would tell a model half of what it may write.
    /// Under a language that spells options with a default there is exactly one, and the rendering is
    /// the single line it always was.
    ///
    /// The definition line follows the signatures rather than leading them: a view opens with the
    /// shape the model came for, and says where to get it from underneath.
    ///
    /// There is exactly one rendering, and every function on the surface goes through it. Nothing is
    /// documented from outside the catalogue any more — `list` was the last thing that was, and it is
    /// gone — so no lookup can come out looking like a different kind of thing than its neighbour.
    ///
    /// It hangs off the runtime rather than standing beside it because the definition line is
    /// answered out of *this agent's* language's catalogue, and a rendering that reached for a
    /// module list of its own would be a second answer to the question the runtime already holds.
    fn assemble(&self, function: &CatalogueFunction) -> String {
        let mut text = String::new();
        for entry in function.signatures {
            text.push_str(&entry.signature);
            text.push('\n');
            for parameter in &entry.parameters {
                describe(&mut text, parameter, 1);
            }
        }
        text.push('\n');
        text.push_str(&self.defined_in(function.module));
        text.push_str("\n\n");
        text.push_str(&function.prose.rendered());
        text
    }

    /// **Where a symbol is defined, and how a program reaches it** — the one line every documentation
    /// view carries under the shape it opens with.
    ///
    /// A view is the only place a model is told which module a symbol belongs to: the prompt names
    /// the modules and no function, and a search hit is a key and a brief. A signature it can read
    /// and cannot qualify is a call it cannot write.
    ///
    /// The module is named by this arm's own [path](crate::sandbox::ModuleView::path) rather than by
    /// gg's id, because the path is what a program writes. `module` is the id, since that is what a
    /// [function](CatalogueFunction) and a type each carry, and [`module_of`] is the join.
    ///
    /// # Both states of the import line are rendered
    ///
    /// A [line](crate::sandbox::ModuleView::import) is quoted exactly as the model must write it,
    /// and an arm whose SDK is in scope before a program compiles says so. A view that rendered only
    /// the first state would leave every model on every other arm hunting for a line its compiler
    /// would refuse.
    ///
    /// A module the catalogue does not declare is named by gg's id and nothing is claimed about
    /// reaching it, which is the honest answer to drift the name rule (`signatures.fqn.rs`) reports
    /// by name.
    fn defined_in(&self, module: &str) -> String {
        let Some(declared) = module_of(self.language.catalogue(), module) else {
            return format!("Defined in `{module}`.");
        };
        match declared.import {
            Some(line) => format!(
                "Defined in `{}`, brought into scope with `{line}`.",
                declared.path
            ),
            None => format!("Defined in `{}`, in scope already.", declared.path),
        }
    }
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
/// [`Parameters`](DocViewType::Parameters) into a flag that selected nothing at all.
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

/// Whether `reference` is in `function`'s **return** position — stated where the catalogue states
/// it, and inferred by elimination where it does not.
///
/// A catalogue carries a real return position, resolved by its arm's reflector out of that arm's own
/// type system, and that is what this reads. Where a call states an empty one, the honest reading of
/// its signature is the one [`types_to_open`](DocsRuntime::types_to_open) documents: a type named by
/// one of the function's own documented parameters is an argument type, and everything else it names
/// is reached through what it hands back.
///
/// A function that states an **empty** return position falls through to the inference rather than
/// answering `false` outright, and that costs nothing: a call that hands nothing back names no type
/// its own signature does not also write into a parameter, so the depth-one narrowing above has
/// already dropped whatever the inference would have kept.
fn returned(function: &CatalogueFunction, reference: &TypeReference, type_name: &str) -> bool {
    if !function.returns.is_empty() {
        return function
            .returns
            .iter()
            .any(|returned| returned.fqn() == reference.fqn());
    }
    !names_a_parameter(function, type_name)
}

/// Whether any shape of `function` takes an argument whose declared type **names** `type_name` —
/// the test that sorts an argument type from a returned one, for
/// [`types_to_open`](DocsRuntime::types_to_open).
///
/// The match is on whole identifiers rather than on substrings, because a bare `contains` would read
/// `FileRead` out of `FileReadOptions` and quietly reclassify a return as an argument. Only the
/// parameter's own declared type is read, never its inline [fields](Parameter::fields): a field's
/// type is a *second* level, and treating one as named by the argument would make
/// [`Return`](DocViewType::Return) withhold a type the return position also uses.
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

#[cfg(test)]
#[path = "docs.test.rs"]
mod tests;

#[cfg(test)]
#[path = "docs.mode.test.rs"]
mod mode_tests;

#[cfg(test)]
#[path = "docs.discoverability.test.rs"]
mod discoverability_tests;

/// The gate over what every view says about **where** its symbol is defined, kept in a file of its
/// own because it is a property of the whole surface — eleven arms, every key each of them binds —
/// rather than a case about this runtime's behaviour.
#[cfg(test)]
#[path = "docs.modules.test.rs"]
mod module_tests;
