//! Tests for **documentation views** — the band a model's own lookups fill, and the four rules that
//! make it behave unlike every other view kind in this model.
//!
//! Every assertion here is about one of four things, and each of them is a rule some later reader
//! will be tempted to "fix" back into consistency with text and file views:
//!
//! 1. documentation has a **band of its own**, so what it costs is readable apart from what read
//!    skills cost, and closing it needs no carve-out to avoid eating one;
//! 2. re-opening an open key is a **total no-op** — not a supersede, not a move — so the rendered
//!    prompt is byte-identical and the item does not change index;
//! 3. closing is a **plain removal with no cascade**, so "closed" and "never opened" are the same
//!    thing and nothing has to remember why a view exists;
//! 4. the band **survives** archival and a compaction boundary, because closing is the only thing
//!    that is allowed to remove one.

use std::sync::Arc;

use super::*;
use crate::model::Role;
use test_cabinet_core::gg::GgContextSource;

/// A model measuring with the deterministic heuristic estimator (chars/4 + framing), in
/// [code mode](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) — the only mode that opens
/// views, and the one whose headings the bodies carry.
fn code_model() -> ContextModel {
    ContextModel::new(Arc::new(HeuristicTokenEstimator::new()), Some(10_000), true)
}

/// The rendered prompt, as the client would receive it — the thing the D4 no-move rule is *about*,
/// since a provider's cache reads exactly this list and nothing else.
fn rendered(ctx: &ContextModel) -> Vec<(Role, String)> {
    ctx.messages()
        .into_iter()
        .map(|message| (message.role, message.content.unwrap_or_default()))
        .collect()
}

/// The keys of the documentation band, in window order.
fn docview_keys(ctx: &ContextModel) -> Vec<String> {
    ctx.items()
        .iter()
        .filter(|item| item.source() == GgContextSource::DocsView)
        .filter_map(|item| item.label().map(str::to_string))
        .collect()
}

// ---------------------------------------------------------------------------
// The band
// ---------------------------------------------------------------------------

/// **A documentation view is an ephemeral, keyed, closable item in its own band.**
///
/// The band is what makes two things separable: what documentation costs is reported apart from
/// what skills cost, and a close of documentation is a removal over its own band rather than over
/// the skill band.
#[test]
fn a_docview_is_ephemeral_keyed_and_in_its_own_band() {
    let mut ctx = code_model();
    ctx.open_docview(
        "readFile".to_string(),
        "readFile(path): FileRead".to_string(),
    );

    let item = ctx
        .items()
        .iter()
        .find(|item| item.source() == GgContextSource::DocsView)
        .expect("the docview is in the documentation band");
    assert_eq!(item.retention(), Retention::Ephemeral);
    assert_eq!(item.label(), Some("readFile"));
    assert_eq!(item.message().role, Role::User);
    assert!(
        item.message()
            .content
            .as_deref()
            .expect("a body")
            .starts_with("Documentation: readFile\n----\n"),
        "it is headed by the key it was opened under, which is also what a close takes"
    );
    assert!(
        ctx.tokens_for(GgContextSource::DocsView) > 0
            && ctx.tokens_for(GgContextSource::Skill) == 0,
        "documentation is accounted on its own, not folded into the skill band"
    );
}

/// **Closing documentation cannot reach a read skill**, and no longer needs a pinned carve-out to
/// make that true: a skill is not in the band at all, so even the blanket form cannot select one.
#[test]
fn closing_docviews_cannot_reach_a_read_skill() {
    let mut ctx = code_model();
    ctx.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::user("the authored skill's body".to_string()),
    );
    ctx.open_docview("readFile".to_string(), "the function's docs".to_string());

    let closed = ctx.close_docviews(None);
    assert_eq!(closed.reclaimed.items, 1);
    let skills: Vec<String> = ctx
        .items()
        .iter()
        .filter(|item| item.source() == GgContextSource::Skill)
        .map(|item| item.message().content.clone().unwrap_or_default())
        .collect();
    assert_eq!(skills.len(), 1);
    assert!(
        skills[0].contains("the authored skill's body"),
        "{skills:?}"
    );
}

/// A docview shows up in `view.current()` as its own kind, so a model deciding what to close can see
/// it — and a read skill does not, because it cannot be closed.
#[test]
fn open_views_reports_a_docview_and_not_a_read_skill() {
    let mut ctx = code_model();
    ctx.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::user("the authored skill's body".to_string()),
    );
    ctx.open_docview("readFile".to_string(), "the function's docs".to_string());

    let open: Vec<(ViewKind, String)> = ctx
        .open_views()
        .into_iter()
        .map(|view| (view.kind, view.selector))
        .collect();
    assert_eq!(open, vec![(ViewKind::Docs, "readFile".to_string())]);
}

// ---------------------------------------------------------------------------
// D4: a re-open is a total no-op
// ---------------------------------------------------------------------------

/// **The assertion this whole design turns on: re-opening an open docview leaves the rendered prompt
/// byte-identical and the item at the same index.**
///
/// Not "one copy survives", which supersession would also satisfy — *nothing happens*. A supersede
/// removes the item and re-places it at the tail, which rewrites the prompt from that position
/// onward and costs the run every cached token after it, in exchange for text that is identical
/// because a docview's body is a pure function of its key.
///
/// Anyone reading `open_docview` later and reaching for `supersede_view` to make it consistent with
/// `open_text_view` will fail here, which is the point.
#[test]
fn re_opening_an_open_docview_changes_nothing_at_all() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_docview("readFile".to_string(), "readFile docs".to_string());
    ctx.open_docview("writeFile".to_string(), "writeFile docs".to_string());
    ctx.begin_turn(2);
    ctx.push(
        GgContextSource::Assistant,
        Retention::Ephemeral,
        Message::assistant(Some("a program".to_string()), Vec::new()),
    );

    let before = rendered(&ctx);
    let before_index = ctx
        .items()
        .iter()
        .position(|item| item.label() == Some("readFile"))
        .expect("readFile is open");
    let before_tokens = ctx.total_tokens();

    // A later turn, so a superseding view kind would retag-and-append here rather than replace.
    ctx.begin_turn(3);
    let reopened = ctx.open_docview("readFile".to_string(), "readFile docs".to_string());

    assert_eq!(reopened, DocviewOpen::AlreadyOpen);
    assert_eq!(
        rendered(&ctx),
        before,
        "the rendered prompt is byte-identical: nothing was moved, re-emitted or retagged"
    );
    assert_eq!(
        ctx.items()
            .iter()
            .position(|item| item.label() == Some("readFile")),
        Some(before_index),
        "and the item is at the same index, so a cached prefix reaches past it exactly as before"
    );
    assert_eq!(ctx.total_tokens(), before_tokens, "and it costs nothing");
}

/// **A re-open carrying the same text moves nothing, and a re-open carrying different text shows
/// the new text.**
///
/// One rule read on one question: is the model holding the page this key now addresses. Every page
/// of gg's own surface answers yes however often it is asked, because a body is a projection of a
/// catalogue compiled into the binary — so the band an agent that loaded nothing holds never moves.
///
/// A loaded module's page can answer no, because the model rewrote the code a skill or a memory
/// carries, and there the alternative is a window documenting a declaration that no longer exists.
/// The page that changed is the only one that moves: the copy already sent is retagged as history
/// in place and the revision is appended, so the pages around it keep their positions and the prefix
/// ahead of the retagged copy is untouched.
#[test]
fn a_re_open_replaces_a_page_only_when_its_text_changed() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_docview("readFile".to_string(), "readFile docs".to_string());
    ctx.open_docview(
        "csvTools.parse".to_string(),
        "export function parse(text: string): Row[]".to_string(),
    );
    ctx.begin_turn(2);
    ctx.push(
        GgContextSource::Assistant,
        Retention::Ephemeral,
        Message::assistant(Some("a program".to_string()), Vec::new()),
    );

    let before = rendered(&ctx);
    let sdk_index = ctx
        .items()
        .iter()
        .position(|item| item.label() == Some("readFile"))
        .expect("readFile is open");

    // A later turn, so both copies have been sent and a replacement has a cached prefix to protect.
    ctx.begin_turn(3);
    assert_eq!(
        ctx.open_docview(
            "csvTools.parse".to_string(),
            "export function parse(text: string): Row[]".to_string(),
        ),
        DocviewOpen::AlreadyOpen,
        "the same text under the same key is a total no-op"
    );
    assert_eq!(
        rendered(&ctx),
        before,
        "so the rendered prompt is byte-identical"
    );

    let revised = ctx.open_docview(
        "csvTools.parse".to_string(),
        "export function parse(text: string, strict: boolean): Row[]".to_string(),
    );

    assert!(
        matches!(
            revised,
            DocviewOpen::Placed {
                superseded: true,
                ..
            }
        ),
        "{revised:?}"
    );
    assert_eq!(
        ctx.open_docviews()
            .into_iter()
            .map(|open| (open.key, open.body))
            .collect::<Vec<_>>(),
        vec![
            ("readFile".to_string(), "readFile docs".to_string()),
            (
                "csvTools.parse".to_string(),
                "export function parse(text: string, strict: boolean): Row[]".to_string()
            ),
        ],
        "one live page per key, and it is the one the module now declares"
    );
    assert_eq!(
        ctx.items()
            .iter()
            .position(|item| item.label() == Some("readFile")),
        Some(sdk_index),
        "the page that did not change did not move"
    );
    assert_eq!(
        ctx.items()
            .iter()
            .filter(|item| item.source() == GgContextSource::History)
            .count(),
        1,
        "and the copy the revision retired is retagged history rather than removed from the middle"
    );
}

/// **A revision inside the turn that opened the page replaces it where it stood**, leaving nothing
/// behind.
///
/// Nothing has been sent, so there is no cached prefix to protect and no history worth recording —
/// the terms every other view kind is superseded on. A model that rewrote a memory's code and used
/// it again in one program therefore pays for one page rather than two.
#[test]
fn a_revision_within_one_turn_leaves_no_corpse() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_docview("csvTools.parse".to_string(), "the first".to_string());
    ctx.open_docview("csvTools.widen".to_string(), "widen docs".to_string());
    ctx.open_docview("csvTools.parse".to_string(), "the revision".to_string());

    assert_eq!(
        ctx.items()
            .iter()
            .filter(|item| item.source() == GgContextSource::History)
            .count(),
        0
    );
    assert_eq!(
        ctx.open_docviews()
            .into_iter()
            .map(|open| (open.key, open.body))
            .collect::<Vec<_>>(),
        vec![
            ("csvTools.parse".to_string(), "the revision".to_string()),
            ("csvTools.widen".to_string(), "widen docs".to_string()),
        ],
        "the revision takes the index its own first copy held"
    );
}

/// **Placement is first-open order, permanently**, so the band is a growing suffix whose members
/// never move — the property that makes an open incapable of breaking a cached prefix.
#[test]
fn placement_is_first_open_order_and_never_changes() {
    let mut ctx = code_model();
    for (turn, key) in [(1, "a"), (2, "b"), (3, "c")] {
        ctx.begin_turn(turn);
        ctx.open_docview(key.to_string(), format!("{key} docs"));
    }
    ctx.begin_turn(4);
    // Re-open in a different order; the window's order is unmoved.
    for key in ["c", "a", "b"] {
        ctx.open_docview(key.to_string(), format!("{key} docs"));
    }

    assert_eq!(docview_keys(&ctx), vec!["a", "b", "c"]);
}

/// **A docview is never superseded, so it never leaves a corpse.**
///
/// Contrast a text view, which retags its previous copy to `History` and appends: one dead item per
/// re-open, unreclaimable, sitting inside a cached prefix. With one open able to place a function's
/// view *and* its types, a model re-opening a handful of functions across a session would accumulate
/// those several times over. Here it accumulates none.
#[test]
fn re_opening_leaves_no_history_corpse_where_a_text_view_would() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_docview("readFile".to_string(), "docs".to_string());
    ctx.open_text_view("notes".to_string(), "first".to_string());
    ctx.begin_turn(2);
    ctx.open_docview("readFile".to_string(), "docs".to_string());
    ctx.open_text_view("notes".to_string(), "second".to_string());

    assert_eq!(
        ctx.items()
            .iter()
            .filter(|item| item.source() == GgContextSource::History)
            .count(),
        1,
        "the text view left one corpse behind and the docview left none"
    );
    assert_eq!(docview_keys(&ctx), vec!["readFile"]);
}

/// **The two halves of one open come apart, and that is the set model working.**
///
/// A re-open of a function that is already open is a no-op *for the function* and still places any
/// of the types beside it that are not open. The question asked is never "has this been opened
/// before" but "is this key open now" — so a model whose types were closed and whose function was
/// not gets them back by asking for the function again, which is the only thing it has to ask for.
#[test]
fn re_opening_a_function_still_places_a_type_that_is_not_open() {
    let mut ctx = code_model();
    ctx.open_docview("readFile".to_string(), "readFile docs".to_string());
    ctx.open_docview("FileRead".to_string(), "FileRead declaration".to_string());
    ctx.close_docviews(Some("FileRead"));

    // What one `openDocsView("readFile")` does next, key by key: the function is already open and
    // is untouched; the type is not and is placed.
    assert_eq!(
        ctx.open_docview("readFile".to_string(), "readFile docs".to_string()),
        DocviewOpen::AlreadyOpen
    );
    assert!(matches!(
        ctx.open_docview("FileRead".to_string(), "FileRead declaration".to_string()),
        DocviewOpen::Placed { .. }
    ));
    assert_eq!(docview_keys(&ctx), vec!["readFile", "FileRead"]);
}

// ---------------------------------------------------------------------------
// D3: closing is a plain removal with no cascade
// ---------------------------------------------------------------------------

/// **Closing a type's view leaves every function view untouched**, and vice versa.
///
/// There is no dependency to follow, because the state is a *set of open keys* and nothing records
/// why any of them is open. That is what makes the whole mechanism free of a graph, a refcount and a
/// termination rule.
#[test]
fn closing_a_type_leaves_every_function_view() {
    let mut ctx = code_model();
    ctx.open_docview("readFile".to_string(), "readFile docs".to_string());
    ctx.open_docview("FileRead".to_string(), "FileRead declaration".to_string());
    ctx.open_docview("writeFile".to_string(), "writeFile docs".to_string());

    let closed = ctx.close_docviews(Some("FileRead"));
    assert_eq!(closed.reclaimed.items, 1);
    assert_eq!(docview_keys(&ctx), vec!["readFile", "writeFile"]);
}

/// **"Closed" and "never opened" are indistinguishable**, which is the whole content of the set
/// model: a key closed and then named again by a later open is opened again, at the tail, because
/// the only question ever asked is whether it is open *now*.
#[test]
fn a_closed_key_re_opens_at_the_tail_like_one_never_opened() {
    let mut ctx = code_model();
    ctx.open_docview("readFile".to_string(), "readFile docs".to_string());
    ctx.open_docview("FileRead".to_string(), "FileRead declaration".to_string());
    ctx.open_docview("writeFile".to_string(), "writeFile docs".to_string());
    ctx.close_docviews(Some("FileRead"));

    assert!(!docview_keys(&ctx).contains(&"FileRead".to_string()));
    assert!(
        matches!(
            ctx.open_docview("FileRead".to_string(), "FileRead declaration".to_string()),
            DocviewOpen::Placed {
                superseded: false,
                ..
            }
        ),
        "a closed key is placed again exactly as one that had never been opened"
    );
    assert_eq!(
        docview_keys(&ctx),
        vec!["readFile", "writeFile", "FileRead"]
    );
}

/// A close that names a key nothing is open under reclaims nothing, and is not a failure: a program
/// that tidies up unconditionally should not have to check first.
#[test]
fn closing_a_key_that_is_not_open_reclaims_nothing() {
    let mut ctx = code_model();
    ctx.open_docview("readFile".to_string(), "readFile docs".to_string());

    let closed = ctx.close_docviews(Some("neverOpened"));
    assert_eq!(closed.reclaimed.items, 0);
    assert_eq!(closed.earliest_removed, None);
    assert_eq!(docview_keys(&ctx), vec!["readFile"]);
}

/// **A close reports where it cut**, which is the cost half of a trade whose benefit half is the
/// tokens. The documentation band is append-only, so this is the one call in a session that can
/// invalidate a cached prompt prefix, and the position is the only thing that says how much of one.
#[test]
fn a_close_reports_the_position_of_the_earliest_item_it_removed() {
    let mut ctx = code_model();
    ctx.push(
        GgContextSource::UserPrompt,
        Retention::Pinned,
        Message::user("the task".to_string()),
    );
    ctx.open_docview("readFile".to_string(), "readFile docs".to_string());
    ctx.open_docview("writeFile".to_string(), "writeFile docs".to_string());

    let closed = ctx.close_docviews(None);
    assert_eq!(closed.reclaimed.items, 2);
    assert_eq!(
        closed.earliest_removed,
        Some(1),
        "the build prompt is item 0, so the cut begins at 1"
    );
    assert_eq!(
        closed.reclaimed.paths,
        vec!["readFile".to_string(), "writeFile".to_string()],
        "and the keys it took are named, in window order"
    );
}

// ---------------------------------------------------------------------------
// Survival
// ---------------------------------------------------------------------------

/// **An archival retains the documentation band**, however wide the range is.
///
/// Archival selects by turn, and a docview's turn is an accident of when the model happened to look
/// something up: one opened on turn 3 and still being read on turn 40 would be swept away by an
/// archive of turns 1–10, with no signal. Under this design closing is the only thing that removes a
/// docview, and that has to hold against every other removal in the model.
#[test]
fn archiving_the_turns_a_docview_was_opened_on_retains_it() {
    let mut ctx = code_model();
    ctx.begin_turn(3);
    ctx.open_docview("readFile".to_string(), "readFile docs".to_string());
    ctx.push(
        GgContextSource::ToolOutput,
        Retention::Ephemeral,
        Message::user("a tool result".to_string()),
    );

    ctx.begin_turn(11);
    let archived = ctx.archive_thread(&[TurnRange { from: 1, to: 10 }]);

    assert_eq!(
        archived.items.len(),
        1,
        "the tool result from turn 3 is archived"
    );
    assert_eq!(
        docview_keys(&ctx),
        vec!["readFile"],
        "and the documentation opened on the same turn is not"
    );
}

/// **A compaction round-trips the open set by key, in first-open order.**
///
/// `clear_ephemeral` drops the band with the rest of the ephemeral window; the caller re-derives
/// each key's body and hands them back. The order is asserted because the append-only property is
/// about *order* as much as membership: a rewrite that re-seeded them in a different sequence would
/// break exactly the prefix opening is careful never to disturb.
#[test]
fn a_compaction_round_trips_the_open_set_by_key() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    for key in ["readFile", "FileRead", "writeFile"] {
        ctx.open_docview(key.to_string(), format!("{key} docs"));
    }

    // What the caller carries across: keys and the bodies rendered for them, in window order.
    let carried = ctx.open_docviews();
    assert_eq!(
        carried
            .iter()
            .map(|open| open.key.as_str())
            .collect::<Vec<_>>(),
        vec!["readFile", "FileRead", "writeFile"]
    );
    assert_eq!(
        carried[0].body, "readFile docs",
        "the body is reported without the heading the window prefixed, so a re-open does not head it twice"
    );

    ctx.clear_ephemeral();
    assert!(docview_keys(&ctx).is_empty(), "the reset takes the band");

    for open in carried {
        ctx.open_docview(open.key, open.body);
    }
    assert_eq!(
        docview_keys(&ctx),
        vec!["readFile", "FileRead", "writeFile"]
    );
    assert!(
        ctx.items()
            .iter()
            .filter(|item| item.source() == GgContextSource::DocsView)
            .all(|item| item
                .message()
                .content
                .as_deref()
                .is_some_and(|body| body.matches("Documentation:").count() == 1)),
        "and each re-seeded body is headed exactly once"
    );
}

// ---------------------------------------------------------------------------
// The search-results view — the same model's other half
// ---------------------------------------------------------------------------

/// The keys of the search band, in window order.
fn search_keys(ctx: &ContextModel) -> Vec<String> {
    ctx.items()
        .iter()
        .filter(|item| item.source() == GgContextSource::SearchResults)
        .filter_map(|item| item.label().map(str::to_string))
        .collect()
}

/// **A search-results view is its own band, and a model's own searches all key to one selector, so
/// they SUPERSEDE.**
///
/// This is the deliberate opposite of the rule above it, and the two only make sense read together.
/// A documentation view names a **constant** — one key, one rendering, forever — so re-opening it is
/// a no-op and the band stays append-only. A search result names a mutable **intent**: *these are
/// the results I am working from*. Re-stating an intent replaces it, which is what `openText` does
/// and what this does, so an agent that searches five times holds one page rather than five.
///
/// The model's own searches passing one constant selector rather than the query is what makes the
/// supersession happen at all; a per-query key would be the pile-up this exists to avoid.
#[test]
fn a_search_view_is_its_own_band_and_replaces_itself() {
    let mut ctx = code_model();
    ctx.open_search_view(
        SEARCH_RESULTS_VIEW.to_string(),
        "3 matches for `file`".to_string(),
    );
    ctx.open_search_view(
        SEARCH_RESULTS_VIEW.to_string(),
        "1 match for `memory`".to_string(),
    );

    assert_eq!(
        search_keys(&ctx),
        vec!["search results".to_string()],
        "a second search replaces the first rather than piling up beside it"
    );
    let item = ctx
        .items()
        .iter()
        .find(|item| item.source() == GgContextSource::SearchResults)
        .expect("the results are in the search band");
    assert_eq!(item.retention(), Retention::Ephemeral);
    assert!(
        item.message()
            .content
            .as_deref()
            .expect("a body")
            .starts_with("Documentation: search results\n----\n"),
        "it shares the documentation heading word and is qualified by its own selector"
    );
    assert!(
        item.message()
            .content
            .as_deref()
            .expect("a body")
            .contains("memory"),
        "and it carries the newest results, not the ones it replaced"
    );
}

/// **A search does not disturb the documentation band, and closing one does not disturb the other.**
///
/// The whole reason the two are separate bands rather than one: the documentation band's
/// append-only property is what a provider's cached prefix rests on, and a view that replaced itself
/// on every search would rewrite the window from wherever it sat. Here the search view is placed
/// after the docviews and every replacement of it leaves them exactly where they were.
#[test]
fn searching_and_closing_a_search_leave_the_documentation_band_alone() {
    let mut ctx = code_model();
    ctx.open_docview("readFile".to_string(), "readFile(path)".to_string());
    ctx.open_docview("writeFile".to_string(), "writeFile(path)".to_string());
    let before = rendered(&ctx);

    ctx.open_search_view(
        SEARCH_RESULTS_VIEW.to_string(),
        "3 matches for `file`".to_string(),
    );
    ctx.open_search_view(
        SEARCH_RESULTS_VIEW.to_string(),
        "1 match for `memory`".to_string(),
    );
    assert_eq!(
        rendered(&ctx)[..before.len()],
        before[..],
        "every documentation item is byte-identical and at the same index"
    );

    let closed = ctx.close_search_views(Some(SEARCH_RESULTS_VIEW));
    assert_eq!(closed.items, 1);
    assert!(closed.tokens > 0, "it reclaimed what it cost");
    assert_eq!(
        docview_keys(&ctx),
        vec!["readFile".to_string(), "writeFile".to_string()],
        "closing the search results is not a cascade into anything"
    );
    assert_eq!(rendered(&ctx), before);
}

/// **Closing every documentation view leaves the search results**, which is the same statement from
/// the other side: `close_docviews` selects one band, so the blanket form is blanket over that band
/// alone.
#[test]
fn closing_every_docview_leaves_the_search_results() {
    let mut ctx = code_model();
    ctx.open_docview("readFile".to_string(), "readFile(path)".to_string());
    ctx.open_search_view(
        SEARCH_RESULTS_VIEW.to_string(),
        "3 matches for `file`".to_string(),
    );

    let closed = ctx.close_docviews(None);
    assert_eq!(closed.reclaimed.items, 1);
    assert_eq!(
        search_keys(&ctx),
        vec!["search results".to_string()],
        "the search band is not documentation and is not swept with it"
    );
}

/// **Two searches under two selectors are two views, each superseded only by its own.**
///
/// This is the property the [bootstrap](crate::bootstrap) rests on. Its opening listing is keyed by
/// the modules it covers rather than by [`SEARCH_RESULTS_VIEW`], so it is the surface the session
/// opens holding and the model's own searching — which names a mutable intent and replaces itself —
/// cannot displace it. The selector is the only thing that decides which of those two a view is: the
/// same call, passed the same constant twice, replaces itself (the case above), and passed two
/// different selectors keeps both.
#[test]
fn searches_under_two_selectors_are_two_views_and_supersede_only_themselves() {
    let mut ctx = code_model();
    ctx.open_search_view(
        "gg::files".to_string(),
        "12 entries in `gg::files`".to_string(),
    );
    ctx.open_search_view(
        "gg::views".to_string(),
        "6 entries in `gg::views`".to_string(),
    );
    assert_eq!(
        search_keys(&ctx),
        vec!["gg::files".to_string(), "gg::views".to_string()],
        "a listing of one module does not replace the listing of another"
    );

    ctx.open_search_view(
        "gg::files".to_string(),
        "12 entries in `gg::files` (again)".to_string(),
    );
    assert_eq!(
        search_keys(&ctx),
        vec!["gg::files".to_string(), "gg::views".to_string()],
        "re-listing one module replaces that module's view and nothing else, in the position it \
         already held"
    );
    let bodies: Vec<&str> = ctx
        .items()
        .iter()
        .filter(|item| item.source() == GgContextSource::SearchResults)
        .filter_map(|item| item.message().content.as_deref())
        .collect();
    assert_eq!(
        bodies,
        vec![
            "Documentation: gg::files\n----\n12 entries in `gg::files` (again)",
            "Documentation: gg::views\n----\n6 entries in `gg::views`"
        ],
        "the re-listed module's body is the new one and the other module's is untouched"
    );
}

/// **A module listing is headed by its own module and closed by its own path**, which is what makes
/// a window holding a dozen of them readable and each of them individually closable.
///
/// Both halves already worked for the one constant selector and neither has a special case for it,
/// so this is the assertion that they key off the selector rather than off the constant.
#[test]
fn a_module_listing_is_headed_by_its_module_and_closed_by_its_path() {
    let mut ctx = code_model();
    ctx.open_search_view(
        "gg::files".to_string(),
        "12 entries in `gg::files`".to_string(),
    );
    ctx.open_search_view(
        "gg::views".to_string(),
        "6 entries in `gg::views`".to_string(),
    );

    let item = ctx
        .items()
        .iter()
        .find(|item| item.label() == Some("gg::files"))
        .expect("the listing is in the search band");
    assert!(
        item.message()
            .content
            .as_deref()
            .expect("a body")
            .starts_with("Documentation: gg::files\n----\n"),
        "it is qualified by the module it lists, not by the constant"
    );

    let closed = ctx.close_search_views(Some("gg::files"));
    assert_eq!(closed.items, 1);
    assert_eq!(
        search_keys(&ctx),
        vec!["gg::views".to_string()],
        "a close by module path reaches that listing and leaves the rest"
    );
}

/// **A search-results view is reported as an open view, so a model can see what it costs and close
/// it** — and it is reported under its own kind, which is what makes the cost of *finding*
/// documentation readable apart from the cost of the documentation itself.
#[test]
fn a_search_view_is_reported_as_an_open_view_of_its_own_kind() {
    let mut ctx = code_model();
    ctx.open_search_view(
        SEARCH_RESULTS_VIEW.to_string(),
        "3 matches for `file`".to_string(),
    );

    let open = ctx.open_views();
    let view = open
        .iter()
        .find(|view| view.kind == ViewKind::Search)
        .expect("the search results are an open view");
    assert_eq!(view.selector, SEARCH_RESULTS_VIEW);
    assert!(view.tokens > 0);
    assert_eq!(view.region, None);
}

/// **A search-results view is NOT retained across archival**, where a documentation view is.
///
/// The asymmetry is the point and follows from what each of them is. A docview survives an archive
/// because closing is meant to be the only thing that removes one, and the turn it happened to be
/// opened on says nothing about whether the model still needs it. A search result is a page the
/// agent was working from at a moment; if the archive swept that moment away, re-running the query
/// costs one call and answers with what is true now.
#[test]
fn a_search_view_is_ordinary_ephemeral_material_at_an_archive_boundary() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_docview("readFile".to_string(), "readFile(path)".to_string());
    ctx.open_search_view(
        SEARCH_RESULTS_VIEW.to_string(),
        "3 matches for `file`".to_string(),
    );

    ctx.begin_turn(2);
    ctx.archive_thread(&[TurnRange { from: 1, to: 1 }]);

    assert_eq!(
        docview_keys(&ctx),
        vec!["readFile".to_string()],
        "documentation is retained however wide the range"
    );
    assert!(
        search_keys(&ctx).is_empty(),
        "the search results are ordinary ephemeral material"
    );
}
