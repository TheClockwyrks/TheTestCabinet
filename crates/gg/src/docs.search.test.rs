//! Tests for the [documentation search](super) — the matching, the tiers, the filters, the page,
//! and the permission filter that decides what a search may even see.

use test_cabinet_core::gg::{
    CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_READ_FILE, CAPABILITY_SHELL, GgProgramLanguage,
};

use super::*;
use crate::docs::DocsRuntime;
use crate::ending::EndingRole;
use crate::sandbox::{capability_operations, gating_capabilities};

/// A runtime for an agent holding `capabilities`, granted every operation they offer, answering in
/// TypeScript's spellings.
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

/// A runtime for an agent granted **everything** — enough to see the whole surface at once.
fn full() -> DocsRuntime {
    on(GgProgramLanguage::TypeScript)
}

/// [`full`], answering in `language`.
fn on(language: GgProgramLanguage) -> DocsRuntime {
    let capabilities = gating_capabilities();
    let operations = capability_operations(capabilities.iter().copied());
    DocsRuntime::new(
        capabilities.into_iter().map(str::to_string).collect(),
        EndingRole::Standard,
        &operations,
        language,
    )
}

/// A plain query, with no filters and the default page.
fn ask(query: &str) -> DocQuery<'_> {
    DocQuery {
        query,
        ..DocQuery::default()
    }
}

/// The keys of a search's hits, in the order they came back.
fn keys(found: &DocSearch) -> Vec<&str> {
    found.hits.iter().map(|hit| hit.key.as_str()).collect()
}

/// The key a hit for the function or type **spelled** `name` is filed under.
///
/// A query is words and a key is a name, and on an arm reshaped into capability modules those are
/// two different strings: a model searches for `listDir` and the hit that comes back is keyed
/// `gg.files.listDir`, which is what a documentation view is opened by. So every expectation below
/// says which function it means and asks this what that arm files it under.
///
/// Resolved out of the same catalogue the search reads rather than written out, so no test here
/// carries a second copy of how this arm spells its module paths — which is the copy that would
/// drift the next time an arm is reshaped.
fn key_of(name: &str) -> String {
    let language = crate::sandbox::language(GgProgramLanguage::TypeScript);
    if let Some(function) = crate::sandbox::catalogue_functions(language)
        .into_iter()
        .find(|function| function.name == name)
    {
        return function.fqn.to_string();
    }
    crate::sandbox::type_declaration(language, name)
        .map(|declared| declared.key().to_string())
        .unwrap_or_else(|| name.to_string())
}

/// **A term matches a name as a case-insensitive substring**, which is the requirement in the brief
/// spelled with the brief's own example: `foobar` finds `getFoobar`.
#[test]
fn a_substring_of_a_name_finds_it() {
    let docs = full();
    let found = docs.search(ask("dir")).expect("a usable query");
    let list_dir = key_of("listDir");
    assert!(
        keys(&found).contains(&list_dir.as_str()),
        "{:?}",
        keys(&found)
    );
    // Case is not part of the question.
    let shouted = docs.search(ask("LISTDIR")).expect("a usable query");
    assert!(
        keys(&shouted).contains(&list_dir.as_str()),
        "{:?}",
        keys(&shouted)
    );
}

/// A name is matched **folded**, so one query finds the same function under a gg tool name, a
/// camel-cased spelling, or a snake-cased one.
#[test]
fn a_name_is_matched_through_its_spelling() {
    let docs = full();
    for spelling in ["write_file", "writeFile", "WRITE FILE"] {
        let found = docs.search(ask(spelling)).expect("a usable query");
        assert_eq!(
            found.hits.first().map(|hit| hit.key.as_str()),
            Some(key_of("writeFile").as_str()),
            "`{spelling}` should land on writeFile: {:?}",
            keys(&found)
        );
    }
}

/// **Identifiers outrank prose.** A word that is a function's whole name comes before one that only
/// appears in some other entry's description, however often it appears there.
#[test]
fn an_identifier_match_outranks_a_description_match() {
    let docs = full();
    let found = docs.search(ask("readFile")).expect("a usable query");
    assert_eq!(
        found.hits.first().map(|hit| hit.key.as_str()),
        Some(key_of("readFile").as_str()),
        "an exact name is the surest evidence there is: {:?}",
        keys(&found)
    );
    // And plenty of other entries do mention it, so this is a real ordering rather than a
    // single-hit result.
    assert!(found.total > 1, "{:?}", keys(&found));
}

/// A prefix beats a mere containment, which beats a match in the text.
#[test]
fn the_tiers_are_ordered_name_then_prefix_then_text() {
    let docs = full();
    let found = docs.search(ask("read")).expect("a usable query");
    let ranked = keys(&found);
    let at = |name: &str| {
        let key = key_of(name);
        ranked.iter().position(|found| *found == key)
    };
    let (prefix, contains) = (
        at("readFile").expect("readFile matched"),
        at("openFile").expect("openFile's documentation mentions reading"),
    );
    assert!(
        prefix < contains,
        "a name beginning with the term ranks above one that only mentions it: {ranked:?}"
    );
}

/// **Breadth outranks frequency**: an entry mentioning both words beats one that repeats one of
/// them.
///
/// Read between two entries at one tier rather than off the top of the page, because the tier is
/// compared first and one of this query's words is a whole function name — `docs.search` — which
/// takes the exact-identifier tier and therefore the first place. That is the ranking working: a
/// word that names something outranks the same word in a paragraph, which the case above this one
/// asserts directly. What is left to observe is the tie, and `searchMemories` and `searchArchive`
/// are it: both are named for the term `search`, so neither can win on tier, and one of them says
/// `search` twice while the other also says `memory` and `keyword`.
#[test]
fn matching_more_of_the_query_ranks_higher() {
    let docs = full();
    let found = docs
        .search(ask("memory search keyword"))
        .expect("a usable query");
    let ranked = keys(&found);
    let at = |name: &str| {
        let key = key_of(name);
        ranked
            .iter()
            .position(|found| *found == key)
            .unwrap_or_else(|| panic!("`{name}` matched: {ranked:?}"))
    };
    assert!(
        at("searchMemories") < at("searchArchive"),
        "the entry answering more of the query comes first: {ranked:?}"
    );
}

/// A search is **reproducible**: the same query answers in the same order every time, because the
/// last tiebreak is the key rather than catalogue order.
#[test]
fn an_identical_query_answers_in_an_identical_order() {
    let docs = full();
    let once = docs.search(ask("view")).expect("a usable query");
    let twice = docs.search(ask("view")).expect("a usable query");
    assert_eq!(keys(&once), keys(&twice));
}

/// **Only functions this agent may call come back.** A run that withheld a tool never advertises it,
/// which is the whole reason search may be the only way a model finds its surface.
#[test]
fn a_withheld_function_is_not_findable() {
    let docs = runtime(&[CAPABILITY_READ_FILE]);
    let found = docs.search(ask("file")).expect("a usable query");
    let keys = keys(&found);
    assert!(keys.contains(&key_of("readFile").as_str()), "{keys:?}");
    assert!(
        !keys.contains(&key_of("writeFile").as_str())
            && !keys.contains(&key_of("editFile").as_str()),
        "an agent granted only the read-file capability must not advertise the others: {keys:?}"
    );
}

/// A **capability-bought** family is filtered on exactly the same predicate — the one that reads gg's
/// operations table — rather than on a second copy of it that only knows about tools.
#[test]
fn a_capability_family_is_filtered_by_the_same_predicate() {
    let without = runtime(&[]);
    let found = without.search(ask("program")).expect("a usable query");
    assert!(
        !keys(&found).contains(&key_of("rerun").as_str()),
        "an agent with no program library must not find its calls: {:?}",
        keys(&found)
    );
    let with = runtime(&[CAPABILITY_PROGRAM_LIBRARY]);
    let found = with.search(ask("program")).expect("a usable query");
    assert!(
        keys(&found).contains(&key_of("rerun").as_str()),
        "{:?}",
        keys(&found)
    );
}

/// An **ending** call belongs to one role, and a search answers per role like everything else.
#[test]
fn an_ending_call_is_findable_only_by_the_role_that_has_it() {
    let standard = runtime(&[]);
    assert!(
        keys(&standard.search(ask("approve")).expect("a usable query")).is_empty(),
        "a standard agent has no `approve`"
    );
    let reviewer = in_role(&[], EndingRole::Review);
    let found = reviewer.search(ask("approve")).expect("a usable query");
    assert!(
        keys(&found).contains(&key_of("approve").as_str()),
        "{:?}",
        keys(&found)
    );
}

/// **A type is visible when a function that mentions it is** — and invisible when none is, because
/// advertising the shape of a value only a withheld call can produce teaches a model nothing it can
/// use.
#[test]
fn a_type_is_visible_through_the_functions_that_use_it() {
    let with_shell = runtime(&[CAPABILITY_SHELL]);
    let found = with_shell
        .search(ask("ShellOutput"))
        .expect("a usable query");
    assert!(
        keys(&found).contains(&key_of("ShellOutput").as_str()),
        "{:?}",
        keys(&found)
    );

    let without_shell = runtime(&[CAPABILITY_READ_FILE]);
    let found = without_shell
        .search(ask("ShellOutput"))
        .expect("a usable query");
    assert!(
        !keys(&found).contains(&key_of("ShellOutput").as_str()),
        "no bound function mentions it: {:?}",
        keys(&found)
    );
}

/// **A type reports only the modules this agent has a bound function in**, and answers the module
/// filter on the same narrowed set.
///
/// A type's module attribution is the union over every function that mentions it, which for a shared
/// error type is most of the surface. Reported raw it would hand an agent holding `read_file` alone
/// the names `programs`, `skills` and `memory` — and a module name is the discovery vocabulary the
/// prompt gives the model, so the next call would be `search(module: "skills")` and an empty page it
/// cannot tell from *nothing matched*. The filter is narrowed with the report so the two cannot
/// disagree about where an entry lives.
/// Asserted on the **Rust** arm rather than TypeScript's, because TypeScript's catalogue has exactly
/// one type referenced from two modules and both are gated on the same capability, so the narrowing
/// has nothing to bite on there. Rust's `gg::core::ApiError` is referenced from every module that
/// binds anything.
#[test]
fn a_types_modules_are_narrowed_to_what_this_agent_binds() {
    let rust = |capabilities: &[&str]| {
        let operations = capability_operations(capabilities.iter().copied());
        DocsRuntime::new(
            capabilities.iter().map(|id| id.to_string()).collect(),
            EndingRole::Standard,
            &operations,
            GgProgramLanguage::Rust,
        )
    };
    // Searched by the type's own name and found by its KEY, which are two different strings: a
    // query is words, and a key is the fully-qualified name a view is opened by.
    let modules_of = |docs: &DocsRuntime, key: &str| -> String {
        docs.search(ask("ApiError"))
            .expect("a usable query")
            .hits
            .into_iter()
            .find(|hit| hit.key == key)
            .unwrap_or_else(|| panic!("`{key}` is visible to this agent"))
            .module
    };

    // The key is the type's fully-qualified name, because this arm is written in the normalized doc
    // model and a name is what a documentation view is keyed by.
    const API_ERROR: &str = "gg::core::ApiError";
    let reader = rust(&[CAPABILITY_READ_FILE]);
    let narrowed = modules_of(&reader, API_ERROR);
    assert!(
        narrowed.contains("gg::files"),
        "the module it does hold a call in: {narrowed}"
    );
    // Every family it holds nothing in is absent, whatever the catalogue's own union says.
    for absent in ["memories", "skills", "programs", "tasks", "board"] {
        assert!(
            !narrowed.contains(&format!("gg::{absent}")),
            "this agent has no bound call in `{absent}`: {narrowed}"
        );
        // And the filter agrees with the report, so the model cannot be pointed at a module whose
        // page would come back silently empty.
        let found = reader
            .search(DocQuery {
                query: "ApiError",
                module: Some(absent),
                ..DocQuery::default()
            })
            .expect("a usable query");
        assert!(
            !keys(&found).contains(&API_ERROR),
            "`{absent}` answered a type it cannot reach: {:?}",
            keys(&found)
        );
    }

    // An agent that holds the surface is told the whole union, because for it the union is true.
    let whole = modules_of(&rust(&gating_capabilities()), API_ERROR);
    for present in ["files", "memories", "skills", "tasks"] {
        assert!(
            whole.contains(&format!("gg::{present}")),
            "every family that raises it: {whole}"
        );
    }
}

/// The **kind** filter narrows to functions or to types, and nothing else.
#[test]
fn the_kind_filter_narrows_to_functions_or_types() {
    let docs = full();
    let functions = docs
        .search(DocQuery {
            query: "file",
            kind: Some("function"),
            ..DocQuery::default()
        })
        .expect("a usable query");
    assert!(!functions.hits.is_empty());
    assert!(
        functions
            .hits
            .iter()
            .all(|hit| hit.kind == DocKind::Function)
    );

    let types = docs
        .search(DocQuery {
            query: "file",
            kind: Some("type"),
            ..DocQuery::default()
        })
        .expect("a usable query");
    assert!(!types.hits.is_empty());
    assert!(types.hits.iter().all(|hit| hit.kind == DocKind::Type));
}

/// The **module** filter is an exact lookup, and accepts either gg's own id for the module or the
/// spelling this language writes — so a prompt naming one and a model typing the other both work.
#[test]
fn the_module_filter_accepts_ggs_id_and_this_languages_spelling() {
    let docs = full();
    let by_path = docs
        .search(DocQuery {
            query: "",
            module: Some("gg.files"),
            ..DocQuery::default()
        })
        .expect("an empty query with a filter is a directory");
    let by_id = docs
        .search(DocQuery {
            query: "",
            module: Some("FILES"),
            ..DocQuery::default()
        })
        .expect("an empty query with a filter is a directory");
    assert_eq!(keys(&by_path), keys(&by_id));
    assert!(
        keys(&by_path).contains(&key_of("readFile").as_str()),
        "{:?}",
        keys(&by_path)
    );
    assert!(
        !keys(&by_path).contains(&key_of("shell").as_str()),
        "the filter is exact: {:?}",
        keys(&by_path)
    );
}

/// **An empty query with a module filter is that module's directory** — the thing a per-object
/// `list` was, made global and paginated.
#[test]
fn an_empty_query_with_a_filter_is_a_directory() {
    let docs = full();
    let directory = docs
        .search(DocQuery {
            query: "   ",
            module: Some("gg.tasks"),
            limit: Some(MAX_SEARCH_LIMIT),
            ..DocQuery::default()
        })
        .expect("a filter is something to look for");
    assert!(directory.total >= 5, "{:?}", keys(&directory));
    // Every entry it holds really lives in the module that was asked for. A *function* lives in
    // exactly one, so for those this is equality; a **type** is attributed to every module whose
    // calls hand it back, and the two shared error types are raised by all of them — so the claim is
    // membership in the reported list, which is the same claim for both kinds.
    assert!(
        directory
            .hits
            .iter()
            .all(|hit| hit.module.split(", ").any(|module| module == "gg.tasks")),
        "{:?}",
        directory
            .hits
            .iter()
            .map(|hit| (hit.key.as_str(), hit.module.as_str()))
            .collect::<Vec<_>>()
    );
    assert!(
        directory.hits.iter().any(|hit| hit.kind == DocKind::Type)
            && directory
                .hits
                .iter()
                .any(|hit| hit.kind == DocKind::Function),
        "a module's directory carries both its calls and the shapes they use: {:?}",
        keys(&directory)
    );
    // **Ordered by key alone**, and the two kinds interleaved. Nothing here distinguishes one entry
    // from another by relevance, and the type-wins-a-tie bias is confined to the identifier tiers —
    // so a directory reads as one alphabetical list rather than as every type followed by every
    // function, which is an ordering no reader asked for.
    let mut sorted = keys(&directory);
    sorted.sort_unstable();
    assert_eq!(keys(&directory), sorted);
}

/// The **type** filter answers *what can I do with a value of this shape*: the type itself, and the
/// functions whose signatures mention it.
#[test]
fn the_type_filter_returns_the_type_and_what_uses_it() {
    let docs = full();
    let found = docs
        .search(DocQuery {
            query: "",
            declared_type: Some("FileRead"),
            limit: Some(MAX_SEARCH_LIMIT),
            ..DocQuery::default()
        })
        .expect("a filter is something to look for");
    let keys = keys(&found);
    assert!(keys.contains(&key_of("FileRead").as_str()), "{keys:?}");
    assert!(keys.contains(&key_of("readFile").as_str()), "{keys:?}");
    assert!(
        !keys.contains(&key_of("shell").as_str()),
        "nothing about a shell call mentions it: {keys:?}"
    );
}

/// **Pagination reports the total behind the page**, so a model can tell a capped page from a
/// complete answer.
#[test]
fn a_page_reports_the_total_behind_it() {
    let docs = full();
    let first = docs
        .search(DocQuery {
            query: "file",
            limit: Some(2),
            ..DocQuery::default()
        })
        .expect("a usable query");
    assert_eq!(first.hits.len(), 2);
    assert_eq!(first.offset, 0);
    assert!(first.total > 2, "there is more behind it");

    let second = docs
        .search(DocQuery {
            query: "file",
            offset: Some(2),
            limit: Some(2),
            ..DocQuery::default()
        })
        .expect("a usable query");
    assert_eq!(second.offset, 2);
    assert_eq!(second.total, first.total, "the total is of the whole match");
    assert!(
        keys(&second).iter().all(|key| !keys(&first).contains(key)),
        "a second page is the next hits, not the same ones"
    );

    // An offset past the end is an empty page rather than a failure — the total says why.
    let past = docs
        .search(DocQuery {
            query: "file",
            offset: Some(10_000),
            ..DocQuery::default()
        })
        .expect("a usable query");
    assert!(past.hits.is_empty());
    assert_eq!(past.total, first.total);
}

/// A page size past the ceiling is **clamped**, not refused: asking for everything is a reasonable
/// thing to mean, and the total then says how much of it arrived.
#[test]
fn an_oversized_page_is_clamped() {
    let docs = full();
    let found = docs
        .search(DocQuery {
            query: "e",
            limit: Some(10_000),
            ..DocQuery::default()
        })
        .expect("a usable query");
    assert!(found.hits.len() as u32 <= MAX_SEARCH_LIMIT);
}

/// The default page is [`DEFAULT_SEARCH_LIMIT`] when the caller names none.
#[test]
fn a_page_with_no_limit_is_the_default_size() {
    let docs = full();
    let found = docs.search(ask("e")).expect("a usable query");
    assert!(found.total > DEFAULT_SEARCH_LIMIT, "{}", found.total);
    assert_eq!(found.hits.len() as u32, DEFAULT_SEARCH_LIMIT);
}

/// **A query with nothing in it and no filter is refused**, not answered with an empty page: *you
/// asked for nothing* and *nothing matched* are different answers.
#[test]
fn a_query_with_nothing_to_look_for_is_refused() {
    let docs = full();
    let refusal = docs.search(ask("   ")).expect_err("nothing to look for");
    assert_eq!(refusal.failure, crate::tools::ToolFailure::InvalidArgument);
    assert!(refusal.message.contains("module"), "{}", refusal.message);
}

/// An **unrecognised kind** is refused rather than ignored, because ignoring it would answer a wider
/// question than the model asked and it would have no way to notice.
#[test]
fn an_unknown_kind_filter_is_refused() {
    let docs = full();
    let refusal = docs
        .search(DocQuery {
            query: "file",
            kind: Some("method"),
            ..DocQuery::default()
        })
        .expect_err("`method` is not a kind today");
    assert_eq!(refusal.failure, crate::tools::ToolFailure::InvalidArgument);
    assert!(refusal.message.contains("function"), "{}", refusal.message);
}

/// A page of **zero** is refused: it is a call that could never answer anything, and reading it as
/// the default would be gg deciding what the model meant.
#[test]
fn a_page_of_zero_is_refused() {
    let docs = full();
    let refusal = docs
        .search(DocQuery {
            query: "file",
            limit: Some(0),
            ..DocQuery::default()
        })
        .expect_err("a page of nothing");
    assert_eq!(refusal.failure, crate::tools::ToolFailure::InvalidArgument);
}

/// A query matching nothing is an **empty page**, not a refusal — the other half of the same
/// distinction.
#[test]
fn a_query_matching_nothing_is_an_empty_page() {
    let docs = full();
    let found = docs
        .search(ask("quinquagenarian"))
        .expect("a usable query that matches nothing");
    assert_eq!(found.total, 0);
    assert!(found.hits.is_empty());
}

/// A hit carries the **brief and only the brief**: choosing is what a result list is for, and
/// reading is what a documentation view is for.
#[test]
fn a_hit_carries_a_brief_and_not_the_documentation() {
    let docs = full();
    let found = docs.search(ask("readFile")).expect("a usable query");
    let hit = found.hits.first().expect("a hit");
    assert!(!hit.summary.is_empty());
    assert!(
        !hit.summary.contains('\n'),
        "a brief is one line: {:?}",
        hit.summary
    );
    let whole = docs.read(&hit.key).expect("the entry is readable");
    assert!(
        whole.len() > hit.summary.len(),
        "the view carries more than the hit did"
    );
}

/// **Every hit is openable**: the key a search hands back resolves through the same lookup a docview
/// is placed from, for functions and for types alike, on every registered language.
#[test]
fn every_hit_is_openable_on_every_language() {
    for language in crate::sandbox::all_languages() {
        let docs = on(language.id());
        let found = docs
            .search(DocQuery {
                query: "e",
                limit: Some(MAX_SEARCH_LIMIT),
                ..DocQuery::default()
            })
            .expect("a usable query");
        assert!(
            !found.hits.is_empty(),
            "{}: nothing matched at all",
            language.display_name()
        );
        for hit in &found.hits {
            assert!(
                docs.read_any(&hit.key).is_some(),
                "{}: `{}` came back from a search and does not open",
                language.display_name(),
                hit.key
            );
        }
    }
}

/// Every registered language's index builds and answers, and every hit it returns is one that
/// language's agent could call — the cross-arm shape of the permission rule.
#[test]
fn every_language_answers_only_with_what_its_agent_binds() {
    for language in crate::sandbox::all_languages() {
        let operations = capability_operations([CAPABILITY_READ_FILE]);
        let docs = DocsRuntime::new(
            vec![CAPABILITY_READ_FILE.to_string()],
            EndingRole::Standard,
            &operations,
            language.id(),
        );
        let found = docs
            .search(DocQuery {
                query: "",
                module: Some("files"),
                limit: Some(MAX_SEARCH_LIMIT),
                ..DocQuery::default()
            })
            .expect("a filter is something to look for");
        let bound: Vec<&str> = crate::sandbox::catalogue_functions(language)
            .into_iter()
            .filter(|function| docs.bound(function))
            .map(|function| function.fqn)
            .collect();
        for hit in found
            .hits
            .iter()
            .filter(|hit| hit.kind == DocKind::Function)
        {
            assert!(
                bound.contains(&hit.key.as_str()),
                "{}: search returned `{}`, which this agent does not bind",
                language.display_name(),
                hit.key
            );
        }
    }
}

/// **Every argument an arm declares is in the index**: its name with the signature, its own line
/// with the detail.
///
/// Asserted over the index rather than through a query because it is a statement about what the
/// evidence *is* — a search can only be as good as what was filed — and over every arm because the
/// thing it defends is cross-arm. Ten arms write an argument's name into the signature string
/// themselves; the eleventh declares a curried type that names nothing, and before the names were
/// read off `parameters` a model on that arm could not find a call by an argument it had been told
/// the name of.
#[test]
fn every_arguments_name_and_description_is_indexed() {
    for language in crate::sandbox::all_languages() {
        let index = index(language);
        for function in crate::sandbox::catalogue_functions(language) {
            // An entry gg has no operation for is not indexed at all, and could never be returned.
            let Some(entry) = index
                .entries
                .iter()
                .find(|entry| entry.kind == DocKind::Function && entry.key == function.fqn)
            else {
                continue;
            };
            for shape in function.signatures {
                for parameter in &shape.parameters {
                    assert!(
                        entry.signature.contains(&parameter.name.to_lowercase()),
                        "{}: `{}`'s argument `{}` is in no signature evidence",
                        language.display_name(),
                        function.fqn,
                        parameter.name,
                    );
                    assert!(
                        entry.detail_folded.contains(&parameter.doc.to_lowercase()),
                        "{}: what `{}`'s argument `{}` says is in no detail evidence",
                        language.display_name(),
                        function.fqn,
                        parameter.name,
                    );
                }
            }
        }
    }
}

/// **An argument's name finds the call it belongs to, on every arm.**
///
/// The query is the arm's own spelling of the argument, taken from the same catalogue the search
/// reads, because eleven arms name one argument several ways — `old_string`, `oldString`, and
/// Swift's label `replacing` — and a test carrying its own copy of that would be testing the copy.
#[test]
fn an_argument_name_finds_its_call_on_every_arm() {
    for language in crate::sandbox::all_languages() {
        let docs = on(language.id());
        let edit = crate::sandbox::catalogue_functions(language)
            .into_iter()
            .find(|function| function.operation == "files.edit_file")
            .expect("every arm binds files.edit_file");
        // The argument that is not the path: every arm takes three, and the second is the one whose
        // name is distinctive enough that the answer is about it rather than about paths.
        let named = edit.signatures[0].parameters[1].name.as_str();
        let found = docs
            .search(DocQuery {
                query: named,
                limit: Some(MAX_SEARCH_LIMIT),
                ..DocQuery::default()
            })
            .expect("a usable query");
        assert!(
            found.hits.iter().any(|hit| hit.key == edit.fqn),
            "{}: `{}` names `{}`'s second argument and finds {:?}",
            language.display_name(),
            named,
            edit.fqn,
            keys(&found),
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------------------------

/// **A module is a searchable kind, and the hit opens.**
///
/// The module is the entry a model needs before any other: nothing gg offers is in scope until the
/// program has imported the module a symbol lives in, so a surface whose modules are unsearchable
/// hands a model names it has no route to reach. Before this the prompt named module paths that
/// search could not return and `open-doc-view` could not open.
#[test]
fn a_module_is_searchable_and_its_hit_opens() {
    let docs = full();
    let found = docs
        .search(DocQuery {
            query: "",
            module: Some("files"),
            kind: Some("module"),
            limit: Some(MAX_SEARCH_LIMIT),
            ..DocQuery::default()
        })
        .expect("a filter is something to look for");

    let hit = found.hits.first().expect("the files module is a hit");
    assert_eq!(hit.kind, DocKind::Module);
    assert!(!hit.summary.is_empty(), "a module carries its brief");
    assert!(
        !hit.summary.contains('\n'),
        "a brief is one line: {:?}",
        hit.summary
    );
    let view = docs
        .read_any(&hit.key)
        .expect("a module search returned opens as a module view");
    assert!(
        view.len() > hit.summary.len(),
        "the view carries more than the hit did"
    );
}

/// **A module's view says how to reach it and what is in it.**
///
/// The whole reason a module is a view rather than a line in a listing: the import is the line a
/// program has to write, and the entries under it are what importing it buys. Both are read off the
/// arm's own catalogue, so no arm's spelling is written down here.
#[test]
fn a_module_view_carries_its_import_line_and_its_bound_functions() {
    for language in crate::sandbox::all_languages() {
        let docs = on(language.id());
        for module in crate::sandbox::catalogue_modules(crate::sandbox::language(language.id())) {
            let Some(view) = docs.read_module(module.path) else {
                continue;
            };
            assert!(
                view.contains("Defined in"),
                "{}: `{}` does not say where it is defined:\n{view}",
                language.display_name(),
                module.path
            );
            if let Some(import) = module.import {
                assert!(
                    view.contains(import),
                    "{}: `{}` does not quote the line a program writes:\n{view}",
                    language.display_name(),
                    module.path
                );
            }
            let published =
                crate::sandbox::catalogue_functions(crate::sandbox::language(language.id()))
                    .into_iter()
                    .filter(|function| {
                        crate::sandbox::operation_of(function)
                            .is_some_and(|operation| operation.id.namespace == module.id)
                    })
                    .count();
            assert!(published > 0, "a readable module publishes something");
            assert!(
                view.lines().count() > 1,
                "{}: `{}` lists none of what it offers:\n{view}",
                language.display_name(),
                module.path
            );
        }
    }
}

/// **A module every function of which this run withheld is not returned and does not open.**
///
/// The same rule a type keeps, for the same reason: a module is not a call, so it is gated by
/// reachability rather than on its own account — and a module list a model can read that describes
/// a surface it cannot use is a turn spent writing calls that refuse.
#[test]
fn a_module_with_nothing_bound_is_neither_returned_nor_openable() {
    let docs = runtime(&[CAPABILITY_READ_FILE]);
    let found = docs
        .search(DocQuery {
            query: "",
            kind: Some("module"),
            limit: Some(MAX_SEARCH_LIMIT),
            ..DocQuery::default()
        })
        .expect("a filter is something to look for");
    assert!(
        !found.hits.is_empty(),
        "the module the one granted call lives in is still there"
    );
    for hit in &found.hits {
        assert!(
            docs.read_any(&hit.key).is_some(),
            "`{}` came back from a search and does not open",
            hit.key
        );
    }

    let shell =
        crate::sandbox::catalogue_modules(crate::sandbox::language(GgProgramLanguage::TypeScript))
            .into_iter()
            .find(|module| module.id == "shell")
            .expect("the shell module is declared");
    assert!(
        !keys(&found).contains(&shell.path),
        "a module holding nothing this agent may call is not offered: {:?}",
        keys(&found)
    );
    assert!(
        docs.read_module(shell.path).is_none(),
        "and it does not open either"
    );
}

/// An unrecognised `kind` names all three rather than the two it used to.
#[test]
fn an_unknown_kind_names_every_kind_there_is() {
    let refusal = full()
        .search(DocQuery {
            query: "read",
            kind: Some("namespace"),
            ..DocQuery::default()
        })
        .expect_err("a kind gg has no word for is refused");
    for named in ["module", "function", "type"] {
        assert!(
            refusal.message.contains(named),
            "the refusal offers `{named}` back: {}",
            refusal.message
        );
    }
}
