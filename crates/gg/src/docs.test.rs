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
/// Both states of the access line are asserted here, because a renderer that carried only the line
/// would say nothing at all on ten of the eleven arms. TypeScript's SDK is in a program's scope
/// before it compiles, so the view says so; PureScript resolves a qualified name only under a
/// qualified import, so the view quotes the import.
#[test]
fn a_view_names_the_module_and_says_how_to_reach_it() {
    let docs = runtime(ENABLED);
    let read_file = docs.read("readFile").expect("readFile is bound");
    assert!(
        read_file.contains("\nDefined in `gg.files`, in scope already.\n"),
        "{read_file}"
    );
    let file_read = docs.read_type("FileRead").expect("FileRead is reachable");
    assert!(
        file_read.contains("\nDefined in `gg.files`, in scope already.\n"),
        "{file_read}"
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
