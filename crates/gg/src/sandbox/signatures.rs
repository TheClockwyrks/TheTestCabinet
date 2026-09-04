//! The signature catalogue: what the model is *told* it may call, reflected out of what the guest
//! actually exports.
//!
//! When a model asks for a function's documentation — `view.openDocsView(fs.readFile)`, serviced by the
//! [docs carve-out](crate::docs) — gg answers in the run's own program language with every shape the
//! function may be called in, a line saying what to put in each argument, a sentence of
//! documentation, and the types the signature references with a line per member.
//! Hand-writing that would guarantee it drifts — a renamed parameter, an options object that became
//! positional, a tool whose behaviour changed — and documentation that describes a signature the
//! sandbox does not have is worse than none, because the model has no way to discover the lie.
//!
//! So the catalogue is generated from the guest SDK's own declarations and its doc comments — the
//! emitted `.d.ts` and its JSDoc, for the arm this module was written for — and read from here
//! through [`catalogue_functions`], [`catalogue_modules`] and [`type_declaration`].
//!
//! It is generated **by the build that compiles this crate**, not committed and embedded later.
//! `crates/gg/build.rs` runs every arm's reflector into the build's `OUT_DIR`, and each arm module
//! `include_str!`s the result; `sandbox/guests/`, which held them and then held the baked guest
//! components after them, does not exist at all any more. That
//! removes the one failure mode the arrangement could not otherwise see. A committed catalogue is a
//! claim about SDK source that is checked at the moment it is generated and never again, and
//! nothing about a `.json` file *looks* out of date — so between one regeneration and the next it
//! can describe a function the guest stopped exporting, and the model has no way to discover the
//! lie. Generated here, it is the SDK sources of this checkout read on this build, so the
//! documentation cannot be more current *or* less current than the code it describes. What is left
//! to go wrong is a reflector bug rather than a staleness window, which is why the checks in this
//! module and in the agreement and register gates (`language/agreement.rs`, `language/register.rs`)
//! read the emitted JSON rather than trusting that somebody reviewed it.
//!
//! # Every word of it is written on a declaration
//!
//! Not just the sentence under a function: the description of each **argument**, of each **field**
//! of a structured argument, of each **type** and each of its **members**, and of each **module**,
//! is reflected out of the doc comment on the thing it describes. A description authored
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
//! own generated JSON and its own parsed copy, reached through [`ProgramLanguage::catalogue`]. A
//! reader that wants "the catalogue" therefore has to say whose, which is exactly the question a
//! cross-language study makes unavoidable.
//!
//! # A catalogue declares the shape it is written in
//!
//! Every catalogue carries a [`schema`](SignatureCatalogue::schema), and gg reads exactly the one
//! shape it knows — see [`CATALOGUE_SCHEMA`]. A number it does not know is refused rather than read
//! as the nearest thing gg understands, because a catalogue from a newer gg describes a surface this
//! one cannot render, and rendering it anyway is how a model is handed a signature nobody wrote.

use std::borrow::Cow;

use serde::Deserialize;
use test_cabinet_core::gg::GgProgramLanguage;

use super::language::ProgramLanguage;
use super::operations::{Binding, OperationId, operation_by_id};

// The whole vocabulary backs [`sandbox_operation_names`], which is a drift gate rather than a
// run-time need — so, like it, the names it is built from are only reachable under test.
#[cfg(test)]
use crate::tools::ALL_TOOL_NAMES;

/// The shape every catalogue is written in and the only number a reader accepts.
///
/// It is the doc model every arm emits: one flat [`functions`](SignatureCatalogue::functions) array
/// whose entries name a gg [operation](super::operations) rather than asserting a gate of their own,
/// live in a [module](ModuleDoc), are keyed by a module-qualified [`fqn`](FunctionSignature::fqn),
/// carry an **authored** [brief and optional detail](Prose), and record their type references
/// **resolved** rather than as written.
///
/// Gating is gg's and never an arm's ([`Binding`]), and a brief is written by whoever knows what the
/// thing is rather than computed out of a paragraph — the two rules the shape exists to make
/// structural.
pub const CATALOGUE_SCHEMA: u32 = 1;

/// Read the `schema` key, accepting [`CATALOGUE_SCHEMA`] and refusing every other number.
///
/// A number rather than a one-variant enum: there is one shape, so the version is never a choice a
/// reader branches on, only a claim a reader checks. An enum would spell the same number twice — in
/// a variant name and in the conversion that produces it — and hand every consumer a match arm none
/// of them wants.
///
/// A number gg does not know is an **error** rather than a fallback to the shape gg does know: a
/// catalogue from a newer gg describes a surface this gg cannot render, and rendering it as though
/// it were the shape gg understands is how a model is handed a signature nobody wrote.
fn deserialize_schema<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let declared = u32::deserialize(deserializer)?;
    if declared == CATALOGUE_SCHEMA {
        Ok(declared)
    } else {
        Err(serde::de::Error::custom(format!(
            "`schema` is {declared}, and this gg reads catalogue schema {CATALOGUE_SCHEMA} — a \
             catalogue from a newer gg describes a surface this one cannot render"
        )))
    }
}

/// The whole catalogue: the modules an arm's surface is divided into, every call a program can
/// write, and the type declarations those calls reference.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignatureCatalogue {
    /// Which [shape](CATALOGUE_SCHEMA) this catalogue is written in. Required: a catalogue that
    /// does not say what it is written in is one gg would have to guess at, and a guess about the
    /// shape of a document is how a model is shown a surface nobody has.
    #[allow(
        dead_code,
        reason = "the field does its work at parse time — deserializing it is what refuses a \
                  catalogue from a gg whose shape this one cannot render — so nothing downstream \
                  has to branch on it, and nothing does"
    )]
    #[serde(deserialize_with = "deserialize_schema")]
    pub schema: u32,
    /// The [program language](GgProgramLanguage) whose spellings this catalogue carries.
    ///
    /// Every language's guest emits one of these, in this shape, under its own stem in the
    /// directory `crates/gg/build.rs` hands the reflection. The field is what lets the language that
    /// embedded a catalogue check it got its own: eleven reflectors writing eleven stems into one
    /// directory is exactly the arrangement in which a file can land under the wrong name, and a
    /// catalogue read under the wrong stem reaches a model as a system prompt describing a sandbox
    /// nobody has.
    pub language: GgProgramLanguage,
    /// Where the catalogue was reflected from, recorded so a person reading the emitted JSON knows
    /// which sources produced it.
    ///
    /// That reader is the point of the field. The catalogues are written to a directory
    /// (`scripts/gg-signatures.sh`) precisely so a human can open one and look for the reflector
    /// bugs nothing else can see — a dropped `@return` paragraph, a truncated argument description,
    /// an overload group that kept only the first entry's prose — and the first question such a
    /// reader has is which tree the file came out of.
    #[allow(
        dead_code,
        reason = "provenance for a human reading the emitted JSON, not something gg renders"
    )]
    pub generated_from: String,
    /// The **libraries** a program of this language may reach for, grouped as the artifact that
    /// decides the set groups them — the one entry here that is not a signature.
    ///
    /// It belongs in the catalogue for the reason every signature does: it is **model-facing text
    /// about this arm's surface**, so the rule that nothing a model reads may be authored anywhere
    /// but on the code that decides it applies word for word. Prose listing a language's libraries
    /// would drift from the artifact with nothing to catch it — and on the
    /// [Python](super::language::python) arm it did, claiming a whole standard library where
    /// `componentize-py` had baked a curated subset of it.
    ///
    /// What a model reads it through is a **compile failure**
    /// ([`supporting`](super::supporting)): the set is what the compiler measured the program
    /// against, and a program that reached outside it is answered on the turn that did, with the
    /// modules matching what it could not import.
    ///
    /// Empty for a language whose programs get their runtime's own standard library and nothing
    /// else: `#[serde(default)]`, so an arm with nothing to declare emits a catalogue without the
    /// key and a compile failure on it carries the diagnostic alone.
    #[serde(default)]
    pub libraries: Vec<LibraryGroup>,
    /// The **modules** the surface is divided into, in the order it is presented in.
    ///
    /// A module is a *place documentation is filed under*, not an identifier a call has to go
    /// through. Nothing is unreachable for not knowing a module's name, because search finds the
    /// function; knowing the name makes the search an exact lookup instead.
    pub modules: Vec<ModuleDoc>,
    /// **Every model-facing call**, in one array: the tool-backed calls, the view calls, the
    /// program-library calls and the calls that end a session alike.
    ///
    /// One array rather than a section per gate, because a section was never a fact about the
    /// functions: it was where an arm filed a gate it should never have been asserting. Gating is
    /// stated once, by gg's [operations table](super::operations), and each entry names the
    /// [operation](FunctionSignature::operation) it binds.
    pub functions: Vec<FunctionSignature>,
    /// Every type declaration the signatures reference, in declaration order.
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
    reason = "the raw document is read by the gates that hold each arm to it — the register gate \
              and the fully-qualified-name rule — which are `#[cfg(test)]`. What a build reads is \
              the projection beside it, which carries the same fields under the same names."
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
    /// **How a program reaches this module**: the literal line it writes to bring the module into
    /// scope, or `None` where this arm's SDK is in a program's scope already and there is no line to
    /// write.
    ///
    /// # Two states, and both of them are an answer
    ///
    /// Every reader that tells a model where a symbol lives has to render both, because a model that
    /// is shown neither cannot tell "nothing to write" from "nobody said":
    ///
    /// * **`Some(line)`** — this arm needs a line and this is it, character for character, so the
    ///   model copies it rather than guessing at the arm's import syntax. The PureScript arm emits
    ///   one for every module it declares: that language resolves a qualified name only under a
    ///   qualified import, so `Gg.Files.readFile` is an expression a program can write only after
    ///   `import Gg.Files as Gg.Files`. The C# arm emits `using Gg;` for all of its, because its
    ///   modules are types in one namespace and one `using` of that namespace reaches them all; the
    ///   Swift arm emits `import gg` for all of its, because its modules are caseless `enum`s in one
    ///   Swift module; and the two ECMAScript arms emit a **named** import per module —
    ///   `import { files } from "gg";` — because their whole surface is published under one
    ///   specifier and a program there brings in the modules it calls into and no others, writing
    ///   `files.readFile` where this catalogue prints `gg.files.readFile`.
    /// * **`None`** — there is *no line to write*, because gg puts the SDK in a program's scope
    ///   before the model's code is compiled: a prelude, a precompiled header, a re-exported
    ///   import, a scope injection. It is a fact about how that arm delivers its SDK
    ///   rather than a field an arm left blank, and the honest rendering of it is to *say* the
    ///   module is reachable already — not to fall silent and leave the model hunting for an import
    ///   line its compiler would refuse.
    ///
    /// # Why it stays an `Option` and stays per module
    ///
    /// Per module, because the answer is the arm's to give module by module: an arm that put half
    /// its surface behind a line and half in scope would have nowhere else to say so.
    ///
    /// An `Option<String>` rather than an enum, because two states are all there are. A third —
    /// *reachable already, but a line would shorten what a call site writes* — would be a widening
    /// of this type and of every renderer that reads it, and whether an arm is ever in it is decided
    /// by how a program is compiled rather than by this field. That is where a third state would be
    /// added, and it is not a decision a doc comment gets to make in advance.
    pub import: Option<String>,
}

/// **One model-facing call**, whatever kind of thing the arm declared it as.
///
/// One type for every call a program can make, and it carries no gate at all, because a gate is a
/// fact about gg's configuration surface and an arm asserting one is an arm asserting something only
/// gg can be held to. What it carries instead is the [operation](Self::operation) it binds, which is
/// the join to the [table](super::operations::OPERATIONS) where gg states the gate once.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(
    dead_code,
    reason = "the raw document is read by the gates that hold each arm to it — the register gate \
              and the fully-qualified-name rule — which are `#[cfg(test)]`. What a build reads is \
              the projection beside it, which carries the same fields under the same names."
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
    /// How it may be called: one entry per shape this language offers.
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
    /// The SDK types this call's own documentation comment **declares it throws**, resolved. See
    /// [`TypeReference`].
    ///
    /// Like [`returns`](Self::returns) it is **stated by the reflector rather than inferred**, and
    /// for the sharper version of the same reason: a failure is declared in the arm's own tag for
    /// declaring one — `@throws`, `<exception cref="…">`, `\throws`, `# Errors`, `Raises:`,
    /// `@raise`, `- Throws:` — and nothing in a signature says which types those name. Every one of
    /// those blocks was already being read into the entry's [detail](Self::detail) prose, so this is
    /// the structured list beside a sentence that goes on saying exactly what it said; it adds a
    /// field and moves no text.
    ///
    /// **Only an explicitly declared error counts.** A call whose comment declares none carries an
    /// empty list, and that is a truthful record of what the author wrote rather than a claim the
    /// call cannot fail. Nothing is inferred from a body, from a `throws` clause the language
    /// happens to require, or from what some other arm declared for the same operation.
    ///
    /// Each entry names a type this same catalogue declares, which the name rule (`signatures.fqn.rs`)
    /// checks — because the one reader it exists for is the `errors` flag of an agent's
    /// `docViewTypes`, which opens a documentation view of each, and a name that resolves to nothing
    /// is a view that cannot be opened.
    #[serde(default)]
    pub throws: Vec<TypeReference>,
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
    /// `"gg::fs::FileRead"`, from an arm whose signatures write the name they resolve to.
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
/// call away from being read in full. The menu is rendered by
/// [`read_type`](crate::docs::DocsRuntime::read_type), gated line by line: a helper whose operation
/// this agent does not bind is left out, since a type is visible when *some* bound function reaches
/// it and that is weaker than every operation hanging off it being bound.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberFunction {
    /// The gg [operation](super::operations::OperationId) the member binds, rendered
    /// `namespace.key`.
    pub operation: String,
    /// The name a program calls it by.
    #[allow(
        dead_code,
        reason = "read by the gates that hold each arm to its own shape — the register \
                  gate and the fully-qualified-name rule — which are `#[cfg(test)]`. A type view \
                  lists the FULLY-QUALIFIED name, since that is the key that opens the member's own \
                  documentation, so the bare spelling has no production reader."
    )]
    pub name: String,
    /// The member's own fully-qualified name — what opens its documentation view.
    pub fqn: String,
    /// The one line it is listed by. See [`Prose`].
    pub brief: String,
}

/// One group of [libraries](SignatureCatalogue::libraries), as a compile failure lists them.
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

/// One type declaration a signature refers to.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeDeclaration {
    /// The type's name, as it appears in a signature.
    pub name: String,
    /// The declaration, as the SDK wrote it.
    pub declaration: String,
    /// The type's module-qualified fully-qualified name (`gg::fs::FileRead`) — what a documentation
    /// view of it is opened by, and what a resolved [type reference](TypeReference) names.
    pub fqn: String,
    /// The [module](ModuleDoc::id) the type belongs to — **gg's cross-arm id for it**, not this
    /// arm's path.
    ///
    /// It is the join every reader that has to say *where this declaration lives* goes through:
    /// [`module_of`] turns it into the arm's own [path](ModuleDoc::path) and the
    /// [line a program writes](ModuleDoc::import) to reach it, which is what a model needs before it
    /// can name the type at all. The console reference files a type entry under it and resolves the
    /// entry's family through it, and the gates that hold an arm to its own shape
    /// (`signatures.fqn.rs`, `language/register.rs`, `language/agreement.rs`) read it too.
    ///
    /// The id rather than the path, for the reason [`ModuleDoc`] carries both: the path is one arm's
    /// spelling, and a reader joining eleven arms on eleven strings is joining nothing.
    pub module: String,
    /// The single line the type is summarized by, authored. See [`Prose`].
    pub brief: String,
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
    /// Empty on the arms where a value carries no behaviour, which is most of them, deliberately.
    /// See [`MemberFunction`] for why a type view lists them rather than documenting them.
    #[serde(default)]
    pub member_functions: Vec<MemberFunction>,
}

impl TypeDeclaration {
    /// This type's [brief and detail](Prose).
    pub fn prose(&self) -> Prose<'_> {
        Prose::authored(&self.brief, self.detail.as_deref())
    }

    /// **The string this declaration is looked up and opened by**: its
    /// [fully-qualified name](Self::fqn).
    ///
    /// One accessor rather than a field access at each of the three places that key on a type,
    /// because a type that is *indexed* under one string and *opened* under another is a type a
    /// search can find and a model cannot read.
    pub fn key(&self) -> &str {
        &self.fqn
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
    /// Which of the three shapes this member is. See [`MemberKind`].
    #[allow(
        dead_code,
        reason = "read only by the gates that hold an arm to its own shape, which are \
                  `#[cfg(test)]`. What a type view renders is the member's name, type and brief; \
                  the shape decides how the arm declared it rather than how it is printed."
    )]
    pub kind: MemberKind,
    /// The single line the member is documented by, authored. See [`Prose`].
    pub brief: String,
    /// What more there is to say about the member, when there is more. See [`Prose`].
    pub detail: Option<String>,
}

impl TypeMember {
    /// This member's [brief and detail](Prose).
    pub fn prose(&self) -> Prose<'_> {
        Prose::authored(&self.brief, self.detail.as_deref())
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
    /// Parse one language's catalogue.
    ///
    /// Each language caches its own result behind its own `OnceLock` and panics on failure: the file
    /// was written by that arm's reflector during this binary's own build and is asserted parseable
    /// by that language's own gate, so a parse failure is a corrupt build artifact rather than a
    /// runtime condition — and degrading a prompt into silence over one would describe a sandbox
    /// nobody has.
    pub(crate) fn parse(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// Every name the guest's `bound-operations` export must answer with, as the drift gate over a
/// **guest artifact** needs it.
///
/// It is the tool vocabulary and decides nothing about the API surface an operation names; its one
/// use is the WIT's `bound-operations` export, which is how a test asks a committed component what it was
/// built against and catches a stale `.wasm` that no compiler and no source-level test can.
///
/// `#[cfg(test)]` because a run never asks: what a program may call is its [grant](super::Grants),
/// which is stated in operations.
#[cfg(test)]
pub(crate) fn sandbox_operation_names() -> Vec<&'static str> {
    ALL_TOOL_NAMES.to_vec()
}

/// One documented function as the [docs carve-out](crate::docs) sees it: the module it lives in, the
/// name a program calls it by, what buys it, and everything a doc lookup renders.
///
/// It is the catalogue projected for a purpose the prompt does not serve: the model asks for one
/// function's documentation on demand (`views.openDocsView(files.readFile)`), rather than being shown
/// every signature up front. The prose is the SDK's own JSDoc, reflected here exactly as the prompt's
/// was.
pub struct CatalogueFunction {
    /// What it is **grouped under**: this arm's own [module path](ModuleDoc::path) (`gg::fs`) — the
    /// heading the call is listed under, in the arm's own words.
    ///
    /// The cross-arm join is [`operation`](Self::operation) and never this, because eleven arms
    /// spell one module eleven ways.
    pub object: &'static str,
    /// This function's language-independent identity: the key of the
    /// [operation](super::operations::OperationId) it binds (`read_file`, `request_changes`), and
    /// the catalogue entry's own name for an entry naming an operation gg does not have.
    ///
    /// It is how gg names a function in its **own** sentences, through [`spelling`], so a prompt
    /// quoting `session.requestChanges` is quoting the catalogue rather than a second copy of it. It
    /// is *not* the cross-arm join — that is [`operation`](Self::operation), which every entry states
    /// rather than being resolved to.
    pub key: &'static str,
    /// The name a program calls it by, in this language (`readFile`) — the **fallback** key
    /// `views.openDocsView` accepts. The key gg advertises is [`fqn`](Self::fqn).
    pub name: &'static str,
    /// For an ending call, the [role](crate::ending::EndingRole) whose programs bind it; `None` for
    /// everything else, which no role decides.
    pub ending: Option<&'static str>,
    /// The gg **capability id** that buys this function — `None` for an ending call, which the
    /// agent's [role](Self::ending) decides, for the handful bound to every program whatever a
    /// run enables, and for the one bought by an agent's
    /// [position in a machine](crate::sandbox::Binding::Machine) rather than by anything on its own
    /// profile.
    ///
    /// It is [read off gg's own operations table](catalogue_functions) rather than out of the
    /// artifact, and that is the point rather than an implementation detail: a capability id is a
    /// fact about gg's own configuration surface, and an arm that wrote one into its catalogue would
    /// be asserting something about gg that gg alone can be held to. So no reflector and no emitted
    /// catalogue ever learns one. The [operation](Self::operation) an entry names is the most an arm
    /// has to get right.
    ///
    /// It is not the whole gate. A capability says the machinery exists for this agent; whether
    /// *this* call was granted within it is the agent's allowlist, which is per agent and therefore
    /// nothing a catalogue projection can carry — see [`Grants::permits`](super::Grants::permits).
    pub capability: Option<&'static str>,
    /// The gg [operation](super::operations::OperationId) this entry binds, as its catalogue names
    /// it — `files.read_file`. **The cross-arm join key.**
    pub operation: &'static str,
    /// Set when this entry is a **second** way to reach [`operation`](Self::operation) rather than
    /// the arm's canonical binding of it. See [`FunctionSignature::alias_of`].
    ///
    /// It is carried into the projection rather than left in the schema because two readers need it
    /// and neither reads the raw catalogue: coverage counts canonical bindings, and gg naming a call
    /// back at a model ([`spelling`]) should name the binding every arm has rather than the one this
    /// arm added.
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
    /// The [module](ModuleDoc::id) it is documented under.
    pub module: &'static str,
    /// Its module-qualified fully-qualified name — **the key a documentation view is opened by**,
    /// and what search files a hit under. The bare [`name`](Self::name) stays an accepted fallback,
    /// because it is what a model reads at a call site.
    pub fqn: &'static str,
    /// Its documentation: the authored brief, and the detail when there is one. See [`Prose`].
    pub prose: Prose<'static>,
    /// How it may be called: one [entry](SignatureEntry) per shape this language offers, each with
    /// its own parameters. Never empty.
    ///
    /// It is an array because the number of shapes is *spelling*: a language that expresses an
    /// optional argument as an overload pair carries two here where one expressing it as a default
    /// carries one, and neither is a difference in what the function does.
    pub signatures: &'static [SignatureEntry],
    /// The SDK types in the **return** position, resolved. Empty where the call returns nothing an
    /// SDK type names.
    pub returns: &'static [TypeReference],
    /// The SDK types this call's own documentation comment **declares it throws**, resolved. Empty
    /// where the comment declares no failure — which is most calls, and is the author's silence
    /// rather than a claim the call cannot fail. See [`FunctionSignature::throws`].
    ///
    /// What reads it is the `errors` flag of an agent's `docViewTypes`, which places a documentation
    /// view of each of these beside the function's own — the counterpart of what the `return` flag
    /// does with [`returns`](Self::returns).
    #[allow(
        dead_code,
        reason = "carried on the projection ahead of the runtime that opens what it names, so that \
                  the schema, the ten reflectors and the gate over them land on one shape before \
                  anything renders it. What reads it today is that gate, which is `#[cfg(test)]` — \
                  so it is genuinely unread in a build, exactly as `receiver` and `kind` beside it \
                  are, and for the same reason: a reader moving onto it should not first have to \
                  change the projection."
    )]
    pub throws: &'static [TypeReference],
    /// The types this function's signature reaches, **transitively closed** — every declaration a
    /// program holding this call's arguments and result can end up looking at, which is the question the
    /// documentation runtime asks of it before it will open a type at all.
    ///
    /// Consumers that want a *depth* rather than a closure narrow it themselves and must go on doing
    /// so — [`types_to_open`](crate::docs::DocsRuntime::types_to_open) is the one that does.
    pub types: &'static [TypeReference],
}

/// **A brief and an optional detail** — the shape of every piece of documentation in the model, from
/// a module's header down to one member of one record.
///
/// # Why the split is authored
///
/// A brief is a *single line* that says what the thing is; a detail is everything else. The split is
/// the one the author wrote, never one gg found in a paragraph, and that is a correctness
/// requirement rather than a style one: no rule applied to prose can recover a summary the author
/// never wrote, and a rule that guesses cuts mid-sentence or swallows the paragraph after it, in
/// text a model reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Prose<'a> {
    /// The single line the thing is summarized by. Never `None`: an entry with no brief is a
    /// register failure (`language/register.rs`), not an absent field.
    pub brief: &'a str,
    /// Everything else there is to say, or `None` when there is nothing.
    pub detail: Option<&'a str>,
}

impl<'a> Prose<'a> {
    /// The **authored** brief and detail of an entry, which is the whole of its documentation: there
    /// is no paragraph behind them to fall back to, and a blank brief here stays blank so that the
    /// register gate (`language/register.rs`) can name it.
    pub fn authored(brief: &'a str, detail: Option<&'a str>) -> Self {
        Self {
            brief,
            detail: detail.filter(|detail| !detail.trim().is_empty()),
        }
    }

    /// The whole documentation as one block — what a documentation view renders under the signature:
    /// the brief, and the detail after a blank line where there is one.
    pub fn rendered(&self) -> Cow<'a, str> {
        match self.detail {
            None => Cow::Borrowed(self.brief),
            Some(detail) => Cow::Owned(format!("{}\n\n{detail}", self.brief)),
        }
    }
}

/// Every function `language`'s catalogue documents — the tool-backed calls, the view calls, the
/// program-library calls and the ending calls alike — each projected as a
/// [`CatalogueFunction`].
///
/// It takes a language because the *spellings* are one language's: two registered languages offer
/// the same operations under the same gates, and differ in what a program calls them. The docs runtime filters these by the run's enabled set, the agent's role and whether it
/// keeps a program library. **This is the whole model-facing surface** — every reader that reports
/// what an agent binds reports exactly these, with nothing appended, since nothing model-facing sits
/// outside the catalogue any more.
///
/// # It is the one place a gate is decided
///
/// A catalogue entry carries none, and this is where the [operation](FunctionSignature::operation)
/// it names is resolved against gg's own [operations table](super::operations) into the role,
/// capability or standing that buys it — so no consumer downstream has to read the artifact to learn what an
/// arm may do.
pub fn catalogue_functions(language: &dyn ProgramLanguage) -> Vec<CatalogueFunction> {
    functions_of(language.catalogue())
}

/// [`catalogue_functions`], reached by the catalogue rather than by the arm that owns it.
///
/// The split exists so that the projection can be tested against a **fixture** catalogue, which has
/// no arm behind it: giving one an arm — a component, a checker — to ask it one
/// question about its own JSON would be a great deal of apparatus for a question that is about the
/// JSON.
///
/// An entry naming an operation gg does not have is projected with **no** gate, which is the
/// conservative reading and the one that fails safe: [`bound`](crate::docs::DocsRuntime::bound)
/// answers `false` for an unresolvable operation, so an arm that invents an operation documents
/// nothing rather than documenting something ungated. Failing it *by name* is a different job —
/// an arm's claim about gg's own vocabulary belongs to the coverage half of the
/// agreement gate (`language/agreement.rs`) — and this is deliberately the quiet, safe half of
/// that pair rather than a second opinion about it.
pub(crate) fn functions_of(catalogue: &'static SignatureCatalogue) -> Vec<CatalogueFunction> {
    catalogue
        .functions
        .iter()
        .map(|function| {
            let operation = operation_by_id(&function.operation);
            // gg's own binding, decomposed into the two fields the projection carries. The arm does
            // not get a vote: it named an operation, and what buys that operation is stated once, on
            // gg's side, in `OPERATIONS`.
            let (ending, capability) = match operation.map(|operation| operation.binding) {
                Some(Binding::Ending(role)) => (Some(role.id()), None),
                Some(Binding::Capability(id)) => (None, Some(id)),
                // A [positional](Binding::Machine) row carries neither: no role dispatches it and
                // no capability of the agent's own buys it, so the two fields a projection has to
                // offer are both honestly empty. What decides it is the run, and the run is not
                // something a catalogue entry can carry.
                Some(Binding::Machine) | Some(Binding::Always) | None => (None, None),
            };
            CatalogueFunction {
                // The module *path* is this schema's model-facing grouping: it is what a
                // directory of one module lists
                // under, what the console groups by, and what a model reads. The cross-arm join is
                // the operation id beside it, never this.
                object: module_path(catalogue, &function.module),
                key: operation.map_or(function.name.as_str(), |operation| operation.id.key),
                name: function.name.as_str(),
                ending,
                capability,
                operation: function.operation.as_str(),
                alias_of: function.alias_of.as_deref(),
                kind: function.kind,
                receiver: function.receiver.as_deref(),
                module: function.module.as_str(),
                fqn: function.fqn.as_str(),
                prose: Prose::authored(function.brief.as_str(), function.detail.as_deref()),
                signatures: function.signatures.as_slice(),
                returns: function.returns.as_slice(),
                throws: function.throws.as_slice(),
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
    module_of(catalogue, id).map_or(id, |module| module.path)
}

/// **The part of `fqn` after its module path and the one separator following it**, or `None` when
/// the module path is not a prefix of it at all — or is one only by accident, as `gg::fs` is of
/// `gg::fsx`.
///
/// It is the name the model reads *inside* a module: `readFile` for a free function, and
/// `SubagentHandle.send` / `SubagentHandle#send` / `SubagentHandle::send` for a method, in the
/// arm's own separator. The separator is whatever the arm wrote — `.`, `::`, `#`, or a run of
/// them — so the check is that the character after the prefix is one that cannot continue an
/// identifier, not that it is any particular one.
///
/// Two readers hold one implementation of it on purpose. The name rule (`signatures.fqn.rs`) parses
/// it into segments to hold an arm's names to their shape; [`module_relative_name`] reports it, so
/// that a surface naming a method carries its receiver rather than a bare `close` that collides
/// with the free function beside it. A second copy would let the two disagree about what a
/// qualification is.
/// Whether `c` can continue an identifier in *some* language whose names reach gg.
///
/// Deliberately generous — anything alphanumeric, plus `_` — because the alternative is a per-arm
/// table of identifier syntaxes, and the thing being separated is a name the arm's own compiler
/// already accepted. What matters is only that a separator is *not* one of these.
pub(crate) fn is_identifier(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

pub(crate) fn module_relative<'a>(fqn: &'a str, module_path: &str) -> Option<&'a str> {
    let rest = fqn.strip_prefix(module_path)?;
    // A separator, not merely *something*: the character right after the module path has to be one
    // that cannot continue an identifier, or the prefix match was a coincidence rather than a
    // qualification.
    let separator: usize = rest
        .chars()
        .take_while(|c| !is_identifier(*c))
        .map(char::len_utf8)
        .sum();
    if separator == 0 {
        return None;
    }
    let tail = &rest[separator..];
    (!tail.is_empty()).then_some(tail)
}

/// **The name `function` is reported under within its module** — its
/// [fully-qualified name](CatalogueFunction::fqn) with the module [path](CatalogueFunction::object)
/// and the separator after it stripped, falling back to the bare [`name`](CatalogueFunction::name)
/// for an entry whose name the module path does not qualify.
///
/// For a free function the two are the same string. For a method they differ, and the difference is
/// the point: `SubagentHandle::send` is a row of its own beside the free `send_message` it aliases,
/// where the bare `send` would say nothing about the receiver it hangs off — and would leave two
/// rows of one module free to share a name a reader keyed on it would fold.
pub(crate) fn module_relative_name(function: &CatalogueFunction) -> &'static str {
    module_relative(function.fqn, function.object).unwrap_or(function.name)
}

/// **The one module `module` names**, as a [view](ModuleView) of it: gg's id for it, this arm's own
/// path, the line it is introduced by and the [line a program writes](ModuleView::import) to bring
/// it into scope. `None` where the catalogue declares no such module.
///
/// It takes either key — gg's [id](ModuleDoc::id) (`files`) or this arm's own
/// [path](ModuleDoc::path) (`gg::fs`) — because its two kinds of caller hold different ones. A
/// renderer that has to say *where a symbol is defined and how to reach it* holds an id, since that
/// is what a [function](CatalogueFunction::module) and a [type](TypeDeclaration::module) each carry;
/// anything resolving a name a model typed holds a path, since the path is what a model reads. The
/// id is tried across every module before the path is, so an id can never lose to a coincidence.
///
/// # Both keys are matched whole, and a fully-qualified name is not one of them
///
/// Both comparisons are equality. **Nothing here matches a prefix, and a caller must not be tempted
/// to add one**: a module resolved by scanning a symbol's fully-qualified name for a module path it
/// starts with is wrong on the arms where one module's path is a proper prefix of every other's —
/// `Gg` on C#, `gg` on Java, where the `core` module's path prefixes the whole surface — and it is
/// wrong *silently*, filing every symbol on the arm under `core` while every gate stays green. A
/// resolution from a name, if one is ever needed, has to take the **longest** matching path and then
/// check that a separator follows it, which is what the name rule (`signatures.fqn.rs`) already
/// does.
///
/// The reason this asks for a module rather than a name is exactly that trap: the catalogue carries
/// the module on every entry it declares, so the question never has to be put to an fqn at all.
///
/// A caller holding an arm rather than a catalogue reaches it through the arm's own
/// [`catalogue`](ProgramLanguage::catalogue), for the reason [`functions_of`] is split from
/// [`catalogue_functions`]: the lookup is about the JSON, and a test of it should not have to build
/// an arm.
pub(crate) fn module_of(
    catalogue: &'static SignatureCatalogue,
    module: &str,
) -> Option<ModuleView> {
    let modules = &catalogue.modules;
    modules
        .iter()
        .find(|declared| declared.id == module)
        .or_else(|| modules.iter().find(|declared| declared.path == module))
        .map(view_of)
}

/// How `language`'s SDK writes the [operation](OperationId) `id`: **the grouping it is reached
/// through, and the name it is called by**. `None` when its catalogue carries no such function.
///
/// # Why two strings, and why the grouping is the arm's rather than gg's
///
/// Because the caller ([`spell`](super::spell)) has to write a qualified call site a program could
/// compile, and what qualifies one is the arm's own [module path](ModuleDoc::path): the pair reads
/// `Gg.Views.OpenFile` on the arm that spells it that way, which `views.OpenFile` would not be.
///
/// # Why the lookup goes through the operation
///
/// Because an [`OperationId`] is gg's identity for a call and neither half of it is a spelling a
/// catalogue carries: the grouping is the arm's module and the key is gg's word. So the match is
/// made on the **operation** each entry names, which is identity rather than spelling — the property
/// that makes the lookup correct on eleven arms that agree about nothing else.
///
/// A [canonical binding](FunctionSignature::alias_of) is preferred over an alias, because gg naming
/// a call back at a model should name the one every arm has rather than the one this arm added.
pub(crate) fn spelling(
    language: &dyn ProgramLanguage,
    id: OperationId,
) -> Option<(&'static str, &'static str)> {
    let matches = |function: &CatalogueFunction| {
        super::operations::operation_of(function).is_some_and(|operation| operation.id == id)
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
/// An arm writes **three different strings** for one type, and a model may reasonably type any of
/// them:
///
/// * the [key](TypeDeclaration::key) — `Gg.Files.FileRead`, `gg::files::FileRead` — which is what gg
///   itself emits and what a docview is filed under;
/// * the [spelling](TypeReference::spelled) a signature writes — `Files.FileRead`,
///   `files::FileRead` — which is module-qualified but relative, because that is what compiles at a
///   call site under the arm's prelude or the module's own import line;
/// * the bare [name](TypeDeclaration::name) — `FileRead`.
///
/// The middle one is the string the model has most often just read, since it is the one printed in
/// the signature of the function whose documentation it opened. The spellings are taken from the
/// catalogue's own
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
            // The spelling a signature writes. It is neither the key nor the bare name, and it is
            // the one a model copies out of the signature it just read.
            let resolved = spellings_of(catalogue)
                .into_iter()
                .find(|reference| reference.spelled() == key)?;
            types
                .iter()
                .find(|declaration| declaration.key() == resolved.fqn())
        })
        // A bare name still resolves, and deliberately: a model that read `FileRead` in a
        // signature and asked for it by that name is asking for the type it just read. The key is
        // what everything gg emits uses, so this arm of the lookup is only ever reached by a name a
        // *model* typed.
        .or_else(|| types.iter().find(|declaration| declaration.name == key))
}

/// Every **type reference** `catalogue` writes anywhere a model can read it — one entry per
/// (spelling, resolution) pair some signature on this arm carries.
///
/// [`throws`](FunctionSignature::throws) is walked beside
/// [`returns`](FunctionSignature::returns) and [`types`](FunctionSignature::types) for the reason
/// the whole function exists: a model reads a thrown type's *spelling* in the documentation comment
/// it was declared in, and the lookup that accepts what a model typed
/// ([`declaration_of`]) has to accept the string it just read. A declared failure a model can see
/// and cannot open would be the one name in a view that answers nothing.
fn spellings_of(catalogue: &'static SignatureCatalogue) -> Vec<&'static TypeReference> {
    catalogue
        .functions
        .iter()
        .flat_map(|function| {
            function
                .returns
                .iter()
                .chain(&function.throws)
                .chain(&function.types)
        })
        .collect()
}

/// Every **module** `language`'s surface is divided into, in the order it is presented in.
///
/// The order is the catalogue's, not a sort: it is the order the surface was authored in, and it is
/// what a reader of the arm sees.
pub fn catalogue_modules(language: &dyn ProgramLanguage) -> Vec<ModuleView> {
    modules_of(language.catalogue())
}

/// [`catalogue_modules`], reached by the catalogue rather than by the arm that owns it, for the
/// reason [`functions_of`] is.
pub(crate) fn modules_of(catalogue: &'static SignatureCatalogue) -> Vec<ModuleView> {
    catalogue.modules.iter().map(view_of).collect()
}

/// One [module document](ModuleDoc) as the [view](ModuleView) every consumer reads it through.
///
/// One projection rather than one per caller, so that the whole list and a single lookup
/// ([`module_of`]) can never disagree about what a module says — which they could the moment one of
/// them forgot a field, and the field they would forget is the [import line](ModuleView::import),
/// since it is the one that is empty on most arms.
fn view_of(module: &'static ModuleDoc) -> ModuleView {
    ModuleView {
        id: module.id.as_str(),
        path: module.path.as_str(),
        prose: Prose::authored(module.brief.as_str(), module.detail.as_deref()),
        import: module.import.as_deref(),
    }
}

/// One module as every consumer reads it — the [module](ModuleDoc) half of what
/// [`catalogue_functions`] is for the calls.
pub struct ModuleView {
    /// gg's cross-arm id for the module.
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
    /// **The literal line a program writes to bring the module into scope**, or `None` where this
    /// arm's SDK is in a program's scope already and there is no line to write. See
    /// [`ModuleDoc::import`] for the two states, and for what a `None` asserts rather than omits.
    ///
    /// It is carried on the projection because it is model-facing: the system prompt's module list
    /// (`crate::prompts`) writes it, and so does the console's reference page (`crate::reference`).
    /// The place it matters most is a documentation view of a single symbol, which is the one text a
    /// model reads at the moment it is about to write the call.
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

/// The fixture catalogue — one small surface in the [schema](CATALOGUE_SCHEMA) every arm emits —
/// that every test of the projection reads.
#[cfg(test)]
#[path = "signatures.fixture.rs"]
pub(crate) mod fixture;
