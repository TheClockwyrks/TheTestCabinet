//! The committed signature catalogue: what the model is *told* it may call, reflected out of what
//! the guest actually exports.
//!
//! When a model asks for a function's documentation — `view.openDocsView(fs.readFile)`, serviced by the
//! [docs carve-out](crate::docs) — gg answers in the run's own program language with every shape the
//! function may be called in, a line saying what to put in each argument, a sentence of
//! documentation, and the types the signature references with a line per member.
//! Hand-writing that would guarantee it drifts — a renamed parameter, an options object that became
//! positional, a tool whose behaviour changed — and documentation that describes a signature the
//! sandbox does not have is worse than none, because the model has no way to discover the lie.
//!
//! So the catalogue is generated from the guest SDK's own emitted `.d.ts` and its JSDoc, committed
//! beside the component **by the same build**, and read from here through
//! [`catalogue_functions`], [`catalogue_objects`] and [`type_declaration`]. The documentation
//! therefore cannot be more current than the component that implements it, which is the correct
//! failure direction: a stale catalogue describes a sandbox that once existed, while a hand-written
//! one describes a sandbox that never did.
//!
//! # Every word of it is written on a declaration
//!
//! Not just the sentence under a function: the description of each **argument**, of each **field**
//! of a structured argument, of each **type** and each of its **members**, and of each **API
//! object**, is reflected out of the doc comment on the thing it describes. A description authored
//! anywhere else — a table, a prompt template, a `const` in this crate — is one that drifts from
//! its subject with nothing to catch it, which is the same failure hand-writing a signature is. The
//! guest's generator refuses to emit a catalogue with a blank in it, and the
//! agreement gate (`language/agreement.rs`) refuses one at load, so the rule is enforced twice:
//! once in the language that can see its own AST, and once over the emitted JSON, where it is the
//! same check for every language there will ever be.
//!
//! # One schema, one catalogue per language
//!
//! What lives here is the catalogue's **schema**, its parsing and the [`CatalogueFunction`]
//! projection — all of which are language-independent, because every language's SDK offers the same
//! surface under its own spellings. That is what each non-tool entry's
//! [`key`](CatalogueFunction::key) is for: `requestChanges` and `request_changes` are one function
//! under two spellings, and the key is what says so.
//!
//! What does *not* live here is the data: each registered [language](mod@super::language) owns its
//! own committed JSON and its own parsed copy, reached through [`ProgramLanguage::catalogue`]. A
//! reader that wants "the catalogue" therefore has to say whose, which is exactly the question a
//! cross-language study makes unavoidable.
//!
//! # Two schemas at once, and why the second reader is still here
//!
//! A catalogue declares its [`schema`](SignatureCatalogue::schema), and gg parses both the shape
//! every arm committed before the conversion ([`V1`](SchemaVersion::V1)) and the one they all
//! commit now ([`V2`](SchemaVersion::V2)) — see [`SchemaVersion`] for what each carries and why the
//! second exists.
//!
//! Version dispatch is what made the move possible at all. Eleven arms are reflected by eleven
//! different documentation tools out of ten source trees, and converting them in one commit would
//! have meant eleven toolchains, eleven regenerated artifacts and eleven prose rewrites landing
//! together, with nothing green in between. Dispatch made each arm's conversion **its own commit**:
//! an arm that had not moved kept parsing and rendering exactly as before, and one that had was read
//! through the same normalized projection ([`catalogue_functions`], [`catalogue_modules`]) as the
//! rest, so no consumer ever had to ask which schema it was looking at.
//!
//! **Every registered arm is now `V2`**, which `every_registered_arm_is_written_in_the_schema_this_tree_says_it_is`
//! holds them to. What the v1 reader still buys is the ability to *refuse* one by name — the
//! capability gate hands itself a v1 document and asserts the complaint — so retiring it is a change
//! to what those gates can be shown doing rather than a deletion of dead code, and it belongs in a
//! commit of its own. Whichever commit that is takes the v1 sections and the
//! [transitional brief derivation](Prose::from_paragraph) with it.

use std::borrow::Cow;

use serde::Deserialize;
use test_cabinet_core::gg::{CAPABILITY_PROGRAM_LIBRARY, GgProgramLanguage};

use super::language::{ProgramLanguage, SurfaceCall};
use super::operations::{Binding, operation_by_id};

// The whole vocabulary backs [`sandbox_tool_names`], which is a drift gate rather than a
// run-time need — so, like it, the names it is built from are only reachable under test.
#[cfg(test)]
use crate::tools::ALL_TOOL_NAMES;

/// Which shape a committed catalogue is written in — the discriminator every reader dispatches on,
/// and the thing that lets one arm move to the new model without moving the other ten.
///
/// # What each version is
///
/// **[`V1`](Self::V1)** is the shape every arm committed before the conversion: functions filed into five sections
/// (`session`, `views`, `programs`, `tools`, `helpers`), each entry hanging off an **API
/// object** (`fs`, `view`) and carrying the gate that binds it (`requires`, `ending`) as a field the
/// reflector wrote. Documentation is one `doc` paragraph per entry, out of which a one-line summary
/// was derived.
///
/// **[`V2`](Self::V2)** is the normalized doc model: one flat [`functions`](SignatureCatalogue::functions)
/// array whose entries name a gg [operation](super::operations) rather than a section, live in a
/// [module](ModuleDoc) rather than on an object, are keyed by a module-qualified
/// [`fqn`](FunctionSignature::fqn), carry an **authored** [brief and optional detail](Prose) rather
/// than a derived summary, and record their type references **resolved** rather than as written.
///
/// # Why a version rather than "just add the fields"
///
/// Because the two disagree about where the truth is, not merely about how much of it there is. A
/// v1 entry asserts its own gate; a v2 entry does not, because gating is gg's ([`Binding`]). A v1
/// entry's brief is *computed* from prose that was not written to have one; a v2 entry's is
/// written. Reading a v1 entry as though it were a v2 one would take a derived brief and hold it to
/// a rule about authored briefs — which is exactly what the
/// register gate (`language/register.rs`) refuses to do, and why it is inert below `V2`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Deserialize)]
#[serde(try_from = "u32")]
pub enum SchemaVersion {
    /// Sections, API objects, arm-declared gates, one `doc` paragraph. What every arm committed
    /// before the conversion, and what no registered arm commits now.
    ///
    /// The default, and deliberately: a catalogue written before the field existed carries no
    /// `schema` key, and the only honest reading of its absence is the shape that predates it.
    #[default]
    V1,
    /// Modules, operations, fully-qualified names, authored briefs, resolved type references.
    V2,
}

impl TryFrom<u32> for SchemaVersion {
    type Error = String;

    /// The `schema` key as it is written in the JSON — a bare number, so that the artifact reads
    /// `"schema": 2` rather than `"schema": "v2"`.
    ///
    /// An unknown number is an **error** rather than a fallback to the newest shape gg knows: a
    /// catalogue from a future gg describes a surface this gg cannot render, and rendering it as
    /// though it were the shape gg happens to understand is how a model is handed a signature
    /// nobody wrote.
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::V1),
            2 => Ok(Self::V2),
            other => Err(format!(
                "`schema` is {other}, and this gg reads catalogue schemas 1 and 2 — a catalogue \
                 from a newer gg describes a surface this one cannot render"
            )),
        }
    }
}

/// The whole catalogue: one entry per bound tool, one per helper, and the type declarations they
/// reference.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignatureCatalogue {
    /// Which [shape](SchemaVersion) this catalogue is written in. Absent means
    /// [`V1`](SchemaVersion::V1) — see that type for why absence cannot mean anything else.
    #[serde(default)]
    pub schema: SchemaVersion,
    /// The [program language](GgProgramLanguage) whose spellings this catalogue carries.
    ///
    /// Every language's guest emits one of these, in this shape, under its own stem in
    /// `crates/gg/src/sandbox/guests/`. The field is what lets the language that embedded a
    /// catalogue check it got its own: a file committed under the wrong stem would otherwise reach a
    /// model as a system prompt describing a sandbox nobody has.
    pub language: GgProgramLanguage,
    /// Where the catalogue was reflected from, recorded so a reader of the committed JSON knows
    /// which sources to regenerate it from.
    #[allow(
        dead_code,
        reason = "provenance for a human reading the committed artifact, not something gg renders"
    )]
    pub generated_from: String,
    /// The **libraries** a program of this language may reach for, grouped as the artifact that
    /// decides the set groups them — the one entry here that is not a signature.
    ///
    /// It belongs in the catalogue for the reason every signature does: it is **model-facing text
    /// about this arm's surface**, so the rule that nothing a model reads may be authored anywhere
    /// but on the code that decides it applies word for word. A prompt that listed a language's
    /// libraries in prose would drift from the artifact with nothing to catch it — and on the
    /// [Python](super::language::python) arm it did, claiming a whole standard library where
    /// `componentize-py` had baked a curated subset of it.
    ///
    /// Empty for a language whose programs get their runtime's own standard library and nothing
    /// else: `#[serde(default)]`, so an arm with nothing to declare commits a catalogue without the
    /// key and its templates simply render no such section.
    #[serde(default)]
    pub libraries: Vec<LibraryGroup>,
    /// The **API objects** a program's surface is divided into, in the order it is presented in,
    /// each with the one sentence a model is introduced to it by.
    ///
    /// Ordered rather than keyed, because the order is model-facing: it is the sequence the system
    /// prompt's API list renders in and the sequence the run's agent surface reports. Every object a
    /// catalogued function hangs off appears here exactly once, and nothing else does — an object
    /// with no functions would be an object a model is introduced to and never given.
    ///
    /// **[`V1`](SchemaVersion::V1) only.** A [`V2`](SchemaVersion::V2) catalogue has
    /// [`modules`](Self::modules) instead and omits this key — an API object is a name a model must
    /// already know to reach anything, which is what the module vocabulary replaces.
    #[serde(default)]
    pub objects: Vec<ObjectDoc>,
    /// The model-facing functions that are not gg tools: the calls that end a session, one group per
    /// [role](crate::ending::EndingRole).
    ///
    /// Kept out of [`tools`](Self::tools) because none of them has a gg tool name, which is what
    /// keeps that array in exact bijection with the gg tool vocabulary the committed component is
    /// checked against.
    ///
    /// **[`V1`](SchemaVersion::V1) only.** A [`V2`](SchemaVersion::V2) catalogue files every
    /// model-facing call into one flat [`functions`](Self::functions) array, because the section an
    /// entry sat in was only ever a gate field by another name, and a gate is gg's to state.
    #[serde(default)]
    pub session: Vec<SessionSignature>,
    /// The model-facing functions that put material into the agent's own context window — the `view`
    /// object.
    ///
    /// Kept out of [`tools`](Self::tools) on the same rule [`session`](Self::session) is: none of
    /// them has a gg tool name, so folding them in would break the bijection the committed component
    /// is checked against.
    ///
    /// **[`V1`](SchemaVersion::V1) only.** A [`V2`](SchemaVersion::V2) catalogue files every
    /// model-facing call into one flat [`functions`](Self::functions) array, because the section an
    /// entry sat in was only ever a gate field by another name, and a gate is gg's to state.
    #[serde(default)]
    pub views: Vec<ViewSignature>,
    /// The model-facing functions on the [program library](crate::programs) — the `programs`
    /// object.
    ///
    /// Kept out of [`tools`](Self::tools) on the same rule the two above are: none of them has a gg
    /// tool name. They carry no gate field at all, because the whole object is bound or absent
    /// together and what decides that is a *capability* rather than a tool — which the projection
    /// carries as [`CatalogueFunction::capability`], synthesized from this section's membership
    /// rather than read out of the JSON.
    ///
    /// **[`V1`](SchemaVersion::V1) only.** A [`V2`](SchemaVersion::V2) catalogue files every
    /// model-facing call into one flat [`functions`](Self::functions) array, because the section an
    /// entry sat in was only ever a gate field by another name, and a gate is gg's to state.
    #[serde(default)]
    pub programs: Vec<ProgramSignature>,
    /// One entry per gg tool the sandbox binds, in catalogue order.
    ///
    /// **[`V1`](SchemaVersion::V1) only.** A [`V2`](SchemaVersion::V2) catalogue files every
    /// model-facing call into one flat [`functions`](Self::functions) array, because the section an
    /// entry sat in was only ever a gate field by another name, and a gate is gg's to state.
    #[serde(default)]
    pub tools: Vec<ToolSignature>,
    /// The helper functions bound alongside a tool — convenience wrappers that are not gg tools in
    /// their own right and therefore have no name in [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES).
    ///
    /// **[`V1`](SchemaVersion::V1) only.** A [`V2`](SchemaVersion::V2) catalogue files every
    /// model-facing call into one flat [`functions`](Self::functions) array, because the section an
    /// entry sat in was only ever a gate field by another name, and a gate is gg's to state.
    #[serde(default)]
    pub helpers: Vec<HelperSignature>,
    /// The **modules** a [`V2`](SchemaVersion::V2) surface is divided into, in the order it is
    /// presented in. The successor of [`objects`](Self::objects).
    ///
    /// A module differs from an API object in the one way that matters to a model that has not been
    /// told the vocabulary: it is a *place documentation is filed under*, not an identifier a call
    /// has to go through. Nothing is unreachable for not knowing a module's name, because search
    /// finds the function; knowing the name makes the search an exact lookup instead.
    ///
    /// Empty on a `V1` catalogue, which has objects instead.
    #[serde(default)]
    pub modules: Vec<ModuleDoc>,
    /// **Every model-facing call**, in one array — the successor of the five sections above, and the
    /// shape a [`V2`](SchemaVersion::V2) catalogue carries.
    ///
    /// One array rather than five because the sections were never a fact about the functions: they
    /// were where an arm filed a gate it should never have been asserting. With gating stated once
    /// by gg's [operations table](super::operations), the only thing a section still said is which
    /// gate field to look in — so there is nothing left for it to say.
    ///
    /// Empty on a `V1` catalogue, whose calls arrive in the sections.
    #[serde(default)]
    pub functions: Vec<FunctionSignature>,
    /// Every type declaration the signatures reference, in declaration order.
    ///
    /// The one section both schemas share. A `V2` declaration carries more — an
    /// [`fqn`](TypeDeclaration::fqn), the [module](TypeDeclaration::module) it belongs to, an
    /// authored [brief](TypeDeclaration::brief), and the
    /// [member functions](TypeDeclaration::member_functions) a value of it offers — and every one of
    /// those is optional here, so a v1 declaration parses unchanged.
    #[serde(default)]
    pub types: Vec<TypeDeclaration>,
}

/// One **module**: gg's cross-arm id for it, this language's own spelling of the path, and how (or
/// whether) a program brings it into scope.
///
/// # Why an id and a path rather than one name
///
/// Because they answer to different readers. [`id`](Self::id) is gg's, identical on every arm, and
/// is what a cross-language readout joins on — `files` is the filesystem module whether the arm
/// spells it `gg::fs`, `Gg.Files` or `gg/fs`. [`path`](Self::path) is the **arm's**, is what a model
/// reads and types into a module filter, and is free to be idiomatic in a way an id never can be.
/// Collapsing the two would mean either a model typing gg's vocabulary at a language that does not
/// use it, or a study joining eleven arms on eleven different strings.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(
    dead_code,
    reason = "the normalized doc model is read by the gates that hold each arm to it — the \
              register gate and the fully-qualified-name rule — and by the readers that consume it \
              as each stage of the documentation surface lands. A field whose reader belongs to a \
              stage that has not landed yet is unread, and is carried here so that the stage which \
              needs it finds it already reflected by all eleven arms."
)]
pub struct ModuleDoc {
    /// gg's language-independent module id (`files`, `views`, `docs`) — the cross-arm join key, and
    /// the same vocabulary an [operation id](super::operations::OperationId) is namespaced on.
    pub id: String,
    /// This language's own spelling of the module path (`gg::fs`, `Gg.Files`, `gg/fs`) — what a
    /// model reads, what a fully-qualified name is prefixed with, and what a module filter accepts.
    pub path: String,
    /// The one line the module is introduced by. See [`Prose`].
    pub brief: String,
    /// What more there is to say about the module, when there is more. See [`Prose`].
    pub detail: Option<String>,
    /// The literal line a program writes to bring the module into scope, or `None` where the SDK is
    /// in scope already and there is no line to write.
    ///
    /// It is `None` on ten of the eleven arms, and that is the honest answer rather than a missing
    /// one: gg injects the SDK into a program's scope through a prelude, a precompiled header, an
    /// `@_exported import`, a global using or a scope injection, so a documented "import" would be a
    /// line the model would be wrong to write. The one arm that writes a real one says so here.
    pub import: Option<String>,
}

/// **One model-facing call** in the [`V2`](SchemaVersion::V2) model, whatever kind of thing the arm
/// declared it as.
///
/// It replaces five types that differed only in which gate field they carried
/// ([`ToolSignature`], [`SessionSignature`], [`ViewSignature`], [`ProgramSignature`],
/// [`HelperSignature`]) — and it carries no gate at all, because a gate is a fact
/// about gg's configuration surface and an arm asserting one is an arm asserting something only gg
/// can be held to. What it carries instead is the [operation](Self::operation) it binds, which is
/// the join to the [table](super::operations::OPERATIONS) where gg states the gate once.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(
    dead_code,
    reason = "the normalized doc model is read by the gates that hold each arm to it — the \
              register gate and the fully-qualified-name rule — and by the readers that consume it \
              as each stage of the documentation surface lands. A field whose reader belongs to a \
              stage that has not landed yet is unread, and is carried here so that the stage which \
              needs it finds it already reflected by all eleven arms."
)]
pub struct FunctionSignature {
    /// The gg [operation](super::operations::OperationId) this call binds, rendered
    /// `namespace.key` — `files.read_file`. **The cross-arm join key**, and what gg resolves the
    /// gate through.
    pub operation: String,
    /// Set when this entry is a *second* way to reach [`operation`](Self::operation) — a free
    /// function beside the method on the type it operates on, a block form beside a keyword form.
    ///
    /// An alias is documented and gated exactly like the canonical binding and counts toward
    /// nothing: coverage counts canonical bindings, so an arm that idiomatically offers one
    /// capability twice is not thereby ahead of an arm that offers it once.
    pub alias_of: Option<String>,
    /// The [module](ModuleDoc::id) it is documented under.
    pub module: String,
    /// What kind of declaration the arm made of it. See [`EntryKind`].
    pub kind: EntryKind,
    /// The declared type this call hangs off, for a [member](EntryKind::Method) kind; `None` for a
    /// standalone function and for a static method whose owning class *is* the module.
    pub receiver: Option<String>,
    /// The name a program calls it by, in this language (`read_file`, `readFile`, `ReadFile`).
    pub name: String,
    /// **The model-facing key**: this call's module-qualified fully-qualified name, in the arm's own
    /// spelling.
    ///
    /// Emitted by the reflector and never assembled by gg — see
    /// the rule it is held to (`signatures.fqn.rs`) for the four invariants that make eleven
    /// disagreeing spellings usable as one key.
    pub fqn: String,
    /// How the call is **written at a call site**, when that differs from the
    /// [`fqn`](Self::fqn) — Java's `#`-separated member name and Swift's labelled selector are keys
    /// rather than syntax, and a model that typed one would not compile.
    pub call: Option<String>,
    /// The single line this call is summarized by. **Authored**, never derived. See [`Prose`].
    pub brief: String,
    /// What more there is to say, when there is more. See [`Prose`].
    pub detail: Option<String>,
    /// How it may be called: one entry per shape this language offers. Unchanged from
    /// [`V1`](SchemaVersion::V1) — the shape of a call was never the thing that needed normalizing.
    pub signatures: Vec<SignatureEntry>,
    /// The SDK types in the **return** position, resolved. See [`TypeReference`].
    ///
    /// It is its own field rather than something inferred from the signature text because inference
    /// is what gg does today and it is an inference by *elimination* — every type the signature
    /// names that is not named by a documented parameter — which is only as good as the arm's
    /// parameter list. A return position the reflector states is a return position gg does not have
    /// to guess, and guessing it wrong shows a model the wrong types beside a function it opened.
    #[serde(default)]
    pub returns: Vec<TypeReference>,
    /// Every SDK type this call's own shapes name, return position and arguments alike, resolved.
    #[serde(default)]
    pub types: Vec<TypeReference>,
}

/// What kind of declaration a [call](FunctionSignature) is, in the arm's own language.
///
/// This is **not** a gg concept being imposed on eleven languages; it is the one axis on which the
/// idiomatic shape of a call genuinely differs, and recording it is what lets the same capability be
/// a free function on one arm and a method on another without either arm having to pretend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntryKind {
    /// A standalone function: `gg::fs::read_file(path)`. The default, and the shape of most arms.
    #[default]
    Function,
    /// A member function on a value: `handle.send(text)`. Its [receiver](FunctionSignature::receiver)
    /// is the declared type it hangs off.
    Method,
    /// A function on a type rather than on a value: C#'s `Gg.Files.ReadFile`, Java's
    /// `Reference.search`. The shape a language with no standalone functions gives to what every
    /// other arm spells as one.
    StaticMethod,
    /// A constructor: `ReadOptions::new()`, `new Subagent(…)`. Catalogued because on the arms that
    /// have them, a value a model cannot construct is a capability it cannot reach.
    Initializer,
}

/// One reference from a signature to a **declared SDK type**, carrying the resolved name it names.
///
/// # Why a reference is not just a string
///
/// Because the arms disagree about how much they know. A compiler-backed reflector (rustdoc, clang's
/// AST, Roslyn, the Swift symbol graph) hands back a name that is already resolved — it read it out
/// of a type system. A doc-comment-backed one (YARD, JSDoc, griffe) hands back **the spelling as it
/// was written**, which is what the model reads at the call site and is not necessarily a key
/// anything can be looked up by. The two forms here are exactly those two situations: an arm that
/// only has the written spelling says so, and an arm that resolved it has somewhere to put the
/// resolution *without losing the spelling the model will actually see*.
///
/// Both forms answer [`fqn`](Self::fqn) — the key a documentation view is opened by — and
/// [`spelled`](Self::spelled) — what the signature writes. On the [`Bare`](Self::Bare) form they are
/// the same string, which is a truthful record of an arm that has not resolved anything rather than
/// a claim that it has.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum TypeReference {
    /// One string standing for both the written spelling and the key it resolves to:
    /// `"gg::fs::FileRead"`, or — on a [`V1`](SchemaVersion::V1) catalogue — the bare `"FileRead"`
    /// an arm wrote without resolving.
    Bare(String),
    /// A written spelling and the resolved name it refers to, recorded separately because they
    /// differ: `{ "spelled": "FileRead", "fqn": "gg.fs.FileRead" }`.
    Resolved {
        /// The spelling the signature writes, and what the model reads.
        spelled: String,
        /// The fully-qualified name it resolves to, and what a documentation view is opened by.
        fqn: String,
    },
}

impl TypeReference {
    /// The **resolved** name — the key a documentation view is opened by, and what a catalogue's own
    /// [type declarations](TypeDeclaration) are matched against.
    pub fn fqn(&self) -> &str {
        match self {
            Self::Bare(name) => name,
            Self::Resolved { fqn, .. } => fqn,
        }
    }

    /// The name **as the signature writes it** — what a model reads at the call site.
    pub fn spelled(&self) -> &str {
        match self {
            Self::Bare(name) => name,
            Self::Resolved { spelled, .. } => spelled,
        }
    }
}

/// One **member function** of a [type](TypeDeclaration): a line of it, and the key its own
/// documentation view is opened by.
///
/// A type view carries these rather than the member functions' full documentation, and that is what
/// makes opening a function's return type useful rather than merely long: the model lands on a menu
/// of everything it can do with the value it is about to hold, and each entry on the menu is one
/// call away from being read in full.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(
    dead_code,
    reason = "the normalized doc model is read by the gates that hold each arm to it — the \
              register gate and the fully-qualified-name rule — and by the readers that consume it \
              as each stage of the documentation surface lands. A field whose reader belongs to a \
              stage that has not landed yet is unread, and is carried here so that the stage which \
              needs it finds it already reflected by all eleven arms."
)]
pub struct MemberFunction {
    /// The gg [operation](super::operations::OperationId) the member binds, rendered
    /// `namespace.key`.
    pub operation: String,
    /// The name a program calls it by.
    pub name: String,
    /// The member's own fully-qualified name — what opens its documentation view.
    pub fqn: String,
    /// The one line it is listed by. See [`Prose`].
    pub brief: String,
}

/// One group of [libraries](SignatureCatalogue::libraries), as the prompt lists them.
///
/// Grouped rather than flat because ninety names in one paragraph is a wall a model skims. The
/// grouping is the *artifact's* — the headings the file that decides the set files them under — so
/// it is one more thing gg quotes rather than authors.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryGroup {
    /// What this group is for, in the words the source that groups them uses (`Time`,
    /// `Curated third-party libraries`).
    pub group: String,
    /// The names a program imports, exactly as it must write them: `urllib.parse` rather than
    /// `urllib`, because a dotted module is importable and its siblings may not be.
    pub modules: Vec<String>,
}

/// One bound tool, as the guest exports it and the prompt describes it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolSignature {
    /// The gg tool name (`read_file`), which is what the run's enabled set is expressed in.
    ///
    /// It is also this entry's language-independent identity, which is why a tool — alone among the
    /// catalogue's function-carrying sections — carries no separate `key`: every language's guest
    /// catalogues the same [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES), under its own spellings.
    pub tool: String,
    /// The name a program calls it by, in this catalogue's language (`readFile`).
    pub name: String,
    /// The API object this function is grouped under in a program's scope (`fs`) — what a search
    /// reports a hit under and what `view.openDocsView` routes by.
    pub object: String,
    /// How this function may be called, one entry per shape its language offers. See
    /// [`SignatureEntry`].
    pub signatures: Vec<SignatureEntry>,
    /// The SDK's own one-paragraph documentation for the function.
    pub doc: String,
    /// The type names this signature references, so the prompt can declare only the types the
    /// run's tools actually use.
    pub types: Vec<TypeReference>,
}

/// One session-ending function as the guest exports it and the prompt describes it.
///
/// It has the same shape as a [`ToolSignature`] minus the one field that would be a lie — there is no
/// gg tool name for it, because nothing dispatches it — plus the [role](Self::ending) whose programs
/// it is bound for. That absence is the whole distinction, and giving these their own type rather
/// than an `Option<String>` on the tool entry is what stops them from being folded into a list they
/// do not belong in.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSignature {
    /// This ending's language-independent identity (`request_changes`).
    pub key: String,
    /// The name a program calls it by, in this catalogue's language (`requestChanges`).
    pub name: String,
    /// The API object this function is grouped under (`harness`, `review`, `judge`).
    pub object: String,
    /// The [role](crate::ending::EndingRole) whose programs bind it: `standard`, `review`, `judge`.
    pub ending: String,
    /// How this function may be called, one entry per shape its language offers — for TypeScript
    /// `finish(summary: string): void`, whose `void` is load-bearing prompt text: it tells a model
    /// at a glance that the call returns like any other, so what follows it still runs. See
    /// [`SignatureEntry`].
    pub signatures: Vec<SignatureEntry>,
    /// The SDK's own documentation for it, which is what the system prompt renders.
    pub doc: String,
    /// The type names this signature references, folded into the prompt's declarations exactly as a
    /// tool's are. Empty today — it takes a string and hands nothing back — and read rather than
    /// assumed so a future argument type cannot be shown to a model undeclared.
    pub types: Vec<TypeReference>,
}

/// One view function as the guest exports it and the prompt describes it.
///
/// It is shaped like a [`HelperSignature`] with the gate made **optional**, and that one difference
/// is the whole point of the type: `openFile` is a read and is bound exactly when `read_file` is,
/// while `openText`, `close` and `current` are bound whatever a run enables — the same carve-out the
/// documentation lookup has, because a run that offers no tools at all must still be able to show its
/// model something. Modelling that as `Option<String>` on a *helper* would have made the gate look
/// optional for helpers too, which it never is.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewSignature {
    /// This view function's language-independent identity (`open_text`).
    pub key: String,
    /// The gg tool whose being enabled binds this function, or `None` when nothing gates it.
    pub requires: Option<String>,
    /// The name a program calls it by, in this catalogue's language (`openText`).
    pub name: String,
    /// The API object it is grouped under — `view`, for all four.
    pub object: String,
    /// How this function may be called, one entry per shape its language offers. See
    /// [`SignatureEntry`].
    pub signatures: Vec<SignatureEntry>,
    /// The SDK's own documentation for it, which is what a doc lookup renders.
    pub doc: String,
    /// The type names this signature references, folded into the prompt's declarations exactly as a
    /// tool's are.
    pub types: Vec<TypeReference>,
}

/// One program-library function as the guest exports it and a doc lookup describes it.
///
/// It is a [`ViewSignature`] with the gate removed rather than made optional, and that is the whole
/// point of the separate type: no tool gates a program-library function, and modelling the gate as
/// an always-`None` `Option` would invite a reader to look for the case where it is `Some`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramSignature {
    /// This function's language-independent identity (`get`).
    pub key: String,
    /// The name a program calls it by, in this catalogue's language (`get`).
    pub name: String,
    /// The API object it is grouped under — `programs`, for all three.
    pub object: String,
    /// How this function may be called, one entry per shape its language offers. See
    /// [`SignatureEntry`].
    pub signatures: Vec<SignatureEntry>,
    /// The SDK's own documentation for it, which is what a doc lookup renders.
    pub doc: String,
    /// The type names this signature references, folded into the prompt's declarations exactly as a
    /// tool's are.
    pub types: Vec<TypeReference>,
}

/// One helper function, which is bound only when the tool it wraps is enabled.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelperSignature {
    /// This helper's language-independent identity (`read_text_file`).
    pub key: String,
    /// The gg tool this helper wraps. When that tool is withheld, so is the helper.
    pub requires: String,
    /// The name a program calls it by, in this catalogue's language (`readTextFile`).
    pub name: String,
    /// The API object this helper is grouped under — the same object as the tool it wraps (`fs`).
    pub object: String,
    /// How this function may be called, one entry per shape its language offers. See
    /// [`SignatureEntry`].
    pub signatures: Vec<SignatureEntry>,
    /// The SDK's own documentation.
    pub doc: String,
    /// The type names this signature references.
    pub types: Vec<TypeReference>,
}

/// One type declaration a signature refers to.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeDeclaration {
    /// The type's name, as it appears in a signature.
    pub name: String,
    /// The declaration, as the SDK wrote it.
    pub declaration: String,
    /// The SDK's own documentation for the type: what it is, and why it has the shape it has.
    ///
    /// A declaration says what fields a record has and nothing about what any of them *means*, which
    /// for a model is the half that decides whether it uses the value correctly.
    ///
    /// **[`V1`](SchemaVersion::V1)'s one paragraph.** A [`V2`](SchemaVersion::V2) declaration
    /// authors [`brief`](Self::brief) and [`detail`](Self::detail) instead and omits this key; read
    /// either through [`prose`](Self::prose) rather than by reaching for a field.
    #[serde(default)]
    pub doc: String,
    /// The type's module-qualified fully-qualified name (`gg::fs::FileRead`) — what a documentation
    /// view of it is opened by, and what a resolved [type reference](TypeReference) names.
    ///
    /// `None` on a [`V1`](SchemaVersion::V1) catalogue, whose types are keyed by bare
    /// [`name`](Self::name) alone.
    pub fqn: Option<String>,
    /// The [module](ModuleDoc::id) the type belongs to. `None` on a [`V1`](SchemaVersion::V1)
    /// catalogue, where every type belongs to whichever functions happened to mention it.
    #[allow(
        dead_code,
        reason = "read only by the gates that hold an arm to its own shape (`signatures.fqn.rs`, \
                  `language/register.rs`, `language/agreement.rs`), which are `#[cfg(test)]`, so it \
                  is genuinely unread in a build. It is carried on the projection all the same, so \
                  that a reader moving onto it does not first have to change the projection."
    )]
    pub module: Option<String>,
    /// The single line the type is summarized by, authored. `None` on a
    /// [`V1`](SchemaVersion::V1) catalogue. See [`Prose`].
    pub brief: Option<String>,
    /// What more there is to say about the type, when there is more. See [`Prose`].
    pub detail: Option<String>,
    /// One entry per member, each with the documentation written on it.
    ///
    /// Three shapes reach a model through this one field, because all three are things a model has
    /// to read a value of: a record's **properties**; the **arms** of a union of literals, each named
    /// by the literal itself and carrying no type of its own because the arm *is* the value; and the
    /// properties of every arm of a union of records, in order, so a discriminant appears once per
    /// arm against the literal it is fixed to.
    #[serde(default)]
    pub members: Vec<TypeMember>,
    /// The **member functions** a value of this type offers, one line each.
    ///
    /// Empty on the arms where a value carries no behaviour — which is most of them, deliberately —
    /// and empty on every [`V1`](SchemaVersion::V1) catalogue, whose schema has nowhere to put one.
    /// See [`MemberFunction`] for why a type view lists them rather than documenting them.
    #[serde(default)]
    #[allow(
        dead_code,
        reason = "read only by the gates that hold an arm to its own shape (`signatures.fqn.rs`, \
                  `language/register.rs`, `language/agreement.rs`), which are `#[cfg(test)]`, so it \
                  is genuinely unread in a build. It is carried on the projection all the same, so \
                  that a reader moving onto it does not first have to change the projection."
    )]
    pub member_functions: Vec<MemberFunction>,
}

impl TypeDeclaration {
    /// This type's [brief and detail](Prose), whichever schema the catalogue is written in.
    pub fn prose(&self) -> Prose<'_> {
        Prose::of(self.brief.as_deref(), self.detail.as_deref(), &self.doc)
    }

    /// **The string this declaration is looked up and opened by**: its
    /// [fully-qualified name](Self::fqn) where the catalogue emits one, and its bare
    /// [`name`](Self::name) where it does not.
    ///
    /// One accessor rather than two branches at each of the three places that key on a type,
    /// because a type that is *indexed* under one string and *opened* under another is a type a
    /// search can find and a model cannot read — and that mismatch would appear only on the first
    /// converted arm, which is exactly when nobody is looking for it.
    pub fn key(&self) -> &str {
        self.fqn.as_deref().unwrap_or(&self.name)
    }
}

/// One member of a [type declaration](TypeDeclaration).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeMember {
    /// The member's name as a program reads it (`totalLines`), or the literal itself (`"pending"`)
    /// for the arm of a union.
    pub name: String,
    /// The member's type, as this language's SDK declares it; `None` for a union arm, which is a
    /// value rather than a field and so has no type beside itself.
    pub r#type: Option<String>,
    /// The SDK's own documentation for the member.
    ///
    /// **[`V1`](SchemaVersion::V1)'s.** A [`V2`](SchemaVersion::V2) member authors
    /// [`brief`](Self::brief); read either through [`prose`](Self::prose).
    #[serde(default)]
    pub doc: String,
    /// Which of the three shapes this member is. `None` on a [`V1`](SchemaVersion::V1) catalogue,
    /// where it is [derived](Self::kind) from whether the member has a type of its own.
    pub kind: Option<MemberKind>,
    /// The single line the member is documented by, authored. `None` on a
    /// [`V1`](SchemaVersion::V1) catalogue. See [`Prose`].
    pub brief: Option<String>,
    /// What more there is to say about the member, when there is more. See [`Prose`].
    pub detail: Option<String>,
}

impl TypeMember {
    /// This member's [brief and detail](Prose), whichever schema the catalogue is written in.
    pub fn prose(&self) -> Prose<'_> {
        Prose::of(self.brief.as_deref(), self.detail.as_deref(), &self.doc)
    }

    /// Which shape this member is, **stated** where the catalogue states it and **derived** where it
    /// does not.
    ///
    /// The derivation is the same one every renderer already makes by hand: a member with a type of
    /// its own is a field, and one without is a union arm, because the arm *is* the value. Stating
    /// it is strictly better — a language with a member that has neither shape has somewhere to say
    /// so — and deriving it is what keeps a v1 catalogue readable through the same accessor.
    #[allow(
        dead_code,
        reason = "the normalized reading of a member's shape, unread while every registered arm is \
                  still v1 — the type views that render it arrive with the first converted arm"
    )]
    pub fn kind(&self) -> MemberKind {
        self.kind.unwrap_or(match self.r#type {
            Some(_) => MemberKind::Field,
            None => MemberKind::Variant,
        })
    }
}

/// Which shape one [member](TypeMember) of a type is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MemberKind {
    /// A property of a record, carrying a type of its own.
    Field,
    /// One arm of a union — a value in its own right, with no type beside it.
    Variant,
}

/// One **API object**'s description: the sentence a model is introduced to it by.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDoc {
    /// The object name a program calls through (`fs`).
    pub object: String,
    /// What it is for, in the one line the system prompt's API list renders.
    pub doc: String,
}

/// **One way a function may be called** — the unit that lets two languages offer the same function
/// in the shape each of them writes it in.
///
/// A catalogue entry carries an array of these rather than a single signature, and that is the whole
/// mechanism by which per-language idiom is expressed without per-language *identity*. An optional
/// argument is a Java **overload pair**, a Kotlin **default**, a Python **keyword argument** and a
/// TypeScript `?` — four shapes of one capability. Java's arrives as one entry with two signatures,
/// each with its own [`parameters`](Self::parameters); the other three arrive as one entry with one.
/// Nothing downstream compares the count, because the count is spelling.
///
/// What is *not* free to differ is the identity around it: the gg
/// [operation](super::operations) the entry binds, and therefore what gates it. See the capability
/// gate (`language/agreement.rs`) for the line between the two.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureEntry {
    /// The signature as this language's SDK declares it, beginning with the name a program calls.
    pub signature: String,
    /// Every argument this shape takes, in the order it takes them.
    pub parameters: Vec<Parameter>,
}

/// One argument a [signature](SignatureEntry) takes, or one field of a structured argument.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Parameter {
    /// The name the signature declares it under.
    pub name: String,
    /// Its type, as this language's SDK writes it.
    pub r#type: String,
    /// Whether the call is legal without it.
    pub optional: bool,
    /// How it is passed. See [`ParameterKind`].
    pub kind: ParameterKind,
    /// The value it takes when it is left out, for a language that says so in the signature; `None`
    /// where the language has no such notion or the argument is required.
    pub default: Option<String>,
    /// The SDK's own documentation for it — what to put here, and what happens if you do not.
    pub doc: String,
    /// The fields of a **structured** argument written inline at the call site, each documented in
    /// its own right.
    ///
    /// Empty for an argument typed by *name*: that type is catalogued in [`SignatureCatalogue::types`]
    /// and its [members](TypeMember) carry its documentation, so filling both would be two copies of
    /// one sentence with nothing keeping them equal.
    pub fields: Vec<Parameter>,
}

/// How an argument is passed — the one axis of calling convention that changes what a model must
/// *write*.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ParameterKind {
    /// Passed by position, as TypeScript, Java, Rust and Swift pass every argument.
    Positional,
    /// Passed by name — Python's keyword arguments, Kotlin's named ones — so the call site writes
    /// the parameter's name as well as its value.
    ///
    /// [Python](super::language()) is the registered language that emits it: every optional argument
    /// on that arm is a keyword argument with a real default, which is what the language's own
    /// readers and writers expect and is exactly the half of a call the seam leaves each language
    /// free to spell for itself.
    Keyword,
    /// Passed as a **block** — Ruby's `fs.write_file(path) { … }` — which is not an argument
    /// position at all but a second channel into the call, and is written at the call site as a
    /// body rather than as a value.
    ///
    /// [Ruby](super::language()) is the registered language that emits it, as the second signature of
    /// an overload group: `write_file(path, contents)` and `write_file(path, &contents)` are one
    /// capability written two ways. Its `type` is the block's *return* (`->
    /// String`), because what a block is for is the value it hands back.
    ///
    /// It has its own variant rather than being folded into [`Positional`](Self::Positional)
    /// because anything reading the structured parameters — the reference page's argument rows, a
    /// future gate comparing calling conventions across arms — would otherwise describe a block as
    /// an ordinary positional `String` and be wrong about how a model must write the call. The
    /// rendered signature carried the `&` all along; only the structured half did not.
    Block,
}

impl SignatureCatalogue {
    /// Parse one language's committed catalogue.
    ///
    /// Each language caches its own result behind its own `OnceLock` and panics on failure: the file
    /// is generated, committed, and asserted parseable by that language's own gate, so a parse
    /// failure is a corrupt committed artifact rather than a runtime condition — and degrading a
    /// prompt into silence over one would describe a sandbox nobody has.
    pub(crate) fn parse(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// The gg tool names the sandbox binds into a program's scope: **all** of [`ALL_TOOL_NAMES`].
/// Responses-as-code is the richer interface, and there is no class of gg tool a program is denied.
///
/// Derived rather than listed, so a tool added to gg is bound (or its absence from the guest is a
/// test failure) without anyone remembering to edit a second list.
///
/// `#[cfg(test)]` because a run never needs the whole vocabulary — it binds *its own* enabled set,
/// which the loop derives from the registry. The set-equality drift gates
/// (`the_component_binds_exactly_the_tools_gg_offers`, `every_bound_tool_has_a_host_function`) are
/// its only callers.
#[cfg(test)]
pub(crate) fn sandbox_tool_names() -> Vec<&'static str> {
    ALL_TOOL_NAMES.to_vec()
}

/// One documented function as the [docs carve-out](crate::docs) sees it: the object it lives on, the
/// name a program calls it by, the gg tool whose being enabled gates it, and everything a doc lookup
/// renders.
///
/// It is the catalogue projected for a purpose the prompt does not serve: the model asks for one
/// function's documentation on demand (`view.openDocsView(fs.readFile)`), rather than being shown every
/// signature up front. The prose is the SDK's own JSDoc, reflected here exactly as the prompt's was.
pub struct CatalogueFunction {
    /// What it is **grouped under**: the API object on a [`V1`](SchemaVersion::V1) entry (`fs`), and
    /// the [module path](ModuleDoc::path) on a [`V2`](SchemaVersion::V2) one (`gg::fs`).
    ///
    /// One field for the two because every consumer of it wants the same thing — the heading this
    /// call is listed under, in the arm's own words — and the grouping a converted arm presents *is*
    /// its module. The cross-arm join is [`operation`](Self::operation) and never this, which is
    /// what makes it safe for the string to change shape underneath.
    pub object: &'static str,
    /// This function's language-independent identity: a gg tool's own name (`read_file`) when it has
    /// one, and the catalogue entry's `key` (`request_changes`, `open_text`) when it does not.
    ///
    /// It is how gg names a function in its **own** sentences, through [`spelling`] and the
    /// [`SurfaceCall`] constants, so a prompt quoting `review.requestChanges` is quoting the
    /// catalogue rather than a second copy of it. It is *not* the cross-arm join — that is
    /// [`operation`](Self::operation), which a converted entry states rather than being resolved to.
    pub key: &'static str,
    /// The name a program calls it by, in this language (`readFile`) — the **fallback** key
    /// `view.openDocsView` accepts, and the only one a [`V1`](SchemaVersion::V1) entry has. The key
    /// a converted arm advertises is [`fqn`](Self::fqn).
    pub name: &'static str,
    /// The gg tool whose being enabled gates this function; `None` for a carve-out the enabled set
    /// does not decide — an ending call, which the agent's [role](Self::ending) decides, or a view
    /// function that is bound unconditionally.
    pub gate: Option<&'static str>,
    /// For an ending call, the [role](crate::ending::EndingRole) whose programs bind it; `None` for
    /// a tool or helper, which every role's programs reach the same way.
    pub ending: Option<&'static str>,
    /// The gg **capability id** that buys this function, for the families neither
    /// [`gate`](Self::gate) nor [`ending`](Self::ending) can express — `None` for everything a tool
    /// or a role decides.
    ///
    /// It is [synthesized here](catalogue_functions) from the **section** the entry arrived in, and
    /// that is the point rather than an implementation detail: a capability id is a fact about gg's
    /// own configuration surface, and an arm that wrote one into its catalogue would be asserting
    /// something about gg that gg alone can be held to. So no reflector and no committed JSON ever
    /// learns one. The section an entry sits in is the most an arm has to get right, and the mapping
    /// from section to capability lives on this side of the seam, next to the
    /// [operations table](super::operations) that names the same ids.
    ///
    /// Today the [program library](crate::programs) is the only one: its whole family is bound or
    /// absent together, from a capability rather than from a tool or a role.
    pub capability: Option<&'static str>,
    /// The gg [operation](super::operations::OperationId) this entry binds, as its catalogue names
    /// it — `files.read_file`.
    ///
    /// `None` on a [`V1`](SchemaVersion::V1) entry, which names no operation and is resolved to one
    /// through the `(object, key)` pair instead. That fallback is the transitional half of
    /// [`operation_of`](super::operations::operation_of), and it goes when the last v1 catalogue
    /// does.
    pub operation: Option<&'static str>,
    /// Set when this entry is a **second** way to reach [`operation`](Self::operation) rather than
    /// the arm's canonical binding of it. See [`FunctionSignature::alias_of`].
    ///
    /// It is carried into the projection rather than left in the schema because two readers need it
    /// and neither reads the raw catalogue: coverage counts canonical bindings, and gg naming a call
    /// back at a model ([`spelling`]) should name the binding every arm has rather than the one this
    /// arm added. Always `None` on a [`V1`](SchemaVersion::V1) entry, whose schema cannot express an
    /// alias at all.
    pub alias_of: Option<&'static str>,
    /// What kind of declaration this is in the arm's own language. See [`EntryKind`].
    #[allow(
        dead_code,
        reason = "carried through the projection so a reader can move onto it without the \
                  projection changing under it, and unread here today: what it answers is asked of \
                  the raw catalogue instead, by the gates that hold an arm to its own shape"
    )]
    pub kind: EntryKind,
    /// The declared type a [member](EntryKind::Method) hangs off; `None` for everything else.
    #[allow(
        dead_code,
        reason = "read only by the gates that hold an arm to its own shape (`signatures.fqn.rs`, \
                  `language/register.rs`, `language/agreement.rs`), which are `#[cfg(test)]`, so it \
                  is genuinely unread in a build. It is carried on the projection all the same, so \
                  that a reader moving onto it does not first have to change the projection."
    )]
    pub receiver: Option<&'static str>,
    /// The [module](ModuleDoc::id) it is documented under; `None` on a [`V1`](SchemaVersion::V1)
    /// entry, which has an [object](Self::object) instead.
    #[allow(
        dead_code,
        reason = "carried through the projection so a reader can move onto it without the \
                  projection changing under it, and unread here today: what it answers is asked of \
                  the raw catalogue instead, by the gates that hold an arm to its own shape"
    )]
    pub module: Option<&'static str>,
    /// Its module-qualified fully-qualified name — **the key a documentation view is opened by**,
    /// and what search files a hit under. `None` on a [`V1`](SchemaVersion::V1) entry, which is
    /// keyed by bare [`name`](Self::name) alone; the bare name stays an accepted fallback on every
    /// arm, because it is what a model reads at a call site.
    pub fqn: Option<&'static str>,
    /// Its documentation: the authored brief, and the detail when there is one. See [`Prose`].
    pub prose: Prose<'static>,
    /// How it may be called: one [entry](SignatureEntry) per shape this language offers, each with
    /// its own parameters. Never empty.
    ///
    /// It is an array because the number of shapes is *spelling*: a language that expresses an
    /// optional argument as an overload pair carries two here where one expressing it as a default
    /// carries one, and neither is a difference in what the function does.
    pub signatures: &'static [SignatureEntry],
    /// The SDK types in the **return** position, resolved.
    ///
    /// Empty on a [`V1`](SchemaVersion::V1) entry — that schema records no return position at all,
    /// which is why [`types_to_open`](crate::docs::DocsRuntime::types_to_open) has to sort returns
    /// from arguments by elimination.
    pub returns: &'static [TypeReference],
    /// The types this function's signature reaches, **transitively closed** — every declaration a
    /// program holding this call's arguments and result can end up looking at, which is the question the
    /// documentation runtime asks of it before it will open a type at all.
    ///
    /// A [`V1`](SchemaVersion::V1) entry writes them as they were spelled and a
    /// [`V2`](SchemaVersion::V2) entry resolves them; the set is the same closure either way.
    /// Consumers that want a *depth* rather than a closure narrow it themselves and must go on doing
    /// so — [`types_to_open`](crate::docs::DocsRuntime::types_to_open) is the one that does.
    pub types: &'static [TypeReference],
}

/// **A brief and an optional detail** — the shape of every piece of documentation in the model, from
/// a module's header down to one member of one record.
///
/// # Why the split is authored and newline-based
///
/// A brief is a *single line* that says what the thing is; a detail is everything else. The split is
/// on the newline the author wrote, never on a sentence gg found, and that is a correctness
/// requirement rather than a style one. The derivation this replaces ended a sentence at a period
/// followed by a space or end-of-string — so a period followed by a **newline** was not a sentence
/// end, and the "brief" swallowed the whole following paragraph on the eight arms whose docs have
/// paragraph breaks. On the three whose docs are one flowing paragraph it did the opposite and cut
/// mid-code-span, leaving an unbalanced backtick in text a model reads.
///
/// Neither failure is a tuning problem. A brief is a thing an author decides, and a first line is
/// the only place the author can put it that no rule has to find.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Prose<'a> {
    /// The single line the thing is summarized by. Never `None`: an entry with no brief is a
    /// register failure (`language/register.rs`), not an absent field.
    pub brief: &'a str,
    /// Everything else there is to say, or `None` when there is nothing.
    pub detail: Option<&'a str>,
    /// The whole documentation exactly as a [`V1`](SchemaVersion::V1) catalogue carries it, kept so
    /// that [rendering](Self::rendered) one is byte-for-byte what it always was.
    ///
    /// **Transitional, and the reason it is private.** A [`V2`](SchemaVersion::V2) entry has no such
    /// string — its documentation *is* the brief and the detail — so this is `None` there, and the
    /// field disappears with the last v1 catalogue.
    whole: Option<&'a str>,
}

impl<'a> Prose<'a> {
    /// The prose an entry carries, whichever schema wrote it: the **authored** brief and detail when
    /// they are there, and the [transitional derivation](Self::from_paragraph) from `doc` when they
    /// are not.
    ///
    /// Dispatching on the presence of an authored brief rather than on the catalogue's declared
    /// [schema](SchemaVersion) is deliberate: it puts the decision beside the data instead of
    /// threading a version through every leaf of the model, and it fails in the right direction. A
    /// v2 entry that forgot its brief has an *empty* one — which the
    /// register gate (`language/register.rs`) refuses by name — rather than a plausible-looking
    /// line derived from a `doc` field the schema does not have.
    pub fn of(brief: Option<&'a str>, detail: Option<&'a str>, doc: &'a str) -> Self {
        match brief {
            Some(brief) => Self::authored(brief, detail),
            None => Self::from_paragraph(doc),
        }
    }

    /// The **authored** brief and detail of a [`V2`](SchemaVersion::V2) entry, which is the whole of
    /// its documentation: there is no paragraph behind them to fall back to, and a blank brief here
    /// stays blank so that the register gate (`language/register.rs`) can name it.
    pub fn authored(brief: &'a str, detail: Option<&'a str>) -> Self {
        Self {
            brief,
            detail: detail.filter(|detail| !detail.trim().is_empty()),
            whole: None,
        }
    }

    /// **TRANSITIONAL.** The brief and detail of a [`V1`](SchemaVersion::V1) paragraph, split at its
    /// first newline.
    ///
    /// It exists for exactly as long as one arm still commits a v1 catalogue, and it is not a
    /// fallback anything may rely on: the whole point of the v2 model is that a brief is written by
    /// the person who knows what the thing is, and no rule gg applies to a paragraph can recover
    /// one that was never authored. Where the paragraph has a break it does the honest thing; where
    /// it has none — the two ECMAScript arms and Python — the brief is the whole paragraph, which
    /// reads as *this arm has not authored a brief yet* rather than as a brief that was cut short.
    ///
    /// It is deliberately **not** what the register gate (`language/register.rs`) is run
    /// against: holding a derived line to a rule about authored lines would fail eleven arms for a
    /// property none of them has claimed yet.
    pub fn from_paragraph(doc: &'a str) -> Self {
        let (brief, detail) = match doc.find('\n') {
            Some(newline) => (
                doc[..newline].trim_end(),
                Some(doc[newline..].trim()).filter(|detail| !detail.is_empty()),
            ),
            None => (doc, None),
        };
        Self {
            brief,
            detail,
            whole: Some(doc),
        }
    }

    /// The whole documentation as one block — what a documentation view renders under the signature.
    ///
    /// Borrowed for a [`V1`](SchemaVersion::V1) entry, whose paragraph is kept verbatim so that
    /// nothing a model already reads changes byte for byte, and assembled for a
    /// [`V2`](SchemaVersion::V2) one, whose brief and detail are two authored fields with a blank
    /// line between them.
    pub fn rendered(&self) -> Cow<'a, str> {
        match (self.whole, self.detail) {
            (Some(whole), _) => Cow::Borrowed(whole),
            (None, None) => Cow::Borrowed(self.brief),
            (None, Some(detail)) => Cow::Owned(format!("{}\n\n{detail}", self.brief)),
        }
    }
}

/// Every function `language`'s committed catalogue documents — the ending calls, the view calls, the
/// program-library calls, the tools, and the one helper — each projected as a
/// [`CatalogueFunction`].
///
/// It takes a language because the *spellings* are one language's: two registered languages offer
/// the same functions on the same objects under the same gates, and differ in what a program calls
/// them. The docs runtime filters these by the run's enabled set, the agent's role and whether it
/// keeps a program library. **This is the whole model-facing surface** — every reader that reports
/// what an agent binds reports exactly these, with nothing appended, since nothing model-facing sits
/// outside the catalogue any more.
///
/// # It is the one place either [schema](SchemaVersion) is read
///
/// A [`V1`](SchemaVersion::V1) catalogue's five sections and a [`V2`](SchemaVersion::V2) catalogue's
/// one array arrive here as the same [`CatalogueFunction`], so **no consumer downstream has to know
/// which schema an arm committed** — which is the whole of what makes converting one arm per commit
/// possible. Where the two schemas genuinely disagree, the projection says so in the field rather
/// than papering over it: a v1 entry carries no [operation](CatalogueFunction::operation), no
/// [fqn](CatalogueFunction::fqn) and no [return position](CatalogueFunction::returns), and a v2
/// entry carries no gate of its own, because gg states its gate.
pub fn catalogue_functions(language: &dyn ProgramLanguage) -> Vec<CatalogueFunction> {
    functions_of(language.catalogue())
}

/// [`catalogue_functions`], reached by the catalogue rather than by the arm that owns it.
///
/// The split exists so that the two schemas can be tested **against each other**: a fixture
/// catalogue has no arm behind it, and giving one an arm — a component, a checker, a healing dialect
/// — to ask it one question about its own JSON would be a great deal of apparatus for a question
/// that is about the JSON.
pub(crate) fn functions_of(catalogue: &'static SignatureCatalogue) -> Vec<CatalogueFunction> {
    match catalogue.schema {
        SchemaVersion::V1 => catalogue_functions_v1(catalogue),
        SchemaVersion::V2 => catalogue_functions_v2(catalogue),
    }
}

/// The [`V2`](SchemaVersion::V2) half of [`catalogue_functions`]: one flat array, and every gate
/// read off gg's own [operations table](super::operations) rather than out of the artifact.
///
/// An entry naming an operation gg does not have is projected with **no** gate, which is the
/// conservative reading and the one that fails safe: [`bound`](crate::docs::DocsRuntime::bound)
/// answers `false` for an unresolvable operation, so an arm that invents an operation documents
/// nothing rather than documenting something ungated. Failing it *by name* is a different job —
/// an arm's claim about gg's own vocabulary belongs to the coverage half of the
/// agreement gate (`language/agreement.rs`) — and this is deliberately the quiet, safe half of
/// that pair rather than a second opinion about it.
fn catalogue_functions_v2(catalogue: &'static SignatureCatalogue) -> Vec<CatalogueFunction> {
    catalogue
        .functions
        .iter()
        .map(|function| {
            let operation = operation_by_id(&function.operation);
            // gg's own binding, decomposed into the three fields the projection has always carried.
            // The arm does not get a vote: it named an operation, and what buys that operation is
            // stated once, on gg's side, in `OPERATIONS`.
            let (gate, ending, capability) = match operation.map(|operation| operation.binding) {
                Some(Binding::Tool(tool)) => (Some(tool), None, None),
                Some(Binding::Ending(role)) => (None, Some(role.id()), None),
                Some(Binding::Capability(id)) => (None, None, Some(id)),
                Some(Binding::Always) | None => (None, None, None),
            };
            CatalogueFunction {
                // The module *path* stands where an object used to, because that is what this
                // schema's model-facing grouping is: it is what a directory of one module lists
                // under, what the console groups by, and what a model reads. The cross-arm join is
                // the operation id beside it, never this.
                object: module_path(catalogue, &function.module),
                key: operation.map_or(function.name.as_str(), |operation| operation.id.key),
                name: function.name.as_str(),
                gate,
                ending,
                capability,
                operation: Some(function.operation.as_str()),
                alias_of: function.alias_of.as_deref(),
                kind: function.kind,
                receiver: function.receiver.as_deref(),
                module: Some(function.module.as_str()),
                fqn: Some(function.fqn.as_str()),
                prose: Prose::authored(function.brief.as_str(), function.detail.as_deref()),
                signatures: function.signatures.as_slice(),
                returns: function.returns.as_slice(),
                types: function.types.as_slice(),
            }
        })
        .collect()
}

/// This language's own spelling of the module `id`, or the id itself where the catalogue declares no
/// such module.
///
/// The fallback is deliberately the id rather than a panic or an empty string: a module an entry
/// names and the `modules` section forgot is a real defect, but it is one
/// the name rule (`signatures.fqn.rs`) reports by name, and degrading a *grouping label* mid-run is a
/// worse answer than showing gg's own word for the module until that gate is read.
fn module_path(catalogue: &'static SignatureCatalogue, id: &'static str) -> &'static str {
    catalogue
        .modules
        .iter()
        .find(|module| module.id == id)
        .map_or(id, |module| module.path.as_str())
}

/// The [`V1`](SchemaVersion::V1) half of [`catalogue_functions`]: the five sections, each with the
/// gate its own section decides, exactly as they have always been read.
fn catalogue_functions_v1(catalogue: &'static SignatureCatalogue) -> Vec<CatalogueFunction> {
    let mut functions = Vec::with_capacity(
        catalogue.session.len()
            + catalogue.views.len()
            + catalogue.programs.len()
            + catalogue.tools.len()
            + catalogue.helpers.len(),
    );
    for session in &catalogue.session {
        functions.push(CatalogueFunction {
            object: session.object.as_str(),
            key: session.key.as_str(),
            name: session.name.as_str(),
            gate: None,
            ending: Some(session.ending.as_str()),
            capability: None,
            operation: None,
            alias_of: None,
            kind: EntryKind::Function,
            receiver: None,
            module: None,
            fqn: None,
            prose: Prose::from_paragraph(session.doc.as_str()),
            signatures: session.signatures.as_slice(),
            returns: &[],
            types: session.types.as_slice(),
        });
    }
    // A view function's gate is the one thing that varies within its group: `openFile` is a read and
    // carries `read_file`, the other three carry nothing and are therefore bound to every program,
    // which is what `(None, None)` means to the two consumers that read this projection.
    for view in &catalogue.views {
        functions.push(CatalogueFunction {
            object: view.object.as_str(),
            key: view.key.as_str(),
            name: view.name.as_str(),
            gate: view.requires.as_deref(),
            ending: None,
            capability: None,
            operation: None,
            alias_of: None,
            kind: EntryKind::Function,
            receiver: None,
            module: None,
            fqn: None,
            prose: Prose::from_paragraph(view.doc.as_str()),
            signatures: view.signatures.as_slice(),
            returns: &[],
            types: view.types.as_slice(),
        });
    }
    // The program library, whose binding neither gate can express: the object is bound or absent as
    // a whole, from a capability — and *which* capability is decided here, by the section the entry
    // arrived in, so that no arm has to know gg's id for it. See `CatalogueFunction::capability`.
    for program in &catalogue.programs {
        functions.push(CatalogueFunction {
            object: program.object.as_str(),
            key: program.key.as_str(),
            name: program.name.as_str(),
            gate: None,
            ending: None,
            capability: Some(CAPABILITY_PROGRAM_LIBRARY),
            operation: None,
            alias_of: None,
            kind: EntryKind::Function,
            receiver: None,
            module: None,
            fqn: None,
            prose: Prose::from_paragraph(program.doc.as_str()),
            signatures: program.signatures.as_slice(),
            returns: &[],
            types: program.types.as_slice(),
        });
    }
    for tool in &catalogue.tools {
        functions.push(CatalogueFunction {
            object: tool.object.as_str(),
            key: tool.tool.as_str(),
            name: tool.name.as_str(),
            gate: Some(tool.tool.as_str()),
            ending: None,
            capability: None,
            operation: None,
            alias_of: None,
            kind: EntryKind::Function,
            receiver: None,
            module: None,
            fqn: None,
            prose: Prose::from_paragraph(tool.doc.as_str()),
            signatures: tool.signatures.as_slice(),
            returns: &[],
            types: tool.types.as_slice(),
        });
    }
    for helper in &catalogue.helpers {
        functions.push(CatalogueFunction {
            object: helper.object.as_str(),
            key: helper.key.as_str(),
            name: helper.name.as_str(),
            gate: Some(helper.requires.as_str()),
            ending: None,
            capability: None,
            operation: None,
            alias_of: None,
            kind: EntryKind::Function,
            receiver: None,
            module: None,
            fqn: None,
            prose: Prose::from_paragraph(helper.doc.as_str()),
            signatures: helper.signatures.as_slice(),
            returns: &[],
            types: helper.types.as_slice(),
        });
    }
    functions
}

/// How `language`'s SDK writes the function `call` identifies: **the grouping it is reached
/// through, and the name it is called by**. `None` when its catalogue carries no such function.
///
/// # Why two strings, and why the grouping is the arm's rather than gg's
///
/// Because the two schemas disagree about what a qualified call site looks like, and the caller
/// ([`spell`](super::spell)) has to write one a program could compile. On a
/// [`V1`](SchemaVersion::V1) arm the grouping is the API object and the pair reads `view.openFile`,
/// exactly as it always has. On a [`V2`](SchemaVersion::V2) arm it is the
/// [module path](ModuleDoc::path) and the pair reads `Gg.Views.OpenFile` — which is a real,
/// compilable name on that arm, and which `view.OpenFile` would no longer be.
///
/// # Why the lookup goes through the operation
///
/// The pair a [`SurfaceCall`] names is gg's own identity, and on a converted arm neither half of it
/// appears in the catalogue: the grouping is the arm's module and the key belongs to the
/// [operation](super::operations). So the match is made on the **operation** each entry resolves to,
/// which is the one thing both schemas answer — and it is still identity rather than spelling, which
/// is the property that made the original lookup correct.
///
/// A [canonical binding](FunctionSignature::alias_of) is preferred over an alias, because gg naming
/// a call back at a model should name the one every arm has rather than the one this arm added.
pub(crate) fn spelling(
    language: &dyn ProgramLanguage,
    call: SurfaceCall,
) -> Option<(&'static str, &'static str)> {
    let matches = |function: &CatalogueFunction| {
        super::operations::operation_of(function).is_some_and(|operation| {
            operation.call.object == call.object && operation.call.key == call.key
        })
    };
    let functions = catalogue_functions(language);
    functions
        .iter()
        .find(|function| matches(function) && function.alias_of.is_none())
        .or_else(|| functions.iter().find(|function| matches(function)))
        .map(|function| (function.object, function.name))
}

/// One catalogued type, by name, as `language`'s SDK writes it — the declaration, the paragraph
/// explaining it, and a line per member. What a doc lookup appends for a referenced type the session
/// has not already been shown.
///
/// # The three names one type answers to, and why it needs all three
///
/// A converted arm writes **three different strings** for one type, and a model may reasonably type
/// any of them:
///
/// * the [key](TypeDeclaration::key) — `Gg.Files.FileRead`, `gg::files::FileRead` — which is what gg
///   itself emits and what a docview is filed under;
/// * the [spelling](TypeReference::spelled) a signature writes — `Files.FileRead`,
///   `files::FileRead` — which is module-qualified but relative, because that is what compiles at a
///   call site under the arm's prelude or `global using`;
/// * the bare [name](TypeDeclaration::name) — `FileRead`.
///
/// The middle one is the string the model has most often just read, since it is the one printed in
/// the signature of the function whose documentation it opened, and before this arm it resolved to
/// nothing at all. The spellings are taken from the catalogue's own
/// [resolved references](TypeReference::Resolved) rather than derived by trimming a prefix, so what
/// is accepted is exactly what some signature on this arm actually writes.
pub fn type_declaration(
    language: &dyn ProgramLanguage,
    key: &str,
) -> Option<&'static TypeDeclaration> {
    declaration_of(language.catalogue(), key)
}

/// [`type_declaration`], reached by the catalogue rather than by the arm that owns it, for the
/// reason [`functions_of`] is.
pub(crate) fn declaration_of(
    catalogue: &'static SignatureCatalogue,
    key: &str,
) -> Option<&'static TypeDeclaration> {
    let types = &catalogue.types;
    types
        .iter()
        .find(|declaration| declaration.key() == key)
        .or_else(|| {
            // The spelling a signature writes. It is neither the key nor the bare name on a
            // converted arm, and it is the one a model copies out of the signature it just read.
            let resolved = spellings_of(catalogue)
                .into_iter()
                .find(|reference| reference.spelled() == key)?;
            types
                .iter()
                .find(|declaration| declaration.key() == resolved.fqn())
        })
        // A bare name still resolves on a converted arm, and deliberately: a model that read
        // `FileRead` in a signature and asked for it by that name is asking for the type it just
        // read. The key is what everything gg emits uses, so this arm of the lookup is only ever
        // reached by a name a *model* typed.
        .or_else(|| types.iter().find(|declaration| declaration.name == key))
}

/// Every **type reference** `catalogue` writes anywhere a model can read it — one entry per
/// (spelling, resolution) pair some signature on this arm carries.
///
/// It walks every section rather than only [`functions`](SignatureCatalogue::functions), because the
/// spelling a model reads is the spelling of whichever schema its arm committed, and the lookup this
/// feeds is asked the same question on all eleven.
fn spellings_of(catalogue: &'static SignatureCatalogue) -> Vec<&'static TypeReference> {
    let mut out: Vec<&'static TypeReference> = Vec::new();
    for function in &catalogue.functions {
        out.extend(function.returns.iter().chain(&function.types));
    }
    out.extend(catalogue.tools.iter().flat_map(|entry| &entry.types));
    out.extend(catalogue.helpers.iter().flat_map(|entry| &entry.types));
    out.extend(catalogue.views.iter().flat_map(|entry| &entry.types));
    out.extend(catalogue.session.iter().flat_map(|entry| &entry.types));
    out.extend(catalogue.programs.iter().flat_map(|entry| &entry.types));
    out
}

/// Every **API object** `language`'s catalogue describes, in the order a program's surface is
/// presented in — the [`V1`](SchemaVersion::V1) half of what [`catalogue_modules`] normalizes, and
/// empty on a [`V2`](SchemaVersion::V2) arm, which has modules instead.
///
/// The order is the catalogue's, not a sort: it is the order the surface was authored in, so
/// re-ordering it here would change what a reader of an unconverted arm sees.
#[allow(
    dead_code,
    reason = "read only by the gates that hold an arm to the vocabulary it declares \
              (`lib.test.rs`, `prompts.spellings.test.rs`), which are `#[cfg(test)]`, so it is \
              genuinely unread in a build. Every reader that must answer for both schemas has \
              moved onto `catalogue_modules`; this stays for the ones whose subject is an API \
              object specifically, and goes with the last v1 arm."
)]
pub fn catalogue_objects(language: &dyn ProgramLanguage) -> &'static [ObjectDoc] {
    language.catalogue().objects.as_slice()
}

/// Every **module** `language`'s surface is divided into, in the order it is presented in — the
/// normalized reading of [`objects`](SignatureCatalogue::objects) and
/// [`modules`](SignatureCatalogue::modules) both.
///
/// A [`V1`](SchemaVersion::V1) catalogue's API objects are projected as modules whose id and path
/// are the object's own name, which is the truthful reading of an arm that has not been reshaped:
/// its grouping *is* the object, gg has no cross-arm id for it beyond the name, and nothing is
/// imported. The [operation](super::operations::OperationId::namespace) namespace is the real
/// cross-arm module vocabulary, and an arm earns entries in it by being converted rather than by
/// having gg guess on its behalf.
pub fn catalogue_modules(language: &dyn ProgramLanguage) -> Vec<ModuleView> {
    modules_of(language.catalogue())
}

/// [`catalogue_modules`], reached by the catalogue rather than by the arm that owns it, for the
/// reason [`functions_of`] is.
pub(crate) fn modules_of(catalogue: &'static SignatureCatalogue) -> Vec<ModuleView> {
    match catalogue.schema {
        SchemaVersion::V1 => catalogue
            .objects
            .iter()
            .map(|object| ModuleView {
                id: object.object.as_str(),
                path: object.object.as_str(),
                prose: Prose::from_paragraph(object.doc.as_str()),
                import: None,
            })
            .collect(),
        SchemaVersion::V2 => catalogue
            .modules
            .iter()
            .map(|module| ModuleView {
                id: module.id.as_str(),
                path: module.path.as_str(),
                prose: Prose::authored(module.brief.as_str(), module.detail.as_deref()),
                import: module.import.as_deref(),
            })
            .collect(),
    }
}

/// One module as every consumer reads it, whichever [schema](SchemaVersion) the arm committed — the
/// [module](ModuleDoc) half of what [`catalogue_functions`] is for the calls.
pub struct ModuleView {
    /// gg's cross-arm id for the module, or — on a [`V1`](SchemaVersion::V1) arm — the API object's
    /// own name, which is the most identity that arm has.
    ///
    /// The cross-arm join key: it is what the [surface event](test_cabinet_core::gg::GgAgentApi)
    /// and the [reference](crate::reference) group by, and the namespace half of every
    /// [operation](super::operations::OperationId) the module's calls are recorded under. The
    /// [path](Self::path) beside it is what a model reads, and the two are separate because one arm
    /// spelling `gg::files` and another `Gg.Files` must still be one module to a reader comparing
    /// them.
    pub id: &'static str,
    /// This language's own spelling of the module path, and what a model reads.
    pub path: &'static str,
    /// The line the module is introduced by, and what more there is to say. See [`Prose`].
    pub prose: Prose<'static>,
    /// The literal line a program writes to bring it into scope, where there is one.
    #[allow(
        dead_code,
        reason = "`None` on every registered arm, because each of the eleven puts its SDK in scope \
                  without a line a program writes. It is read by the prompt when an arm that needs \
                  one is converted — PureScript is the one that will."
    )]
    pub import: Option<&'static str>,
}

#[cfg(test)]
#[path = "signatures.test.rs"]
mod tests;

/// **The rule one fully-qualified name is held to**, across eleven languages that disagree about
/// how a name is spelled. A gate rather than a run-time need, like the agreement gate
/// (`language/agreement.rs`) it runs beside.
#[cfg(test)]
#[path = "signatures.fqn.rs"]
pub(crate) mod fqn;

/// The matched pair of catalogues — one surface, written once in each
/// [schema](SchemaVersion) — that every test of the model's two halves reads.
#[cfg(test)]
#[path = "signatures.fixture.rs"]
pub(crate) mod fixture;
