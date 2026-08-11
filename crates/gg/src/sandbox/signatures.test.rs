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
/// What is *not* here is anything that must hold for **every** registered language: capability
/// coverage, the gating vocabulary, whether a call takes input at all and the spelling-uniqueness
/// rules all live in the [capability gate](crate::sandbox::language) now, stated once against gg's
/// own operations table and applied to every language there is.
fn typescript() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::TypeScript)
}

/// TypeScript's committed catalogue.
fn catalogue() -> &'static SignatureCatalogue {
    typescript().catalogue()
}

/// TypeScript's surface as every consumer reads it — the normalized projection of the one shape its
/// catalogue is written in.
///
/// The expectations below are about spellings, and a spelling is a property of an *entry*; which
/// section of the artifact that entry arrived in is the thing the two schemas disagree about and the
/// thing [`catalogue_functions`] exists to hide. So the lookups here go through the projection, and
/// a reshaping of the arm's SDK moves what they say rather than which field they read.
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

/// The committed catalogue parses, is not empty, and says whose it is.
#[test]
fn the_committed_catalogue_parses() {
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
/// Asked of every projected function rather than of the sections a carve-out used to arrive in: this
/// arm files every call in one array now, and the identity rule was never about which section an
/// entry sat in.
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
        helper.gate,
        Some("read_file"),
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
/// for every language, including the ones with no committed component yet. What stays here is
/// TypeScript's own spelling of them, and the count, which is this SDK's surface rather than a rule
/// about surfaces.
#[test]
fn typescript_spells_its_view_calls_as_its_sdk_declares_them() {
    let open_file = function("openFile");
    assert_eq!(open_file.object, "gg.views");
    assert_eq!(
        open_file.gate,
        Some("read_file"),
        "opening a file view is a read, and closes with reading"
    );

    for name in ["openText", "openDocsView", "close", "current"] {
        let entry = member("gg.views", name);
        assert!(
            entry.gate.is_none() && entry.ending.is_none() && entry.capability.is_none(),
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
        [(Some("gg.views.OpenView.close"), "views.close")],
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
    assert_eq!(projected("openFile").gate, Some("read_file"));
    assert_eq!(projected("openFile").object, "gg.views");
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
        finish.gate.is_none(),
        "finish is not gated by any capability"
    );

    // A tool is gated by its own gg tool name and grouped under the module it is declared in.
    let read = functions
        .iter()
        .find(|function| function.name == "readFile")
        .expect("readFile is documented");
    assert_eq!(read.object, "gg.files");
    assert_eq!(read.gate, Some("read_file"));
    assert!(
        !read.prose.brief.is_empty(),
        "every function carries a brief"
    );

    // The helper is gated by the tool it wraps, and lives in that tool's module.
    let helper = functions
        .iter()
        .find(|function| function.name == "readTextFile")
        .expect("readTextFile is documented");
    assert_eq!(helper.object, "gg.files");
    assert_eq!(helper.gate, Some("read_file"));
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
/// before it tries, and they used to contradict both gg and each other: `fs.readFile` promised that
/// "an image's pixels are shown to you" one sentence before saying `view.openFile` is the call that
/// shows a file. A model that reads the first half calls `readFile` on a reference mockup and then
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
        read.fqn.unwrap_or(read.name)
    );
    assert!(
        own.contains("shows nothing") || own.contains("does not show"),
        "`{}` must say plainly that reading an image does not show it: {own}",
        read.fqn.unwrap_or(read.name)
    );

    // The call that DOES show one, quoted as this arm's own catalogue spells it rather than typed
    // here — a hand-written spelling in a test is the same defect the prompt gate exists for.
    let shows = functions()
        .into_iter()
        .find(|function| function.operation == Some("views.open_file"))
        .expect("this arm binds the call that shows a file");
    let spelled = shows.fqn.unwrap_or(shows.name);
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
    // refuses an image view for being the n-th one — but a catalogue cannot be hand-edited
    // (contract-drift regenerates it from SDK source), so retiring the promise was a change to each
    // SDK source tree in turn. Swift was the last one carrying it and made the change with its
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
// The two schemas
//
// What follows is about the doc model rather than about TypeScript: that a catalogue says which
// shape it is written in, that both shapes parse, and — the load-bearing one — that a consumer
// reading either through `catalogue_functions` cannot tell which it was handed. That last property
// is what makes converting one arm per commit possible, so it is asserted against a matched pair of
// fixtures rather than inferred from the two halves working separately.
// ---------------------------------------------------------------------------------------------

use super::fixture;

/// **Which arms have been converted, named.**
///
/// Stated rather than assumed, because it is what makes every "inert below v2" claim in the gates a
/// claim about the tree that exists: an arm absent from this list is one the register gate and the
/// name rule say nothing about, and that is only acceptable while it is *known* to be absent.
///
/// It fails in both directions, which is the point. Converting an arm and forgetting to name it
/// here leaves the tree quietly holding a v2 catalogue to no v2 gate; naming one that has not been
/// converted claims a coverage nothing provides.
const CONVERTED: [GgProgramLanguage; 11] = [
    GgProgramLanguage::Cpp,
    GgProgramLanguage::CSharp,
    GgProgramLanguage::Java,
    GgProgramLanguage::JavaScript,
    GgProgramLanguage::Kotlin,
    GgProgramLanguage::PureScript,
    GgProgramLanguage::Python,
    GgProgramLanguage::Ruby,
    GgProgramLanguage::Rust,
    GgProgramLanguage::Swift,
    GgProgramLanguage::TypeScript,
];

#[test]
fn every_registered_arm_is_written_in_the_schema_this_tree_says_it_is() {
    for language in language::all_languages() {
        let expected = if CONVERTED.contains(&language.id()) {
            SchemaVersion::V2
        } else {
            SchemaVersion::V1
        };
        assert_eq!(
            language.catalogue().schema,
            expected,
            "{} is written in a schema this tree does not expect — an arm's conversion commit adds \
             it to `CONVERTED`, which is what turns the v2 gates on for it",
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
