//! **The cross-language agreement gate** — the assertion that every
//! [registered language](super::all_languages) describes *the same capabilities*, and that the only
//! thing free to differ between them is how they are spelled.
//!
//! # Why it is load-bearing
//!
//! The [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) capability exists to
//! **measure**. The question that made the program language a variable at all — *does the language a
//! model writes in change how well it works?* — is answered by running two arms and comparing them,
//! and that comparison is only a measurement of the language if both arms present the model with the
//! same capabilities. If one language's SDK were missing `edit_file`, or gated `view.openFile` on
//! nothing, or offered four view functions where the other offers five, then every difference the
//! study measured would be confounded by a difference in *surface*, and the study would quietly be
//! measuring something nobody asked about.
//!
//! Nothing else in gg would notice. Each language's own drift gates compare it to
//! [`ALL_TOOL_NAMES`] and to its own committed component — never to another language — so two
//! internally-consistent surfaces that disagree with each other are two green test suites. This
//! module is the only thing that compares them, and therefore the only thing standing between a
//! configured `language` param and an invalidated experiment.
//!
//! # What is identity, and what is spelling
//!
//! **Identity** is everything a consumer routes, gates or groups on, and no language may differ on
//! any of it:
//!
//! * the **key** — a gg tool's own name (`read_file`), or the catalogue entry's `key`
//!   (`request_changes`, `open_text`) for the carve-outs that are not tools;
//! * the **object** it hangs off (`fs`, `view`, `harness`), which is on the wire in
//!   [`AgentSurface`](test_cabinet_core::gg::AgentSurface), is what the console groups by, is what
//!   [`reference`](crate::reference) joins capability families to, and is what the
//!   [docs runtime](crate::docs) routes a lookup by — or *no* object, for a
//!   [meta](Section::Meta) function, which is bound onto every one of them;
//! * the **gate** — the gg tool whose being enabled binds it;
//! * the **ending role** whose programs bind it, and whether it belongs to the
//!   [program library](crate::programs), which is the one family a capability rather than a tool
//!   decides.
//!
//! **Spelling** is everything else, and it is deliberately a great deal: the function name a program
//! calls, the prose that documents it, the object's own description — and the whole **shape of the
//! call**. Parameter names, parameter descriptions, whether an argument is positional or passed by
//! name, what it defaults to, and *how many signatures the entry carries* are all spelling. A
//! language that expresses an optional argument as an overload pair carries two signatures where one
//! expressing it as a default carries one, and that is not a difference in what the function does —
//! so nothing here compares the count. Those are the language's own, and the whole point of the seam.
//!
//! The one thing about the call shape that is **not** free is whether there is one: a capability that
//! needs a path needs it in every language, so *whether an entry documents any argument at all* is
//! compared across arms. An arm whose model is told what to put in `fs.read_file` and an arm whose
//! model is not are not two spellings of one surface.
//!
//! # What is asserted about spelling, then
//!
//! That it is *there*. Every parameter, every field of a structured argument, every type, every one
//! of a type's members and every API object must carry documentation, because all of it is read by a
//! model and a blank is a model guessing. The check runs over the **emitted catalogue**, so it is the
//! same check for a language whose compiler enforced its doc comments and one whose convention did —
//! Swift's `docc`, Java's `-Xdoclint`, Rust's `# Arguments` heading and PureScript's `@param` all
//! land in one shape here, and one gate covers every language that will ever be added.
//!
//! An **omission** is caught as well as a blank, which matters because the languages with no
//! per-argument doc slot of their own are exactly the ones whose reflector is most likely to emit an
//! empty list and call it done. Two checks catch it: a signature that writes a non-empty argument
//! list and documents nothing fails on its own ([`declares_arguments`]), and an entry that documents
//! no argument where another arm documents one fails comparatively — so a language whose signatures
//! carry no brackets to look inside is covered too.
//!
//! # With exactly one registered language
//!
//! The cross-language half degenerates to "equals itself" — and the gate still asserts a great deal,
//! because most of what it checks anchors a language's catalogue to **gg's own vocabularies** rather
//! than to another language: the tool bijection against [`ALL_TOOL_NAMES`], the session keys against
//! the four [ending tools](crate::completion), the meta keys against the one the
//! [docs runtime](crate::docs) binds on every object, the ending roles against the three that
//! runtime filters by, and every gate against the tool vocabulary. Those hold,
//! and fail, with one language registered. The comparative half is dormant until a second language
//! lands, which is the correct state for an assertion whose subject does not yet exist — and it is
//! exercised today against the [fixture language](super::fixture), which is a second surface built
//! by re-spelling the first.
//!
//! # Why it returns disagreements rather than asserting them
//!
//! A gate that only panics can be shown to pass; it cannot be shown to *catch* anything. Returning
//! the disagreements makes the gate's own failure mode testable, and
//! [its tests](self::tests) hand it deliberately damaged catalogues and assert on what comes back.
//! A gate nobody has watched fail is a gate nobody knows works.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use crate::completion::{APPROVE_TOOL, FINISH_TOOL, REQUEST_CHANGES_TOOL};
use crate::ending::EndingRole;
use crate::tools::ALL_TOOL_NAMES;

use super::ProgramLanguage;
use crate::sandbox::signatures::{Parameter, SignatureEntry};

/// The six function-carrying sections of a catalogue, which are themselves identity: a function that
/// is a `view` in one language and a `tool` in another is not the same function, whatever it is
/// called.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Section {
    /// The functions bound onto **every** API object rather than declared on one — today just
    /// `list`. The one section whose entries carry no object at all.
    Meta,
    /// The calls that end a session, one group per [role](crate::ending::EndingRole).
    Session,
    /// The `view` object — the calls that put material into the agent's own context window.
    Views,
    /// The [program library](crate::programs)'s object.
    Programs,
    /// One entry per gg tool the sandbox binds.
    Tools,
    /// The convenience wrappers bound alongside a tool.
    Helpers,
}

impl fmt::Display for Section {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Meta => "meta",
            Self::Session => "session",
            Self::Views => "views",
            Self::Programs => "programs",
            Self::Tools => "tools",
            Self::Helpers => "helpers",
        })
    }
}

/// One capability, stripped of every spelling — what two languages must agree on exactly.
///
/// Ordered and compared as a whole, and collected into a sorted `Vec` rather than a set, so that a
/// language offering the *same* function twice is a disagreement rather than a silently-deduplicated
/// match.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Identity {
    /// Which of the catalogue's [sections](Section) it came from.
    pub section: Section,
    /// The API object it hangs off. Identity, never spelling.
    ///
    /// `None` for a [meta](Section::Meta) function, which hangs off no object because it hangs off
    /// all of them: naming one would be a claim about the eleven it is equally bound on.
    pub object: Option<String>,
    /// The language-independent key: a tool's gg tool name, or the entry's own `key`.
    pub key: String,
    /// The gg tool whose being enabled binds it, when one does.
    pub gate: Option<String>,
    /// The [ending role](crate::ending::EndingRole) whose programs bind it, when it is an ending
    /// call.
    pub ending: Option<String>,
    /// Whether it belongs to the [program library](crate::programs).
    pub library: bool,
}

impl fmt::Display for Identity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} [{}",
            qualified(self.object.as_deref(), &self.key),
            self.section
        )?;
        if let Some(gate) = &self.gate {
            write!(f, ", gated on {gate}")?;
        }
        if let Some(ending) = &self.ending {
            write!(f, ", {ending} ending")?;
        }
        if self.library {
            f.write_str(", library")?;
        }
        f.write_str("]")
    }
}

/// One thing wrong: which language it is wrong in, and what.
///
/// The language is named by its [display name](ProgramLanguage::display_name) rather than its wire
/// id, because a language under test may not have one — the [fixture](super::fixture) does not, by
/// construction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Disagreement {
    /// The language the complaint is about.
    pub language: &'static str,
    /// What is wrong with it, in one sentence, naming the identity at fault.
    pub detail: String,
}

impl fmt::Display for Disagreement {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.language, self.detail)
    }
}

/// How a complaint names one function: `fs.read_file` for the entries that hang off an object, and
/// the bare key for a [meta](Section::Meta) function, which hangs off none.
fn qualified(object: Option<&str>, key: &str) -> String {
    match object {
        Some(object) => format!("{object}.{key}"),
        None => key.to_string(),
    }
}

/// The [identity](Identity) of every function one language's catalogue describes, sorted.
pub(crate) fn identities(language: &dyn ProgramLanguage) -> Vec<Identity> {
    let catalogue = language.catalogue();
    let mut out = Vec::new();
    for entry in &catalogue.meta {
        out.push(Identity {
            section: Section::Meta,
            object: None,
            key: entry.key.clone(),
            gate: None,
            ending: None,
            library: false,
        });
    }
    for entry in &catalogue.session {
        out.push(Identity {
            section: Section::Session,
            object: Some(entry.object.clone()),
            key: entry.key.clone(),
            gate: None,
            ending: Some(entry.ending.clone()),
            library: false,
        });
    }
    for entry in &catalogue.views {
        out.push(Identity {
            section: Section::Views,
            object: Some(entry.object.clone()),
            key: entry.key.clone(),
            gate: entry.requires.clone(),
            ending: None,
            library: false,
        });
    }
    for entry in &catalogue.programs {
        out.push(Identity {
            section: Section::Programs,
            object: Some(entry.object.clone()),
            key: entry.key.clone(),
            gate: None,
            ending: None,
            library: true,
        });
    }
    for entry in &catalogue.tools {
        out.push(Identity {
            section: Section::Tools,
            object: Some(entry.object.clone()),
            key: entry.tool.clone(),
            gate: Some(entry.tool.clone()),
            ending: None,
            library: false,
        });
    }
    for entry in &catalogue.helpers {
        out.push(Identity {
            section: Section::Helpers,
            object: Some(entry.object.clone()),
            key: entry.key.clone(),
            gate: Some(entry.requires.clone()),
            ending: None,
            library: false,
        });
    }
    out.sort();
    out
}

/// Every way `languages` fail to describe one capability surface. Empty is the passing answer.
///
/// The first language is the **reference arm**: the comparative complaints are phrased as what the
/// others have that it does not, and vice versa. That is a presentation choice only — the relation
/// is symmetric, and a disagreement anywhere fails the gate whichever arm is first.
///
/// Every check is over catalogues alone, so this costs no component compile and can be run against
/// as many candidate surfaces as a test cares to build.
pub(crate) fn disagreements(languages: &[&'static dyn ProgramLanguage]) -> Vec<Disagreement> {
    let mut out = Vec::new();
    for language in languages {
        anchored_to_gg(*language, &mut out);
        internally_consistent(*language, &mut out);
    }
    let Some((reference, rest)) = languages.split_first() else {
        return out;
    };
    for language in rest {
        agrees_with(*reference, *language, &mut out);
    }
    out
}

/// The checks that hold with **one** language registered: every one of them anchors the catalogue to
/// a vocabulary gg owns, rather than to another language's catalogue.
fn anchored_to_gg(language: &'static dyn ProgramLanguage, out: &mut Vec<Disagreement>) {
    let name = language.display_name();
    let catalogue = language.catalogue();
    let mut complain = |detail: String| {
        out.push(Disagreement {
            language: name,
            detail,
        })
    };

    // The tool bijection: every gg tool is catalogued, nothing else is, and none is catalogued
    // twice. This is the drift gate that has always existed, restated per language.
    let catalogued: BTreeSet<&str> = catalogue.tools.iter().map(|e| e.tool.as_str()).collect();
    let offered: BTreeSet<&str> = ALL_TOOL_NAMES.iter().copied().collect();
    for missing in offered.difference(&catalogued) {
        complain(format!("the gg tool `{missing}` is not catalogued"));
    }
    for extra in catalogued.difference(&offered) {
        complain(format!(
            "`{extra}` is catalogued as a gg tool, and is not one"
        ));
    }
    if catalogued.len() != catalogue.tools.len() {
        complain(format!(
            "the catalogue has {} tool entries for {} distinct tools",
            catalogue.tools.len(),
            catalogued.len()
        ));
    }

    // The meta vocabulary is gg's own, exactly: the [documentation carve-out](crate::docs) seeds
    // `list` onto every object the guest creates and answers a lookup for that key by it. A
    // catalogue that omits it leaves the one function every object carries undocumented — the
    // directory a model reaches for first — and one that invents a second names a function no guest
    // binds. Neither is visible to any other check, because a meta entry hangs off no object and so
    // appears in none of the per-object counts.
    let meta_vocabulary: BTreeSet<&str> = [crate::docs::LIST_FUNCTION].into_iter().collect();
    let meta: BTreeSet<&str> = catalogue.meta.iter().map(|e| e.key.as_str()).collect();
    for missing in meta_vocabulary.difference(&meta) {
        complain(format!("the meta function `{missing}` is not catalogued"));
    }
    for extra in meta.difference(&meta_vocabulary) {
        complain(format!(
            "`{extra}` is catalogued as a meta function, and gg binds no such function"
        ));
    }
    if meta.len() != catalogue.meta.len() {
        complain(format!(
            "the catalogue has {} meta entries for {} distinct meta functions",
            catalogue.meta.len(),
            meta.len()
        ));
    }

    // Every gate names a gg tool. A gate that names nothing is a function bound by a condition
    // nobody can satisfy, or — worse — one bound unconditionally by a typo.
    let gates = catalogue
        .views
        .iter()
        .filter_map(|e| e.requires.as_deref())
        .chain(catalogue.helpers.iter().map(|e| e.requires.as_str()));
    for gate in gates {
        if !offered.contains(gate) {
            complain(format!("`{gate}` gates a function and is not a gg tool"));
        }
    }

    // The session section is gg's ending vocabulary, exactly: the same three names the tool-calling
    // arm dispatches, which is what makes an ending comparable across the two execution modes as
    // well as across languages.
    let ending_vocabulary: BTreeSet<&str> = [FINISH_TOOL, APPROVE_TOOL, REQUEST_CHANGES_TOOL]
        .into_iter()
        .collect();
    let session: BTreeSet<&str> = catalogue.session.iter().map(|e| e.key.as_str()).collect();
    for missing in ending_vocabulary.difference(&session) {
        complain(format!("the ending call `{missing}` is not catalogued"));
    }
    for extra in session.difference(&ending_vocabulary) {
        complain(format!(
            "`{extra}` is catalogued as an ending call, and gg has no such ending"
        ));
    }

    // The role each ending belongs to is one of the three the docs runtime filters by; anything else
    // documents a call to every agent, including the ones whose scope does not bind it.
    for entry in &catalogue.session {
        if !ENDING_ROLES.contains(&entry.ending.as_str()) {
            complain(format!(
                "the ending `{}` belongs to the role `{}`, which is not one of {ENDING_ROLES:?}",
                entry.key, entry.ending
            ));
        }
    }

    // And which role, exactly — read off [`EndingRole::tools`] rather than listed here, so the
    // catalogue is checked against gg's own answer to "what may this role end with" and the two
    // cannot be edited apart. A reviewer offered `finish` is a reviewer that can declare the work
    // complete, which is not a verdict a reviewer is asked for.
    for (role, ending) in [
        (EndingRole::Standard, "standard"),
        (EndingRole::Review, "review"),
    ] {
        for tool in role.tools() {
            if let Some(entry) = catalogue.session.iter().find(|e| e.key == *tool)
                && entry.ending != ending
            {
                complain(format!(
                    "`{tool}` is catalogued as a `{}` ending, and gg offers it to the `{ending}` \
                     role",
                    entry.ending
                ));
            }
        }
    }

    // A file view is a **read**, and the rest of the view surface is not gated at all: a run that
    // offers no tools must still be able to show its model something. A `requires` that slipped onto
    // the wrong one would silently withhold the only channel into the context window, or silently
    // open a side door into the workspace, and neither shows up as a compile error.
    for entry in &catalogue.views {
        let expected = (entry.key == FILE_VIEW).then_some(READ_FILE_TOOL);
        if entry.requires.as_deref() != expected {
            complain(format!(
                "the view `{}` is gated on {:?} where gg gates it on {expected:?}",
                entry.key, entry.requires
            ));
        }
    }

    // No non-tool function may be a gg tool in disguise — neither by gg's own name for one nor by
    // this SDK's spelling of one. Two vocabularies share one program scope, so a collision would be
    // resolved by bind order rather than by anyone's decision; and a model shown two unrelated
    // functions under one word has no way to tell which it is calling. Ending calls, view calls,
    // program-library calls, helpers and meta functions alike, since none of them has a gg tool name
    // of its own — and a meta function most of all, since it is bound on *every* object and so
    // collides with a tool spelling wherever that tool is grouped.
    let tool_spellings: BTreeSet<&str> = catalogue
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect();
    for (family, object, name) in catalogue
        .meta
        .iter()
        .map(|e| ("meta function", None, e.name.as_str()))
        .chain(
            catalogue
                .session
                .iter()
                .map(|e| ("ending call", Some(e.object.as_str()), e.name.as_str())),
        )
        .chain(
            catalogue
                .views
                .iter()
                .map(|e| ("view call", Some(e.object.as_str()), e.name.as_str())),
        )
        .chain(catalogue.programs.iter().map(|e| {
            (
                "program-library call",
                Some(e.object.as_str()),
                e.name.as_str(),
            )
        }))
        .chain(
            catalogue
                .helpers
                .iter()
                .map(|e| ("helper", Some(e.object.as_str()), e.name.as_str())),
        )
    {
        let where_ = qualified(object, name);
        if ALL_TOOL_NAMES.contains(&name) {
            complain(format!(
                "the {family} `{where_}` is spelled as one of gg's own tool names"
            ));
        }
        if tool_spellings.contains(name) {
            complain(format!(
                "the {family} `{where_}` is spelled exactly as this SDK spells a gg tool"
            ));
        }
    }
}

/// Every API object at least one of a catalogue's functions hangs off.
///
/// A [meta](Section::Meta) function contributes none: it is bound onto whatever objects the rest of
/// the catalogue creates, so it can neither introduce an object nor keep one alive.
fn grouped_objects(language: &'static dyn ProgramLanguage) -> BTreeSet<&'static str> {
    spellings(language)
        .into_iter()
        .filter_map(|spelling| spelling.object)
        .collect()
}

/// The [ending roles](crate::ending::EndingRole) a catalogue may tag a session entry with — the same
/// three spellings [`DocsRuntime`](crate::docs::DocsRuntime) filters by.
const ENDING_ROLES: [&str; 3] = ["standard", "review", "judge"];

/// The [key](Identity::key) of the view function that opens a **file**, which is the one view call a
/// gg tool gates.
const FILE_VIEW: &str = "open_file";

/// The gg tool that gates it. A view of a file is a read, so it closes when reading does.
const READ_FILE_TOOL: &str = "read_file";

/// The checks about one language's own coherence: that its spellings are usable and unambiguous, and
/// that every type it mentions it also declares.
fn internally_consistent(language: &'static dyn ProgramLanguage, out: &mut Vec<Disagreement>) {
    let name = language.display_name();
    let catalogue = language.catalogue();
    let mut complain = |detail: String| {
        out.push(Disagreement {
            language: name,
            detail,
        })
    };

    // Spelled once each, per object. A program's scope is one namespace per object, so two entries
    // on `fs` sharing a name is one of them silently shadowing the other at bind time.
    let mut seen: BTreeSet<(Option<&str>, &str)> = BTreeSet::new();
    for entry in spellings(language) {
        let Spelling {
            object,
            name,
            signatures,
            doc,
            key,
        } = entry;
        let where_ = qualified(object, key);
        if name.trim().is_empty() {
            complain(format!("`{where_}` has no name a program could call"));
        }
        if doc.trim().is_empty() {
            complain(format!("`{where_}` has no documentation"));
        }
        if !seen.insert((object, name)) {
            complain(match object {
                Some(object) => format!("two functions on `{object}` are both spelled `{name}`"),
                None => format!("two meta functions are both spelled `{name}`"),
            });
        }
        // Every shape the language offers this function in, checked on its own. The COUNT is
        // spelling — an overload pair and a default argument are two idioms for one capability —
        // so what is asserted is that each of them is callable and documented, never how many
        // there are.
        if signatures.is_empty() {
            complain(format!("`{where_}` has no signature"));
        }
        for SignatureEntry {
            signature,
            parameters,
        } in signatures
        {
            if signature.trim().is_empty() {
                complain(format!("`{where_}` has an empty signature"));
            } else if !signature.starts_with(name) {
                complain(format!(
                    "`{where_}`'s signature does not start with the name a program calls \
                     (`{name}`): {signature}"
                ));
            }
            if parameters.is_empty() && declares_arguments(signature) {
                complain(format!(
                    "`{where_}` takes arguments and documents none: {signature}"
                ));
            }
            for parameter in parameters {
                check_parameter(parameter, &where_, signature, &mut complain);
            }
        }
    }

    // And a meta function is spelled once against *every* object, not just against the other meta
    // functions: it is seeded onto each object the guest creates, so a name it shares with any
    // catalogued function is a collision on that object — the same silent shadowing the per-object
    // rule above catches, in the one shape that rule cannot see.
    let meta_names: BTreeSet<&str> = catalogue.meta.iter().map(|e| e.name.as_str()).collect();
    for spelling in spellings(language) {
        let Some(object) = spelling.object else {
            continue;
        };
        if meta_names.contains(spelling.name) {
            complain(format!(
                "`{object}.{}` is spelled exactly as the meta function bound on every object",
                spelling.name
            ));
        }
    }

    // Every type a signature mentions is declared, so a doc lookup never shows a name it does not
    // then define — and is itself explained, member by member. A record whose fields arrive
    // unexplained is a record the model has to infer from its field names, which is exactly the
    // guessing the catalogue exists to remove.
    let declared: BTreeSet<&str> = catalogue.types.iter().map(|t| t.name.as_str()).collect();
    for declaration in &catalogue.types {
        let name = &declaration.name;
        if declaration.declaration.trim().is_empty() {
            complain(format!("the type `{name}` has no declaration"));
        }
        if declaration.doc.trim().is_empty() {
            complain(format!("the type `{name}` has no documentation"));
        }
        for member in &declaration.members {
            if member.name.trim().is_empty() {
                complain(format!("a member of `{name}` has no name"));
            } else if member.doc.trim().is_empty() {
                complain(format!(
                    "`{name}.{}` has no documentation",
                    member.name.trim()
                ));
            }
        }
    }

    // The API objects: described exactly once each, and only the ones a function actually hangs off.
    // A described object with nothing on it is an object a model is introduced to and never given;
    // an object with functions and no description is a heading with no sentence under it.
    let grouped = grouped_objects(language);
    let mut described: BTreeSet<&str> = BTreeSet::new();
    for entry in &catalogue.objects {
        let object = entry.object.as_str();
        if !described.insert(object) {
            complain(format!("the API object `{object}` is described twice"));
        }
        if entry.doc.trim().is_empty() {
            complain(format!("the API object `{object}` has no description"));
        }
        if !grouped.contains(object) {
            complain(format!(
                "the API object `{object}` is described and no function hangs off it"
            ));
        }
    }
    for object in grouped.difference(&described) {
        complain(format!(
            "functions hang off `{object}` and nothing describes it"
        ));
    }
    let referenced = catalogue
        .meta
        .iter()
        .flat_map(|e| e.types.iter())
        .chain(catalogue.session.iter().flat_map(|e| e.types.iter()))
        .chain(catalogue.views.iter().flat_map(|e| e.types.iter()))
        .chain(catalogue.programs.iter().flat_map(|e| e.types.iter()))
        .chain(catalogue.tools.iter().flat_map(|e| e.types.iter()))
        .chain(catalogue.helpers.iter().flat_map(|e| e.types.iter()));
    for name in referenced {
        if !declared.contains(name.as_str()) {
            complain(format!(
                "`{name}` is referenced by a signature and never declared"
            ));
        }
    }
}

/// Every parameter is named, documented, and named *in the signature it belongs to*.
///
/// The last of the three is what catches the defect this gate exists for: a parameter renamed in the
/// signature and left behind under its old name in the documentation reads perfectly and tells a
/// model to write something the call will not accept. It is checked by substring rather than by
/// parsing, because parsing a signature would need a parser per language, and every language spells
/// a parameter's name into its own signature whichever side of the type it puts it on.
fn check_parameter(
    parameter: &'static Parameter,
    where_: &str,
    signature: &'static str,
    complain: &mut impl FnMut(String),
) {
    let name = parameter.name.trim();
    if name.is_empty() {
        complain(format!("`{where_}` has an argument with no name"));
        return;
    }
    if parameter.doc.trim().is_empty() {
        complain(format!("`{where_}`'s `{name}` has no documentation"));
    }
    if !signature.contains(name) {
        complain(format!(
            "`{where_}` documents an argument `{name}` its signature does not name: {signature}"
        ));
    }
    for field in &parameter.fields {
        check_parameter(field, where_, signature, complain);
    }
}

/// Whether a signature writes an argument list at all: its first parenthesised group, matched to its
/// own closing bracket, with something in it.
///
/// Deliberately shallow, and deliberately not a parser — a parser would be one per language. Every
/// language that writes its arguments between brackets is covered by this one rule, which is every
/// language that has a call syntax at all: `shell(command: string)`, `fn read_file(path: &str)`,
/// `func readFile(path: String) throws`. A signature written in ML notation
/// (`readFile :: String -> Effect FileRead`) has no bracket to look inside and reads as taking
/// nothing; that blind spot is covered instead by the comparative check in [`agrees_with`], which
/// asks whether the *other* arms document arguments for the same identity.
fn declares_arguments(signature: &str) -> bool {
    let Some(open) = signature.find('(') else {
        return false;
    };
    let mut depth = 0usize;
    for (offset, character) in signature[open..].char_indices() {
        match character {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return !signature[open + 1..open + offset].trim().is_empty();
                }
            }
            _ => {}
        }
    }
    // Unbalanced brackets: malformed rather than argument-free. Complaining here would be a second
    // sentence about one defect, and the name and doc checks above already have it.
    false
}

/// Whether each entry documents any argument at all, keyed by the identity it belongs to.
///
/// Folded across an entry's signatures, because an overload group legitimately contains a nullary
/// shape beside one that takes a path — `listDir()` and `listDir(String)` are one capability, and it
/// takes an argument.
fn documented_arguments(
    language: &'static dyn ProgramLanguage,
) -> BTreeMap<(Option<&'static str>, &'static str), bool> {
    let mut out = BTreeMap::new();
    for spelling in spellings(language) {
        let documented = spelling
            .signatures
            .iter()
            .any(|entry| !entry.parameters.is_empty());
        *out.entry((spelling.object, spelling.key)).or_default() |= documented;
    }
    out
}

/// One entry's spellings, beside the identity they belong to, so a complaint can name both.
struct Spelling {
    /// The object it hangs off — identity, and here only so a complaint can qualify the name.
    /// `None` for a [meta](Section::Meta) function, which hangs off every object rather than one.
    object: Option<&'static str>,
    /// The name a program calls it by.
    name: &'static str,
    /// Every shape this language's SDK declares it in. Never compared across languages — the count
    /// is idiom — and checked one by one within a language.
    signatures: &'static [SignatureEntry],
    /// The documentation paragraph a lookup renders.
    doc: &'static str,
    /// The language-independent key the spelling belongs to.
    key: &'static str,
}

/// Every catalogue entry's [spellings](Spelling), across all six function-carrying sections.
fn spellings(language: &'static dyn ProgramLanguage) -> Vec<Spelling> {
    let catalogue = language.catalogue();
    let mut out: Vec<Spelling> = catalogue
        .meta
        .iter()
        .map(|e| Spelling {
            object: None,
            name: e.name.as_str(),
            signatures: e.signatures.as_slice(),
            doc: e.doc.as_str(),
            key: e.key.as_str(),
        })
        .collect();
    out.extend(catalogue.session.iter().map(|e| Spelling {
        object: Some(e.object.as_str()),
        name: e.name.as_str(),
        signatures: e.signatures.as_slice(),
        doc: e.doc.as_str(),
        key: e.key.as_str(),
    }));
    out.extend(catalogue.views.iter().map(|e| Spelling {
        object: Some(e.object.as_str()),
        name: e.name.as_str(),
        signatures: e.signatures.as_slice(),
        doc: e.doc.as_str(),
        key: e.key.as_str(),
    }));
    out.extend(catalogue.programs.iter().map(|e| Spelling {
        object: Some(e.object.as_str()),
        name: e.name.as_str(),
        signatures: e.signatures.as_slice(),
        doc: e.doc.as_str(),
        key: e.key.as_str(),
    }));
    // A tool's identity is its own gg tool name, which is why it alone carries no separate `key`.
    out.extend(catalogue.tools.iter().map(|e| Spelling {
        object: Some(e.object.as_str()),
        name: e.name.as_str(),
        signatures: e.signatures.as_slice(),
        doc: e.doc.as_str(),
        key: e.tool.as_str(),
    }));
    out.extend(catalogue.helpers.iter().map(|e| Spelling {
        object: Some(e.object.as_str()),
        name: e.name.as_str(),
        signatures: e.signatures.as_slice(),
        doc: e.doc.as_str(),
        key: e.key.as_str(),
    }));
    out
}

/// The comparative half: `language` offers exactly the capabilities `reference` does.
fn agrees_with(
    reference: &'static dyn ProgramLanguage,
    language: &'static dyn ProgramLanguage,
    out: &mut Vec<Disagreement>,
) {
    let name = language.display_name();
    let theirs = identities(reference);
    let ours = identities(language);

    for identity in ours.iter().filter(|i| !theirs.contains(i)) {
        out.push(Disagreement {
            language: name,
            detail: format!(
                "offers `{identity}`, which {} does not",
                reference.display_name()
            ),
        });
    }
    for identity in theirs.iter().filter(|i| !ours.contains(i)) {
        out.push(Disagreement {
            language: name,
            detail: format!(
                "does not offer `{identity}`, which {} does",
                reference.display_name()
            ),
        });
    }

    // Whether an entry takes arguments at all. How many there are, what they are called and how they
    // are passed are the language's own — but a capability that needs a path needs one in every
    // language, so an arm documenting arguments for `fs.read_file` and an arm documenting none are
    // not two spellings of one surface: a model reads what to put in the call on one arm and guesses
    // on the other, which is a difference in surface in the middle of a study measuring the language.
    // It is also the check that covers what `declares_arguments` cannot see: a reflector for a
    // language whose signature notation has no bracket, emitting an empty `parameters` for
    // everything, passes the internal half and fails here.
    let theirs_arguments = documented_arguments(reference);
    for ((object, key), mine) in documented_arguments(language) {
        // Absent means the reference arm does not offer this identity at all, which the comparison
        // above has already said in the sentence that diagnoses it.
        let Some(yours) = theirs_arguments.get(&(object, key)).copied() else {
            continue;
        };
        if mine != yours {
            let (here, there) = if mine {
                ("arguments", "none")
            } else {
                ("no arguments", "some")
            };
            out.push(Disagreement {
                language: name,
                detail: format!(
                    "documents {here} for `{}`, where {} documents {there}",
                    qualified(object, key),
                    reference.display_name()
                ),
            });
        }
    }

    // The objects, and how many functions hang off each. Implied by the identity comparison above,
    // and stated separately because it is the failure a *renamed* object produces, and "`fs` has 12
    // functions here and 0 there" is the sentence that diagnoses it.
    let theirs = objects(&theirs);
    let ours = objects(&ours);
    for object in theirs.keys().chain(ours.keys()).collect::<BTreeSet<_>>() {
        let (mine, yours) = (
            ours.get(object).copied().unwrap_or_default(),
            theirs.get(object).copied().unwrap_or_default(),
        );
        if mine != yours {
            out.push(Disagreement {
                language: name,
                detail: format!(
                    "groups {mine} function(s) under `{object}` where {} groups {yours}",
                    reference.display_name()
                ),
            });
        }
    }
}

/// How many functions hang off each object.
///
/// A [meta](Section::Meta) function counts against none of them: it is bound on every object equally,
/// so counting it would add one to each and say nothing.
fn objects(identities: &[Identity]) -> BTreeMap<&str, usize> {
    let mut out: BTreeMap<&str, usize> = BTreeMap::new();
    for identity in identities {
        if let Some(object) = identity.object.as_deref() {
            *out.entry(object).or_default() += 1;
        }
    }
    out
}

#[cfg(test)]
#[path = "agreement.test.rs"]
mod tests;
