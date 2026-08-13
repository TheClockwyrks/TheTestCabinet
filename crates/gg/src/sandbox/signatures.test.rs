//! Tests for the signature catalogue the [docs carve-out](crate::docs) reads.
//!
//! What these guard is subtle but expensive to get wrong: the catalogue is the *only* description of
//! this API a model ever sees, served on demand through `fn.docs()`. A catalogue that describes
//! something the guest does not offer does not fail loudly — it hands a model a signature that does
//! not exist, and every program it writes against it is wrong in a way it cannot diagnose.
//!
//! It is reflected out of the SDK by `crates/gg/build.rs` on the build that compiles this crate, so
//! it cannot be *stale* — but it can be *mis-reflected*, and these read the emitted document rather
//! than the SDK for exactly that reason. There is no committed copy anybody reviewed on the way in.

use test_cabinet_core::gg::{CAPABILITY_READ_FILE, GgProgramLanguage};

use super::*;
use crate::sandbox::FINISH_FUNCTION;
use crate::sandbox::language;
use crate::tools::ALL_TOOL_NAMES;

/// The language whose catalogue these cases read: **TypeScript's**, named explicitly.
///
/// Every expectation below is a spelling — `readFile`, `requestChanges`, `interface DirEntry` — and
/// a spelling is exactly what the [seam](crate::sandbox::ProgramLanguage) declares free to differ
/// between languages. So these are assertions about TypeScript's SDK, and they say so, rather than
/// about whichever language happens to be gg's default.
///
/// What is *not* here is anything that must hold for **every** registered language: capability
/// coverage, the gating vocabulary, whether a call takes input at all and the spelling-uniqueness
/// rules all live in the [capability gate](crate::sandbox::language) now, stated once against gg's
/// own operations table and applied to every language there is.
fn typescript() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::TypeScript)
}

/// TypeScript's catalogue, as its build reflected it.
fn catalogue() -> &'static SignatureCatalogue {
    typescript().catalogue()
}

/// TypeScript's surface as every consumer reads it — the projection of its catalogue.
///
/// The expectations below are about spellings, and a spelling is a property of an *entry* rather
/// than of how the artifact is laid out. So the lookups here go through the projection, and a
/// reshaping of the arm's SDK moves what they say rather than which field they read.
fn functions() -> Vec<CatalogueFunction> {
    catalogue_functions(typescript())
}

/// One projected function by the name a program calls it by, which must name exactly one.
///
/// A bare name is unique across this SDK only by accident, and it stopped being so: `close` is
/// `gg.views.close` and `gg.docs.close`, because gg files a documentation view's removal under its
/// own object and the SDK spells each of them the way its operation key does. So a lookup that
/// silently took the first match would quietly re-aim an expectation at the wrong module rather than
/// fail — use [`member`] wherever a name is shared.
fn function(name: &str) -> CatalogueFunction {
    let matched: Vec<CatalogueFunction> = functions()
        .into_iter()
        .filter(|function| function.name == name)
        .collect();
    match <[CatalogueFunction; 1]>::try_from(matched) {
        Ok([function]) => function,
        Err(matched) => panic!(
            "`{name}` names {} catalogued functions ({:?}), so it has to be looked up by module",
            matched.len(),
            matched.iter().map(|f| f.object).collect::<Vec<_>>()
        ),
    }
}

/// One projected function by the module it is declared in and the name it is called by.
fn member(object: &str, name: &str) -> CatalogueFunction {
    functions()
        .into_iter()
        .find(|function| function.object == object && function.name == name)
        .unwrap_or_else(|| panic!("`{object}.{name}` is catalogued"))
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

/// The generated catalogue parses, is not empty, and says whose it is.
#[test]
fn the_generated_catalogue_parses() {
    let catalogue = catalogue();
    assert!(!functions().is_empty());
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

/// **Every function that is not a gg tool carries a `key`, and no two claim one identity.**
///
/// A tool's identity is its gg tool name; the carve-outs have none, so the key is the only thing
/// that says a second language's `request_changes` and this one's `requestChanges` are one function.
/// Without it the surfaces of two languages could only be compared by spelling, which is precisely
/// the thing a cross-language study leaves free to differ.
///
/// The identity is the **pair** — the grouping and the key — which is what
/// [the search index files an entry under](crate::docs::DocsRuntime) and what gg's operation ids
/// are built from. The key alone was unique only for as long as no two groupings shared one word,
/// and `close` is now `gg.views.close` and `gg.docs.close`: taking a documentation view out of the
/// window is bought by a capability and taking any other view out is not, so they are two
/// operations, and a rule reading half of an identity would have called them one.
///
/// Asked of every projected function rather than of a section: this arm files every call in one
/// array, and the identity rule is not about which section an entry sits in.
#[test]
fn every_carve_out_entry_carries_an_identity() {
    let mut seen: Vec<(&str, &str)> = Vec::new();
    for function in functions() {
        assert!(
            !function.key.is_empty(),
            "`{}` has no identity of its own",
            function.name
        );
        // An alias is a second binding of one identity, which is exactly what it is for, so it is
        // the canonical bindings that must be distinct.
        if function.alias_of.is_some() {
            continue;
        }
        let identity = (function.object, function.key);
        assert!(
            !seen.contains(&identity),
            "two functions claim the identity `{}.{}`",
            function.object,
            function.key
        );
        seen.push(identity);
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
    let helper = function("readTextFile");
    assert!(
        !ALL_TOOL_NAMES.contains(&helper.key),
        "the helper claims the identity of a gg tool: `{}`",
        helper.key
    );
    assert_eq!(
        helper.capability,
        Some(CAPABILITY_READ_FILE),
        "the helper is bought by the capability the read it wraps is bought by"
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
    let finish = function(FINISH_FUNCTION);
    assert_eq!(finish.object, "gg.session");
    assert_eq!(finish.ending, Some("standard"));
    assert_eq!(sole(finish.signatures), "finish(summary: string): void");

    let approve = function("approve");
    assert_eq!(approve.object, "gg.session");
    assert_eq!(approve.ending, Some("review"));
    assert_eq!(sole(approve.signatures), "approve(): void");

    let request_changes = function("requestChanges");
    assert_eq!(request_changes.object, "gg.session");
    assert_eq!(request_changes.ending, Some("review"));
    assert_eq!(
        sole(request_changes.signatures),
        "requestChanges(items: string[]): void"
    );

    // Every ending documents itself as one: the prose is what a `.docs()` lookup renders verbatim,
    // and an ending call that does not say it ends the session is the one sentence a model must not
    // have to infer. It is read as brief-and-detail together, because which of the two carries the
    // sentence is the SDK author's choice and not a property of the call.
    for function in functions() {
        if function.ending.is_none() {
            continue;
        }
        let prose = function.prose.rendered();
        assert!(
            prose.contains("ends your session")
                || prose.contains("End the session")
                || prose.contains("This ends the session"),
            "`{}` does not say that it ends the session: {prose}",
            function.name
        );
    }
}

/// **TypeScript's views module is the five functions its SDK declares, spelled as it declares
/// them.**
///
/// Which functions the grouping carries and what gates them is identity — a file view is a read
/// whatever language asks for it — and the [agreement gate](crate::sandbox::language) asserts that
/// for every language, including the ones with no prebuilt component yet. What stays here is
/// TypeScript's own spelling of them, and the count, which is this SDK's surface rather than a rule
/// about surfaces.
#[test]
fn typescript_spells_its_view_calls_as_its_sdk_declares_them() {
    let open_file = function("openFile");
    assert_eq!(open_file.object, "gg.views");
    assert_eq!(
        open_file.capability,
        Some(CAPABILITY_READ_FILE),
        "opening a file view is a read, and is bought with reading"
    );

    for name in ["openText", "openDocsView", "close", "current"] {
        let entry = member("gg.views", name);
        assert!(
            entry.ending.is_none() && entry.capability.is_none(),
            "`{name}` is bound whatever a run enables"
        );
    }

    // Five operations, and a sixth entry that is a second way to reach one of them: `OpenView.close`
    // is the selector-supplying member on the value `current` lists, an alias of `views.close` that
    // is gated as `views.close` and adds no capability. Counting the two apart is what keeps "how
    // many things can this module do" separate from "how many ways are there to write them".
    let catalogued = functions();
    let views: Vec<_> = catalogued
        .iter()
        .filter(|function| function.object == "gg.views")
        .collect();
    assert_eq!(
        views
            .iter()
            .filter(|function| function.alias_of.is_none())
            .count(),
        5,
        "the view surface is the five operations and nothing else"
    );
    assert_eq!(
        views
            .iter()
            .filter_map(|function| function.alias_of.map(|alias| (function.fqn, alias)))
            .collect::<Vec<_>>(),
        [("gg.views.OpenView.close", "views.close")],
        "and its one alias says which operation it is a second way to reach"
    );

    // The projection the docs runtime reads carries the same gates, which is what makes a withheld
    // `read_file` withhold `gg.views.openFile`'s *documentation* as well as the function.
    let functions = catalogue_functions(typescript());
    let projected = |name: &str| {
        functions
            .iter()
            .find(|function| function.name == name)
            .unwrap_or_else(|| panic!("`{name}` is documented"))
    };
    assert_eq!(projected("openFile").capability, Some(CAPABILITY_READ_FILE));
    assert_eq!(projected("openFile").object, "gg.views");
    assert!(projected("openText").capability.is_none());
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
    // No catalogued call that is *not* the ending itself binds the name, whichever grouping it sits
    // under: the collision this rules out is in one scope, and everything a program can call is in
    // that one scope.
    for function in functions() {
        if function.ending.is_some() {
            continue;
        }
        assert_ne!(
            function.name, FINISH_FUNCTION,
            "`{}` binds the name the session function needs",
            function.key
        );
    }
}
/// The documentation directory the [docs carve-out](crate::docs) reads carries, for each function,
/// the object it lives on and the gg tool that gates it — `None` for a carve-out always bound.
#[test]
fn catalogue_functions_carry_object_and_gate() {
    let functions = catalogue_functions(typescript());

    // `finish` is always bound (no gate) and lives in the session module.
    let finish = functions
        .iter()
        .find(|function| function.name == "finish")
        .expect("finish is documented");
    assert_eq!(finish.object, "gg.session");
    assert!(
        finish.capability.is_none(),
        "finish is not bought by any capability"
    );

    // A workspace call is bought by its own capability and grouped under the module it is declared
    // in.
    let read = functions
        .iter()
        .find(|function| function.name == "readFile")
        .expect("readFile is documented");
    assert_eq!(read.object, "gg.files");
    assert_eq!(read.capability, Some(CAPABILITY_READ_FILE));
    assert!(
        !read.prose.brief.is_empty(),
        "every function carries a brief"
    );

    // The helper is bought by the capability the read it wraps is bought by, and lives in that
    // read's module.
    let helper = functions
        .iter()
        .find(|function| function.name == "readTextFile")
        .expect("readTextFile is documented");
    assert_eq!(helper.object, "gg.files");
    assert_eq!(helper.capability, Some(CAPABILITY_READ_FILE));
}

/// A type's declaration is returned verbatim, so what a doc lookup shows is what the SDK wrote — and
/// a type the catalogue does not carry is `None` rather than a fabricated declaration.
#[test]
fn type_declaration_returns_the_sdks_own_declaration() {
    let dir_entry = type_declaration(typescript(), "DirEntry").expect("DirEntry is declared");
    assert!(dir_entry.declaration.contains("interface DirEntry"));
    // And it arrives explained, member by member: a declaration alone says what fields a value has
    // and nothing about what any of them means. Read through `prose`, which is the accessor that
    // answers whichever schema the arm committed — the raw `doc` field is the shape this arm no
    // longer writes, and reaching for it would assert that a documented type is undocumented.
    assert!(!dir_entry.prose().rendered().trim().is_empty());
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
            !member.prose().rendered().trim().is_empty(),
            "`DirEntry.{}` came out undocumented",
            member.name
        );
    }
    assert!(type_declaration(typescript(), "NoSuchType").is_none());
}

/// **The picture channel the catalogue describes is the one gg implements.**
///
/// These two docs are the only place a code-mode model can learn how looking at an image works
/// before it tries, so they must not contradict gg or each other. A `fs.readFile` promising that
/// "an image's pixels are shown to you" one sentence before saying `view.openFile` is the call that
/// shows a file leaves a model that reads the first half calling `readFile` on a reference mockup and then
/// reasons about a picture it was never shown — the exact misconception the one-channel rule exists
/// to prevent, delivered by gg's own documentation.
///
/// A doc string cannot be type-checked against behaviour, so this pins the two claims that matter:
/// a bare read does not show, and a view can be refused.
///
/// The first claim is asked of the read's **own** paragraph, because a promise that a bare read
/// shows a picture is a lie wherever it is written and a model reading only the call must not meet
/// one. The second is asked of the read's paragraph *and the types it hands back*, because those are
/// one block: a documentation view of the call lists the types its signature names, each openable by
/// name, and the arm of the union a program reaches by narrowing `kind === "image"` is where a
/// remedy is most useful. Demanding the sentence in one particular paragraph would be demanding a
/// layout rather than a fact.
#[test]
fn the_catalogue_tells_the_truth_about_pictures() {
    let read = function("readFile");
    let own = read.prose.rendered().into_owned();
    assert!(
        !own.contains("pixels are shown to you"),
        "`{}` must not promise a picture it does not show: {own}",
        read.fqn
    );
    assert!(
        own.contains("shows nothing") || own.contains("does not show"),
        "`{}` must say plainly that reading an image does not show it: {own}",
        read.fqn
    );

    // The call that DOES show one, quoted as this arm's own catalogue spells it rather than typed
    // here — a hand-written spelling in a test is the same defect the prompt gate exists for.
    let shows = functions()
        .into_iter()
        .find(|function| function.operation == "views.open_file")
        .expect("this arm binds the call that shows a file");
    let spelled = shows.fqn;
    let reachable = read
        .types
        .iter()
        .filter_map(|reference| type_declaration(typescript(), reference.fqn()))
        .fold(own.clone(), |mut text, declared| {
            text.push('\n');
            text.push_str(&declared.prose().rendered());
            text
        });
    assert!(
        reachable.contains(spelled),
        "reading a file must name `{spelled}`, the call that does show one, somewhere a model \
         reading the call meets it: {reachable}"
    );

    // THE IMAGE-VIEW CAP IS GONE, AND NO ARM MAY STILL PROMISE IT.
    // `SandboxLimits::image_view_cap` and its per-agent `imageViewCap` param were deleted — nothing
    // refuses an image view for being the n-th one — but a catalogue cannot be hand-edited to say
    // so, because every build reflects it back out of the SDK sources and a hand edit does not
    // survive one. So retiring the promise was a change to each SDK source tree in turn. Swift was the last one carrying it and made the change with its
    // conversion, so there is no arm left to exempt and none may reintroduce it: a sentence
    // promising a refusal that cannot happen teaches a model to guard against nothing.
    for language in crate::sandbox::all_languages() {
        let open_file = language
            .catalogue()
            .functions
            .iter()
            .find(|entry| entry.operation == "views.open_file")
            .expect("every arm binds `views.open_file`");
        let prose = format!(
            "{} {}",
            open_file.brief,
            open_file.detail.as_deref().unwrap_or("")
        );
        assert!(
            !prose.contains("imageViewCap") && !prose.contains("image-view cap"),
            "{}: `views.open_file` promises an image-view cap the host does not have: {prose}",
            language.display_name(),
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The doc model
//
// What follows is about the doc model rather than about TypeScript: that a catalogue says which
// shape it is written in and is refused when that is a shape this gg cannot render, and that the
// projection every consumer reads carries the identity, the gate and the prose the document states.
// Asserted against a fixture rather than against an arm, because the subject is the document.
// ---------------------------------------------------------------------------------------------

use super::fixture;

/// **Every registered arm is written in the one schema gg reads.**
///
/// Stated rather than assumed, because every gate over the doc model — the register gate, the name
/// rule, the capability gate — is written against that one shape and has nothing to say about any
/// other. An arm emitting something else would fail to parse at all, and this says so where the
/// failure names the arm.
#[test]
fn every_registered_arm_is_written_in_the_schema_this_tree_reads() {
    for language in language::all_languages() {
        assert_eq!(
            language.catalogue().schema,
            CATALOGUE_SCHEMA,
            "{} is written in a schema this tree does not read",
            language.display_name()
        );
    }
}

/// **A schema this gg does not know is refused, not rounded down to one it does.**
///
/// A catalogue from a newer gg describes a surface this one cannot render, and rendering it as
/// whichever shape happens to parse is how a model is handed a signature nobody wrote.
#[test]
fn a_schema_from_a_newer_gg_is_refused() {
    let ahead = fixture::CATALOGUE.replacen("\"schema\": 1", "\"schema\": 2", 1);
    let error = SignatureCatalogue::parse(&ahead).expect_err("schema 2 is not readable here");
    assert!(
        error.to_string().contains("schema"),
        "the refusal says which key it is about: {error}"
    );
}

/// **A catalogue that does not say what it is written in is refused too.**
///
/// The key is required rather than defaulted, because a default would read a document of unknown
/// shape as the one shape gg renders — the same signature nobody wrote, reached by omission instead
/// of by a number.
#[test]
fn a_catalogue_that_declares_no_schema_is_refused() {
    let silent = fixture::CATALOGUE.replacen("\"schema\": 1,", "", 1);
    let error = SignatureCatalogue::parse(&silent).expect_err("a catalogue must say its shape");
    assert!(
        error.to_string().contains("schema"),
        "the refusal says which key is missing: {error}"
    );
}

/// **The projection carries the identity the document states**: the name it is opened by, the module
/// it is filed under, the operation it binds and the return position its reflector resolved.
#[test]
fn an_entry_carries_the_identity_its_document_states() {
    let functions = super::functions_of(fixture::catalogue());
    let read = functions
        .iter()
        .find(|function| function.name == "read_file")
        .expect("the fixture reads files");
    assert_eq!(read.fqn, "gg::files::read_file");
    assert_eq!(read.module, "files");
    assert_eq!(read.operation, "files.read_file");
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
    let close = functions
        .iter()
        .find(|function| function.name == "close")
        .expect("the fixture closes views");
    assert_eq!(close.kind, EntryKind::Method);
    assert_eq!(close.receiver, Some("OpenView"));
    assert_eq!(close.fqn, "gg::views::OpenView::close");
}

/// **An entry's gate is gg's own**, synthesized from the operation it names rather than read out of
/// the artifact — which is why the schema has no field for one.
///
/// All four kinds of binding are exercised, because the failure worth catching is a projection that
/// gets one of them right and silently answers `None` for the rest.
#[test]
fn the_gate_of_an_entry_is_synthesized_from_ggs_own_table() {
    let functions = super::functions_of(fixture::catalogue());
    let by_name = |name: &str| {
        functions
            .iter()
            .find(|function| function.name == name)
            .unwrap_or_else(|| panic!("`{name}` is in the fixture"))
    };

    // A workspace call, whose capability id no catalogue ever learns either.
    assert_eq!(by_name("read_file").capability, Some(CAPABILITY_READ_FILE));
    // An ending, whose role gg names.
    assert_eq!(by_name("finish").ending, Some("standard"));
    assert!(by_name("finish").capability.is_none());
    // A capability, whose id no catalogue ever learns.
    assert_eq!(
        by_name("get").capability,
        Some(test_cabinet_core::gg::CAPABILITY_PROGRAM_LIBRARY)
    );
    // And an unconditional one: bound to every program whatever a run enables.
    let close = by_name("close");
    assert!(close.ending.is_none() && close.capability.is_none());

    // The fixture never says any of that: the JSON carries an operation id and no gate at all.
    assert!(!fixture::CATALOGUE.contains("\"requires\""));
    assert!(!fixture::CATALOGUE.contains("\"ending\""));
}

/// **An operation named on the declaration resolves to gg's row for it** — the one join between an
/// arm's surface and gg's own vocabulary.
#[test]
fn an_entry_resolves_to_its_operation_by_id() {
    let functions = super::functions_of(fixture::catalogue());
    let read = functions
        .iter()
        .find(|function| function.name == "read_file")
        .expect("the fixture reads files");
    let operation = crate::sandbox::operation_of(read).expect("gg has a row for it");
    assert_eq!(operation.id.namespace, "files");
    assert_eq!(operation.id.key, "read_file");
}

/// **A module carries gg's id and the arm's own path**, which is what lets one module be one module
/// across eleven arms that spell it eleven ways.
#[test]
fn a_module_carries_ggs_id_and_the_arms_own_path() {
    let new = super::modules_of(fixture::catalogue());
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

/// **An authored brief and detail render as one block**, with the blank line between them a
/// documentation view needs.
#[test]
fn authored_prose_renders_as_one_block() {
    let authored = Prose::authored("Read a file.", Some("Narrow it before use."));
    assert_eq!(authored.rendered(), "Read a file.\n\nNarrow it before use.");

    let brief_only = Prose::authored("Read a file.", None);
    assert_eq!(brief_only.rendered(), "Read a file.");

    // A blank brief stays blank rather than being filled in from somewhere, which is what lets the
    // register gate name an entry whose author forgot one.
    let empty = Prose::authored("", None);
    assert_eq!(
        empty.brief, "",
        "an absent brief stays absent, and the gate names it"
    );

    // A detail that is only whitespace is no detail, so nothing renders a trailing blank line.
    assert_eq!(Prose::authored("Read a file.", Some("  ")).detail, None);
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

    let read = super::functions_of(fixture::catalogue())
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

/// **A type declaration carries the name it is opened by, the module it belongs to and the shape of
/// each member.**
#[test]
fn a_type_carries_the_name_it_is_opened_by() {
    let declared = fixture::catalogue()
        .types
        .iter()
        .find(|declaration| declaration.name == "FileRead")
        .expect("the fixture declares it");

    assert_eq!(declared.fqn, "gg::files::FileRead");
    assert_eq!(declared.key(), "gg::files::FileRead");
    assert_eq!(declared.module, "files");
    assert_eq!(declared.prose().brief, "The result of a file read.");
    assert_eq!(
        declared.prose().detail,
        Some("Narrow it before use: the two arms carry different things.")
    );

    // A member states its own shape: an arm of a union carries no type of its own, because the arm
    // is the value.
    for member in &declared.members {
        assert_eq!(member.kind, MemberKind::Variant);
        assert!(!member.prose().brief.is_empty());
    }

    // And a type carries the menu of what can be done with a value of it, which is what makes
    // opening a function's return type land the model somewhere useful.
    let view = fixture::catalogue()
        .types
        .iter()
        .find(|declaration| declaration.name == "OpenView")
        .expect("the fixture declares it");
    assert_eq!(
        view.member_functions
            .iter()
            .map(|member| member.fqn.as_str())
            .collect::<Vec<_>>(),
        ["gg::views::OpenView::close"]
    );
}
