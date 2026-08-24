//! Tests for what the [view](crate::sandbox) caps decide.
//!
//! Every one of these asserts on the **words** as well as the classification, because a cap that
//! refuses without naming itself is a cap the model cannot work around. The whole reason a breach is
//! a catchable `limit-exceeded` rather than a silent truncation is that the model can split the
//! material, trim it, or write it to a file and open a file view of that — but only if the refusal
//! tells it which ceiling it hit.

use super::*;
use crate::context::{EvictionResult, ViewsClosed};

/// A body under the ceiling, with a label, is simply allowed.
#[test]
fn an_ordinary_text_view_passes_every_cap() {
    assert!(text_view_refusal("build failures", "3 tests failed in x.ts").is_none());
}

/// **An empty body is allowed.**
///
/// It is how a program says that something it was showing is now empty — "no failures this time" —
/// and refusing it would make that unexpressible, leaving the model to either keep a stale view or
/// invent a sentence.
#[test]
fn an_empty_body_is_allowed() {
    assert!(text_view_refusal("failures", "").is_none());
}

/// **The turn's composed-body budget is a total, not a per-call cap**, and it names itself, what has
/// been spent and what is left.
///
/// It is the one bound left on how much text a single turn can push into the host, and it exists for
/// the host rather than for the model: there is deliberately no cap on the *number* of views, so
/// without it `for (;;) view.openText(unique(), sixtyFourKiB)` is bounded only by the program's
/// wall-clock timeout. The per-body cap does not help — one reused buffer feeds every call.
#[test]
fn the_turns_composed_body_budget_refuses_by_total_and_says_what_is_left() {
    // Nothing spent: an ordinary body, and even a maximal one, passes.
    assert!(composed_view_budget_refusal(0, 1_024).is_none());
    assert!(composed_view_budget_refusal(0, MAX_TEXT_VIEW_BYTES).is_none());

    // Exactly at the ceiling is still allowed; one byte past it is not. The ceiling is a total, so
    // the same body that passed on an empty budget is refused on a nearly spent one.
    let nearly = MAX_COMPOSED_VIEW_BYTES_PER_TURN - MAX_TEXT_VIEW_BYTES;
    assert!(composed_view_budget_refusal(nearly, MAX_TEXT_VIEW_BYTES).is_none());
    let refusal = composed_view_budget_refusal(nearly + 1, MAX_TEXT_VIEW_BYTES)
        .expect("one byte past the ceiling is refused");
    assert_eq!(refusal.failure, ToolFailure::LimitExceeded);
    assert!(
        refusal
            .message
            .contains(&MAX_COMPOSED_VIEW_BYTES_PER_TURN.to_string()),
        "a cap that does not state its bound cannot be worked around: {}",
        refusal.message
    );
    assert!(
        !refusal.message.contains("MAX_COMPOSED_VIEW_BYTES_PER_TURN"),
        "the refusal must state the bound's value, not the constant that supplies it: {}",
        refusal.message
    );
    assert!(
        refusal
            .message
            .contains(&(MAX_TEXT_VIEW_BYTES - 1).to_string()),
        "the refusal says how much is left, so the program can split what it was composing: {}",
        refusal.message
    );
}

/// **An empty label is not.** A view with no selector could never be closed, replaced or
/// attributed, so it is an argument error rather than a cap.
#[test]
fn a_blank_label_is_an_argument_error() {
    let refusal = text_view_refusal("  \t ", "body").expect("a blank label names nothing");
    assert_eq!(refusal.failure, ToolFailure::InvalidArgument);
    assert!(refusal.message.contains("non-empty label"));
}

/// Both size caps refuse with the violated rule first, then the size that broke them and the
/// bound in parentheses — the facts a program branching on the refusal needs, and nothing else:
/// the constants that supply the bounds are gg's own and stay out of the message.
#[test]
fn the_size_caps_state_the_bound_and_the_size_that_broke_them() {
    let long_label = "l".repeat(MAX_VIEW_LABEL_BYTES + 1);
    let refusal = text_view_refusal(&long_label, "body").expect("the label is over the cap");
    assert_eq!(refusal.failure, ToolFailure::LimitExceeded);
    assert!(refusal.message.contains("exceeds max length"));
    assert!(refusal.message.contains(&MAX_VIEW_LABEL_BYTES.to_string()));
    assert!(
        !refusal.message.contains("MAX_VIEW_LABEL_BYTES"),
        "the refusal must state the bound's value, not the constant that supplies it: {}",
        refusal.message
    );
    assert!(
        refusal.message.contains(&long_label.len().to_string()),
        "the size that broke the cap has to be in the message: {}",
        refusal.message
    );

    let long_body = "b".repeat(MAX_TEXT_VIEW_BYTES + 1);
    let refusal = text_view_refusal("notes", &long_body).expect("the body is over the cap");
    assert_eq!(refusal.failure, ToolFailure::LimitExceeded);
    assert!(refusal.message.contains("exceeds max size"));
    assert!(refusal.message.contains(&MAX_TEXT_VIEW_BYTES.to_string()));
    assert!(
        !refusal.message.contains("MAX_TEXT_VIEW_BYTES"),
        "the refusal must state the bound's value, not the constant that supplies it: {}",
        refusal.message
    );
    assert!(
        refusal.message.contains(&long_body.len().to_string()),
        "the size that broke the cap has to be in the message: {}",
        refusal.message
    );
}

/// A label of exactly the cap is fine: the ceiling is inclusive, and an off-by-one here would refuse
/// a call the documented number says is legal.
#[test]
fn the_size_caps_are_inclusive() {
    let label = "l".repeat(MAX_VIEW_LABEL_BYTES);
    let body = "b".repeat(MAX_TEXT_VIEW_BYTES);
    assert!(text_view_refusal(&label, &body).is_none());
}

/// **A failed documentation lookup names the miss, and then the fix.**
///
/// The hint is a second line, indented under the error the way a compiler indents one, so the first
/// line still reads as the whole diagnostic for a model that needs nothing more.
#[test]
fn a_missed_lookup_names_the_name_and_the_one_it_meant() {
    let refusal = docs_not_found_refusal("write", &["writeFile".to_string()]);
    assert_eq!(refusal.failure, ToolFailure::NotFound);
    assert_eq!(
        refusal.message,
        "no documentation for `write`\n  Did you mean `writeFile`?"
    );
}

/// **A miss with no near name says nothing extra.** An empty hint would be gg filling a silence,
/// and the sentence is complete without it.
#[test]
fn a_missed_lookup_with_nothing_near_it_carries_no_hint() {
    let refusal = docs_not_found_refusal("compileTheProject", &[]);
    assert_eq!(refusal.failure, ToolFailure::NotFound);
    assert_eq!(refusal.message, "no documentation for `compileTheProject`");
    assert!(!refusal.message.contains("Did you mean"));
}

/// Several candidates read as one English sentence — `or` between two, an Oxford comma among more —
/// because the model is being asked to pick one, and a list it has to parse is a list it can
/// misread.
#[test]
fn several_candidates_read_as_a_sentence() {
    let two = docs_not_found_refusal(
        "write",
        &["writeFile".to_string(), "writeMemory".to_string()],
    );
    assert_eq!(
        two.message,
        "no documentation for `write`\n  Did you mean `writeFile` or `writeMemory`?"
    );

    let three = docs_not_found_refusal(
        "read",
        &[
            "readFile".to_string(),
            "readSkill".to_string(),
            "readMemory".to_string(),
        ],
    );
    assert_eq!(
        three.message,
        "no documentation for `read`\n  Did you mean `readFile`, `readSkill`, or `readMemory`?"
    );
}

/// A blank selector is an argument error; anything else is left to close whatever it names —
/// including nothing.
#[test]
fn only_a_blank_close_selector_is_refused() {
    assert!(close_selector_refusal("src/a.ts").is_none());
    assert!(
        close_selector_refusal("never-opened").is_none(),
        "closing something that is not open is 0, not a failure"
    );

    let refusal = close_selector_refusal("   ").expect("a blank selector names nothing");
    assert_eq!(refusal.failure, ToolFailure::InvalidArgument);
}

/// **A close that reclaimed nothing emits nothing.**
///
/// `ContextManaged` is the operator's record of the window actually changing. A zero-item event
/// would put a line on that stream for a call that did not change it, and a program that closes
/// defensively makes exactly those calls.
#[test]
fn a_close_that_reclaimed_nothing_emits_no_event() {
    assert!(
        view_close_event(
            GgContextAction::CloseTextViews,
            "notes",
            &EvictionResult::default()
        )
        .is_none()
    );
}

/// The two bands report as the two actions the contract declares, each naming what it closed.
#[test]
fn a_close_reports_the_band_it_reclaimed_from() {
    let reclaimed = EvictionResult {
        items: 2,
        tokens: 300,
        paths: vec!["src/a.ts".to_string()],
    };

    let files = view_close_event(GgContextAction::EvictFileViews, "src/a.ts", &reclaimed)
        .expect("two file views were closed");
    match files {
        GgTelemetryKind::ContextManaged {
            action,
            reclaimed_tokens,
            items,
            detail,
            ..
        } => {
            assert_eq!(action, GgContextAction::EvictFileViews);
            assert_eq!((reclaimed_tokens, items), (300, 2));
            assert!(detail.contains("file view(s)"));
            assert!(detail.contains("src/a.ts"));
        }
        other => panic!("a close reports as a context-managed event, not {other:?}"),
    }

    let texts = view_close_event(GgContextAction::CloseTextViews, "notes", &reclaimed)
        .expect("a text view was closed");
    match texts {
        GgTelemetryKind::ContextManaged { action, detail, .. } => {
            assert_eq!(action, GgContextAction::CloseTextViews);
            assert!(detail.contains("text view(s)"));
        }
        other => panic!("a close reports as a context-managed event, not {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Closing documentation
// ---------------------------------------------------------------------------

/// **A documentation close reports where it cut, as well as what it reclaimed.**
///
/// The tokens are what the close bought; the index is what it cost. The documentation band is
/// append-only — a re-open of an open key is a no-op — so this is the only call in a session that
/// can invalidate a cached prompt prefix, and reclaiming three hundred tokens from position 3 of a
/// long window is not the same trade as reclaiming them from position 300.
#[test]
fn a_documentation_close_reports_where_it_cut() {
    let closed = ViewsClosed {
        reclaimed: EvictionResult {
            items: 2,
            tokens: 420,
            paths: vec!["readFile".to_string(), "FileRead".to_string()],
        },
        earliest_removed: Some(7),
    };
    match docs_close_event(Some("readFile"), &closed).expect("two views were closed") {
        GgTelemetryKind::ContextManaged {
            action,
            reclaimed_tokens,
            items,
            detail,
            earliest_removed,
        } => {
            assert_eq!(action, GgContextAction::CloseDocsViews);
            assert_eq!((reclaimed_tokens, items), (420, 2));
            assert_eq!(earliest_removed, Some(7));
            assert!(detail.contains("documentation view(s)"));
            assert!(detail.contains("readFile"));
        }
        other => panic!("a close reports as a context-managed event, not {other:?}"),
    }
}

/// A blanket close says so in its own words rather than naming a selector it did not take.
#[test]
fn a_blanket_documentation_close_says_it_closed_all_of_them() {
    let closed = ViewsClosed {
        reclaimed: EvictionResult {
            items: 5,
            tokens: 900,
            paths: Vec::new(),
        },
        earliest_removed: Some(2),
    };
    let event = docs_close_event(None, &closed).expect("five views were closed");
    match event {
        GgTelemetryKind::ContextManaged { detail, .. } => assert!(detail.contains("all of them")),
        other => panic!("a close reports as a context-managed event, not {other:?}"),
    }
}

/// **A documentation close that reclaimed nothing emits nothing**, on exactly the terms the other
/// two bands' closes do: a program that tidies up defensively must not put a line on the operator's
/// stream for a call that changed nothing.
#[test]
fn a_documentation_close_that_reclaimed_nothing_emits_no_event() {
    assert!(docs_close_event(Some("readFile"), &ViewsClosed::default()).is_none());
    assert!(docs_close_event(None, &ViewsClosed::default()).is_none());
}

// ---------------------------------------------------------------------------
// The search-results view
// ---------------------------------------------------------------------------

/// **A search-results close is its own action and names its own band.**
///
/// It carries no cut position, unlike a documentation close, and the omission is the statement: the
/// search band is superseded on every search, so by the second search of a session a cached prefix
/// has already been rewritten from wherever the results sit. There is nothing left for a close to be
/// the thing that cost.
#[test]
fn a_search_close_reports_its_own_band() {
    let reclaimed = EvictionResult {
        items: 1,
        tokens: 120,
        paths: vec!["search results".to_string()],
    };
    let event = view_close_event(
        GgContextAction::CloseSearchViews,
        "search results",
        &reclaimed,
    )
    .expect("the results view was closed");
    match event {
        GgTelemetryKind::ContextManaged {
            action,
            reclaimed_tokens,
            detail,
            earliest_removed,
            ..
        } => {
            assert_eq!(action, GgContextAction::CloseSearchViews);
            assert_eq!(reclaimed_tokens, 120);
            assert!(detail.contains("search-results view(s)"), "{detail}");
            assert_eq!(earliest_removed, None);
        }
        other => panic!("a close reports as a context-managed event, not {other:?}"),
    }
}

/// **The results view says how much of the answer it is, and shows a brief per hit.**
///
/// The count line is the load-bearing half. A page that did not say what it was a page *of* reads as
/// a complete answer, and an agent that stops at the first five hits of twenty has lost three
/// quarters of what it was looking for — which is the exact failure the envelope's `total` exists to
/// prevent and which a rendering that dropped it would undo.
///
/// The hit carries a `key` that differs from its `name` on purpose. A hit whose two identifiers were
/// the same string could not tell the two apart, so it would pass just as readily against a
/// rendering that printed the wrong one.
///
/// The line itself carries no `(function)` suffix. A hit's kind is stated once, by the heading of
/// the group it sits in, and repeating it per line would spend a word per hit restating what the
/// heading above already said — over a module directory, a hundred times.
#[test]
fn the_results_view_says_how_much_of_the_answer_it_is() {
    let query = DocSearchQuery {
        query: "file".to_string(),
        modules: vec!["fs".to_string()],
        ..DocSearchQuery::default()
    };
    let page = DocSearch {
        total: 9,
        offset: 3,
        hits: vec![crate::docs::DocHit {
            key: "gg.files.readFile".to_string(),
            kind: crate::docs::DocKind::Function,
            module: "gg.files".to_string(),
            name: "readFile".to_string(),
            summary: "Read a file.".to_string(),
        }],
    };

    let body = render_search_results(&query, &page);
    assert!(body.contains("9 matches"), "the total is stated: {body}");
    assert!(body.contains("4-4"), "and which slice this is: {body}");
    assert!(
        body.contains("`file`") && body.contains("module `fs`"),
        "{body}"
    );
    assert!(
        body.contains("Functions:\ngg.files.readFile — Read a file."),
        "one line per hit under its kind's heading, keyed by the name an open takes, brief and \
         all: {body}"
    );
}

/// **Several modules are echoed back as the several they were**, under the plural noun.
///
/// The clause at the top of the page is what a model reads to check that the search it got is the
/// search it asked for, and a filter naming two modules that rendered as one — or as the word
/// `module` followed by a list — would be a page describing a narrower question than the one that
/// was answered. The union is the whole point of naming more than one, so the echo has to show all
/// of them.
#[test]
fn a_filter_naming_several_modules_echoes_all_of_them() {
    let query = DocSearchQuery {
        query: String::new(),
        modules: vec!["gg.files".to_string(), "gg.shell".to_string()],
        ..DocSearchQuery::default()
    };
    let page = DocSearch {
        total: 1,
        offset: 0,
        hits: vec![crate::docs::DocHit {
            key: "gg.shell.shell".to_string(),
            kind: crate::docs::DocKind::Function,
            module: "gg.shell".to_string(),
            name: "shell".to_string(),
            summary: "Run a shell command.".to_string(),
        }],
    };

    let body = render_search_results(&query, &page);
    assert!(
        body.contains("modules `gg.files`, `gg.shell`"),
        "both are named, under the plural: {body}"
    );
    assert!(
        !body.contains("module `gg.files`"),
        "and the singular is not left standing in front of a list: {body}"
    );
}

/// **The count agrees with itself**: one hit is `1 match`, and anything else is `N matches`.
///
/// Trivial to get wrong and read by a model on every search it makes. `1 match(es)` was the previous
/// spelling, and a parenthesised plural is the kind of thing a reader learns to skip — which is the
/// last thing the count line can afford, since it is the only sentence on the page that says the
/// page is not the whole answer.
///
/// Asserted on the **total** rather than on the number of hits shown, because those differ: a page
/// of one hit out of nine is nine matches, and a rendering that agreed with the page in front of it
/// would say `1 match` about a result the model has seen only a ninth of.
#[test]
fn the_count_agrees_with_the_total_it_reports() {
    let hit = |key: &str| crate::docs::DocHit {
        key: key.to_string(),
        kind: crate::docs::DocKind::Function,
        module: "gg.files".to_string(),
        name: key.to_string(),
        summary: "A call.".to_string(),
    };
    let query = DocSearchQuery {
        query: "file".to_string(),
        ..DocSearchQuery::default()
    };

    let one = render_search_results(
        &query,
        &DocSearch {
            total: 1,
            offset: 0,
            hits: vec![hit("gg.files.readFile")],
        },
    );
    assert!(one.starts_with("1 match for "), "{one}");

    let many = render_search_results(
        &query,
        &DocSearch {
            total: 2,
            offset: 0,
            hits: vec![hit("gg.files.readFile"), hit("gg.files.writeFile")],
        },
    );
    assert!(many.starts_with("2 matches for "), "{many}");

    // The page is one hit and the answer is nine, which is exactly when the count line is doing its
    // job — and exactly where a rendering that counted the hits in hand would be wrong.
    let paged = render_search_results(
        &query,
        &DocSearch {
            total: 9,
            offset: 0,
            hits: vec![hit("gg.files.readFile")],
        },
    );
    assert!(paged.starts_with("9 matches for "), "{paged}");
}

/// **The three kinds are three sections, in one order, and a section with no hits is not there.**
///
/// A module, a function and a type are three different things to do next: importing, calling, and
/// reading the shape of a value. A reader scanning a directory for a call should not have to step
/// over the types to find it, and the module — which nothing else on the page is reachable without —
/// belongs above both.
///
/// The omission is the other half. An empty heading is a line that says *there were none of these*,
/// which is true and is not worth a line: a search filtered to `kind: "function"` would otherwise
/// carry two headings over nothing on every page a model reads.
///
/// Rank order is kept **within** a group rather than reimposed, so the best match in a section is
/// still its first line — which is what the two functions here, given deliberately in a
/// non-alphabetical order, hold.
#[test]
fn the_hits_are_grouped_by_kind_in_one_order() {
    let query = DocSearchQuery {
        query: "file".to_string(),
        ..DocSearchQuery::default()
    };
    let page = DocSearch {
        total: 4,
        offset: 0,
        hits: vec![
            crate::docs::DocHit {
                key: "gg.files.writeFile".to_string(),
                kind: crate::docs::DocKind::Function,
                module: "gg.files".to_string(),
                name: "writeFile".to_string(),
                summary: "Write a file.".to_string(),
            },
            crate::docs::DocHit {
                key: "gg.files.FileRead".to_string(),
                kind: crate::docs::DocKind::Type,
                module: "gg.files".to_string(),
                name: "FileRead".to_string(),
                summary: "What a read handed back.".to_string(),
            },
            crate::docs::DocHit {
                key: "gg.files".to_string(),
                kind: crate::docs::DocKind::Module,
                module: "gg.files".to_string(),
                name: "gg.files".to_string(),
                summary: "Reading and writing files.".to_string(),
            },
            crate::docs::DocHit {
                key: "gg.files.readFile".to_string(),
                kind: crate::docs::DocKind::Function,
                module: "gg.files".to_string(),
                name: "readFile".to_string(),
                summary: "Read a file.".to_string(),
            },
        ],
    };

    let body = render_search_results(&query, &page);
    let at = |needle: &str| {
        body.find(needle)
            .unwrap_or_else(|| panic!("`{needle}` is on the page:\n{body}"))
    };
    assert!(
        at("Modules:") < at("Functions:") && at("Functions:") < at("Types:"),
        "the sections are in one order whatever order the hits arrived in:\n{body}"
    );
    assert!(
        at("gg.files.writeFile") < at("gg.files.readFile"),
        "and rank order is kept within a section rather than re-sorted:\n{body}"
    );

    // A page holding one kind carries one heading, and no line at all about the two it has none of.
    let only_functions = render_search_results(
        &query,
        &DocSearch {
            total: 1,
            offset: 0,
            hits: vec![page.hits[0].clone()],
        },
    );
    assert!(only_functions.contains("Functions:"), "{only_functions}");
    assert!(
        !only_functions.contains("Modules:") && !only_functions.contains("Types:"),
        "a section with nothing under it is not rendered at all: {only_functions}"
    );
}

/// **Two entries sharing a bare name render as two distinguishable lines** — which is the whole
/// reason the line leads with the key.
///
/// `close` is the real case: `gg.docs.close` and `gg.views.close` are two different calls, one of
/// them bought by a capability the other is not. Rendered by bare name they are the same string
/// twice, and a model picking one of them by typing what it read would be answered with whichever
/// the catalogue lists first — silently, and with a page documenting a call it may not hold.
#[test]
fn two_hits_sharing_a_name_are_told_apart() {
    let query = DocSearchQuery {
        query: "close".to_string(),
        ..DocSearchQuery::default()
    };
    let page = DocSearch {
        total: 2,
        offset: 0,
        hits: vec![
            crate::docs::DocHit {
                key: "gg.docs.close".to_string(),
                kind: crate::docs::DocKind::Function,
                module: "gg.docs".to_string(),
                name: "close".to_string(),
                summary: "Close a documentation view.".to_string(),
            },
            crate::docs::DocHit {
                key: "gg.views.close".to_string(),
                kind: crate::docs::DocKind::Function,
                module: "gg.views".to_string(),
                name: "close".to_string(),
                summary: "Close every view carrying a selector.".to_string(),
            },
        ],
    };

    let body = render_search_results(&query, &page);
    assert!(
        body.contains("gg.docs.close — Close a documentation view."),
        "{body}"
    );
    assert!(
        body.contains("gg.views.close — Close every view carrying a selector."),
        "{body}"
    );
}

/// **A search that matched nothing says so, and says what to do about it** — rather than rendering
/// an empty list the model has to interpret.
#[test]
fn an_empty_results_view_says_what_to_try_instead() {
    let query = DocSearchQuery {
        query: "quinquagenarian".to_string(),
        ..DocSearchQuery::default()
    };
    let body = render_search_results(
        &query,
        &DocSearch {
            total: 0,
            offset: 0,
            hits: Vec::new(),
        },
    );
    assert!(body.starts_with("No documentation matches"), "{body}");
    assert!(body.contains("substring"), "{body}");
}

/// **`view.close` does not reach the documentation band, and `docs.close` is the only thing that
/// does** — so [`GgContextAction::CloseDocsViews`] has exactly one producer.
///
/// This is a source-level assertion because the seam it guards is a *deletion*: the production
/// [`close_view`](LoopOperationApi::close_view) no longer sweeps documentation, and a deletion has no
/// value to assert on. What a regression would look like is a second
/// `context.close_docviews(...)` appearing in this file — which is exactly what this counts.
///
/// The property is worth holding rather than trusting to review because both halves of it are
/// invisible at the call site. `view.close` is bound to every program while closing documentation
/// is bought by
/// [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE), so a sweep reintroduced here
/// would have to either spend a capability its caller never asked about or answer `0` for an agent
/// that lacks it — and `0` is indistinguishable, to the model reading it, from a selector that named
/// nothing. It would also give the capability two routes, one of which never names it, which is what
/// makes a comparison of two capability sets unable to attribute a close.
#[test]
fn closing_documentation_has_exactly_one_producer() {
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/agent.code.rs"),
    )
    .expect("gg's code-turn api is readable");

    let closes: Vec<&str> = source
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with("//") && !line.starts_with("///"))
        .filter(|line| line.contains(".close_docviews("))
        .collect();

    assert_eq!(
        closes,
        ["let closed = self.context.close_docviews(key.as_deref());"],
        "`close_docviews` is the only call that may take a documentation view out of the window; \
         a second one here is `gg.views.close` reaching a band it does not name and cannot refuse from"
    );
}
