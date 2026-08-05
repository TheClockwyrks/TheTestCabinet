//! The **gg reference**: every tool and every responses-as-code function gg offers a model,
//! carried verbatim, as a data contract the console renders.
//!
//! gg's model-facing surface is large and it is the thing a reader of a run most often wants
//! to check: what, exactly, was the model told `read_file` does? What is the signature of
//! `fs.readFile`? Until now the only honest answer was to read `crates/gg/src/tools/` — the
//! docs site paraphrases a capability, and a paraphrase of prose written *for a model* is a
//! second copy that drifts. So the reference is not written at all. It is **projected from
//! gg's own definitions**: the tool descriptions are the [`ToolDefinition`]s a live
//! [`ToolRegistry`] hands the provider, and the function entries are the committed signature
//! catalogue reflected out of the sandbox SDK's own `.d.ts`.
//!
//! # Why this lives in `core`, and why it is a committed artifact
//!
//! The projection is built by `test-cabinet-gg`, which the **backend cannot depend on**: that
//! crate pulls `wasmtime`, `oxc` and `tiktoken-rs`, and the backend is built portable and
//! static under musl. So the flow is the one `crates/gg/src/sandbox/guests/` and
//! `packages/run-record/src/gg-system-prompt.ts` already use — generate, commit, serve, and
//! gate the diff in CI:
//!
//! ```text
//! gg reference                       → this contract, as JSON on stdout
//!   └─ scripts/gen-contract.mjs      → crates/backend/src/gg_reference.json
//!        └─ backend `include_str!`   → GET /gg/reference
//!             └─ console             → the gg Reference section
//! ```
//!
//! The DTOs live here because `core` is what the backend and `contract-codegen` already
//! depend on, so the TypeScript bindings and JSON Schemas come out of the same generator every
//! other contract type's do. Nothing in this module computes anything — it is the wire shape
//! and its documentation, and the one place a field's meaning is written down.
//!
//! Regenerate the TypeScript/JSON-Schema bindings with `npm run gen:contract` after any change
//! here. JSON is camelCase.
//!
//! [`ToolDefinition`]: https://docs.testcabinet.ai/gg/toolset-ablation/
//! [`ToolRegistry`]: https://docs.testcabinet.ai/gg/toolset-ablation/

use serde::{Deserialize, Serialize};

use crate::gg::GgProgramLanguage;

/// The whole reference: the families the surface is grouped by, every tool, and every
/// responses-as-code function.
///
/// One document rather than three endpoints because it is small, wholly static, and read as a
/// unit — a reader who opens the Tools tab is one click from the API tab, and a category is
/// meaningless without the entries that hang off it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReference {
    /// The version of the `test-cabinet-gg` crate this reference was projected from — its
    /// `CARGO_PKG_VERSION`, which is `core`'s own, since the two crates are versioned in
    /// lockstep.
    ///
    /// Stamped on the page so a reader can tell *which* gg the prose in front of them belongs
    /// to. It is the committed artifact's version, not the running deployment's: they are the
    /// same whenever the artifact was regenerated, and CI's drift gate is what keeps that true.
    pub gg_version: String,
    /// The [program language](GgProgramLanguage) the [functions](Self::functions) below are
    /// spelled in.
    ///
    /// gg's responses-as-code surface is one set of capabilities that every registered language
    /// offers under its own spellings — identical objects, identical gates, different function
    /// names and signatures. So a page showing signatures has to say whose, and a reader comparing
    /// two arms of a cross-language study has to be able to tell which one they are reading. The
    /// [tools](Self::tools) are unaffected: a tool's name and JSON schema are the wire's, not any
    /// language's.
    ///
    /// `#[serde(default)]` so an artifact generated before this field existed still decodes as the
    /// default language, which is the one it was in fact projected from.
    #[serde(default)]
    pub language: GgProgramLanguage,
    /// The families the surface is grouped by, in gg's own order — the order the system
    /// prompt's API table and the built-in skills index list them in, which is roughly "the
    /// workspace, then the work, then yourself".
    pub categories: Vec<GgReferenceCategory>,
    /// Every tool gg can offer, in the canonical tool-vocabulary order.
    pub tools: Vec<GgToolReference>,
    /// Every function a [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/)
    /// program can call, in catalogue order.
    pub functions: Vec<GgApiFunction>,
}

/// One family of gg's surface: a group of tools and the API object(s) their
/// responses-as-code counterparts hang off.
///
/// A category is not a capability. Several capabilities land in one family (the four
/// filesystem tools are four capabilities and one family), and the three code-only families
/// (`view`, `programs`, and the ending call) have no tools at all — they exist only under
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
    /// The responses-as-code API objects this family's functions hang off (`["fs"]`).
    ///
    /// A list rather than one name because of the ending family: `harness`, `review` and
    /// `judge` are one family grouped by role, and a given agent binds exactly one of them.
    pub objects: Vec<String>,
}

/// One tool, exactly as it is sent to the provider.
///
/// The [`description`](Self::description) and [`parameters`](Self::parameters) are the live
/// [tool definition](https://docs.testcabinet.ai/gg/toolset-ablation/) a maximal registry
/// produced — not a re-description of it — so a renamed argument or a reworded sentence shows
/// up here the moment the tool changes, with no second copy to update.
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
    /// The capability id that contributes this tool, or `None` for one no capability decides.
    ///
    /// Every tool has one today; the field is optional because the gate is a *fact about the
    /// implementation*, and a tool offered from somewhere else entirely (the way
    /// `transition_state` is offered from a machine position rather than from a capability on
    /// the agent's own profile) must be able to say so rather than name a capability that does
    /// not really decide it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub capability: Option<String>,
    /// A sentence naming any condition **beyond** the capability that decides whether this tool
    /// is offered — a bound store, a memory strategy, a non-empty roster, a position in a
    /// machine. `None` when the capability alone decides, which is the common case.
    ///
    /// Also where a description built from *run data* says so: `spawn_subagent` enumerates the
    /// agents this run's roster lists, so the text below it is one run's, not the tool's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub note: Option<String>,
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

/// One [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) API function, as
/// the sandbox SDK declares it.
///
/// Everything here is reflected out of the guest SDK's emitted `.d.ts` and its JSDoc, which is
/// the same material a model gets back from `view.openDocsView(...)` — so this page and the
/// documentation lookup a program can perform mid-run cannot disagree.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgApiFunction {
    /// The API object the function hangs off in a program's scope (`fs`).
    pub object: String,
    /// The name a program calls it by (`readFile`).
    pub name: String,
    /// The [category](GgReferenceCategory::id) the function's object belongs to.
    pub category: String,
    /// The one-line summary `object.list()` shows — the first sentence of
    /// [`doc`](Self::doc).
    pub summary: String,
    /// Every shape the SDK offers this function in, each with the arguments it takes.
    ///
    /// An array rather than one string because how a language expresses an optional argument is
    /// that language's own business: an overload pair and a default argument are two spellings of
    /// one capability, and the first arrives here as two entries where the second arrives as one.
    pub signatures: Vec<GgApiSignature>,
    /// The SDK's own paragraph of documentation, verbatim. Rendered with its whitespace
    /// preserved, for the same reason a tool's description is.
    pub doc: String,
    /// The gg tool whose being enabled binds this function, or `None` for one nothing gates —
    /// an ending call (decided by the agent's [role](Self::ending)), a view function bound to
    /// every program whatever a run enables, or a program-library call (see
    /// [`library`](Self::library)).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub gate: Option<String>,
    /// For an ending call, the ending role whose programs bind it (`standard`, `review`,
    /// `judge`); `None` for everything else, which every role reaches the same way.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub ending: Option<String>,
    /// Whether this function belongs to the
    /// [program library](https://docs.testcabinet.ai/gg/program-library/) — the one family a
    /// *capability* binds as a whole rather than a tool or a role, and therefore the one
    /// neither [`gate`](Self::gate) nor [`ending`](Self::ending) can express.
    pub library: bool,
    /// The declarations of every type this function's signature refers to, transitively closed
    /// — exactly what a `view.openDocsView` lookup appends for the types the session has not
    /// already been shown.
    pub types: Vec<GgApiType>,
}

/// One way an [API function](GgApiFunction) may be called.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgApiSignature {
    /// The signature as the SDK declares it, beginning with the name a program calls.
    pub signature: String,
    /// Every argument this shape takes, in the order it takes them.
    pub parameters: Vec<GgApiParameter>,
}

/// One argument an [API signature](GgApiSignature) takes, or one field of a structured argument.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgApiParameter {
    /// The name the signature declares it under.
    pub name: String,
    /// Its type, as the SDK writes it.
    #[serde(rename = "type")]
    pub kind: String,
    /// Whether the call is legal without it.
    pub optional: bool,
    /// How it is passed: `positional`, or `keyword` for a language whose call site writes the
    /// argument's name as well as its value.
    pub passing: String,
    /// The value it takes when it is left out, for a language that says so in the signature.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub default: Option<String>,
    /// The SDK's own documentation for it — what to put here, and what happens if you do not.
    pub doc: String,
    /// The fields of a structured argument written inline at the call site, each documented in its
    /// own right. Empty for an argument typed by name, whose documentation is on that
    /// [type](GgApiType)'s members instead.
    pub fields: Vec<GgApiParameter>,
}

/// One type declaration an [API function](GgApiFunction)'s signature refers to.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgApiType {
    /// The type's name, as it appears in the signature.
    pub name: String,
    /// The declaration, as the SDK wrote it.
    pub declaration: String,
    /// The SDK's own documentation for the type: what it is, and why it has the shape it has.
    pub doc: String,
    /// One line per member — a record's properties, or the arms of a union — each with the
    /// documentation written on it. A declaration says what fields a value has and nothing about
    /// what any of them means, which is the half that decides whether a model uses it correctly.
    pub members: Vec<GgApiTypeMember>,
}

/// One member of an [API type](GgApiType).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgApiTypeMember {
    /// The member's name as a program reads it (`totalLines`), or the literal itself (`"pending"`)
    /// for the arm of a union.
    pub name: String,
    /// The member's type; absent for a union arm, which is a value rather than a field and so has
    /// no type beside itself.
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub kind: Option<String>,
    /// The SDK's own documentation for the member.
    pub doc: String,
}
