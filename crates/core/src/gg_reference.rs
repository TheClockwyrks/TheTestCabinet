//! The **gg reference**: every tool and every responses-as-code function gg offers a model,
//! carried verbatim, as a data contract the console renders.
//!
//! gg's model-facing surface is large and it is the thing a reader of a run most often wants
//! to check: what, exactly, was the model told `read_file` does? What is the signature of
//! `gg.files.readFile`, and what is it called on the Swift arm? Until now the only honest answer was
//! to read `crates/gg/src/tools/` — the docs site paraphrases a capability, and a paraphrase of
//! prose written *for a model* is a second copy that drifts. So the reference is not written at all.
//! It is **projected from gg's own definitions**: the tool descriptions are the [`ToolDefinition`]s a
//! live [`ToolRegistry`] hands the provider, and each language's entries are the bytes that
//! language's own documentation view renders, produced by the same call a program makes mid-run.
//!
//! # Two documents, and why the surface is split by language
//!
//! There is an [index](GgReference) — the half that belongs to no language, being the families and
//! the tools, plus a line per registered arm — and there is one [API document](GgReferenceApi) **per
//! program language**. Eleven arms offer one set of capabilities under eleven idiomatic spellings,
//! and each is deliberately written to read as its own language rather than as a transliteration of
//! some other; a page that showed one of them would be documenting a tenth of gg's surface while
//! looking complete. Serving them separately is what lets a reader open the arm they write in
//! without paying for the ten they do not.
//!
//! The split is by *document*, not by field, because the alternative — one document carrying all
//! eleven — is the same duplication in a different place: the tools and families would travel eleven
//! times, and a reader who wanted Kotlin would fetch Ruby.
//!
//! ```text
//! gg reference                → the index document, as JSON on stdout
//! gg reference --out <dir>    → index.json + <language>.json × 11
//!   └─ read at run time       → GET /gg/reference and GET /gg/reference/{language}
//!        └─ console           → the gg Reference section
//! ```
//!
//! # What is *not* here, deliberately
//!
//! This is the **maximal reachable pool**: every function gg offers on that arm, and every tool gg
//! can offer at all. It is not one run's view, and it must not be read as one. What a particular
//! agent was actually offered is a different question with its own answer — the
//! [agent surface](crate::gg::GgTelemetryKind::AgentSurface) event, recorded per instance — and a
//! page that tried to answer both would be answering neither.
//!
//! The DTOs live here because `core` is what the backend and `contract-codegen` already
//! depend on, so the TypeScript bindings and JSON Schemas come out of the same generator every
//! other contract type's do. Nothing in this module computes anything — it is the wire shape
//! and its documentation, and the one place a field's meaning is written down. The one exception
//! is the [directory layout](index_file), and it is here for the same reason the types are: the
//! writer and the reader are two crates that never link each other, so the filenames between them
//! are as much a contract as the fields inside them and must not be spelled twice.
//!
//! Regenerate the TypeScript/JSON-Schema bindings with `npm run gen:contract` after any change
//! here. JSON is camelCase.
//!
//! [`ToolDefinition`]: https://docs.testcabinet.ai/gg/reference/
//! [`ToolRegistry`]: https://docs.testcabinet.ai/gg/reference/

use serde::{Deserialize, Serialize};

use crate::gg::GgProgramLanguage;

/// The name of the [index](GgReference) document inside a reference directory — the one file whose
/// absence means "there is no reference here at all".
///
/// `gg reference --out` writes it **last**, after every arm, precisely so that this file existing is
/// evidence the arms beside it are complete rather than half-written.
///
/// A function in `core` rather than a `const` in each crate because the writer (`test-cabinet-gg`)
/// and the reader (`test-cabinet-backend`) do not link each other and never will — that boundary is
/// the whole point of shipping the projection as files — so a filename spelled once on each side is
/// a contract with two authorities and no gate between them. Renaming it here is a compile error in
/// both, which is the only way that layout can be changed safely.
pub fn index_file() -> &'static str {
    "index.json"
}

/// The name of `language`'s own [API document](GgReferenceApi) inside a reference directory.
///
/// Keyed on the language's [id](GgProgramLanguage::id) — the same string the URL segment and a run's
/// `language` capability param carry — so the file a reader opens for an arm is named after the
/// thing an operator asked for. See [`index_file`] for why the spelling lives in `core`.
pub fn document_file(language: GgProgramLanguage) -> String {
    format!("{}.json", language.id())
}

/// The reference's **index**: the families the surface is grouped by, every tool, and a line per
/// registered [program language](GgReferenceLanguage).
///
/// Everything here is language-independent, and that is the whole reason it is its own document. A
/// tool's name and JSON schema are the *wire's*, not any language's, so carrying them beside one
/// arm's signatures would either privilege that arm or repeat the tools eleven times. The
/// signatures live in [`GgReferenceApi`], one document per arm, fetched when a reader picks one.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReference {
    /// The version of the `test-cabinet-gg` crate this reference was projected from — its
    /// `CARGO_PKG_VERSION`, which is `core`'s own, since the two crates are versioned in
    /// lockstep.
    ///
    /// Stamped on the page so a reader can tell *which* gg the prose in front of them belongs
    /// to. It is the version of the binary that wrote the documents, which for a deployment is the
    /// gg its image was built from.
    pub gg_version: String,
    /// The families the surface is grouped by, in gg's own order — the order the system
    /// prompt's API table and the built-in skills index list them in, which is roughly "the
    /// workspace, then the work, then yourself".
    pub categories: Vec<GgReferenceCategory>,
    /// Every tool gg can offer, in the canonical tool-vocabulary order.
    pub tools: Vec<GgToolReference>,
    /// Every [program language](GgProgramLanguage) the **server** can serve an arm document for,
    /// each with the size of that document — what a picker needs to render an arm before it has
    /// fetched it.
    ///
    /// Read that first clause exactly: this is not "every arm gg registers". gg writes a line per
    /// registered arm, but the arms are eleven separate files a deployment reads at run time, so
    /// what the file says and what the reader can actually serve are two facts and only one of them
    /// is worth advertising. The server therefore rebuilds this list from the documents it loaded —
    /// dropping an arm whose document is not beside the index, and taking each arm's counts from the
    /// document it read rather than from the line that describes it. An index served with a count in
    /// it is a count the reader has seen.
    pub languages: Vec<GgReferenceLanguage>,
}

/// One registered [program language](GgProgramLanguage), as the arm picker lists it.
///
/// It carries no prose of its own — the description of what an arm *is* belongs to the language
/// enum and to the docs site — only the id a reader picks by and the size of what picking it fetches.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReferenceLanguage {
    /// The language's id — the path segment its [document](GgReferenceApi) is fetched under, and
    /// the same string a run's `language` capability param is configured with.
    pub id: GgProgramLanguage,
    /// How many [capability modules](GgReferenceModule) this arm's surface is divided into.
    pub module_count: usize,
    /// How many callable functions this arm's document carries.
    pub function_count: usize,
    /// How many SDK type declarations this arm's document carries.
    pub type_count: usize,
}

/// One **program language's** whole responses-as-code surface: the modules it is divided into, and
/// every function and type in it.
///
/// Fetched when a reader picks an arm. The [index](GgReference)'s tools and families are not
/// repeated here, because they are the same on every arm and a reader who has the index already has
/// them.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReferenceApi {
    /// The gg version this arm was projected from — [the index's](GgReference::gg_version), stamped
    /// here too so a document read on its own says which gg it describes.
    pub gg_version: String,
    /// The [program language](GgProgramLanguage) every entry below is spelled in.
    pub language: GgProgramLanguage,
    /// The [capability modules](GgReferenceModule) this arm's surface is divided into, in the order
    /// a model is presented with them.
    ///
    /// The **module** is the unit of that surface: it is what the system prompt names, what a
    /// documentation search filters by, and what a program writes in front of every call it makes.
    /// So the page is grouped by module and each [entry](GgReferenceEntry::module) names the one it
    /// belongs to.
    pub modules: Vec<GgReferenceModule>,
    /// Every function and every type on this arm, in the order a model meets them: module by
    /// module, each module's callable functions and then the types declared in it.
    pub entries: Vec<GgReferenceEntry>,
}

/// One family of gg's surface: a group of tools and the [module](GgReferenceModule) their
/// responses-as-code counterparts live in.
///
/// A category is not a capability. Several capabilities land in one family (the four
/// filesystem tools are four capabilities and one family), and the three code-only families
/// (`views`, `programs`, and the ending call) have no tools at all — they exist only under
/// responses as code, which is exactly why the grouping is by *family* rather than by the
/// capability that switches something on.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReferenceCategory {
    /// The family id — also the name of the built-in skill gg ships for it, so
    /// `gg-filesystem` here is the skill a model reads by that name.
    pub id: String,
    /// The display title for the family (`Filesystem`). Written for a human reading the
    /// console; it is *not* shown to a model, which is why it is separate from
    /// [`description`](Self::description).
    pub title: String,
    /// The family's one-line description, **verbatim as a model sees it** — the line the
    /// built-in skills index carries. Not editorialized here: a second, friendlier wording
    /// would be a copy that drifts, and the point of the page is to show what is really said.
    pub description: String,
}

/// One **capability module** of the responses-as-code surface — the grouping a program writes in
/// front of a call, and the folder the reference's API tab files that call under.
///
/// It carries gg's own [id](Self::id) for the module and this arm's [spelling](Self::path) of it,
/// because the two answer to different authorities: the id is what an
/// [entry](GgReferenceEntry::module) names and what the same module is called on every other arm,
/// and the path is what a model actually writes in *this* one.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReferenceModule {
    /// gg's cross-arm id for the module — `files`, `views`, `session`.
    pub id: String,
    /// This arm's own spelling of it — `gg.files` in TypeScript, `gg::files` in Rust.
    pub path: String,
    /// The line the module's own declaration introduces it by, verbatim from the SDK — the same
    /// sentence the system prompt names it by. Never a second wording written for this page.
    pub summary: String,
    /// The [category](GgReferenceCategory::id) this module's calls belong to, or `None` for a
    /// module that carries no callable operation at all — the types-only module every arm has for
    /// the declarations that belong to no capability.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub category: Option<String>,
    /// The literal line a program writes to bring the module into scope, where the arm needs one.
    /// `None` where the SDK is in scope already, which is every registered arm but PureScript.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub import: Option<String>,
}

/// One tool, exactly as it is sent to the provider.
///
/// The [`description`](Self::description) and [`parameters`](Self::parameters) are the live
/// [tool definition](https://docs.testcabinet.ai/gg/reference/) a maximal registry
/// produced — not a re-description of it — so a renamed argument or a reworded sentence shows
/// up here the moment the tool changes, with no second copy to update. What buys the tool
/// ([`capabilities`](Self::capabilities), [`requires`](Self::requires)) is projected the same way:
/// gg withholds one thing at a time from that maximal registry and records what disappears.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgToolReference {
    /// The tool name the model calls (`read_file`).
    pub name: String,
    /// The [category](GgReferenceCategory::id) this tool belongs to.
    pub category: String,
    /// The tool's description, verbatim — the prose the model is given. Rendered with its
    /// whitespace preserved and never as markdown: what matters is what the model sees.
    pub description: String,
    /// The tool's JSON-Schema parameters, verbatim.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub parameters: serde_json::Value,
    /// Every capability id a run must hold **on its own** for this tool to be offered, in gg's
    /// order.
    ///
    /// One for almost every tool. Two for `fork`, which needs the capability of its own name *and*
    /// the `subagents` capability that buys the calls collecting the copy — and that is exactly why
    /// this is a list rather than a single optional id: a field that can only name one capability
    /// answers for one of them and silently acquits the other.
    ///
    /// **Empty means no capability decides**, which is a real state rather than a gap:
    /// `transition_state` is offered from where an agent *stands* — a state of a machine another
    /// profile declares — and naming a capability for it would be naming something that does not
    /// decide it. Its condition is in [`requires`](Self::requires) instead.
    ///
    /// A capability that is required only *in the alternative* — as one of the ways a condition can
    /// be met — is not here; it is a clause of that [condition](Self::requires), because it is not
    /// something a run must hold.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    /// Every condition **beyond** the capabilities that decides whether this tool is offered — a
    /// bound store, a writable handle, a memory strategy, a non-empty roster, a position in a
    /// machine. Empty when the capabilities alone decide.
    ///
    /// Each entry is one thing that must be true, and each carries the sentence gg composed for it,
    /// so the console renders a string it never wrote. See [`GgToolCondition`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<GgToolCondition>,
    /// The placeholder tokens standing in this entry's prose and schema where a **run's own data**
    /// would be, each with what it stands for.
    ///
    /// Some descriptions enumerate run data rather than a policy: `spawn_subagent` lists the roster,
    /// `read_skill` lists the library, `transition_state` names the state the agent is in. There is
    /// no configuration-independent rendering of those, so the reference is projected from a run
    /// with obvious placeholders in it — and this is where the page learns which strings are
    /// placeholders instead of inferring it from angle brackets, which ordinary prose also contains.
    ///
    /// Empty for every tool whose description is the same in every run, which is most of them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub run_data: Vec<GgRunDataStandIn>,
    /// Alternate renderings of the **same tool** under a different configuration — a policy
    /// that rewrites the description or the parameter schema.
    ///
    /// Empty for most tools. A handful genuinely change shape with their capability's
    /// implementation (`read_file` offers no paging arguments at all under the unlimited read
    /// mode), and showing only one of those would misrepresent every run configured the other
    /// way. The top-level description and parameters are the **default** configuration's.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<GgToolVariant>,
}

/// One condition a run must satisfy for a [tool](GgToolReference) to be offered, beyond holding the
/// capabilities.
///
/// It may be a **disjunction**: `wait_for_subagents` is offered to an agent that can have children
/// at all, which is a non-empty roster *or* the `fork` capability, and either satisfies it. That is
/// why [`axes`](Self::axes) is a list — one entry per alternative — and why the
/// [sentence](Self::sentence) is composed by gg rather than assembled from the parts by a page that
/// would have to know how to join them.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgToolCondition {
    /// The condition as a sentence, written in the second person about the *run* rather than about
    /// the model's options — "Only when the agent holds a task-list module."
    ///
    /// Composed by gg from one authored template per kind of alternative, which is what keeps the
    /// authorship at "one sentence per kind of condition" instead of one per tool. A template
    /// cannot be wrong about *which* condition applies to a tool, and the sentences it replaced
    /// could be, because nothing checked them against the code they described.
    pub sentence: String,
    /// The configuration axes this condition constrains — one id per alternative, so a page can
    /// group or filter by them: `capability`, `module`, `memory-access`, `memory-strategy`,
    /// `compaction-strategy`, `roster`, `machine`.
    ///
    /// One entry for an ordinary condition and several for a disjunction, in the order the
    /// [sentence](Self::sentence) names them.
    pub axes: Vec<String>,
}

/// One placeholder token standing where a **run's own data** would appear in a
/// [tool](GgToolReference)'s prose or parameter schema.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgRunDataStandIn {
    /// The literal token as it appears in the description and schema — `<agent>`, `<skill>`,
    /// `<state>`. A page marks these in place; it does not go looking for angle brackets, because
    /// the tool descriptions contain those in ordinary prose too.
    pub token: String,
    /// What a real run would have there instead, as a phrase that completes "this stands for …" —
    /// "the agents on this run's own roster".
    pub stands_for: String,
}

/// One alternate rendering of a [tool](GgToolReference) under a non-default policy.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgToolVariant {
    /// What configuration produced this rendering, as a label a reader can match against the
    /// capability editor (`read mode: default-cap`).
    pub label: String,
    /// The description this configuration sends, verbatim.
    pub description: String,
    /// The JSON-Schema parameters this configuration sends, verbatim.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub parameters: serde_json::Value,
}

/// Which kind of thing one [entry](GgReferenceEntry) documents.
///
/// The two are the two kinds of documentation view gg opens, and they are separate kinds rather
/// than one because a model reads them separately: a function view says how to call something, and
/// a type view says what a value it hands back is made of. Modelling them as one list with a
/// discriminant — rather than as two lists — is what lets the page order them the way a model meets
/// them, module by module.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReferenceEntryKind {
    /// A callable function.
    Function,
    /// An SDK type declaration.
    Type,
}

/// One entry of an arm's surface — a function or a type — carrying **the bytes its documentation
/// view renders** plus what a page needs to file, link and filter it.
///
/// # Why the documentation is one block and not a structure
///
/// [`body`](Self::body) is not a rendering of this entry assembled for the console. It is the
/// string gg's own documentation runtime produces for that name, from the same call a program makes
/// with `view.openDocsView(...)` mid-run — so what a reader of this page sees and what a model sees
/// are the same bytes by construction rather than by two renderers agreeing. The owner's rule for
/// this page is that it show *exactly* what an agent would; a second renderer over structured
/// fields is precisely the second source of truth that rule forbids, however faithful it is on the
/// day it is written.
///
/// What that costs is real and worth stating: the page cannot filter by parameter, cannot fold a
/// long argument list, and cannot linkify a type named *inside* the block without parsing it — which
/// would be the second renderer again. The links come from the FQN lists beside the body
/// ([`types`](Self::types), [`returns`](Self::returns)), which are names rather than prose.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReferenceEntry {
    /// Whether this entry documents a function or a type. See [`GgReferenceEntryKind`].
    pub kind: GgReferenceEntryKind,
    /// **The key this entry is opened by** — the fully-qualified name a `view.openDocsView` takes
    /// and a documentation search files its hit under (`gg.files.readFile`, `gg.files.FileRead`).
    ///
    /// Unique within the document, which is what makes it the page's own route parameter. The bare
    /// [`name`](Self::name) is not: a convenience method on a value and the free function it aliases
    /// may share one.
    pub fqn: String,
    /// The name a program writes at the call site (`readFile`), or the type's own name.
    pub name: String,
    /// The [module](GgReferenceModule::id) this entry belongs to, by gg's id for it (`files`).
    pub module: String,
    /// The [category](GgReferenceCategory::id) this entry belongs to, or `None` for one that
    /// belongs to no family — a type declared in the types-only module every arm has for the shapes
    /// no capability owns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub category: Option<String>,
    /// The one line a search result carries — the entry's authored brief. It is the first thing of
    /// the [body](Self::body), not a second wording of it.
    pub brief: String,
    /// **The documentation view's whole body**, verbatim: for a function, every shape it may be
    /// called in with a line per argument and then its description; for a type, its declaration, its
    /// paragraph, a line per member and a line per member function a value of it offers.
    ///
    /// Rendered with its whitespace preserved. See this type's own note on why it is a block.
    pub body: String,
    /// gg's own [operation](https://docs.testcabinet.ai/gg/languages/static-sdks/) id for what this
    /// call does (`files.read_file`) — the identity that is the same in all eleven arms, and the
    /// string a run's calls are recorded under. `None` for a type, which is not a call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub operation: Option<String>,
    /// Set when this entry is a **second** way to reach an [operation](Self::operation) the arm
    /// already binds elsewhere — the method some arm hangs off the type it operates on, beside the
    /// free function every arm has — naming that operation.
    ///
    /// It is a fact about the arm rather than about gg: an arm may ship a convenience its neighbours
    /// do not, which is the whole point of eleven idiomatic SDKs rather than eleven transliterations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub alias_of: Option<String>,
    /// The declared type this entry is a **member of**, for a function called on a value rather than
    /// on a module; `None` for a free function and for a type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub receiver: Option<String>,
    /// For an ending call, the ending role whose programs bind it (`standard`, `review`);
    /// `None` for everything else, which every role reaches the same way.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub ending: Option<String>,
    /// The **capability** that buys this function, by gg's own id for it (`memories`,
    /// `program-library`, `docview-close`), or `None` for a function no capability gates.
    ///
    /// This and [`ending`](Self::ending) are the only two things that can withhold a call — a
    /// capability the agent's profile does not switch on, or an ending belonging to another role —
    /// so a reader that finds both empty may say the function is always available, and one that does
    /// not must not.
    ///
    /// There is deliberately no third field naming a *tool*. The API surface is not gated by the
    /// tool surface: the two are independent vocabularies over one core, an agent holds exactly one
    /// of them, and a tool name on an API function was an answer to a question nobody could ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub capability: Option<String>,
    /// The [fully-qualified names](Self::fqn) of every SDK type this function's signature reaches,
    /// **transitively closed** — every declaration a program holding this call's arguments and its
    /// result can end up looking at.
    ///
    /// Names, never declarations. The type's own entry is in this same document, so a page links to
    /// it; expanding each declaration into every function that mentions it is what made the old
    /// single-arm artifact four times the size of this whole one, with eighty-eight per cent of it
    /// the same type declarations written out again.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub types: Vec<String>,
    /// The [fully-qualified names](Self::fqn) of the SDK types in this function's **return**
    /// position. Empty for a call that hands nothing back, and for a type.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub returns: Vec<String>,
    /// The type views gg opens **beside** this function's own when a model opens it, under the
    /// `return` documentation-view mode — the default.
    ///
    /// This is the real answer, computed by the same function the run uses, rather than the
    /// transitive [`types`](Self::types) list a reader would otherwise mistake for it: the two
    /// differ, because opening is exactly one level deep and the closure is not.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opens_under_return: Vec<String>,
    /// The type views gg opens beside this function's own under the `return-and-parameters` mode —
    /// every catalogued type the signature itself names, still one level deep.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub opens_under_return_and_parameters: Vec<String>,
}
