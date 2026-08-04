//! **The program-language seam** — the one place gg says what a
//! [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) program is written in,
//! and everything that follows from the answer.
//!
//! gg used to have exactly one answer, spelled out in a dozen places: the type-strip was
//! TypeScript's, the committed component was TypeScript's, the signature catalogue's entries were
//! keyed on a field literally named `js`, and the system prompt said so in prose. That was true and
//! costless right up until the question became *does the language a model writes in change how well
//! it works?* — which is a question a harness answers by running two arms, and therefore a question
//! gg cannot answer at all while the language is a fact rather than a variable.
//!
//! So the language is a variable: a [`GgProgramLanguage`] configured per agent, recorded on the run,
//! and resolved here into one [`ProgramLanguage`] implementation that owns every answer that used to
//! be hard-coded.
//!
//! # What a language is, and what it is not
//!
//! It is **not** a source dialect. The wire — `crates/gg/wit/gg-sandbox.wit`, fourteen interfaces of
//! typed functions — is a language-neutral IDL that other guest toolchains bind directly, and
//! [`ToolApi`](super::ToolApi) on this side of it is already free of any language's fingerprints.
//! Nothing about either changes when a language is added, and neither is allowed to acquire a
//! generic `call(name, json)` door in the name of pluggability: the typed surface *is* the
//! capability model.
//!
//! What a language does own is everything between the model's text and that wire:
//!
//! * how a model's reply becomes source the guest can evaluate ([`ProgramLanguage::prepare_program`]);
//! * how a code [skill](crate::skills)'s or [memory](crate::memories)'s file becomes a namespace
//!   bound at `lib.<key>` ([`ProgramLanguage::prepare_module`]);
//! * which committed component evaluates it ([`ProgramLanguage::guest_component`]);
//! * what that component needs from the host linker ([`ProgramLanguage::host_requirements`]);
//! * and how its SDK spells the surface ([`ProgramLanguage::catalogue`]).
//!
//! # Why the registry is trait objects
//!
//! [`language`] is an exhaustive `match` handing back a `&'static dyn ProgramLanguage`, and
//! [`all_languages`] is *derived* from [`GgProgramLanguage::ALL`] rather than being a second list
//! somebody has to remember to extend. Adding a variant to the core enum therefore fails to compile
//! until this module has an arm for it, and the new arm is instantly in every iteration — the drift
//! gates, the healing invariant, the prompt registration. `ALL` itself is not a list anyone can
//! forget either: [`GgProgramLanguage::ordinal`] is a second exhaustive `match` whose every arm is
//! checked against `ALL` in a `const` block, so a variant that never reached the list is a build
//! failure rather than a language every gate here silently skips.
//!
//! Three alternatives were considered and rejected. An **enum with a big `match` per question** puts
//! every language's implementation in one shared file and makes adding one an edit to ten `match`es,
//! which is the opposite of additive. A **static table of `fn` pointers** cannot carry a language's
//! lazily-initialised state (its parsed catalogue, its compiled component), so that bookkeeping
//! would come back as a side table keyed by id — exactly what the trait removes. And a **generic
//! parameter** would infect every consumer with a type parameter for a choice made at run time from
//! a config file.
//!
//! Trait objects in `static`s are awkward only when the implementation needs data; here each is a
//! unit struct whose data is `const`/`static`/`OnceLock` at module scope, so
//! `static TYPESCRIPT: TypeScript = TypeScript;` is the whole of the machinery.

use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgProgramLanguage};

use super::signatures::SignatureCatalogue;

#[path = "language/typescript.rs"]
mod typescript;

/// The **cross-language agreement gate**: the assertion that every registered language describes the
/// same capabilities, and that only their spellings differ.
///
/// `#[cfg(test)]` because it is a gate rather than a runtime need — it reads committed artifacts and
/// compiles components, which is a test's budget and not a turn's. Its own module documentation says
/// why an A/B study is worthless without it.
#[cfg(test)]
#[path = "language/agreement.rs"]
mod agreement;

/// A **second implementation of this trait, for tests only** — the thing that makes the seam an
/// abstraction rather than one implementation wearing a trait.
///
/// It is deliberately *not* in [`language`] or [`all_languages`]: it has no wire id, so it can never
/// be configured, resolved, recorded or compiled. See its module documentation for what it stands in
/// for.
#[cfg(test)]
#[path = "language/fixture.rs"]
pub(crate) mod fixture;

#[cfg(test)]
pub(crate) use fixture::fixture_languages;

/// One program language gg can drive a responses-as-code agent in.
///
/// Object-safe on purpose: the registry hands out `&'static dyn ProgramLanguage`, so nothing that
/// consults a language is generic over it, and a second language is a new module plus one `match`
/// arm rather than a type parameter threaded through the sandbox.
///
/// Every implementation must keep the model-facing rules the TypeScript SDK keeps, because those
/// rules — not the syntax — are what a cross-language study holds constant: capabilities reach the
/// program as typed, standalone, namespaced bindings rather than a dispatcher taking a name as data;
/// every call is synchronous; a fixed choice is a typed value rather than a string; neither an
/// argument nor a result is a JSON document the program has to parse; optional arguments use the
/// language's own idiom while required ones stay positional.
pub trait ProgramLanguage: Send + Sync + 'static {
    /// The wire id this language is configured, recorded and sliced by.
    fn id(&self) -> GgProgramLanguage;

    /// This language's name as a **human** reads it — `"TypeScript"`.
    ///
    /// The operator-facing name: the launch warning that lists the languages gg can drive, the
    /// warm-up line that names which component compiled. What the *model* reads is its own prompt
    /// template, which is written in this language's syntax and names the language in its own words
    /// — so this is not the string a model is shown, and changing it changes no prompt.
    fn display_name(&self) -> &'static str;

    /// Turn a model's reply into the source the guest evaluates as a program.
    ///
    /// This is where a language spends whatever it must to make untrusted text safe to hand to a
    /// parser, and where it refuses — with a sentence the model can act on — anything the sandbox
    /// has no implementation of.
    fn prepare_program(&self, source: &str) -> Result<PreparedProgram, PrepareError>;

    /// Turn a code skill's or code memory's source into the source the guest evaluates to produce
    /// that module's namespace, bound at `lib.<key>`.
    fn prepare_module(&self, source: &str) -> Result<PreparedModule, PrepareError>;

    /// The identifier a code [skill](crate::skills) or [memory](crate::memories) called `name` is
    /// bound at — the `<key>` of `lib.<key>`.
    ///
    /// A skill's own name is authored prose (`csv-tools`, `my_helpers.v2`, `9lives`), and the key is
    /// a property a **program spells out** rather than one it looks up with a string, so it has to
    /// come out as an identifier the language will parse. Which identifier is the language's
    /// business: `csvTools` where the convention is camelCase, `csv_tools` where it is not. gg's
    /// only requirements are that the result is non-empty and stable for a given name, which is what
    /// lets it be minted once per agent and quoted back in the reply that names it.
    fn binding_name(&self, name: &str) -> String;

    /// This language's committed guest component, embedded in the binary.
    fn guest_component(&self) -> &'static [u8];

    /// What this language's component needs from the host linker beyond gg's own sandbox world.
    fn host_requirements(&self) -> HostRequirements;

    /// The committed signature catalogue for this language's SDK, parsed once per process.
    fn catalogue(&self) -> &'static SignatureCatalogue;

    /// The dialect [response healing](crate::healing) asks its language-shaped questions of.
    ///
    /// Healing is not part of the sandbox and does not import it — the trait is declared over there
    /// and implemented over here, so the arrow points one way and this module is the only thing that
    /// knows both halves exist.
    fn healing(&self) -> &'static dyn crate::healing::Dialect;

    /// The authored, model-facing prose and spellings that are written in this language's syntax.
    fn prompt(&self) -> &'static PromptDialect;

    /// The one statement a program writes to open a view of `path` — the whole file, or one
    /// `offset`/`limit` [window](FileWindow) of it — as this language spells it, terminated the way
    /// this language terminates a statement.
    ///
    /// A trait method rather than a spelling in [`PromptDialect`] because it is not a name. The
    /// optional half is an **arguments idiom** the seam explicitly leaves to each language (a
    /// trailing options object in TypeScript; keyword arguments where that is the idiom), and gg
    /// does not merely quote this call — it synthesizes it into the agent's own transcript, as an
    /// assistant turn the agent is meant to read as an example of its own output. A statement in
    /// another language's syntax would teach the model the wrong thing on turn one, which is exactly
    /// the confound a cross-language study cannot carry.
    ///
    /// The two callers are [autoload](crate::agent) and
    /// [agent persistence](crate::persistence::restore_file_views).
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String;

    /// Replies this language contributes to the delete-only invariant corpus.
    ///
    /// `#[cfg(test)]`, and on the trait rather than beside the tests so that a language cannot be
    /// registered without contributing replies its own [dialect](Self::healing) has to survive. It
    /// delegates to [`Dialect::fixtures`](crate::healing::Dialect::fixtures), which is where a
    /// language actually authors them.
    #[cfg(test)]
    fn healing_fixtures(&self) -> &'static [&'static str] {
        self.healing().fixtures()
    }
}

/// Everything model-facing that is **authored in one language's syntax** and does not live inside
/// that language's own [prepare step](ProgramLanguage::prepare_program).
///
/// Two things qualify, and the boundary between them and everything else is worth stating plainly.
///
/// * **Prose written in the language's spellings.** The responses-as-code system prompt quotes the
///   SDK throughout — `skills.readSkill(name)`, `project.createIssue`, `view.openText`,
///   `JSON.stringify` — and function spelling is precisely the thing the seam declares free to
///   differ. So the template is per-language and lives here rather than being one file with a branch
///   at every bullet.
///
/// What is deliberately **not** here, and the boundary is worth stating plainly:
///
/// * The refusals a language produces while *preparing* a program (a module import where there is no
///   loader, an `await` where there is no event loop). Those belong to the prepare step and stay with
///   it, because they are answers to something the model just wrote rather than standing prose.
/// * The **spellings of individual functions** gg quotes in its own sentences — the ending call a
///   prompt names, the call a context-pressure notice points at. Those are not authored anywhere:
///   they are resolved from the language's own catalogue by [`spell`], keyed on the
///   language-independent [`SurfaceCall`], so gg quotes what the SDK really binds and there is no
///   second copy to drift.
pub struct PromptDialect {
    /// This language's responses-as-code system prompt template, verbatim.
    pub system_template: &'static str,
    /// The name it is registered under: `system-code.<language id>`.
    pub system_template_name: &'static str,
    /// This language's "your program showed you nothing" notice template, verbatim.
    ///
    /// The one message a *successful* program can produce, and only because a request has to end on
    /// something for the model to answer. It is per language for the same reason the system prompt
    /// is: it names the calls that would have shown the model something.
    ///
    /// There is deliberately no counterpart for a program that *did* show itself something — the
    /// views are the report, and a covering note over them would be gg narrating what the model can
    /// already read.
    pub nothing_shown_template: &'static str,
    /// The name that is registered under: `code-nothing-shown.<language id>`.
    pub nothing_shown_template_name: &'static str,
    /// The plain sentence rendered when that template fails to render — a turn with degraded
    /// wording is recoverable where a panicked run is not.
    pub nothing_shown_fallback: &'static str,
    /// The `list` meta function's signature, as a documentation lookup renders it.
    ///
    /// `list` has no catalogue entry: the guest seeds it onto every object it creates, and the
    /// [docs carve-out](crate::docs) answers for it. So its rendering is authored, and it is
    /// authored *per language*, because a signature is a spelling.
    pub list_signature: &'static str,
    /// The `list` meta function's documentation paragraph.
    pub list_doc: &'static str,
    /// The one-line summary every object's directory carries for `list`.
    pub list_summary: &'static str,
}

/// One model-facing call **gg itself quotes** back at a model, named the only way the seam is
/// allowed to name a function: by the API object it hangs off and the catalogue
/// [key](super::signatures::CatalogueFunction::key) that is its language-independent identity.
///
/// The **object** half is identity rather than spelling — `harness`, `review`, `judge` and `view`
/// are on the wire, the console groups by them, and no language may rename them. The function half
/// is a spelling, so it is not written down here at all: [`spell`] resolves it against the
/// language's own committed catalogue. That is the difference between "a test checks the two agree"
/// and "there is only one of them".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SurfaceCall {
    /// The API object it is grouped under in a program's scope.
    pub object: &'static str,
    /// Its catalogue key: `request_changes`, `open_text`. gg's own vocabulary, in `snake_case`,
    /// deliberately not any one SDK's spelling.
    pub key: &'static str,
}

impl SurfaceCall {
    /// The call `key` identifies on `object`.
    const fn new(object: &'static str, key: &'static str) -> Self {
        Self { object, key }
    }
}

/// The [standard](crate::ending::EndingRole::Standard) role's ending call.
pub const FINISH: SurfaceCall = SurfaceCall::new("harness", "finish");

/// The [review](crate::ending::EndingRole::Review) role's approval.
pub const APPROVE: SurfaceCall = SurfaceCall::new("review", "approve");

/// The review role's change request.
pub const REQUEST_CHANGES: SurfaceCall = SurfaceCall::new("review", "request_changes");

/// The call that closes a view — what the context-pressure block points an agent at when text views
/// are holding window it could reclaim.
pub const CLOSE_VIEW: SurfaceCall = SurfaceCall::new("view", "close");

/// The call that shows the agent a value it computed — quoted in the prompt's account of the
/// message kinds an agent receives.
pub const OPEN_TEXT: SurfaceCall = SurfaceCall::new("view", "open_text");

/// The [program library](crate::programs) call that fetches a program the agent already ran.
pub const PROGRAM_GET: SurfaceCall = SurfaceCall::new("programs", "get");

/// The program-library call that hands gg a program to run in place of the current one — quoted in
/// every notice about a hand-over gg did not honour.
pub const PROGRAM_RERUN: SurfaceCall = SurfaceCall::new("programs", "rerun");

/// Every call gg quotes, for the gate that asserts each one resolves in every registered language.
///
/// A `SurfaceCall` gg quotes but no language binds would put a sentence in front of a model telling
/// it to call something its scope does not hold, so the set is enumerated here and checked rather
/// than trusted.
#[cfg(test)]
pub(crate) const QUOTED_CALLS: [SurfaceCall; 7] = [
    FINISH,
    APPROVE,
    REQUEST_CHANGES,
    CLOSE_VIEW,
    OPEN_TEXT,
    PROGRAM_GET,
    PROGRAM_RERUN,
];

/// How `language` spells `call`, qualified exactly as a program writes it —
/// `review.requestChanges`.
///
/// Resolved from that language's own committed catalogue by the call's language-independent
/// [key](SurfaceCall::key), so a language that renamed a function renames it in gg's sentences too,
/// with nothing to keep in step. A catalogue that carries no such key falls back to the key itself:
/// the [agreement gate](agreement) proves every [quoted call](QUOTED_CALLS) resolves in every
/// registered language, so the fallback is unreachable — and degrading one word of a notice is the
/// right failure anyway, where panicking mid-run is not.
pub fn spell(language: &'static dyn ProgramLanguage, call: SurfaceCall) -> String {
    let name = super::signatures::spelling(language, call).unwrap_or(call.key);
    format!("{}.{name}", call.object)
}

/// The `offset`/`limit` window a synthesized file-view call re-opens — the same pair the model would
/// have passed itself. `None` at the call sites means the whole file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileWindow {
    /// The 1-based first line.
    pub offset: u64,
    /// How many lines.
    pub limit: u64,
}

/// The one instance of each registered language.
///
/// A unit struct in a `static` is the whole of the machinery: no allocation, no lazy init, and
/// `&TYPESCRIPT` coerces to `&'static dyn ProgramLanguage`. The `match` is exhaustive, so a language
/// added to [`GgProgramLanguage`] does not compile until it is registered here.
pub fn language(id: GgProgramLanguage) -> &'static dyn ProgramLanguage {
    match id {
        GgProgramLanguage::TypeScript => &typescript::TYPESCRIPT,
    }
}

/// Every registered language, in registration order.
///
/// **Derived** from [`GgProgramLanguage::ALL`] rather than kept as a second slice, so there is no
/// list to forget: a new variant arrives here the moment [`language`] has an arm for it, and every
/// gate that iterates languages covers it without being edited.
///
/// It is exactly the registered set, under test as in production: the
/// [fixture language](fixture) the seam's own tests are written against is deliberately **not** here,
/// so nothing that iterates this pays for it and nothing that reads it can be handed a language an
/// operator could not have configured.
pub fn all_languages() -> impl Iterator<Item = &'static dyn ProgramLanguage> {
    GgProgramLanguage::ALL.iter().copied().map(language)
}

/// A program that prepared cleanly: the source the guest evaluates, and what preparing it observed
/// about the model's own text on the way past.
///
/// The observation rides with the source rather than being recovered later because it is a fact
/// about the **model's** text, in the model's own coordinates, and the only place both that text and
/// the language's own understanding of it exist together is inside the prepare step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedProgram {
    /// The source the guest evaluates. For TypeScript, the type-stripped JavaScript.
    pub source: String,
    /// Top-level statements the program wrote that cannot execute, when it wrote any. See
    /// [`UnreachableTail`].
    pub unreachable: Option<UnreachableTail>,
}

/// A code module that prepared cleanly: the source whose evaluation produces the module's namespace,
/// and the names that namespace offers.
///
/// The names travel beside the source rather than being read back out of it, because they are what
/// the model is *told* it can call — and a second reading of the same fact is a second chance for
/// the two to disagree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedModule {
    /// The source the guest evaluates to produce the module's namespace.
    pub source: String,
    /// The exported names, in source order, as the namespace lists them. A renaming export is listed
    /// under the name the namespace gives it.
    pub exports: Vec<String>,
}

/// Top-level statements a program wrote **after** a statement that ends it — code that provably
/// never runs.
///
/// This is not an error and nothing is refused: a language whose program body may end early is
/// entitled to dead code after the statement that ends it. It exists because of what it is a symptom
/// of. A model that drafts two programs and pastes the second after the first produces exactly this
/// shape, and without a word about it gg reports "your program ran to completion" over a reply whose
/// second half — the half that wrote the deliverable and ended the run — never executed. Round 1
/// proved that silent discard is the one failure a model cannot recover from, so gg counts what did
/// not run and says so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnreachableTail {
    /// How many top-level statements followed it that could have done something. Declarations the
    /// language hoists into scope before the first statement runs, and declarations that do not
    /// exist at run time at all, are excluded: calling either "did not run" would be false.
    pub statements: usize,
    /// The 1-based line of the first such statement, in the **program's** coordinates.
    pub line: usize,
    /// The first such statement's own source text, trimmed and capped — what lets a model recognise
    /// the half of its reply that never ran without counting lines.
    pub excerpt: String,
}

/// Why a source could not be prepared for its guest.
///
/// Every variant is **recoverable and model-facing** — the model wrote something it can fix, is told
/// exactly what, and writes another program next turn. None of them is a run-ending failure, and
/// none of them costs any engine work: a program that does not prepare never reaches the component
/// at all.
///
/// The four kinds are the ones every language's prepare step distinguishes, whatever its toolchain
/// calls them, and they are kept apart because they have *different causes*: a syntax error is a
/// typo, a semantic error is almost always two programs in one reply, a lowering failure is a defect
/// in the pipeline rather than in the reply, and a refusal is gg declining something the sandbox has
/// no implementation of. Telling them apart in the telemetry is how each shows up as a rate rather
/// than as anecdote.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PrepareError {
    /// The source is not valid in this language — the parser's own diagnostics, located in the
    /// program's own coordinates so the model sees *where* rather than only *what*.
    #[error("{0}")]
    Syntax(String),
    /// It parses, but breaks a rule the language enforces before any statement runs: a `const`
    /// declared twice, a duplicate binding in a destructuring pattern. Carries the same located
    /// rendering a syntax error does.
    #[error("{0}")]
    Semantic(String),
    /// It could not be lowered into what the guest evaluates. Distinct from
    /// [`Syntax`](Self::Syntax) because it is not the model's text that failed but the transform
    /// over it — a distinction worth keeping when one of the two starts happening and the other does
    /// not.
    #[error("{0}")]
    Lowering(String),
    /// It asks for something the sandbox will not run it with, and is refused with an explanation of
    /// what to write instead — a module import where there is no loader, an `await` where there is
    /// no event loop, a nesting depth the host's parser is not given room for.
    #[error("{0}")]
    Unsupported(String),
}

/// What one language's guest component needs from the host linker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostRequirements {
    /// Which WASI surface the component's imports need beyond gg's own `sandbox` world.
    pub wasi: WasiSurface,
}

/// The WASI surface a guest imports.
///
/// This type exists because a language is not merely a source dialect plus an SDK. The committed
/// TypeScript component is baked with **every** WASI capability disabled — no filesystem, no clock,
/// no randomness, no network, no module system — which is what makes a code turn reproducible for
/// gg's [replay](crate::replay) capability, and gg's [`linker`](super::linker) therefore provides no
/// WASI at all. A guest built by another toolchain need not be so frugal: a `componentize-py` guest
/// imports the full WASI p2 surface (`wasi:cli`, `wasi:filesystem`, `wasi:sockets`, `wasi:clocks`,
/// `wasi:random`, `wasi:io`) whether or not the program uses any of it. So the requirement has to
/// travel *with the language* rather than being a property of the one host that exists today.
///
/// # How a second variant lands
///
/// A language needing WASI requires three things, in this order. **First**, a new variant here that
/// names the surface *and how each nondeterministic capability is pinned* — a fixed clock, a seeded
/// RNG, a denied filesystem and socket set — because replay's exactness rests on it and a guest
/// handed the ambient host is a guest whose turns cannot be reproduced. **Second**,
/// [`MembraneState`](super::membrane) growing a `wasmtime_wasi::WasiCtx` and the corresponding view
/// impls. **Third**, a `wasmtime-wasi` dependency, which gg does not carry today.
///
/// Adding a variant makes [`linker`](super::linker) fail to compile until it is handled, which is
/// the pressure this type exists to apply: the seam is enforced by the compiler rather than by this
/// paragraph.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WasiSurface {
    /// Nothing beyond the `sandbox` world. TypeScript's answer, and the only reproducible one.
    SandboxOnly,
}

/// A resolved [program language](GgProgramLanguage) together with the `language` value gg could not
/// read, if any — the same shape [`ResolvedHealing`](crate::healing::ResolvedHealing) takes, and
/// reported the same way at launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedProgramLanguage {
    /// The language this agent's programs are written in.
    pub language: GgProgramLanguage,
    /// The bare `language` key, when its value named no language gg has. Reported at `warn` when the
    /// run starts.
    pub unknown_params: Vec<String>,
}

/// Resolve the [program language](GgProgramLanguage) from the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `language` param.
///
/// | `params.language` | Language |
/// | --- | --- |
/// | absent / `null` / `"typescript"` | [`TypeScript`](GgProgramLanguage::TypeScript) — the default |
/// | anything else | [`TypeScript`](GgProgramLanguage::TypeScript), and the value is reported |
///
/// Read literally and reported on mismatch for the same reason
/// [`resolve_assistant_messages`](crate::healing::resolve_assistant_messages) is: the value is
/// contract-visible (the console's capability catalogue writes it, persisted run data records it),
/// so a typo must change *nothing* silently rather than quietly run an arm the study did not ask
/// for. Reading `"pythn"` as Python would be bad; reading it as TypeScript **without saying so**
/// would be worse, because the run would then be recorded under a language nobody chose.
///
/// Per **agent**, like [`resolve_sandbox_limits`](super::resolve_sandbox_limits) and
/// [`resolve_healing`](crate::healing::resolve_healing): responses-as-code is a per-agent
/// capability, so one run may drive a root in one language and a reviewer in another. A capability
/// that is present but **disabled** configures nothing.
pub fn resolve_program_language(profile: &GgAgentConfig) -> ResolvedProgramLanguage {
    let mut resolved = ResolvedProgramLanguage {
        language: GgProgramLanguage::default(),
        unknown_params: Vec::new(),
    };
    let Some(capability) = profile
        .capability(CAPABILITY_RESPONSES_AS_CODE)
        .filter(|capability| capability.enabled)
    else {
        return resolved;
    };
    let Some(value) = capability.params.get("language") else {
        return resolved;
    };

    match value {
        serde_json::Value::Null => {}
        serde_json::Value::String(id) => match GgProgramLanguage::from_id(id) {
            Some(language) => resolved.language = language,
            None => resolved.unknown_params.push("language".to_string()),
        },
        _ => resolved.unknown_params.push("language".to_string()),
    }
    resolved
}

#[cfg(test)]
#[path = "language.test.rs"]
mod tests;
