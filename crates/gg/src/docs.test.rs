//! Tests for the [documentation carve-out runtime](super::DocsRuntime).

use test_cabinet_core::gg::{
    CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE,
    CAPABILITY_SHELL, CAPABILITY_SUBAGENTS, CAPABILITY_WRITE_FILE, GgProgramLanguage,
};

use super::*;
use crate::ending::EndingRole;
use crate::sandbox::{
    BOARD_CREATE_ISSUE, BOARD_UPDATE_ISSUE, BOARD_WAIT_FOR_ISSUE, OperationId,
    capability_operations, gating_capabilities,
};

/// The capabilities a full run enables — enough to reach the filesystem, the shell and the board.
const ENABLED: &[&str] = &[
    CAPABILITY_READ_FILE,
    CAPABILITY_WRITE_FILE,
    CAPABILITY_SHELL,
    CAPABILITY_PROJECT_MANAGEMENT,
];

/// A runtime for an agent holding `capabilities` and granted **every operation they offer** — the
/// ordinary shape, and the one every test that is about something other than the allowlist wants.
///
/// The allowlist is seeded rather than left empty because an empty one withholds everything: a
/// fixture that named no operations would make each assertion below pass for the wrong reason. The
/// tests that *are* about the allowlist ([`granting`]) name their operations explicitly.
fn runtime(capabilities: &[&str]) -> DocsRuntime {
    in_role(capabilities, EndingRole::Standard)
}

/// [`runtime`], dispatched in `role`.
fn in_role(capabilities: &[&str], role: EndingRole) -> DocsRuntime {
    let operations = capability_operations(capabilities.iter().copied());
    DocsRuntime::new(
        capabilities.iter().map(|id| id.to_string()).collect(),
        role,
        &operations,
        GgProgramLanguage::TypeScript,
    )
}

/// A runtime for an agent holding `capabilities` and granted exactly `operations` — the two halves
/// of a grant set independently, which is what the allowlist tests are for.
fn granting(capabilities: &[&str], operations: &[OperationId]) -> DocsRuntime {
    DocsRuntime::new(
        capabilities.iter().map(|id| id.to_string()).collect(),
        EndingRole::Standard,
        operations,
        GgProgramLanguage::TypeScript,
    )
}

/// A runtime for an agent granted **everything** on `language`, in `role` — every capability that
/// gates a call, and every operation those capabilities offer.
fn everything(language: GgProgramLanguage, role: EndingRole) -> DocsRuntime {
    let capabilities = gating_capabilities();
    let operations = capability_operations(capabilities.iter().copied());
    DocsRuntime::new(
        capabilities.into_iter().map(str::to_string).collect(),
        role,
        &operations,
        language,
    )
}

/// `openDocsView` is documented ungated — an agent granted nothing at all must still be able to
/// read what the functions it *does* have do.
#[test]
fn view_always_carries_open_docs_view() {
    let docs = runtime(&[]);
    assert!(docs.read("openDocsView").is_some());
}

/// **A function's lookup is the signature and the description, and stops there.**
///
/// The declarations of the types it mentions are not folded in: each is a
/// [view of its own](DocsRuntime::read_type), placed beside the function according to the agent's
/// [type mode](DocViewTypes). Folding them in repeated a record in full in every function view that
/// mentioned it, with no way to reclaim any of the copies — and left the three arms of the mode with
/// nothing to differ about.
///
/// The view still reads correctly on its own, which is what the old shape was protecting: the
/// signature names its types, and a lookup of a type declares one.
#[test]
fn a_function_lookup_is_its_signature_and_its_prose() {
    let docs = runtime(ENABLED);

    let first = docs.read("readFile").expect("readFile is bound");
    assert!(
        first.contains("readFile("),
        "the signature is included: {first}"
    );
    assert!(
        !first.contains("interface FileRead"),
        "but the referenced type's DECLARATION is a view of its own: {first}"
    );

    // A lookup is a pure projection of the catalogue through this agent's scope, so a second one
    // says exactly the same thing — which is what lets a compaction and a restore re-derive a
    // docview's body from its key rather than replay a stored copy of it.
    let second = docs.read("readFile").expect("readFile is bound");
    assert_eq!(first, second);
}

/// **A type is addressable by name**, and its lookup is the declaration, the paragraph explaining it,
/// and a line per member.
///
/// The gate is *reachability*, not the type's own: an agent that may call `readFile` reads
/// `FileRead`, because refusing it the declaration of what `readFile` hands back would be refusing
/// it half of a call it holds. What the gate stops is the other case — see
/// [`a_type_only_a_withheld_function_reaches_is_not_readable`].
#[test]
fn a_type_lookup_declares_the_type_and_explains_its_members() {
    let docs = runtime(&[CAPABILITY_READ_FILE]);
    let file_read = docs
        .read_type("FileRead")
        .expect("FileRead is in the catalogue");
    assert!(file_read.contains("FileRead"), "{file_read}");
    // Explained, not merely declared — and the explanation asked for is the SDK's own, read out of
    // the catalogue rather than quoted here. The regression this catches is a renderer that shows
    // the declaration and drops the paragraph under it, which is the half a model cannot infer and
    // which is exactly what reaching for a field one schema does not carry produces.
    let declared = crate::sandbox::type_declaration(
        crate::sandbox::language(GgProgramLanguage::TypeScript),
        "FileRead",
    )
    .expect("FileRead is declared");
    assert!(
        file_read.contains(declared.prose().rendered().as_ref()),
        "the type is explained, not just declared: {file_read}"
    );
    assert!(docs.read_type("NotAType").is_none());
}

/// **A view names the module the symbol is defined in, and says how a program reaches it.**
///
/// It is the only place a model is told: the prompt names the modules and no function, and a search
/// hit is a key and a brief. A signature a model can read and cannot qualify is a call it cannot
/// write.
///
/// Three arms are asserted, because the line is the arm's own and the shapes differ: TypeScript and
/// JavaScript reach the whole surface with one namespace import, and PureScript imports each module
/// under its own full name.
#[test]
fn a_view_names_the_module_and_says_how_to_reach_it() {
    let docs = runtime(ENABLED);
    let read_file = docs.read("readFile").expect("readFile is bound");
    assert!(
        read_file.contains(
            "\nDefined in `gg.files`, brought into scope with `import * as gg from \"gg\";`.\n"
        ),
        "{read_file}"
    );
    let file_read = docs.read_type("FileRead").expect("FileRead is reachable");
    assert!(
        file_read.contains(
            "\nDefined in `gg.files`, brought into scope with `import * as gg from \"gg\";`.\n"
        ),
        "{file_read}"
    );

    // The unchecked arm is the same language on the same guest, so it states the same line — and a
    // model there reads it in the same sentence.
    let unchecked = everything(GgProgramLanguage::JavaScript, EndingRole::Standard);
    let read_file = unchecked.read("readFile").expect("readFile is bound");
    assert!(
        read_file.contains(
            "\nDefined in `gg.files`, brought into scope with `import * as gg from \"gg\";`.\n"
        ),
        "{read_file}"
    );

    // The line an arm needs is quoted exactly as the model must write it, and it is read out of the
    // catalogue rather than spelled here: a test carrying its own copy of an import line would go on
    // passing after the arm changed one.
    let module = crate::sandbox::catalogue_modules(language(GgProgramLanguage::PureScript))
        .into_iter()
        .find(|module| module.id == "files")
        .expect("purescript declares the filesystem module");
    let import = module
        .import
        .expect("purescript states an import line for every module it declares");
    let docs = everything(GgProgramLanguage::PureScript, EndingRole::Standard);
    let read_file = docs
        .read("Gg.Files.readFile")
        .expect("readFile is bound on every arm");
    let defined = read_file
        .lines()
        .find(|line| line.starts_with("Defined in "))
        .expect("a view says where its symbol is defined");
    assert!(
        defined.contains(module.path) && defined.contains(import),
        "{defined}"
    );
}

/// **A type no function this agent binds can reach is not readable by name** — the half of the
/// discovery surface that would otherwise leak past the permission filter.
///
/// A type's body names the calls that produce it and the members that hang off it, so an agent
/// granted only `read_file` reading `SubagentHandle` by name would learn `sendMessage` and
/// `waitForSubagents` — the very names [`search`](DocsRuntime::search) refuses it — and would then
/// spend a turn writing a call that dies at the membrane. The two halves of the same carve-out
/// answer the same predicate, and the refusal is a plain `None`, indistinguishable from a name that
/// does not exist.
#[test]
fn a_type_only_a_withheld_function_reaches_is_not_readable() {
    let reader = runtime(&[CAPABILITY_READ_FILE]);
    assert!(
        reader.read_type("SubagentHandle").is_none(),
        "only `spawn_subagent` and its family reach it, and this agent has neither"
    );
    assert_eq!(reader.read_any("SubagentHandle"), None);

    // And the same name is readable for an agent that does hold one of those calls, so what is being
    // asserted is the gate rather than the type being unrenderable.
    let delegator = runtime(&[CAPABILITY_SUBAGENTS]);
    assert!(delegator.read_type("SubagentHandle").is_some());
}

/// **One key, one lookup, whichever kind of thing it names** — the entry point everything that
/// re-derives a docview from its key goes through, so a re-seeded window cannot come back holding a
/// different kind of block than the one it lost.
#[test]
fn read_any_resolves_a_function_or_a_type() {
    let docs = runtime(ENABLED);
    assert_eq!(docs.read_any("readFile"), docs.read("readFile"));
    assert_eq!(docs.read_any("FileRead"), docs.read_type("FileRead"));
    assert!(docs.read_any("neitherOne").is_none());
}

/// **Two spellings of one lookup are one key**, so the documentation band never holds a page twice.
///
/// Every entry answers to its fully-qualified name and to its bare one, on purpose: a model reads
/// the first in a search hit and writes the second at a call site. The band, though, is keyed by the
/// string a view was opened under and rests on a re-open being a total no-op — so an agent that
/// spelled one lookup both ways would be holding, and paying for, the same documentation twice, and
/// a reader attributing context to a documentation mode would count one page as two.
///
/// A type is asserted beside the function because the two halves resolve through different code and
/// only one of them was ever normalized: [`TypeDeclaration::key`](crate::sandbox::TypeDeclaration)
/// is where this rule came from, and this is the function half catching up to it.
#[test]
fn a_lookup_spelled_either_way_resolves_to_one_key() {
    let docs = runtime(ENABLED);

    let key = docs.docview_key("readFile").expect("readFile is bound");
    assert_eq!(
        key, "gg.files.readFile",
        "the fully-qualified name is the key"
    );
    assert_eq!(docs.docview_key("gg.files.readFile"), Some(key));

    let key = docs.docview_key("FileRead").expect("FileRead is reachable");
    assert_eq!(docs.docview_key("gg.files.FileRead"), Some(key));

    // The same three gates the reader answers against, so a name the agent cannot look up has no
    // key either — a key resolved for a withheld call would file a view nothing may render.
    assert_eq!(docs.docview_key("neitherOne"), None);
    let withheld = runtime(&[]);
    assert_eq!(withheld.docview_key("readFile"), None);
}

/// **A lookup says what each argument is for, and what each field of the result means.**
///
/// A signature and a paragraph leave a model to infer the rest from names alone, and the two things
/// it has to infer are exactly the two it cannot: what to put in an argument it has never passed,
/// and what a field of a returned record means. Both are the SDK's own words — reflected out of the
/// `@param` written on the argument and the comment written above the member — so this is also the
/// assertion that the reflection reaches the model rather than stopping at the emitted JSON.
#[test]
fn a_lookup_explains_every_argument_and_every_field() {
    let docs = runtime(ENABLED);
    let read_file = docs.read("readFile").expect("readFile is bound");

    // The argument, and the fields of the structured argument nested under it.
    assert!(read_file.contains("\n  path: string — "), "{read_file}");
    assert!(read_file.contains("\n  options?: "), "{read_file}");
    assert!(
        read_file.contains("\n    offset?: number — "),
        "{read_file}"
    );

    // The referenced type's own members are explained in ITS view, not in this one. `FileRead` is
    // this arm's union of two named records, so the fields live on the arm that declares them —
    // which a lookup reaches because the type closure carries it.
    let text_file = docs
        .read_type("TextFile")
        .expect("TextFile is in the catalogue");
    assert!(
        text_file.contains("\n  totalLines: number — "),
        "{text_file}"
    );
}

/// **An argument passed by name says so, and a positional one is silent.**
///
/// The one property of an argument that changes what the model has to *type*: under a language that
/// passes by name, the call site writes the argument's name as well as its value, and a model that
/// read only the name and the type would write it positionally and be refused.
///
/// Built from a parameter rather than read out of a catalogue because no registered language passes
/// by name yet — TypeScript is positional throughout, so a catalogue-driven test could only assert
/// the silent half. The point of the test is that the renderer is ready for the first language that
/// is not, rather than carrying the distinction as far as the JSON and dropping it.
#[test]
fn an_argument_passed_by_name_is_marked_and_a_positional_one_is_not() {
    let parameter = |kind: &str| -> Parameter {
        serde_json::from_value(serde_json::json!({
            "name": "limit",
            "type": "number",
            "optional": true,
            "kind": kind,
            "default": null,
            "doc": "How many lines to read.",
            "fields": [],
        }))
        .expect("a parameter")
    };

    let mut positional = String::new();
    describe(&mut positional, &parameter("positional"), 1);
    assert_eq!(
        positional, "  limit?: number — How many lines to read.\n",
        "a positional argument carries no marker: it is every argument in every language that \
         passes by position"
    );

    let mut keyword = String::new();
    describe(&mut keyword, &parameter("keyword"), 1);
    assert_eq!(
        keyword,
        "  limit?: number (passed by name) — How many lines to read.\n"
    );
}

/// A union's arms are members too — named by the literal, with no type beside them, because the arm
/// *is* the value. A model choosing between `pending` and `in_progress` is choosing between two
/// values whose difference is prose, and nothing but the prose can tell it which to write.
#[test]
fn a_lookup_explains_the_arms_of_a_union() {
    let docs = granting(&[CAPABILITY_PROJECT_MANAGEMENT], &[BOARD_UPDATE_ISSUE]);
    let status = docs
        .read_type("IssueStatus")
        .expect("the status union is catalogued");
    assert!(status.contains("\n  \"in_progress\" — "), "{status}");
}

/// A lookup for a function the run did not enable is `None` — the model is told the name is not
/// available rather than shown docs for a method its scope does not carry.
#[test]
fn read_of_a_withheld_function_is_none() {
    let docs = runtime(&[CAPABILITY_READ_FILE]);
    assert!(docs.read("writeFile").is_none());
}

/// **A suggestion is drawn from this agent's scope, never from the catalogue.**
///
/// The failure a whole-catalogue hint would cause is the worst kind: the model reads a plausible
/// name gg itself offered, writes the call, and is answered with a `ReferenceError`. So a run that
/// withheld `write_file` does not hear `writeFile` back — from the lookup or from the hint.
#[test]
fn a_suggestion_never_names_a_function_this_agent_lacks() {
    let docs = runtime(&[CAPABILITY_READ_FILE]);
    assert!(docs.read("writeFile").is_none());
    assert!(
        docs.suggest("write_file").is_empty(),
        "`writeFile` is not bound, so it is not offered: {:?}",
        docs.suggest("write_file")
    );
    // What *is* bound is still offered, on the same query shape and under both its keys.
    assert_eq!(
        docs.suggest("read_file"),
        vec!["readFile", "gg.files.readFile"]
    );

    // The ending gate is a scope like any other: a reviewer's verdicts are not suggested to an
    // agent doing work, and `finish` is not suggested to a reviewer.
    let worker = runtime(ENABLED);
    assert!(worker.suggest("request_changes").is_empty());
    let reviewer = in_role(ENABLED, EndingRole::Review);
    assert_eq!(
        reviewer.suggest("request_changes"),
        vec!["requestChanges", "gg.session.requestChanges"]
    );
    assert!(reviewer.suggest("finsih").is_empty());
}

/// The **third gate**: the program library, which neither the enabled set nor the ending role can
/// express.
///
/// It is documented exactly when the capability is on, because documenting a function the scope did
/// not bind is the one thing documentation must never do — and the failure it would produce is the
/// worst kind: the model reads a plausible signature, writes the call, and is answered with a
/// `ReferenceError` about a name gg itself named.
#[test]
fn the_program_library_is_documented_only_when_the_agent_keeps_one() {
    let without = runtime(ENABLED);
    for call in ["rerun", "history", "get"] {
        assert!(without.read(call).is_none(), "`{call}` is not bought");
    }

    let mut with_library = ENABLED.to_vec();
    with_library.push(CAPABILITY_PROGRAM_LIBRARY);
    let with = runtime(&with_library);
    for call in ["rerun", "history", "get"] {
        assert!(with.read(call).is_some(), "`{call}` is bought");
    }
    let doc = with
        .read("rerun")
        .expect("the library's calls are documented");
    assert!(doc.contains("rerun(source: string)"), "{doc}");

    // The gate is the library's alone: it does not withdraw anything else, and it is not withdrawn
    // by an ending role.
    assert!(with.read("readFile").is_some());
    let reviewer = in_role(&with_library, EndingRole::Review);
    assert!(reviewer.read("get").is_some());
}

/// **Every name a model has been shown opens**, on every registered arm — the fourth invariant of
/// the [name rule](crate::sandbox::signatures::fqn), which is a property of this runtime rather than
/// of a catalogue and so is asserted here.
///
/// Three strings count as *shown*, and the gate is over all three because a model has no way to
/// tell them apart:
///
/// 1. the key a catalogued function advertises — its
///    [fully-qualified name](crate::sandbox::CatalogueFunction::fqn), which is also what a search
///    hit is filed under;
/// 2. the name a program calls that function by, which is what a call site writes;
/// 3. the **spelling** every type reference writes into a signature — `Files.FileRead`,
///    `files::FileRead` — which is neither the type's key nor its bare name, and which is the string
///    a model most often copies, because it is printed inside the signature of the very function
///    whose documentation it just opened.
///
/// The third is the one an arm can quietly cost a model: a spelling printed in a signature and
/// resolving to nothing is a name the model reads and cannot open. It is asked of an agent holding
/// everything,
/// because what a *withheld* name answers is a different question with its own tests
/// ([`a_type_only_a_withheld_function_reaches_is_not_readable`]).
#[test]
fn every_name_a_model_is_shown_opens_on_every_arm() {
    for language in crate::sandbox::all_languages() {
        let arm = language.display_name();
        // Both roles, because the endings are bound one group per role and a name no role binds
        // is a name no model is ever shown.
        for role in [EndingRole::Standard, EndingRole::Review] {
            let docs = everything(language.id(), role);
            for function in crate::sandbox::catalogue_functions(language) {
                if !docs.bound(&function) {
                    continue;
                }
                for key in [function.fqn, function.name] {
                    assert!(
                        docs.read_any(key).is_some(),
                        "{arm}: `{key}` is a name this arm advertises for `{}` and opens nothing",
                        function.name,
                    );
                }
                for reference in function.returns.iter().chain(function.types) {
                    assert!(
                        docs.read_any(reference.spelled()).is_some(),
                        "{arm}: `{}` writes the type `{}` and that spelling opens nothing — it is \
                         the string the model reads in the signature",
                        function.name,
                        reference.spelled(),
                    );
                }
            }
        }
    }
}

/// **A type view lists the member functions a value of it offers, and lists only the bound ones.**
///
/// A member function is the second way to reach an operation — `view.close()` on the `OpenView` a
/// listing handed back — and the view of the type the call produced is the one place a model walking
/// its own return value would ever meet it. Rendering the members and dropping the member functions
/// leaves the affordance discoverable only by someone who already knew to search for its name, which
/// is the reader it least needs to help.
///
/// The second half is the gate, and it is not defensive. A type is readable when *some* bound
/// function reaches it, which is strictly weaker than every operation hanging off it being bound:
/// `IssueCreated` is what `createIssue` hands back, and `wait` on it binds the separate
/// `board.wait_for_issue` operation — the same capability, a different entry in the allowlist. An
/// agent granted the first and not the second must not be handed the second's name by the
/// declaration of the value it is holding.
#[test]
fn a_type_view_lists_the_member_functions_this_agent_binds() {
    let both = granting(
        &[CAPABILITY_PROJECT_MANAGEMENT],
        &[BOARD_CREATE_ISSUE, BOARD_WAIT_FOR_ISSUE],
    );
    let listed = both
        .read_type("IssueCreated")
        .expect("`createIssue` reaches it");
    assert!(
        listed.contains("\n  gg.board.IssueCreated.wait — "),
        "the helper is listed by the fully-qualified name that opens its own documentation: \
         {listed}"
    );
    assert!(
        both.read_any("gg.board.IssueCreated.wait").is_some(),
        "and that name is one a model can then open"
    );

    let creator = granting(&[CAPABILITY_PROJECT_MANAGEMENT], &[BOARD_CREATE_ISSUE]);
    let withheld = creator
        .read_type("IssueCreated")
        .expect("`createIssue` still reaches it");
    assert!(
        !withheld.contains("IssueCreated.wait"),
        "`wait_for_issue` is withheld, so its name does not arrive through the declaration of what \
         `createIssue` handed back: {withheld}"
    );
}

/// **Every member function every arm catalogues is rendered for an agent that binds it, on every
/// arm.**
///
/// The per-arm reflectors decide which values carry behaviour, and D11 is explicit that they may
/// differ: a helper belongs on an arm where it makes sense and nowhere else. What must not differ is
/// whether a helper an arm *did* reflect reaches a model — the failure this catches is a type whose
/// menu is catalogued and never printed, which is exactly the state this rendering was added to end.
#[test]
fn every_catalogued_member_function_reaches_a_type_view() {
    for language in crate::sandbox::all_languages() {
        let arm = language.display_name();
        let docs = everything(language.id(), EndingRole::Standard);
        for declaration in &language.catalogue().types {
            for member in &declaration.member_functions {
                let Some(body) = docs.read_type(declaration.key()) else {
                    panic!(
                        "{arm}: `{}` carries a member function and its own view is unreachable",
                        declaration.key()
                    );
                };
                assert!(
                    body.contains(&member.fqn),
                    "{arm}: `{}` is catalogued on `{}` and its type view never names it:\n{body}",
                    member.fqn,
                    declaration.key(),
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The loaded half: the code modules an agent brought into use
// ---------------------------------------------------------------------------------------------

/// One export, with as much of a declaration as the assertion needs.
fn export(
    name: &str,
    kind: crate::sandbox::ModuleExportKind,
    declaration: &str,
    returns: &[&str],
    parameters: &[&str],
) -> crate::sandbox::ModuleExport {
    crate::sandbox::ModuleExport {
        name: name.to_string(),
        kind,
        declaration: declaration.to_string(),
        doc: None,
        returns: returns.iter().map(|name| name.to_string()).collect(),
        parameters: parameters.iter().map(|name| name.to_string()).collect(),
    }
}

/// A runtime granted everything, reading a registry holding `exports` under `csvTools`.
fn loading(exports: &[crate::sandbox::ModuleExport]) -> DocsRuntime {
    let loaded = LoadedDocs::new();
    loaded.register(
        crate::sandbox::language(GgProgramLanguage::TypeScript),
        "csvTools",
        "skill",
        "csv-tools",
        exports,
    );
    everything(GgProgramLanguage::TypeScript, EndingRole::Standard).reading(loaded)
}

/// **A loaded declaration is looked up under both names it answers to, and canonicalized to one.**
///
/// The same rule the SDK half follows, and for the same reason: a model reads the key in a search
/// hit and types the bare name at a call site, and a view filed under whichever of the two it
/// happened to write would put one page in the window twice.
#[test]
fn a_loaded_declaration_answers_to_its_key_and_to_its_bare_name() {
    let docs = loading(&[export(
        "parse",
        crate::sandbox::ModuleExportKind::Function,
        "export function parse(text: string): Row[]",
        &[],
        &[],
    )]);
    for spelling in ["csvTools.parse", "parse"] {
        assert_eq!(
            docs.docview_key(spelling).as_deref(),
            Some("csvTools.parse"),
            "`{spelling}` resolves, and to the one key it is filed under"
        );
        assert!(docs.read_any(spelling).is_some(), "{spelling}");
    }
    assert!(
        docs.read_any("csvTools").is_some(),
        "and the module itself is an entry under the key it was loaded at"
    );
}

/// **gg's own surface wins a collision**, so a loaded declaration can only ever add a name.
///
/// A skill that happens to export a `readFile` must not take gg's page out of the model's hands: it
/// did not ask to replace it, and the SDK is what the prompt and the bootstrap taught it. The
/// loaded entry keeps its qualified key, which is the name a search hands back for it, so nothing is
/// unreachable — only unshadowed.
#[test]
fn a_loaded_declaration_does_not_shadow_the_sdk() {
    let docs = loading(&[export(
        "readFile",
        crate::sandbox::ModuleExportKind::Function,
        "export function readFile(path: string): string",
        &[],
        &[],
    )]);
    let sdk = docs
        .docview_key("readFile")
        .expect("an agent granted everything binds gg's own");
    assert_ne!(sdk, "csvTools.readFile");
    assert_eq!(
        docs.docview_key("csvTools.readFile").as_deref(),
        Some("csvTools.readFile"),
        "and the author's own is still reachable under its key"
    );
}

/// **A near-miss on a loaded declaration is offered back**, because a model reaching for a name it
/// read a moment ago in a view gg opened for it is the likeliest near-miss there is.
#[test]
fn a_failed_lookup_suggests_a_loaded_declaration() {
    let docs = loading(&[export(
        "parseCsv",
        crate::sandbox::ModuleExportKind::Function,
        "export function parseCsv(text: string): Row[]",
        &[],
        &[],
    )]);
    assert!(
        docs.suggest("parsecsv").contains(&"parseCsv".to_string()),
        "{:?}",
        docs.suggest("parsecsv")
    );
}

/// **A use opens the module's callables and nothing else** — no view of the module itself, and none
/// of the declarations a program cannot call.
#[test]
fn a_use_selects_a_view_per_callable_declaration() {
    let docs = loading(&[
        export(
            "parse",
            crate::sandbox::ModuleExportKind::Function,
            "export function parse(text: string): Row[]",
            &[],
            &[],
        ),
        export(
            "Row",
            crate::sandbox::ModuleExportKind::Type,
            "export type Row = Record<string, string>",
            &[],
            &[],
        ),
        export(
            "DELIMITER",
            crate::sandbox::ModuleExportKind::Value,
            "export const DELIMITER = \",\"",
            &[],
            &[],
        ),
    ]);
    assert_eq!(
        docs.use_views("csvTools", DocViewTypes::default()),
        ["csvTools.parse"]
    );
    assert!(
        docs.use_views("jsonTools", DocViewTypes::default())
            .is_empty(),
        "and a key naming no loaded module selects nothing"
    );
}

/// **The type flags are honoured over a loaded declaration's own type names**, on the rule an SDK
/// function's are: return types under one flag, argument types under another, unioned, one level
/// deep and each placed once.
///
/// Every arm reads an empty list today, so this is a rule with no data behind it yet — which is
/// exactly why it is asserted here rather than left to be discovered when an arm starts filling one
/// in. The declaration a name resolves to is looked for in the **module itself** first, because a
/// name a declaration writes is most likely the name of something declared beside it.
#[test]
fn the_type_flags_select_a_loaded_declarations_own_types() {
    let docs = loading(&[
        export(
            "parse",
            crate::sandbox::ModuleExportKind::Function,
            "export function parse(options: Options): Row[]",
            &["Row"],
            &["Options"],
        ),
        export(
            "Row",
            crate::sandbox::ModuleExportKind::Type,
            "export type Row = Record<string, string>",
            &[],
            &[],
        ),
        export(
            "Options",
            crate::sandbox::ModuleExportKind::Type,
            "export type Options = { header: boolean }",
            &[],
            &[],
        ),
    ]);
    assert_eq!(
        docs.use_views("csvTools", DocViewTypes::OFF),
        ["csvTools.parse"],
        "every flag off places the callable and nothing around it"
    );
    assert_eq!(
        docs.use_views("csvTools", DocViewTypes::only(DocViewType::Return)),
        ["csvTools.parse", "csvTools.Row"]
    );
    assert_eq!(
        docs.use_views("csvTools", DocViewTypes::only(DocViewType::Parameters)),
        ["csvTools.parse", "csvTools.Options"]
    );
    let mut every = DocViewTypes::default();
    every.set(DocViewType::Parameters, true);
    let both = docs.use_views("csvTools", every);
    assert_eq!(
        both,
        ["csvTools.parse", "csvTools.Row", "csvTools.Options"],
        "the flags are read independently and unioned"
    );
}

/// **A type name a loaded declaration writes that the module does not declare falls through to
/// gg's own catalogue**, which is what makes the rule one level deep rather than one module wide.
#[test]
fn a_loaded_declaration_may_name_an_sdk_type() {
    let docs = loading(&[export(
        "show",
        crate::sandbox::ModuleExportKind::Function,
        "export function show(read: FileRead): void",
        &[],
        &["FileRead"],
    )]);
    let opened = docs.use_views("csvTools", DocViewTypes::only(DocViewType::Parameters));
    assert!(
        opened.iter().any(|key| key.contains("FileRead")),
        "gg's own declaration is what the name resolves to: {opened:?}"
    );
}

/// **A loaded declaration does not shadow gg's own *page*, not just its key.**
///
/// [`docview_key`](DocsRuntime::docview_key) and [`read_any`](DocsRuntime::read_any) are asserted to
/// ask their sources in one order, and the sibling test above holds the resolver to it. This holds
/// the *renderer* to it, which is the half a window is filled from: a use that opened
/// `readFile` and got an author's four-line helper back would have replaced gg's manual in the model's
/// window without anything having refused anything.
#[test]
fn a_loaded_declaration_does_not_shadow_the_sdks_own_page() {
    let docs = loading(&[export(
        "readFile",
        crate::sandbox::ModuleExportKind::Function,
        "export function readFile(path: string): string",
        &[],
        &[],
    )]);
    let sdk = docs.read_any("readFile").expect("gg's own still renders");
    assert!(
        !sdk.contains("export function readFile(path: string): string"),
        "the page is gg's, not the author's: {sdk}"
    );
    let authored = docs
        .read_any("csvTools.readFile")
        .expect("and the author's is still reachable under its key");
    assert!(
        authored.contains("export function readFile(path: string): string"),
        "{authored}"
    );
}

/// **A near-miss on a loaded module's own key is offered back too**, not only on a declaration's
/// name. The key is the string a model reads at the top of every view a use opened, so it is as
/// likely a thing to mistype as the names beneath it.
#[test]
fn a_failed_lookup_suggests_a_loaded_module_key() {
    let docs = loading(&[export(
        "parse",
        crate::sandbox::ModuleExportKind::Function,
        "export function parse(text: string): Row[]",
        &[],
        &[],
    )]);
    assert!(
        docs.suggest("csvtools").contains(&"csvTools".to_string()),
        "{:?}",
        docs.suggest("csvtools")
    );
}

/// **A use opens the views of the module it names and of no other**, which is what keeps two skills
/// used in one session two separate manuals.
#[test]
fn a_use_opens_only_the_module_it_names() {
    let loaded = LoadedDocs::new();
    let language = crate::sandbox::language(GgProgramLanguage::TypeScript);
    loaded.register(
        language,
        "csvTools",
        "skill",
        "csv-tools",
        &[export(
            "parse",
            crate::sandbox::ModuleExportKind::Function,
            "export function parse(text: string): Row[]",
            &[],
            &[],
        )],
    );
    loaded.register(
        language,
        "jsonTools",
        "memory",
        "json_tools",
        &[export(
            "read",
            crate::sandbox::ModuleExportKind::Function,
            "export function read(text: string): unknown",
            &[],
            &[],
        )],
    );
    let docs = everything(GgProgramLanguage::TypeScript, EndingRole::Standard).reading(loaded);
    assert_eq!(
        docs.use_views("csvTools", DocViewTypes::default()),
        ["csvTools.parse"]
    );
    assert_eq!(
        docs.use_views("jsonTools", DocViewTypes::default()),
        ["jsonTools.read"]
    );
}

/// **A key naming a module this instance has not loaded renders nothing**, which is the `None` both
/// re-derivations of a docview read to drop a view whose module did not travel.
///
/// Asserted at the runtime because that is where the two restores ask it, and because the answer has
/// to be `None` rather than an empty page: a page rendered empty would be a view of a module the
/// agent cannot call, kept in the window and charged to it.
#[test]
fn a_key_of_a_module_this_instance_did_not_load_renders_nothing() {
    let docs = everything(GgProgramLanguage::TypeScript, EndingRole::Standard);
    assert_eq!(docs.read_any("csvTools.parse"), None);
    assert_eq!(docs.read_any("csvTools"), None);
    assert_eq!(docs.docview_key("csvTools.parse"), None);
}

/// **The `Errors` flag places nothing beside a loaded declaration**, and that is a statement rather
/// than an omission.
///
/// An error view is opened off the names a function's own documentation comment declares it throws,
/// in gg's catalogue vocabulary. An author's module does not write that vocabulary and a
/// [`ModuleExport`](crate::sandbox::ModuleExport) carries no throws list, so there is nothing for the
/// flag to select — and the flag being on must not therefore reach for something else.
#[test]
fn the_errors_flag_places_nothing_beside_a_loaded_declaration() {
    let docs = loading(&[
        export(
            "parse",
            crate::sandbox::ModuleExportKind::Function,
            "export function parse(text: string): Row[]",
            &["Row"],
            &[],
        ),
        export(
            "Row",
            crate::sandbox::ModuleExportKind::Type,
            "export type Row = Record<string, string>",
            &[],
            &[],
        ),
    ]);
    assert_eq!(
        docs.use_views("csvTools", DocViewTypes::only(DocViewType::Errors)),
        ["csvTools.parse"],
        "the callable, and nothing the flag could have added"
    );
}

/// **A type name resolves in its own module or in gg's, and never in a *third* one.**
///
/// The two-source resolver is lenient on purpose — every entry answers to its bare name as well as
/// to its key — and that leniency is what makes the fallback dangerous here. A declaration writing
/// `Row` says nothing about anybody else's `Row`, so a resolver that walked the whole registry
/// would open a page about another skill's data because two authors picked the same word, and open
/// it as though it documented the call the model is about to write.
///
/// Both halves are asserted against one registry: the module's own `Row` is found, and the other
/// module's is not reached for even when this one declares no such type at all.
#[test]
fn a_loaded_declarations_type_never_resolves_in_another_loaded_module() {
    let loaded = LoadedDocs::new();
    let language = crate::sandbox::language(GgProgramLanguage::TypeScript);
    loaded.register(
        language,
        "csvTools",
        "skill",
        "csv-tools",
        &[export(
            "parse",
            crate::sandbox::ModuleExportKind::Function,
            "export function parse(text: string): Row[]",
            &["Row"],
            &[],
        )],
    );
    loaded.register(
        language,
        "jsonTools",
        "memory",
        "json_tools",
        &[export(
            "Row",
            crate::sandbox::ModuleExportKind::Type,
            "export type Row = { kind: \"json\" }",
            &[],
            &[],
        )],
    );
    let docs = everything(GgProgramLanguage::TypeScript, EndingRole::Standard).reading(loaded);

    assert_eq!(
        docs.use_views("csvTools", DocViewTypes::only(DocViewType::Return)),
        ["csvTools.parse"],
        "the only `Row` in reach belongs to a module this declaration never mentions"
    );

    // And the same declaration in a module that *does* declare `Row` opens it, so the assertion
    // above is about whose `Row` it is rather than about the flag placing nothing.
    let own = LoadedDocs::new();
    own.register(
        language,
        "csvTools",
        "skill",
        "csv-tools",
        &[
            export(
                "parse",
                crate::sandbox::ModuleExportKind::Function,
                "export function parse(text: string): Row[]",
                &["Row"],
                &[],
            ),
            export(
                "Row",
                crate::sandbox::ModuleExportKind::Type,
                "export type Row = Record<string, string>",
                &[],
                &[],
            ),
        ],
    );
    assert_eq!(
        everything(GgProgramLanguage::TypeScript, EndingRole::Standard)
            .reading(own)
            .use_views("csvTools", DocViewTypes::only(DocViewType::Return)),
        ["csvTools.parse", "csvTools.Row"]
    );
}

/// **A loaded module whose key names one of gg's own modules does not take that page either.**
///
/// The precedence rule is asserted above for a declaration; a module key is the other half of it and
/// the likelier collision, since a skill is named for what it does and so are gg's own families. The
/// consequence is the one the rule promises: gg's page stays gg's, and the author's declarations are
/// still reachable — under keys the author's own module key builds, which nothing else claims.
#[test]
fn a_loaded_module_key_that_names_an_sdk_module_does_not_take_its_page() {
    let language = crate::sandbox::language(GgProgramLanguage::TypeScript);
    let module = crate::sandbox::catalogue_modules(language)
        .first()
        .map(|described| described.id)
        .expect("this arm declares modules");
    let loaded = LoadedDocs::new();
    loaded.register(
        language,
        module,
        "skill",
        module,
        &[export(
            "parse",
            crate::sandbox::ModuleExportKind::Function,
            "export function parse(text: string): string[]",
            &[],
            &[],
        )],
    );
    let docs = everything(GgProgramLanguage::TypeScript, EndingRole::Standard).reading(loaded);

    let page = docs
        .read_any(module)
        .expect("gg's own module still renders");
    assert!(
        !page.contains("The code the skill"),
        "the page under `{module}` is gg's, not the skill's: {page}"
    );
    let declaration = docs
        .read_any(&format!("{module}.parse"))
        .expect("and the author's declaration is still reachable under its own key");
    assert!(
        declaration.contains("export function parse(text: string): string[]"),
        "{declaration}"
    );
}
