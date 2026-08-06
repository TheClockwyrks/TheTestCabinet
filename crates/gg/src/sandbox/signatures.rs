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
//! [agreement gate](super::language::agreement) refuses one at load, so the rule is enforced twice:
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
//! What does *not* live here is the data: each registered [language](super::language) owns its own
//! committed JSON and its own parsed copy, reached through
//! [`ProgramLanguage::catalogue`](super::ProgramLanguage::catalogue). A reader that wants "the
//! catalogue" therefore has to say whose, which is exactly the question a cross-language study makes
//! unavoidable.

use serde::Deserialize;
use test_cabinet_core::gg::GgProgramLanguage;

use super::language::{ProgramLanguage, SurfaceCall};

// The whole vocabulary backs [`sandbox_tool_names`], which is a drift gate rather than a
// run-time need — so, like it, the names it is built from are only reachable under test.
#[cfg(test)]
use crate::tools::ALL_TOOL_NAMES;

/// The whole catalogue: one entry per bound tool, one per helper, and the type declarations they
/// reference.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignatureCatalogue {
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
    pub objects: Vec<ObjectDoc>,
    /// The model-facing functions that hang off **no** API object, because they hang off all of
    /// them — today just `list`, the directory every object carries.
    ///
    /// Kept out of every other section because each of those carries an `object`, and any object a
    /// meta function named would be a claim about the eleven it is also on. See [`MetaSignature`].
    pub meta: Vec<MetaSignature>,
    /// The model-facing functions that are not gg tools: the calls that end a session, one group per
    /// [role](crate::ending::EndingRole).
    ///
    /// Kept out of [`tools`](Self::tools) because none of them has a gg tool name, which is what
    /// keeps that array in exact bijection with the gg tool vocabulary the committed component is
    /// checked against.
    pub session: Vec<SessionSignature>,
    /// The model-facing functions that put material into the agent's own context window — the `view`
    /// object.
    ///
    /// Kept out of [`tools`](Self::tools) on the same rule [`session`](Self::session) is: none of
    /// them has a gg tool name, so folding them in would break the bijection the committed component
    /// is checked against.
    pub views: Vec<ViewSignature>,
    /// The model-facing functions on the [program library](crate::programs) — the `programs`
    /// object.
    ///
    /// Kept out of [`tools`](Self::tools) on the same rule the two above are: none of them has a gg
    /// tool name. They carry no gate field at all, because the whole object is bound or absent
    /// together and what decides that is a *capability* rather than a tool — which is why
    /// [`CatalogueFunction::library`] exists as a flag of its own.
    pub programs: Vec<ProgramSignature>,
    /// One entry per gg tool the sandbox binds, in catalogue order.
    pub tools: Vec<ToolSignature>,
    /// The helper functions bound alongside a tool — convenience wrappers that are not gg tools in
    /// their own right and therefore have no name in [`ALL_TOOL_NAMES`].
    pub helpers: Vec<HelperSignature>,
    /// Every type declaration the signatures reference, in declaration order.
    pub types: Vec<TypeDeclaration>,
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

/// One **meta** function: a call bound onto every API object rather than declared on one.
///
/// `list` is the whole of it. The guest seeds it onto each object it creates, closing over that
/// object's name, so the function a program calls takes no arguments and belongs to no object — the
/// one entry in the surface whose identity is a bare key.
///
/// It is catalogued for the reason everything else is: its signature and its description are read by
/// a **model**, and the rule this whole module exists to keep is that nothing a model reads about
/// the SDK is written anywhere but on the declaration it describes. A meta function documented in a
/// `const` on gg's side would be the one description in the surface no gate could compare against
/// the code — and it was, until this section existed.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaSignature {
    /// This function's language-independent identity (`list`).
    pub key: String,
    /// The name a program calls it by, in this catalogue's language (`list`).
    pub name: String,
    /// How this function may be called, one entry per shape its language offers. See
    /// [`SignatureEntry`].
    pub signatures: Vec<SignatureEntry>,
    /// The SDK's own documentation for it, which is what a doc lookup renders and what every
    /// object's directory takes its one-line summary from.
    pub doc: String,
    /// The type names this signature references, folded into a doc lookup's declarations exactly as
    /// a tool's are.
    pub types: Vec<String>,
}

/// One bound tool, as the guest exports it and the prompt describes it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolSignature {
    /// The gg tool name (`read_file`), which is what the run's enabled set is expressed in.
    ///
    /// It is also this entry's language-independent identity, which is why a tool — alone among the
    /// catalogue's function-carrying sections — carries no separate `key`: every language's guest
    /// catalogues the same [`ALL_TOOL_NAMES`], under its own spellings.
    pub tool: String,
    /// The name a program calls it by, in this catalogue's language (`readFile`).
    pub name: String,
    /// The API object this function is grouped under in a program's scope (`fs`) — what
    /// `object.list()` enumerates and what `view.openDocsView` routes by.
    pub object: String,
    /// How this function may be called, one entry per shape its language offers. See
    /// [`SignatureEntry`].
    pub signatures: Vec<SignatureEntry>,
    /// The SDK's own one-paragraph documentation for the function.
    pub doc: String,
    /// The type names this signature references, so the prompt can declare only the types the
    /// run's tools actually use.
    pub types: Vec<String>,
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
    pub types: Vec<String>,
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
    pub types: Vec<String>,
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
    pub types: Vec<String>,
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
    pub types: Vec<String>,
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
    pub doc: String,
    /// One entry per member, each with the documentation written on it.
    ///
    /// Three shapes reach a model through this one field, because all three are things a model has
    /// to read a value of: a record's **properties**; the **arms** of a union of literals, each named
    /// by the literal itself and carrying no type of its own because the arm *is* the value; and the
    /// properties of every arm of a union of records, in order, so a discriminant appears once per
    /// arm against the literal it is fixed to.
    pub members: Vec<TypeMember>,
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
    pub doc: String,
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
/// What is *not* free to differ is the identity around it: the entry's key, its object, its gate.
/// See the [agreement gate](super::language::agreement) for the line between the two.
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
    /// [Python](super::language) is the registered language that emits it: every optional argument
    /// on that arm is a keyword argument with a real default, which is what the language's own
    /// readers and writers expect and is exactly the half of a call the seam leaves each language
    /// free to spell for itself.
    Keyword,
    /// Passed as a **block** — Ruby's `fs.write_file(path) { … }` — which is not an argument
    /// position at all but a second channel into the call, and is written at the call site as a
    /// body rather than as a value.
    ///
    /// [Ruby](super::language) is the registered language that emits it, as the second signature of
    /// an overload group: `write_file(path, contents)` and `write_file(path, &contents)` are one
    /// capability written two ways. Its [type](Parameter::r#type) is the block's *return* (`->
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
    /// The API object it is grouped under (`fs`).
    pub object: &'static str,
    /// This function's language-independent identity: a gg tool's own name (`read_file`) when it has
    /// one, and the catalogue entry's `key` (`request_changes`, `open_text`) when it does not.
    ///
    /// It is what two languages' catalogues are compared *by*, since the surface they offer is the
    /// same and only [`name`](Self::name) differs — and it is how gg names a function in its **own**
    /// sentences, through [`spelling`] and the [`SurfaceCall`] constants, so a prompt quoting
    /// `review.requestChanges` is quoting the catalogue rather than a second copy of it.
    pub key: &'static str,
    /// The name a program calls it by, in this language (`readFile`) — what `view.openDocsView` is
    /// keyed on.
    pub name: &'static str,
    /// The gg tool whose being enabled gates this function; `None` for a carve-out the enabled set
    /// does not decide — an ending call, which the agent's [role](Self::ending) decides, or a view
    /// function that is bound unconditionally.
    pub gate: Option<&'static str>,
    /// For an ending call, the [role](crate::ending::EndingRole) whose programs bind it; `None` for
    /// a tool or helper, which every role's programs reach the same way.
    pub ending: Option<&'static str>,
    /// Whether this function belongs to the [program library](crate::programs) — the one family a
    /// *capability* gates rather than a tool or a role, and therefore the one whose binding neither
    /// [`gate`](Self::gate) nor [`ending`](Self::ending) can express.
    pub library: bool,
    /// The one-line summary `object.list()` shows — the first sentence of the documentation.
    pub summary: &'static str,
    /// How it may be called: one [entry](SignatureEntry) per shape this language offers, each with
    /// its own parameters. Never empty.
    ///
    /// It is an array because the number of shapes is *spelling*: a language that expresses an
    /// optional argument as an overload pair carries two here where one expressing it as a default
    /// carries one, and neither is a difference in what the function does.
    pub signatures: &'static [SignatureEntry],
    /// The SDK's own paragraph of documentation.
    pub doc: &'static str,
    /// The type names this function's signature refers to, transitively closed.
    pub types: &'static [String],
}

/// The first sentence of a documentation paragraph — up to and including the first period that ends
/// one — for the one-line summary a directory lists. The whole text when it has no sentence break.
fn first_sentence(doc: &'static str) -> &'static str {
    let bytes = doc.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'.' && (i + 1 == bytes.len() || bytes[i + 1] == b' ') {
            return doc[..=i].trim_end();
        }
        i += 1;
    }
    doc
}

/// Every function `language`'s committed catalogue documents — the ending calls, the view calls, the
/// program-library calls, the tools, and the one helper — each projected as a
/// [`CatalogueFunction`].
///
/// It takes a language because the *spellings* are one language's: two registered languages offer
/// the same functions on the same objects under the same gates, and differ in what a program calls
/// them. The docs runtime filters these by the run's enabled set, the agent's role
/// and whether it keeps a program library, and adds the `list` meta function itself, since it is the
/// carve-out's own and has no catalogue entry. Every other reader of this catalogue that reports what
/// an object binds — the agent-surface telemetry — has to add it back for the same reason.
pub fn catalogue_functions(language: &dyn ProgramLanguage) -> Vec<CatalogueFunction> {
    let catalogue = language.catalogue();
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
            library: false,
            summary: first_sentence(&session.doc),
            signatures: session.signatures.as_slice(),
            doc: session.doc.as_str(),
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
            library: false,
            summary: first_sentence(&view.doc),
            signatures: view.signatures.as_slice(),
            doc: view.doc.as_str(),
            types: view.types.as_slice(),
        });
    }
    // The program library, whose binding neither gate can express: the object is bound or absent as
    // a whole, from the capability, so the flag carries it instead.
    for program in &catalogue.programs {
        functions.push(CatalogueFunction {
            object: program.object.as_str(),
            key: program.key.as_str(),
            name: program.name.as_str(),
            gate: None,
            ending: None,
            library: true,
            summary: first_sentence(&program.doc),
            signatures: program.signatures.as_slice(),
            doc: program.doc.as_str(),
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
            library: false,
            summary: first_sentence(&tool.doc),
            signatures: tool.signatures.as_slice(),
            doc: tool.doc.as_str(),
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
            library: false,
            summary: first_sentence(&helper.doc),
            signatures: helper.signatures.as_slice(),
            doc: helper.doc.as_str(),
            types: helper.types.as_slice(),
        });
    }
    functions
}

/// One **meta** function by its language-independent key, as `language`'s SDK spells and documents
/// it — the signature a lookup renders, the paragraph under it, and the one-line summary every
/// object's directory carries for it.
///
/// `None` for a key this language's catalogue does not carry. The
/// [agreement gate](super::language::agreement) asserts that every registered language's meta
/// section is exactly gg's own meta vocabulary — [`list`](crate::docs::LIST_FUNCTION) and nothing
/// else — so a miss is a corrupt committed artifact rather than a runtime condition, and the callers
/// degrade rather than panic, because one word missing from a directory is a smaller failure than a
/// run that stops.
pub fn meta_function(language: &dyn ProgramLanguage, key: &str) -> Option<&'static MetaSignature> {
    language
        .catalogue()
        .meta
        .iter()
        .find(|entry| entry.key == key)
}

/// The first sentence of a documentation paragraph, for the one-line summary a directory lists.
///
/// Public because a [meta function](meta_function)'s summary is taken the same way a
/// [catalogue function](CatalogueFunction::summary)'s is, and taking it two ways would be two answers
/// to one question.
pub fn summary_of(doc: &'static str) -> &'static str {
    first_sentence(doc)
}

/// The name `language`'s SDK gives the function `call` identifies, or `None` when its catalogue
/// carries no such function.
///
/// The lookup is by [`key`](CatalogueFunction::key) and object — identity — never by name, because
/// the name is exactly the thing that differs between two languages and is therefore the one thing
/// gg may not assume. [`spell`](super::spell) is the caller; nothing else should need this, since
/// every other consumer of the catalogue is rendering *its whole* surface rather than picking one
/// function out of it.
pub(crate) fn spelling(language: &dyn ProgramLanguage, call: SurfaceCall) -> Option<&'static str> {
    catalogue_functions(language)
        .into_iter()
        .find(|function| function.object == call.object && function.key == call.key)
        .map(|function| function.name)
}

/// One catalogued type, by name, as `language`'s SDK writes it — the declaration, the paragraph
/// explaining it, and a line per member. What a doc lookup appends for a referenced type the session
/// has not already been shown.
pub fn type_declaration(
    language: &dyn ProgramLanguage,
    name: &str,
) -> Option<&'static TypeDeclaration> {
    language
        .catalogue()
        .types
        .iter()
        .find(|declaration| declaration.name == name)
}

/// Every **API object** `language`'s catalogue describes, in the order a program's surface is
/// presented in.
///
/// The order is the catalogue's, not a sort: it is what the system prompt's API list and the run's
/// [agent surface](test_cabinet_core::gg::GgTelemetryKind::AgentSurface) both render, so re-ordering
/// it here would change what a model reads.
pub fn catalogue_objects(language: &dyn ProgramLanguage) -> &'static [ObjectDoc] {
    language.catalogue().objects.as_slice()
}

#[cfg(test)]
#[path = "signatures.test.rs"]
mod tests;
