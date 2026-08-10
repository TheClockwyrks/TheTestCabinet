//! Tests for the [documentation carve-out runtime](super::DocsRuntime).

use test_cabinet_core::gg::{CAPABILITY_PROGRAM_LIBRARY, GgProgramLanguage};

use super::*;
use crate::ending::EndingRole;

/// The scope-bound tool names a full run offers, as gg expresses its enabled set — enough to bind
/// `fs`, `system`, and `project`.
fn enabled() -> Vec<String> {
    ["read_file", "write_file", "shell", "create_issue"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// An object's directory lists its bound functions with summaries, plus the `list` meta function
/// every object carries — and only the functions the run enabled.
#[test]
fn list_enumerates_bound_functions_and_the_list_meta() {
    let docs = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    let fs = docs.list("fs");
    let names: Vec<&str> = fs.iter().map(|f| f.name.as_str()).collect();
    assert!(names.contains(&"readFile"), "{names:?}");
    assert!(names.contains(&"writeFile"), "{names:?}");
    assert!(
        names.contains(&"list"),
        "every object carries `list`: {names:?}"
    );
    // `edit_file` was not enabled, so `editFile` is not listed.
    assert!(!names.contains(&"editFile"), "{names:?}");
    // Every entry carries a non-empty one-line summary.
    assert!(fs.iter().all(|f| !f.summary.is_empty()));
}

/// The `harness` object always carries `finish` and `list`, whatever a run enables.
///
/// It no longer carries `readDocs`: reading a function's documentation is
/// `view.openDocsView`, on the object that owns every other channel into the model's window.
#[test]
fn harness_always_carries_finish_and_list() {
    let docs = DocsRuntime::new(
        Vec::new(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    let harness = docs.list("harness");
    let names: Vec<&str> = harness.iter().map(|f| f.name.as_str()).collect();
    assert!(names.contains(&"finish"), "{names:?}");
    assert!(names.contains(&"list"), "{names:?}");
    assert!(!names.contains(&"readDocs"), "{names:?}");
}

/// The `view` object carries `openDocsView`, ungated — a run that enables no tools at all must still
/// be able to read what the functions it *does* have do.
#[test]
fn view_always_carries_open_docs_view() {
    let docs = DocsRuntime::new(
        Vec::new(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    let names: Vec<String> = docs.list("view").into_iter().map(|f| f.name).collect();
    assert!(names.iter().any(|n| n == "openDocsView"), "{names:?}");
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
    let docs = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );

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
    let docs = DocsRuntime::new(
        vec!["read_file".to_string()],
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    let file_read = docs
        .read_type("FileRead")
        .expect("FileRead is in the catalogue");
    assert!(file_read.contains("FileRead"), "{file_read}");
    assert!(
        file_read.contains("What `readFile` returned"),
        "the type is explained, not just declared: {file_read}"
    );
    assert!(docs.read_type("NotAType").is_none());
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
    let reader = DocsRuntime::new(
        vec!["read_file".to_string()],
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    assert!(
        reader.read_type("SubagentHandle").is_none(),
        "only `spawn_subagent` and its family reach it, and this agent has neither"
    );
    assert_eq!(reader.read_any("SubagentHandle"), None);

    // And the same name is readable for an agent that does hold one of those calls, so what is being
    // asserted is the gate rather than the type being unrenderable.
    let delegator = DocsRuntime::new(
        vec!["spawn_subagent".to_string()],
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    assert!(delegator.read_type("SubagentHandle").is_some());
}

/// **One key, one lookup, whichever kind of thing it names** — the entry point everything that
/// re-derives a docview from its key goes through, so a re-seeded window cannot come back holding a
/// different kind of block than the one it lost.
#[test]
fn read_any_resolves_a_function_or_a_type() {
    let docs = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    assert_eq!(docs.read_any("readFile"), docs.read("readFile"));
    assert_eq!(docs.read_any("FileRead"), docs.read_type("FileRead"));
    assert!(docs.read_any("neitherOne").is_none());
}

/// **A lookup says what each argument is for, and what each field of the result means.**
///
/// A signature and a paragraph leave a model to infer the rest from names alone, and the two things
/// it has to infer are exactly the two it cannot: what to put in an argument it has never passed,
/// and what a field of a returned record means. Both are the SDK's own words — reflected out of the
/// `@param` written on the argument and the comment written above the member — so this is also the
/// assertion that the reflection reaches the model rather than stopping at the committed JSON.
#[test]
fn a_lookup_explains_every_argument_and_every_field() {
    let docs = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    let read_file = docs.read("readFile").expect("readFile is bound");

    // The argument, and the fields of the structured argument nested under it.
    assert!(read_file.contains("\n  path: string — "), "{read_file}");
    assert!(read_file.contains("\n  options?: "), "{read_file}");
    assert!(
        read_file.contains("\n    offset?: number — "),
        "{read_file}"
    );

    // The referenced type's own members are explained in ITS view, not in this one.
    let file_read = docs
        .read_type("FileRead")
        .expect("FileRead is in the catalogue");
    assert!(
        file_read.contains("\n  totalLines: number — "),
        "{file_read}"
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
    let docs = DocsRuntime::new(
        vec!["update_issue".to_string()],
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    let status = docs
        .read_type("IssueStatus")
        .expect("the status union is catalogued");
    assert!(status.contains("\n  \"in_progress\" — "), "{status}");
}

/// A lookup for a function the run did not enable is `None` — the model is told the name is not
/// available rather than shown docs for a method its scope does not carry.
#[test]
fn read_of_a_withheld_function_is_none() {
    let docs = DocsRuntime::new(
        vec!["read_file".to_string()],
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    assert!(docs.read("writeFile").is_none());
}

/// The one meta function documents itself, so `view.openDocsView("list")` is answerable even though
/// `list` has no catalogue entry of its own.
#[test]
fn read_documents_the_list_meta_function() {
    let docs = DocsRuntime::new(
        Vec::new(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    let list = docs.read("list").expect("list is a meta function");
    // Its signature and its paragraph both come from the SDK declaration the guest binds it from.
    assert!(list.contains("list(): FunctionSummary[]"), "{list}");
    // And it points at the call that opens a function's full documentation.
    assert!(list.contains("view.openDocsView"), "{list}");
    assert!(docs.read("readDocs").is_none(), "`readDocs` is retired");
    // The type it names is a view of its own, reachable by that name.
    assert!(
        docs.read_type("FunctionSummary")
            .is_some_and(|summary| summary.contains("summary")),
        "the return type a signature names is addressable"
    );
}

/// A missed lookup is answered with the bound names nearest it — the tool name the model wrote
/// instead of the spelling, and the stem it completed by guess.
#[test]
fn a_miss_suggests_the_bound_names_nearest_it() {
    let docs = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    assert_eq!(docs.suggest("write_file"), vec!["writeFile"]);
    assert_eq!(docs.suggest("write"), vec!["writeFile"]);
    // The meta function is a candidate like any other: it is bound on every object, and `read`
    // answers it.
    assert_eq!(docs.suggest("lists"), vec!["list"]);
}

/// **A suggestion is drawn from this agent's scope, never from the catalogue.**
///
/// The failure a whole-catalogue hint would cause is the worst kind: the model reads a plausible
/// name gg itself offered, writes the call, and is answered with a `ReferenceError`. So a run that
/// withheld `write_file` does not hear `writeFile` back — from the lookup or from the hint.
#[test]
fn a_suggestion_never_names_a_function_this_agent_lacks() {
    let docs = DocsRuntime::new(
        vec!["read_file".to_string()],
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    assert!(docs.read("writeFile").is_none());
    assert!(
        docs.suggest("write_file").is_empty(),
        "`writeFile` is not bound, so it is not offered: {:?}",
        docs.suggest("write_file")
    );
    // What *is* bound is still offered, on the same query shape.
    assert_eq!(docs.suggest("read_file"), vec!["readFile"]);

    // The ending gate is a scope like any other: a reviewer's verdicts are not suggested to an
    // agent doing work, and `finish` is not suggested to a reviewer.
    let worker = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    assert!(worker.suggest("request_changes").is_empty());
    let reviewer = DocsRuntime::new(
        enabled(),
        EndingRole::Review,
        &[],
        GgProgramLanguage::TypeScript,
    );
    assert_eq!(reviewer.suggest("request_changes"), vec!["requestChanges"]);
    assert!(reviewer.suggest("finsih").is_empty());
}

/// The **third gate**: the program library, which neither the enabled set nor the ending role can
/// express.
///
/// It is documented exactly when the capability is on, because a directory that lists a function the
/// scope did not bind is the one thing a directory must never do — and the failure it would produce
/// is the worst kind: the model reads a plausible signature, writes the call, and is answered with a
/// `ReferenceError` about a name gg itself named.
#[test]
fn the_program_library_is_documented_only_when_the_agent_keeps_one() {
    let without = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    assert!(without.read("rerun").is_none());
    assert_eq!(
        without
            .list("programs")
            .iter()
            .map(|f| f.name.as_str())
            .collect::<Vec<_>>(),
        vec!["list"],
        "an unknown object lists the meta function alone"
    );

    let with = DocsRuntime::new(
        enabled(),
        EndingRole::Standard,
        &[CAPABILITY_PROGRAM_LIBRARY],
        GgProgramLanguage::TypeScript,
    );
    let listed = with.list("programs");
    let names: Vec<&str> = listed.iter().map(|f| f.name.as_str()).collect();
    assert!(names.contains(&"history"), "{names:?}");
    assert!(names.contains(&"get"), "{names:?}");
    assert!(names.contains(&"rerun"), "{names:?}");
    let doc = with
        .read("rerun")
        .expect("the library's calls are documented");
    assert!(doc.contains("rerun(source: string)"), "{doc}");

    // The gate is the library's alone: it does not withdraw anything else, and it is not withdrawn
    // by an ending role.
    assert!(with.read("readFile").is_some());
    let reviewer = DocsRuntime::new(
        enabled(),
        EndingRole::Review,
        &[CAPABILITY_PROGRAM_LIBRARY],
        GgProgramLanguage::TypeScript,
    );
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
///    [fully-qualified name](crate::sandbox::CatalogueFunction::fqn) where its arm emits one, which
///    is also what a search hit is filed under;
/// 2. the name a program calls that function by, which is what a call site writes;
/// 3. the **spelling** every type reference writes into a signature — `Files.FileRead`,
///    `files::FileRead` — which is neither the type's key nor its bare name on a converted arm, and
///    which is the string a model most often copies, because it is printed inside the signature of
///    the very function whose documentation it just opened.
///
/// It passes vacuously on an arm whose spellings *are* its keys, which is every unconverted arm, and
/// that is the point: it is the assertion that converting an arm cannot quietly cost the model the
/// ability to open what the conversion made it read. It is asked of an agent holding everything,
/// because what a *withheld* name answers is a different question with its own tests
/// ([`a_type_only_a_withheld_function_reaches_is_not_readable`]).
#[test]
fn every_name_a_model_is_shown_opens_on_every_arm() {
    for language in crate::sandbox::all_languages() {
        let arm = language.display_name();
        // Both roles, because the endings are bound one group per role and a name no role binds
        // is a name no model is ever shown.
        for role in [EndingRole::Standard, EndingRole::Review] {
            let docs = DocsRuntime::new(
                crate::tools::ALL_TOOL_NAMES
                    .iter()
                    .map(|tool| tool.to_string())
                    .collect(),
                role,
                test_cabinet_core::gg_query::GG_CAPABILITY_CATALOG,
                language.id(),
            );
            for function in crate::sandbox::catalogue_functions(language) {
                if !docs.bound(&function) {
                    continue;
                }
                for key in [function.fqn.unwrap_or(function.name), function.name] {
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

/// **Every grouping name an arm's `list` can pass resolves to that function's directory**, on every
/// arm and in both of the two spellings a guest can hold.
///
/// The two spellings exist because [`list`](DocsRuntime::list) is reached by two different routes.
/// A compiled arm calls the `docs.list-functions` import with the module path its own SDK closed
/// over, so it asks with [`object`](crate::sandbox::CatalogueFunction::object). The three arms that
/// share the ECMAScript guest cannot: that guest seeds each object's `list` with the **API object**
/// name it built the object under, so a PureScript program writing `Gg.Files.list` asks with `fs`.
/// A directory that answered only one of the two would hand the other route a well-formed empty
/// array — the failure shape worth designing out, because an empty directory reads as a capability
/// that is not there rather than as a question asked in the wrong words.
///
/// It is asked of an agent holding everything, so that a name missing from the answer is a grouping
/// that does not resolve rather than a capability this run withheld.
#[test]
fn both_spellings_of_a_grouping_open_its_directory_on_every_arm() {
    for language in crate::sandbox::all_languages() {
        let arm = language.display_name();
        for role in [EndingRole::Standard, EndingRole::Review] {
            let docs = DocsRuntime::new(
                crate::tools::ALL_TOOL_NAMES
                    .iter()
                    .map(|tool| tool.to_string())
                    .collect(),
                role,
                test_cabinet_core::gg_query::GG_CAPABILITY_CATALOG,
                language.id(),
            );
            for function in crate::sandbox::catalogue_functions(language) {
                if !docs.bound(&function) {
                    continue;
                }
                let legacy = crate::sandbox::operation_of(&function)
                    .map(|operation| operation.call.object)
                    .unwrap_or(function.object);
                for grouping in [function.object, legacy] {
                    let listed = docs.list(grouping);
                    assert!(
                        listed.iter().any(|entry| entry.name == function.name),
                        "{arm}: `{}` is grouped under `{grouping}`, and asking that grouping for \
                         its directory does not list it",
                        function.name,
                    );
                }
            }
        }
    }
}
