//! Tests for the [documentation search](super) — the matching, the tiers, the filters, the page,
//! and the permission filter that decides what a search may even see.

use test_cabinet_core::gg::{CAPABILITY_PROGRAM_LIBRARY, GgProgramLanguage};

use super::*;
use crate::docs::DocsRuntime;
use crate::ending::EndingRole;

/// A runtime for an agent whose run enabled `tools`, in TypeScript's spellings.
fn runtime(tools: &[&str]) -> DocsRuntime {
    DocsRuntime::new(
        tools.iter().map(|tool| tool.to_string()).collect(),
        EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    )
}

/// A runtime for a fully-tooled agent — enough to see the whole surface at once.
fn full() -> DocsRuntime {
    DocsRuntime::new(
        crate::tools::ALL_TOOL_NAMES
            .iter()
            .map(|tool| tool.to_string())
            .collect(),
        EndingRole::Standard,
        &[CAPABILITY_PROGRAM_LIBRARY],
        GgProgramLanguage::TypeScript,
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

/// **A term matches a name as a case-insensitive substring**, which is the requirement in the brief
/// spelled with the brief's own example: `foobar` finds `getFoobar`.
#[test]
fn a_substring_of_a_name_finds_it() {
    let docs = full();
    let found = docs.search(ask("dir")).expect("a usable query");
    assert!(keys(&found).contains(&"listDir"), "{:?}", keys(&found));
    // Case is not part of the question.
    let shouted = docs.search(ask("LISTDIR")).expect("a usable query");
    assert!(keys(&shouted).contains(&"listDir"), "{:?}", keys(&shouted));
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
            Some("writeFile"),
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
        Some("readFile"),
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
    let at = |name: &str| ranked.iter().position(|key| *key == name);
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
#[test]
fn matching_more_of_the_query_ranks_higher() {
    let docs = full();
    let found = docs
        .search(ask("memory search keyword"))
        .expect("a usable query");
    assert_eq!(
        found.hits.first().map(|hit| hit.key.as_str()),
        Some("searchMemories"),
        "{:?}",
        keys(&found)
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
    let docs = runtime(&["read_file"]);
    let found = docs.search(ask("file")).expect("a usable query");
    let keys = keys(&found);
    assert!(keys.contains(&"readFile"), "{keys:?}");
    assert!(
        !keys.contains(&"writeFile") && !keys.contains(&"editFile"),
        "a run that enabled only `read_file` must not advertise the others: {keys:?}"
    );
}

/// A **capability-bought** family is filtered on exactly the same predicate — the one that reads gg's
/// operations table — rather than on a second copy of it that only knows about tools.
#[test]
fn a_capability_family_is_filtered_by_the_same_predicate() {
    let without = runtime(&[]);
    let found = without.search(ask("program")).expect("a usable query");
    assert!(
        !keys(&found).contains(&"rerun"),
        "an agent with no program library must not find its calls: {:?}",
        keys(&found)
    );
    let with = DocsRuntime::new(
        Vec::new(),
        EndingRole::Standard,
        &[CAPABILITY_PROGRAM_LIBRARY],
        GgProgramLanguage::TypeScript,
    );
    let found = with.search(ask("program")).expect("a usable query");
    assert!(keys(&found).contains(&"rerun"), "{:?}", keys(&found));
}

/// An **ending** call belongs to one role, and a search answers per role like everything else.
#[test]
fn an_ending_call_is_findable_only_by_the_role_that_has_it() {
    let standard = runtime(&[]);
    assert!(
        keys(&standard.search(ask("approve")).expect("a usable query")).is_empty(),
        "a standard agent has no `approve`"
    );
    let reviewer = DocsRuntime::new(
        Vec::new(),
        EndingRole::Review,
        &[],
        GgProgramLanguage::TypeScript,
    );
    let found = reviewer.search(ask("approve")).expect("a usable query");
    assert!(keys(&found).contains(&"approve"), "{:?}", keys(&found));
}

/// **A type is visible when a function that mentions it is** — and invisible when none is, because
/// advertising the shape of a value only a withheld call can produce teaches a model nothing it can
/// use.
#[test]
fn a_type_is_visible_through_the_functions_that_use_it() {
    let with_shell = runtime(&["shell"]);
    let found = with_shell
        .search(ask("ShellOutput"))
        .expect("a usable query");
    assert!(keys(&found).contains(&"ShellOutput"), "{:?}", keys(&found));

    let without_shell = runtime(&["read_file"]);
    let found = without_shell
        .search(ask("ShellOutput"))
        .expect("a usable query");
    assert!(
        !keys(&found).contains(&"ShellOutput"),
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
/// one type referenced from two objects and both are gated on the same tool, so the narrowing has
/// nothing to bite on there. Rust's `ToolError` is referenced from all twelve.
#[test]
fn a_types_modules_are_narrowed_to_what_this_agent_binds() {
    let rust = |tools: &[&str]| {
        DocsRuntime::new(
            tools.iter().map(|tool| tool.to_string()).collect(),
            EndingRole::Standard,
            &[],
            GgProgramLanguage::Rust,
        )
    };
    let modules_of = |docs: &DocsRuntime, key: &str| -> String {
        docs.search(ask(key))
            .expect("a usable query")
            .hits
            .into_iter()
            .find(|hit| hit.key == key)
            .unwrap_or_else(|| panic!("`{key}` is visible to this agent"))
            .module
    };

    let reader = rust(&["read_file"]);
    let narrowed = modules_of(&reader, "ToolError");
    assert!(
        narrowed.contains("fs"),
        "the module it does hold a call in: {narrowed}"
    );
    // Every family it holds nothing in is absent, whatever the catalogue's own union says.
    for absent in ["memory", "skills", "programs", "tasks", "project"] {
        assert!(
            !narrowed.contains(absent),
            "this agent has no bound call in `{absent}`: {narrowed}"
        );
        // And the filter agrees with the report, so the model cannot be pointed at a module whose
        // page would come back silently empty.
        let found = reader
            .search(DocQuery {
                query: "ToolError",
                module: Some(absent),
                ..DocQuery::default()
            })
            .expect("a usable query");
        assert!(
            !keys(&found).contains(&"ToolError"),
            "`{absent}` answered a type it cannot reach: {:?}",
            keys(&found)
        );
    }

    // An agent that holds the surface is told the whole union, because for it the union is true.
    let whole = modules_of(&rust(crate::tools::ALL_TOOL_NAMES), "ToolError");
    for present in ["fs", "memory", "skills", "tasks"] {
        assert!(
            whole.contains(present),
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
            module: Some("fs"),
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
    assert!(keys(&by_path).contains(&"readFile"), "{:?}", keys(&by_path));
    assert!(
        !keys(&by_path).contains(&"shell"),
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
            module: Some("tasks"),
            limit: Some(MAX_SEARCH_LIMIT),
            ..DocQuery::default()
        })
        .expect("a filter is something to look for");
    assert!(directory.total >= 5, "{:?}", keys(&directory));
    assert!(directory.hits.iter().all(|hit| hit.module == "tasks"));
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
    assert!(keys.contains(&"FileRead"), "{keys:?}");
    assert!(keys.contains(&"readFile"), "{keys:?}");
    assert!(
        !keys.contains(&"shell"),
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
        let docs = DocsRuntime::new(
            crate::tools::ALL_TOOL_NAMES
                .iter()
                .map(|tool| tool.to_string())
                .collect(),
            EndingRole::Standard,
            &[CAPABILITY_PROGRAM_LIBRARY],
            language.id(),
        );
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
        let docs = DocsRuntime::new(
            vec!["read_file".to_string()],
            EndingRole::Standard,
            &[],
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
            .map(|function| function.name)
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
