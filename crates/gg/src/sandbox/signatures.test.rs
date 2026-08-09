//! Tests for the committed signature catalogue the [docs carve-out](crate::docs) reads.
//!
//! What these guard is subtle but expensive to get wrong: the catalogue is the *only* description of
//! this API a model ever sees, served on demand through `fn.docs()`. A catalogue that has drifted
//! from the guest does not fail loudly — it hands a model a signature that does not exist, and every
//! program it writes against it is wrong in a way it cannot diagnose.

use test_cabinet_core::gg::GgProgramLanguage;

use super::*;
use crate::sandbox::FINISH_FUNCTION;
use crate::sandbox::language;
use crate::tools::ALL_TOOL_NAMES;

/// The language whose committed catalogue these cases read: **TypeScript's**, named explicitly.
///
/// Every expectation below is a spelling — `readFile`, `requestChanges`, `interface DirEntry` — and
/// a spelling is exactly what the [seam](crate::sandbox::ProgramLanguage) declares free to differ
/// between languages. So these are assertions about TypeScript's SDK, and they say so, rather than
/// about whichever language happens to be gg's default.
///
/// What is *not* here is anything that must hold for **every** registered language, or that compares
/// two languages: the tool bijection, the type closure, the ending vocabulary, the gates and the
/// spelling-uniqueness rules all live in the [agreement gate](crate::sandbox::language) now, stated
/// once and applied to every language there is.
fn typescript() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::TypeScript)
}

/// TypeScript's committed catalogue.
fn catalogue() -> &'static SignatureCatalogue {
    typescript().catalogue()
}

/// The one way a TypeScript function may be called.
///
/// TypeScript spells every optional argument with `?`, so each of its entries carries exactly one
/// signature — the assertion is here rather than left implicit, because an entry that quietly grew a
/// second shape would otherwise have the expectations below read only its first.
fn sole(signatures: &[SignatureEntry]) -> &str {
    let [entry] = signatures else {
        panic!("TypeScript offers one shape per function, and this one has {signatures:?}")
    };
    entry.signature.as_str()
}

/// The committed catalogue parses, is not empty, and says whose it is.
#[test]
fn the_committed_catalogue_parses() {
    let catalogue = catalogue();
    assert!(!catalogue.tools.is_empty());
    assert!(!catalogue.types.is_empty());
    assert!(
        !catalogue.generated_from.is_empty(),
        "the catalogue records where it was generated from"
    );
    assert_eq!(
        catalogue.language,
        typescript().id(),
        "a catalogue records the language it was generated for, and the language that embedded it \
         checks it got its own"
    );
}

/// **Every function that is not a gg tool carries a `key`.**
///
/// A tool's identity is its gg tool name; the carve-outs have none, so the key is the only thing
/// that says a second language's `request_changes` and this one's `requestChanges` are one function.
/// Without it the surfaces of two languages could only be compared by spelling, which is precisely
/// the thing a cross-language study leaves free to differ.
#[test]
fn every_carve_out_entry_carries_an_identity() {
    let catalogue = catalogue();
    let keys = catalogue
        .session
        .iter()
        .map(|entry| (entry.key.as_str(), entry.name.as_str()))
        .chain(
            catalogue
                .views
                .iter()
                .map(|entry| (entry.key.as_str(), entry.name.as_str())),
        )
        .chain(
            catalogue
                .programs
                .iter()
                .map(|entry| (entry.key.as_str(), entry.name.as_str())),
        )
        .chain(
            catalogue
                .helpers
                .iter()
                .map(|entry| (entry.key.as_str(), entry.name.as_str())),
        );

    let mut seen: Vec<&str> = Vec::new();
    for (key, name) in keys {
        assert!(!key.is_empty(), "`{name}` has no identity of its own");
        assert!(
            !seen.contains(&key),
            "two functions claim the identity `{key}`"
        );
        seen.push(key);
    }

    // The projection the docs runtime reads carries a tool's identity too — its own gg tool name,
    // which is why a tool needs no separate key.
    let functions = catalogue_functions(typescript());
    let read = functions
        .iter()
        .find(|function| function.name == "readFile")
        .expect("readFile is documented");
    assert_eq!(read.key, "read_file");
    let request_changes = functions
        .iter()
        .find(|function| function.name == "requestChanges")
        .expect("requestChanges is documented");
    assert_eq!(request_changes.key, "request_changes");
}

/// `readTextFile` is a **helper**, not a gg tool: it wraps `read_file` for the common case, and
/// listing it among the tools would put a name in the model's head that no capability controls.
#[test]
fn read_text_file_is_a_helper_not_a_tool() {
    assert!(
        catalogue()
            .tools
            .iter()
            .all(|entry| entry.name != "readTextFile"),
        "the helper is listed as a tool"
    );
    let helper = catalogue()
        .helpers
        .iter()
        .find(|helper| helper.name == "readTextFile")
        .expect("the helper is catalogued");
    assert_eq!(
        helper.requires, "read_file",
        "the helper is bound only when the tool it wraps is"
    );
}

/// **TypeScript spells its four ending calls the way its SDK declares them**, on the objects gg
/// groups them under.
///
/// That every language carries these four, tagged with the [role](crate::ending::EndingRole) whose
/// programs bind it, is the [agreement gate](crate::sandbox::language)'s to assert — it is identity,
/// and it holds for a language nobody has written yet. What is left here is the half that is
/// TypeScript's alone: the exact signature a doc lookup renders, which is prompt text a model reads
/// and acts on, and the object each call hangs off, which the console groups by.
///
/// The `void` in each signature is load-bearing: it tells a model at a glance that the call returns
/// like any other, so what follows it still runs.
#[test]
fn typescript_spells_its_ending_calls_as_its_sdk_declares_them() {
    let by_name = |name: &str| {
        catalogue()
            .session
            .iter()
            .find(|entry| entry.name == name)
            .unwrap_or_else(|| panic!("`{name}` is catalogued"))
    };

    let finish = by_name(FINISH_FUNCTION);
    assert_eq!(finish.object, "harness");
    assert_eq!(finish.ending, "standard");
    assert_eq!(sole(&finish.signatures), "finish(summary: string): void");

    let approve = by_name("approve");
    assert_eq!(approve.object, "review");
    assert_eq!(approve.ending, "review");
    assert_eq!(sole(&approve.signatures), "approve(): void");

    let request_changes = by_name("requestChanges");
    assert_eq!(request_changes.object, "review");
    assert_eq!(request_changes.ending, "review");
    assert_eq!(
        sole(&request_changes.signatures),
        "requestChanges(items: string[]): void"
    );

    // Every entry documents itself: the doc is what a `.docs()` lookup renders verbatim.
    for entry in &catalogue().session {
        assert!(
            entry.doc.contains("ends your session") || entry.doc.contains("End your session"),
            "`{}` does not say that it ends the session: {}",
            entry.name,
            entry.doc
        );
    }
}

/// **TypeScript's `view` object is the five functions its SDK declares, spelled as it declares
/// them.**
///
/// Which functions the object carries and what gates them is identity — a file view is a read
/// whatever language asks for it — and the [agreement gate](crate::sandbox::language) asserts that
/// for every language, including the ones with no committed component yet. What stays here is
/// TypeScript's own spelling of them, and the count, which is this SDK's surface rather than a rule
/// about surfaces.
#[test]
fn typescript_spells_its_view_calls_as_its_sdk_declares_them() {
    let by_name = |name: &str| {
        catalogue()
            .views
            .iter()
            .find(|entry| entry.name == name)
            .unwrap_or_else(|| panic!("`{name}` is catalogued"))
    };

    let open_file = by_name("openFile");
    assert_eq!(open_file.object, "view");
    assert_eq!(
        open_file.requires.as_deref(),
        Some("read_file"),
        "opening a file view is a read, and closes with reading"
    );

    for name in ["openText", "openDocsView", "close", "current"] {
        let entry = by_name(name);
        assert_eq!(entry.object, "view");
        assert!(
            entry.requires.is_none(),
            "`{name}` is bound whatever a run enables"
        );
    }

    assert_eq!(
        catalogue().views.len(),
        5,
        "the view surface is the five functions and nothing else"
    );

    // The projection the docs runtime reads carries the same gates, which is what makes a withheld
    // `read_file` withhold `view.openFile`'s *documentation* as well as the function.
    let functions = catalogue_functions(typescript());
    let projected = |name: &str| {
        functions
            .iter()
            .find(|function| function.name == name)
            .unwrap_or_else(|| panic!("`{name}` is documented"))
    };
    assert_eq!(projected("openFile").gate, Some("read_file"));
    assert_eq!(projected("openFile").object, "view");
    assert!(projected("openText").gate.is_none());
    assert!(projected("openText").ending.is_none());
    assert!(!projected("current").prose.brief.is_empty());
}

/// **`finish` is not a gg tool, and no gg tool is called `finish`.**
///
/// Two vocabularies share one namespace — a program's scope — and the sandbox binds them from
/// different places: the tools from the run's enabled set, `finish` unconditionally. If they ever
/// collided, one would silently shadow the other in every program, and which one won would depend on
/// bind order rather than on anything anyone decided.
#[test]
fn no_gg_tool_binds_the_name_finish() {
    assert!(
        !ALL_TOOL_NAMES.contains(&FINISH_FUNCTION),
        "`{FINISH_FUNCTION}` is not a gg tool: no capability offers it and nothing dispatches it"
    );
    for entry in &catalogue().tools {
        assert_ne!(
            entry.name, FINISH_FUNCTION,
            "the gg tool `{}` binds the name the session function needs",
            entry.tool
        );
    }
    for helper in &catalogue().helpers {
        assert_ne!(
            helper.name, FINISH_FUNCTION,
            "a helper binds the name the session function needs"
        );
    }
}
/// The documentation directory the [docs carve-out](crate::docs) reads carries, for each function,
/// the object it lives on and the gg tool that gates it — `None` for a carve-out always bound.
#[test]
fn catalogue_functions_carry_object_and_gate() {
    let functions = catalogue_functions(typescript());

    // `finish` is always bound (no gate) and lives on `harness`.
    let finish = functions
        .iter()
        .find(|function| function.name == "finish")
        .expect("finish is documented");
    assert_eq!(finish.object, "harness");
    assert!(
        finish.gate.is_none(),
        "finish is not gated by any capability"
    );

    // A tool is gated by its own gg tool name and grouped under its object.
    let read = functions
        .iter()
        .find(|function| function.name == "readFile")
        .expect("readFile is documented");
    assert_eq!(read.object, "fs");
    assert_eq!(read.gate, Some("read_file"));
    assert!(
        !read.prose.brief.is_empty(),
        "every function carries a brief"
    );

    // The helper is gated by the tool it wraps, and lives on that tool's object.
    let helper = functions
        .iter()
        .find(|function| function.name == "readTextFile")
        .expect("readTextFile is documented");
    assert_eq!(helper.object, "fs");
    assert_eq!(helper.gate, Some("read_file"));
}

/// A type's declaration is returned verbatim, so what a doc lookup shows is what the SDK wrote — and
/// a type the catalogue does not carry is `None` rather than a fabricated declaration.
#[test]
fn type_declaration_returns_the_sdks_own_declaration() {
    let dir_entry = type_declaration(typescript(), "DirEntry").expect("DirEntry is declared");
    assert!(dir_entry.declaration.contains("interface DirEntry"));
    // And it arrives explained, member by member: a declaration alone says what fields a value has
    // and nothing about what any of them means.
    assert!(!dir_entry.doc.trim().is_empty());
    assert_eq!(
        dir_entry
            .members
            .iter()
            .map(|member| member.name.as_str())
            .collect::<Vec<_>>(),
        ["name", "kind"]
    );
    for member in &dir_entry.members {
        assert!(
            !member.doc.trim().is_empty(),
            "`DirEntry.{}` came out undocumented",
            member.name
        );
    }
    assert!(type_declaration(typescript(), "NoSuchType").is_none());
}

/// **The picture channel the catalogue describes is the one gg implements.**
///
/// These two docs are the only place a code-mode model can learn how looking at an image works
/// before it tries, and they used to contradict both gg and each other: `fs.readFile` promised that
/// "an image's pixels are shown to you" one sentence before saying `view.openFile` is the call that
/// shows a file. A model that reads the first half calls `readFile` on a reference mockup and then
/// reasons about a picture it was never shown — the exact misconception the one-channel rule exists
/// to prevent, delivered by gg's own documentation.
///
/// A doc string cannot be type-checked against behaviour, so this pins the two claims that matter:
/// a bare read does not show, and a view can be refused.
#[test]
fn the_catalogue_tells_the_truth_about_pictures() {
    let read = catalogue()
        .tools
        .iter()
        .find(|entry| entry.name == "readFile")
        .expect("readFile is catalogued");
    assert!(
        !read.doc.contains("pixels are shown to you"),
        "`fs.readFile` must not promise a picture it does not show: {}",
        read.doc
    );
    assert!(
        read.doc.contains("does not show it to YOU"),
        "`fs.readFile` must say plainly that reading an image does not show it: {}",
        read.doc
    );
    assert!(
        read.doc.contains("view.openFile"),
        "`fs.readFile` must name the call that does show it: {}",
        read.doc
    );

    let open_file = catalogue()
        .views
        .iter()
        .find(|entry| entry.name == "openFile")
        .expect("openFile is catalogued");
    // STALE PROSE, HELD DELIBERATELY. `SandboxLimits::image_view_cap` and its per-agent
    // `imageViewCap` param are gone — nothing refuses an image view for being the n-th one any
    // more — so these two assertions now hold every arm to a promise the host no longer keeps. They
    // stay because a catalogue cannot be hand-edited (contract-drift regenerates it from SDK
    // source), so retiring the promise is a change to ten SDK source trees: stage 4 of the
    // documentation plan, which rewrites each arm's prose anyway. Until then this is a *marker* for
    // where the lie is, not a live contract — and its failure on that commit is the expected signal
    // that the prose was finally fixed, at which point both assertions are deleted rather than
    // inverted. The same sentence sits in `crates/backend/src/gg_reference.json`, which is likewise
    // regenerated rather than authored.
    assert!(
        open_file.doc.contains("imageViewCap"),
        "`view.openFile` must name the cap an operator configures: {}",
        open_file.doc
    );
    assert!(
        open_file.doc.contains("limit-exceeded") && open_file.doc.contains("view.close"),
        "`view.openFile` must say how the cap fails and how to recover from it: {}",
        open_file.doc
    );
}

// ---------------------------------------------------------------------------------------------
// The two schemas
//
// What follows is about the doc model rather than about TypeScript: that a catalogue says which
// shape it is written in, that both shapes parse, and — the load-bearing one — that a consumer
// reading either through `catalogue_functions` cannot tell which it was handed. That last property
// is what makes converting one arm per commit possible, so it is asserted against a matched pair of
// fixtures rather than inferred from the two halves working separately.
// ---------------------------------------------------------------------------------------------

use super::fixture;

/// **Every committed catalogue is still v1 today.**
///
/// Stated rather than assumed, because it is what makes every "inert below v2" claim in the gates a
/// claim about the tree that exists. When an arm is converted this test is the first thing to say
/// so, and its failure is the signal to move that arm's name into the converted list rather than a
/// defect.
#[test]
fn every_registered_arm_is_still_written_in_the_first_schema() {
    for language in language::all_languages() {
        assert_eq!(
            language.catalogue().schema,
            SchemaVersion::V1,
            "{} has been converted — the gates that are inert below v2 now apply to it",
            language.display_name()
        );
    }
}

/// **A catalogue declares which schema it is written in, and the absence of the key means the first
/// one** — the only honest reading of an artifact written before the key existed.
#[test]
fn a_catalogue_declares_its_schema_and_absence_means_the_first() {
    assert_eq!(fixture::v1().schema, SchemaVersion::V1);
    assert_eq!(fixture::v2().schema, SchemaVersion::V2);
    assert!(
        !fixture::V1.contains("\"schema\""),
        "the v1 fixture is the shape that predates the key, and must not declare one"
    );
}

/// **A schema this gg does not know is refused, not rounded down to one it does.**
///
/// A catalogue from a newer gg describes a surface this one cannot render, and rendering it as
/// whichever shape happens to parse is how a model is handed a signature nobody wrote.
#[test]
fn a_schema_from_a_newer_gg_is_refused() {
    let ahead = fixture::V2.replacen("\"schema\": 2", "\"schema\": 3", 1);
    let error = SignatureCatalogue::parse(&ahead).expect_err("schema 3 is not readable here");
    assert!(
        error.to_string().contains("schema"),
        "the refusal says which key it is about: {error}"
    );
}

/// **One surface written in either schema projects the same way.**
///
/// This is the property the whole version dispatch exists for. The two fixtures describe the same
/// four calls — same identities, same gates, same prose, same shapes — and every field a consumer
/// routes, gates or renders on comes out equal, so a converted arm is not a different arm.
#[test]
fn one_surface_written_in_either_schema_projects_the_same_way() {
    let old = super::functions_of(fixture::v1());
    let new = super::functions_of(fixture::v2());
    assert_eq!(
        old.len(),
        new.len(),
        "the two fixtures describe one surface"
    );

    for (old, new) in old.iter().zip(&new) {
        assert_eq!(old.key, new.key, "identity is the same in either schema");
        assert_eq!(old.name, new.name);
        assert_eq!(old.gate, new.gate, "`{}` is gated the same way", old.key);
        assert_eq!(old.ending, new.ending);
        assert_eq!(old.capability, new.capability);
        assert_eq!(
            old.prose.brief, new.prose.brief,
            "`{}`'s brief is the same line the transitional split recovers",
            old.key
        );
        assert_eq!(old.prose.detail, new.prose.detail);
        assert_eq!(
            old.prose.rendered(),
            new.prose.rendered(),
            "`{}` reads identically in a documentation view",
            old.key
        );
        assert_eq!(
            old.signatures.len(),
            new.signatures.len(),
            "the shape of a call was never the thing that needed normalizing"
        );
    }
}

/// **A v2 entry carries what a v1 entry structurally cannot**, and the projection says so rather
/// than inventing it: a name, a module, an operation and a return position.
#[test]
fn a_v2_entry_carries_the_identity_a_v1_entry_has_nowhere_to_put() {
    let old = super::functions_of(fixture::v1());
    for function in &old {
        assert!(function.fqn.is_none(), "a v1 entry has no name of its own");
        assert!(function.module.is_none());
        assert!(function.operation.is_none());
        assert!(
            function.returns.is_empty(),
            "a v1 catalogue records no return position, which is why the depth-one rule has to \
             sort returns from arguments by elimination"
        );
    }

    let new = super::functions_of(fixture::v2());
    let read = new
        .iter()
        .find(|function| function.name == "read_file")
        .expect("the fixture reads files");
    assert_eq!(read.fqn, Some("gg::files::read_file"));
    assert_eq!(read.module, Some("files"));
    assert_eq!(read.operation, Some("files.read_file"));
    assert_eq!(read.kind, EntryKind::Function);
    assert!(read.receiver.is_none());
    assert_eq!(
        read.returns
            .iter()
            .map(TypeReference::fqn)
            .collect::<Vec<_>>(),
        ["gg::files::FileRead"]
    );

    // The one entry whose idiomatic shape is a member: the receiver is recorded, and it is what
    // adds the third segment to the name.
    let close = new
        .iter()
        .find(|function| function.name == "close")
        .expect("the fixture closes views");
    assert_eq!(close.kind, EntryKind::Method);
    assert_eq!(close.receiver, Some("OpenView"));
    assert_eq!(close.fqn, Some("gg::views::OpenView::close"));
}

/// **A v2 entry's gate is gg's own**, synthesized from the operation it names rather than read out
/// of the artifact — which is why the schema has no field for one.
///
/// All four kinds of binding are exercised, because the failure worth catching is a projection that
/// gets one of them right and silently answers `None` for the rest.
#[test]
fn the_gate_of_a_v2_entry_is_synthesized_from_ggs_own_table() {
    let functions = super::functions_of(fixture::v2());
    let by_name = |name: &str| {
        functions
            .iter()
            .find(|function| function.name == name)
            .unwrap_or_else(|| panic!("`{name}` is in the fixture"))
    };

    // A tool.
    assert_eq!(by_name("read_file").gate, Some("read_file"));
    // An ending, whose role gg names.
    assert_eq!(by_name("finish").ending, Some("standard"));
    assert!(by_name("finish").gate.is_none());
    // A capability, whose id no catalogue ever learns.
    assert_eq!(
        by_name("get").capability,
        Some(test_cabinet_core::gg::CAPABILITY_PROGRAM_LIBRARY)
    );
    // And an unconditional one: bound to every program whatever a run enables.
    let close = by_name("close");
    assert!(close.gate.is_none() && close.ending.is_none() && close.capability.is_none());

    // The `V2` fixture never says any of that: the JSON carries an operation id and no gate at all.
    assert!(!fixture::V2.contains("\"requires\""));
    assert!(!fixture::V2.contains("\"ending\""));
}

/// **An operation named on the declaration resolves to gg's row for it**, which is the join a
/// converted arm uses in place of the `(object, key)` pair.
#[test]
fn a_v2_entry_resolves_to_its_operation_by_id() {
    let functions = super::functions_of(fixture::v2());
    let read = functions
        .iter()
        .find(|function| function.name == "read_file")
        .expect("the fixture reads files");
    let operation = crate::sandbox::operation_of(read).expect("gg has a row for it");
    assert_eq!(operation.id.namespace, "files");
    assert_eq!(operation.id.key, "read_file");
}

/// **A module is read the same way in either schema**, and a v1 catalogue's API objects are
/// projected as the modules they are — path and id both the object's own name, because that is the
/// most identity an unconverted arm has.
#[test]
fn modules_are_read_the_same_way_in_either_schema() {
    let old = super::modules_of(fixture::v1());
    assert_eq!(
        old.iter().map(|module| module.path).collect::<Vec<_>>(),
        ["fs", "view", "harness", "programs"]
    );
    assert!(old.iter().all(|module| module.id == module.path));
    assert!(
        old.iter().all(|module| module.import.is_none()),
        "a v1 catalogue has nowhere to record an import line"
    );

    let new = super::modules_of(fixture::v2());
    assert_eq!(
        new.iter().map(|module| module.path).collect::<Vec<_>>(),
        ["gg::files", "gg::views", "gg::session", "gg::programs"]
    );
    assert_eq!(
        new.iter().map(|module| module.id).collect::<Vec<_>>(),
        ["files", "views", "session", "programs"],
        "the id is gg's cross-arm vocabulary and the path is the arm's own spelling"
    );
    assert_eq!(
        new.iter()
            .find(|module| module.id == "programs")
            .map(|module| module.import),
        Some(Some("use gg::programs;")),
        "the one arm that writes a real import line has somewhere to say so"
    );
}

/// **A brief is the first LINE, never the first sentence** — the defect that made the old
/// derivation wrong in any language.
///
/// A period followed by a newline is not a sentence end, so a first-sentence rule ran on past the
/// paragraph break and swallowed the paragraph after it. Measured on today's committed catalogues,
/// that is every one of the eight arms whose docs have paragraph breaks.
#[test]
fn a_brief_is_the_first_line_and_never_the_first_sentence() {
    let doc = "Run a command. A non-zero exit is not a failure.\n\nRead the exit code instead.";
    let prose = Prose::from_paragraph(doc);
    assert_eq!(
        prose.brief,
        "Run a command. A non-zero exit is not a failure."
    );
    assert_eq!(prose.detail, Some("Read the exit code instead."));
    assert_eq!(
        prose.rendered(),
        doc,
        "a v1 paragraph is rendered back verbatim, so nothing a model already reads moves"
    );

    // And a paragraph with no break at all is a brief that is the whole of it, which reads as *this
    // arm has not authored a brief yet* rather than as a line cut short mid-code-span.
    let flowing = Prose::from_paragraph("Read a file, returning either `text` or `image`.");
    assert_eq!(
        flowing.brief,
        "Read a file, returning either `text` or `image`."
    );
    assert!(flowing.detail.is_none());
}

/// **An authored brief and detail render as one block**, with the blank line between them a
/// documentation view needs and a v1 paragraph already had.
#[test]
fn authored_prose_renders_as_one_block() {
    let authored = Prose::of(Some("Read a file."), Some("Narrow it before use."), "");
    assert_eq!(authored.rendered(), "Read a file.\n\nNarrow it before use.");

    let brief_only = Prose::of(Some("Read a file."), None, "");
    assert_eq!(brief_only.rendered(), "Read a file.");

    // An authored brief wins over a `doc` that is not there to be split, which is what stops a v2
    // entry that forgot its brief from being handed a plausible-looking one.
    let empty = Prose::of(Some(""), None, "Read a file.\n\nNarrow it.");
    assert_eq!(
        empty.brief, "",
        "an absent brief stays absent, and the gate names it"
    );
}

/// **A type reference carries the resolved name and the written spelling**, and says which is which
/// even when an arm has only one of them.
#[test]
fn a_type_reference_carries_both_the_spelling_and_the_resolution() {
    let bare = TypeReference::Bare("FileRead".to_string());
    assert_eq!(bare.fqn(), "FileRead");
    assert_eq!(
        bare.spelled(),
        "FileRead",
        "an arm that resolved nothing records the same string twice, which is truthful rather than \
         a claim to have resolved it"
    );

    let read = super::functions_of(fixture::v2())
        .into_iter()
        .find(|function| function.name == "read_file")
        .expect("the fixture reads files");
    let [reference] = read.types else {
        panic!("the fixture's read names one type: {:?}", read.types)
    };
    assert_eq!(reference.spelled(), "FileRead", "what the signature writes");
    assert_eq!(
        reference.fqn(),
        "gg::files::FileRead",
        "what a documentation view is opened by"
    );
}

/// **A type declaration reads the same way in either schema**, and a converted one carries the name
/// it is opened by, the module it belongs to and the shape of each member.
#[test]
fn a_type_is_read_the_same_way_in_either_schema() {
    let old = fixture::v1()
        .types
        .iter()
        .find(|declaration| declaration.name == "FileRead")
        .expect("the v1 fixture declares it");
    let new = fixture::v2()
        .types
        .iter()
        .find(|declaration| declaration.name == "FileRead")
        .expect("the v2 fixture declares it");

    assert_eq!(old.prose().brief, new.prose().brief);
    assert_eq!(old.prose().detail, new.prose().detail);
    assert_eq!(old.prose().rendered(), new.prose().rendered());
    assert!(old.fqn.is_none() && old.module.is_none());
    assert_eq!(new.fqn.as_deref(), Some("gg::files::FileRead"));
    assert_eq!(new.module.as_deref(), Some("files"));

    // A member's shape is stated where the catalogue states it and derived where it does not, and
    // the two agree: an arm of a union carries no type of its own, because the arm is the value.
    for (old, new) in old.members.iter().zip(&new.members) {
        assert_eq!(old.kind(), new.kind());
        assert_eq!(old.kind(), MemberKind::Variant);
        assert_eq!(old.prose().brief, new.prose().brief);
    }

    // And a converted type carries the menu of what can be done with a value of it, which is what
    // makes opening a function's return type land the model somewhere useful.
    let view = fixture::v2()
        .types
        .iter()
        .find(|declaration| declaration.name == "OpenView")
        .expect("the v2 fixture declares it");
    assert_eq!(
        view.member_functions
            .iter()
            .map(|member| member.fqn.as_str())
            .collect::<Vec<_>>(),
        ["gg::views::OpenView::close"]
    );
}
