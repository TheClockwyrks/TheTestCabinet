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
//! **There is no directory.** Nothing enumerates a module's functions, and that is a decision rather
//! than an omission: a call that hands back a whole module defeats the point of making a model
//! search for what it needs, since the cheapest way to find anything would be to dump the directory
//! and read it. [`search`](DocsRuntime::search) is the only route in, and it is global — one query
//! reaches every module at once, so nothing is discovered by already knowing where to look.
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
//! names it is nearly. See [`suggest`] for what "nearly" means and why the candidates are the bound
//! ones alone.

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgProgramLanguage};

use crate::ending::EndingRole;
use crate::sandbox::{
    CatalogueFunction, FunctionSummary, Grants, MemberFunction, OperationId, Parameter,
    ParameterKind, ProgramLanguage, TypeDeclaration, TypeReference, catalogue_functions, language,
    operation_by_id, operation_of, type_declaration,
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
    /// The three modes, in the spelling a [refusal](crate::validate) offers back.
    pub const ALL: [&'static str; 3] = [
        DOC_VIEW_TYPES_OFF,
        DOC_VIEW_TYPES_RETURN,
        DOC_VIEW_TYPES_RETURN_AND_PARAMETERS,
    ];

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

/// The [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability param choosing how much of a
/// function's type a documentation view shows. Absent takes [`DocViewTypes::default`].
pub const PARAM_DOC_VIEW_TYPES: &str = "docViewTypes";

/// Resolve the [documentation-view type mode](DocViewTypes) from this agent's
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's
/// [`docViewTypes`](PARAM_DOC_VIEW_TYPES) param.
///
/// | `params.docViewTypes` | Mode |
/// | --- | --- |
/// | absent / `null` / `"return"` | [`ReturnOnly`](DocViewTypes::ReturnOnly) — the return position (the default) |
/// | `"off"` | [`Off`](DocViewTypes::Off) |
/// | `"return-and-parameters"` | [`ReturnAndParameters`](DocViewTypes::ReturnAndParameters) |
/// | anything else | **refused** — the launch does not start |
///
/// Read literally — with only surrounding whitespace forgiven — and [refused](crate::validate) on
/// mismatch for the reason
/// [`resolve_assistant_messages`](crate::healing::resolve_assistant_messages) is: the value is
/// contract-visible, and the [agent surface](crate::telemetry) records the *resolved* mode, so a
/// typo read as the default would leave a run whose every record says it ran the arm it did not.
/// The default comes back anyway to keep the resolver total for the per-turn calls that re-read it.
/// The value is read whether the capability is switched on or off, on the rule the whole params
/// table follows: a disabled capability records the configuration the arm would have used, and a
/// typo skipped because a switch happened to be off is a typo that surfaces on the launch where it
/// is flipped.
pub fn resolve_doc_view_types(
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> DocViewTypes {
    let Some(capability) = profile.capability(CAPABILITY_RESPONSES_AS_CODE) else {
        return DocViewTypes::default();
    };
    let Some(value) = capability.params.get(PARAM_DOC_VIEW_TYPES) else {
        return DocViewTypes::default();
    };

    match value {
        Value::Null => DocViewTypes::default(),
        Value::String(mode) if mode.trim() == DOC_VIEW_TYPES_RETURN => DocViewTypes::default(),
        Value::String(mode) if mode.trim() == DOC_VIEW_TYPES_OFF => DocViewTypes::Off,
        Value::String(mode) if mode.trim() == DOC_VIEW_TYPES_RETURN_AND_PARAMETERS => {
            DocViewTypes::ReturnAndParameters
        }
        other => {
            report.report(
                crate::validate::LaunchDefect::run_level(
                    crate::validate::param_locus(
                        CAPABILITY_RESPONSES_AS_CODE,
                        PARAM_DOC_VIEW_TYPES,
                    ),
                    crate::validate::as_written(other),
                    format!(
                        "the `{PARAM_DOC_VIEW_TYPES}` param names how much of a function's type is \
                         opened beside it; gg has no such mode, and opening the default set would \
                         hand the agent a different amount of documentation than the run asked for."
                    ),
                )
                .known(DocViewTypes::ALL),
            );
            DocViewTypes::default()
        }
    }
}

/// The documentation half of one profile's contribution to the
/// [launch pass](crate::validate::validate_launch): the [type mode](DocViewTypes) it declares, read
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
        Some(assemble(&function))
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

    /// One type declaration, with a line per member and then a line per **member function** this
    /// agent binds — the whole body of a **type** docview.
    ///
    /// The declaration alone says what fields a record has and nothing about what any of them
    /// *means*, and `shown: boolean` on a `FileRead` is not a thing a model can infer. A union arm
    /// carries no type of its own — the arm is the value — so it is rendered as the bare literal.
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
            "{}\n{}",
            declaration.declaration,
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
        self.read(key).or_else(|| self.read_type(key))
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
        let declaration = type_declaration(self.language, name)?;
        self.type_is_reachable(declaration.key())
            .then(|| declaration.key().to_string())
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
    /// By the catalogue's own [return position](crate::sandbox::CatalogueFunction), which each
    /// reflector resolves out of its arm's type system. A call that returns nothing an SDK type
    /// names states an empty one, and there the answer falls back to elimination over the narrowed
    /// set: a catalogued type named by one of the function's own documented **parameters** is an
    /// argument type, and every other type the signature names is reached through what it hands
    /// back. That fallback errs toward *showing* rather than withholding, since a type named only by
    /// a field of an argument's type is not named by the argument itself.
    /// [`ReturnAndParameters`](DocViewTypes::ReturnAndParameters) and [`Off`](DocViewTypes::Off) do
    /// not ask the question at all.
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
                // render, so there is no view to open for it. The name rule
                // (`sandbox/signatures.fqn.rs`) holds every arm to declaring what it references, so
                // this is drift rather than a run-time condition.
                None => continue,
            };
            // Depth one, applied before the mode split: a referenced type no shape of this function
            // writes down was reached through some *other* type, and is a level the rule does not
            // reach. See *Why the catalogue's own `types` list cannot be used as it stands*.
            if !names_a_signature(&function, &declaration.name) {
                continue;
            }
            if mode == DocViewTypes::ReturnOnly
                && !returned(&function, referenced, &declaration.name)
            {
                continue;
            }
            // The key, never the bare name: what comes back from here is handed straight to
            // `read_type`, and a name that is indexed under one string and opened under another is
            // a type this rule would name and that lookup would then miss.
            let key = declaration.key();
            if !names.contains(&key) {
                names.push(key);
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
/// There is exactly one rendering, and every function on the surface goes through it. Nothing is
/// documented from outside the catalogue any more — `list` was the last thing that was, and it is
/// gone — so no lookup can come out looking like a different kind of thing than its neighbour.
fn assemble(function: &CatalogueFunction) -> String {
    let mut text = String::new();
    for entry in function.signatures {
        text.push_str(&entry.signature);
        text.push('\n');
        for parameter in &entry.parameters {
            describe(&mut text, parameter, 1);
        }
    }
    text.push('\n');
    text.push_str(&function.prose.rendered());
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

#[cfg(test)]
#[path = "docs.test.rs"]
mod tests;

#[cfg(test)]
#[path = "docs.mode.test.rs"]
mod mode_tests;

#[cfg(test)]
#[path = "docs.discoverability.test.rs"]
mod discoverability_tests;
