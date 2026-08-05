//! Tests for **views** — the material a
//! [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) program declares should be
//! visible to it, and the open/supersede/close machinery the context model gives it.
//!
//! Split out of `context.test.rs`, which is already long; the two share the model's other seams and
//! nothing else.

use std::sync::Arc;

use super::*;
use crate::model::{ImageContent, Role};
use test_cabinet_core::gg::{GgContextSource, GgProgramLanguage};

/// A model measuring with the deterministic heuristic estimator (chars/4 + framing), in
/// [code mode](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) — the only mode that opens
/// views, and the one whose headings the bodies carry.
fn code_model() -> ContextModel {
    ContextModel::new(Arc::new(HeuristicTokenEstimator::new()), Some(10_000), true)
}

/// A small image, for the picture a file view of a mockup carries.
fn image(bytes: u64) -> ImageContent {
    ImageContent::new("image/png", "AAAA", bytes)
}

/// The `(source, label, region)` key of every thread item, in order — the shape most of these
/// assertions are about.
fn keys(ctx: &ContextModel) -> Vec<(GgContextSource, Option<String>, Option<FileRegion>)> {
    ctx.items()
        .iter()
        .map(|item| {
            (
                item.source(),
                item.label().map(str::to_string),
                item.region(),
            )
        })
        .collect()
}

/// How many pictures the window would actually upload — counted over the rendered
/// [`messages`](ContextModel::messages) rather than over the open views, because the whole point of
/// the image-view cap is that those two numbers agree.
fn resident_images(ctx: &ContextModel) -> usize {
    ctx.messages()
        .iter()
        .map(|message| message.images.len())
        .sum()
}

/// The rendered body of every thread item, in order.
fn bodies(ctx: &ContextModel) -> Vec<String> {
    ctx.items()
        .iter()
        .map(|item| item.message().content.clone().unwrap_or_default())
        .collect()
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

#[test]
fn a_text_view_is_a_labelled_user_message_in_its_own_band() {
    let mut ctx = code_model();
    ctx.begin_turn(1);

    let opened = ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());

    assert!(!opened.superseded);
    assert!(!opened.replaced_in_turn);
    // Pushed as a `user` message, never a `tool` result: a code turn's assistant message carries no
    // `tool_calls`, so a `tool`-role message would quote a dangling id.
    let item = &ctx.items()[0];
    assert_eq!(item.message().role, Role::User);
    assert_eq!(item.message().tool_call_id, None);
    assert_eq!(item.source(), GgContextSource::TextView);
    assert_eq!(item.retention(), Retention::Ephemeral);
    assert_eq!(item.label(), Some("summary"));
    assert_eq!(item.region(), None);
    assert_eq!(item.turn(), 1);
    // The heading names the band *and* the selector, so two views are distinguishable.
    assert_eq!(
        item.message().content.as_deref(),
        Some("View: summary\n----\n3 tests failed")
    );
    assert_eq!(opened.tokens, item.tokens());
    assert_eq!(
        ctx.tokens_for(GgContextSource::TextView),
        item.tokens() as u64
    );
}

#[test]
fn an_empty_text_view_body_is_allowed() {
    let mut ctx = code_model();
    ctx.begin_turn(1);

    ctx.open_text_view("failures".to_string(), String::new());

    // How a program states that something it was showing is now empty; refusing it would make that
    // unexpressible.
    assert_eq!(
        ctx.open_text_views(),
        vec![OpenTextView {
            label: "failures".to_string(),
            body: String::new(),
        }]
    );
}

#[test]
fn a_file_view_carries_its_region_and_its_pictures() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    let region = FileRegion {
        offset: 201,
        limit: 200,
    };

    let opened = ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(region),
        "export {}".to_string(),
        vec![image(4096)],
    );

    let item = &ctx.items()[0];
    assert_eq!(item.message().role, Role::User);
    assert_eq!(item.source(), GgContextSource::FileView);
    assert_eq!(item.label(), Some("a.ts"));
    assert_eq!(item.region(), Some(region));
    assert_eq!(item.message().images.len(), 1);
    // A picture is not a third view kind — it is a file view of an image file, so it is charged to
    // the same item and reclaimed with it.
    assert!(opened.tokens > estimate_image(4096));
    // The file heading stays the bare word: the read's own body already names the path.
    assert_eq!(
        item.message().content.as_deref(),
        Some("File\n----\nexport {}")
    );
}

// ---------------------------------------------------------------------------
// Superseding
// ---------------------------------------------------------------------------

#[test]
fn reopening_within_one_turn_replaces_the_view_in_place() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("summary".to_string(), "first".to_string());
    ctx.open_text_view("other".to_string(), "unrelated".to_string());

    let opened = ctx.open_text_view("summary".to_string(), "second".to_string());

    // Nothing was ever sent, so there is no cached prefix to protect and no history worth
    // recording: the refined copy takes the position the first one held rather than leaving a
    // corpse per loop iteration.
    assert!(opened.superseded);
    assert!(opened.replaced_in_turn);
    assert_eq!(ctx.items().len(), 2);
    assert_eq!(
        bodies(&ctx),
        vec![
            "View: summary\n----\nsecond".to_string(),
            "View: other\n----\nunrelated".to_string(),
        ]
    );
    assert_eq!(ctx.tokens_for(GgContextSource::History), 0);
}

#[test]
fn reopening_across_turns_leaves_a_history_corpse_with_no_selector() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("summary".to_string(), "first".to_string());
    ctx.begin_turn(2);

    let opened = ctx.open_text_view("summary".to_string(), "second".to_string());

    // The first copy has been sent and a provider has cached the prefix containing it, so it stays
    // exactly where it sits — retagged as ordinary history, unselectable — and the new copy is
    // appended at the tail.
    assert!(opened.superseded);
    assert!(!opened.replaced_in_turn);
    assert_eq!(
        keys(&ctx),
        vec![
            (GgContextSource::History, None, None),
            (GgContextSource::TextView, Some("summary".to_string()), None),
        ]
    );
    assert_eq!(ctx.items()[0].retention(), Retention::Ephemeral);
    // The retagged copy keeps its body: it is the honest record of what the model was told then.
    assert_eq!(
        bodies(&ctx),
        vec![
            "View: summary\n----\nfirst".to_string(),
            "View: summary\n----\nsecond".to_string(),
        ]
    );
    // Only the live copy is charged to the band; the corpse is history.
    assert_eq!(
        ctx.tokens_for(GgContextSource::TextView),
        ctx.items()[1].tokens() as u64
    );
    assert_eq!(ctx.open_views().len(), 1);
}

#[test]
fn reopening_a_file_view_supersedes_only_the_same_page() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    let first = FileRegion {
        offset: 1,
        limit: 200,
    };
    let second = FileRegion {
        offset: 201,
        limit: 200,
    };
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(first),
        "page 1".to_string(),
        Vec::new(),
    );
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(second),
        "page 2".to_string(),
        Vec::new(),
    );
    ctx.begin_turn(2);

    // Two pages of one file are two views and must coexist — a program paging through a file is not
    // a program changing its mind.
    assert_eq!(ctx.open_views().len(), 2);

    let opened = ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(second),
        "page 2 again".to_string(),
        Vec::new(),
    );

    assert!(opened.superseded);
    assert_eq!(
        keys(&ctx),
        vec![
            (
                GgContextSource::FileView,
                Some("a.ts".to_string()),
                Some(first)
            ),
            (GgContextSource::History, None, None),
            (
                GgContextSource::FileView,
                Some("a.ts".to_string()),
                Some(second)
            ),
        ]
    );
}

#[test]
fn a_whole_file_view_and_a_paged_one_are_distinct_keys() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    let page = FileRegion {
        offset: 201,
        limit: 200,
    };
    ctx.open_file_view_deduped("a.ts".to_string(), None, "whole".to_string(), Vec::new());
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(page),
        "page".to_string(),
        Vec::new(),
    );
    ctx.begin_turn(2);

    // `FileRegion::covered` reports `None` for a whole-file read, so the whole-file view supersedes
    // itself on re-read without disturbing the page.
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        None,
        "whole again".to_string(),
        Vec::new(),
    );

    assert_eq!(
        keys(&ctx),
        vec![
            (GgContextSource::History, None, None),
            (
                GgContextSource::FileView,
                Some("a.ts".to_string()),
                Some(page)
            ),
            (GgContextSource::FileView, Some("a.ts".to_string()), None),
        ]
    );
}

#[test]
fn a_view_supersedes_the_native_reads_of_the_same_page() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    // The native `read_file` path appends a fresh view per read and is deliberately unchanged.
    ctx.push_file_view(Some("a.ts".to_string()), None, "c1", "once", Vec::new());
    ctx.push_file_view(Some("a.ts".to_string()), None, "c2", "twice", Vec::new());
    ctx.begin_turn(2);

    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        None,
        "as a view".to_string(),
        Vec::new(),
    );

    // Both stale copies show the same material; leaving either in the band would double-count it.
    assert_eq!(
        keys(&ctx),
        vec![
            (GgContextSource::History, None, None),
            (GgContextSource::History, None, None),
            (GgContextSource::FileView, Some("a.ts".to_string()), None),
        ]
    );
}

#[test]
fn a_locked_specification_is_never_superseded_out_of_its_band() {
    let mut ctx = code_model();
    ctx.push_file_view_with_retention(
        Some("specs/rules.md".to_string()),
        None,
        "c1",
        "the rules",
        Vec::new(),
        Retention::Pinned,
    );
    ctx.begin_turn(1);

    ctx.open_file_view_deduped(
        "specs/rules.md".to_string(),
        None,
        "the rules".to_string(),
        Vec::new(),
    );

    // Retagging a locked autoloaded specification out of its band is exactly the removal locking
    // exists to prevent, so the re-open appends an ordinary evictable view beside it.
    assert_eq!(
        keys(&ctx),
        vec![
            (
                GgContextSource::FileView,
                Some("specs/rules.md".to_string()),
                None
            ),
            (
                GgContextSource::FileView,
                Some("specs/rules.md".to_string()),
                None
            ),
        ]
    );
    assert_eq!(ctx.items()[0].retention(), Retention::Pinned);
    assert_eq!(ctx.items()[1].retention(), Retention::Ephemeral);
}

// ---------------------------------------------------------------------------
// Counting the pictures that are open
// ---------------------------------------------------------------------------

/// The count is over **image-carrying** file views: a text view of the same window costs tokens but
/// no megabytes of base64, and a file view of a text file is not what the cap is about.
#[test]
fn open_image_views_counts_only_the_file_views_that_carry_a_picture() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    assert_eq!(ctx.open_image_views(), 0);

    ctx.open_file_view_deduped("src/a.ts".to_string(), None, "code".to_string(), Vec::new());
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());
    assert_eq!(ctx.open_image_views(), 0, "neither of those is a picture");

    ctx.open_file_view_deduped(
        "mock/a.png".to_string(),
        None,
        "a PNG".to_string(),
        vec![image(1_024)],
    );
    ctx.open_file_view_deduped(
        "mock/b.png".to_string(),
        None,
        "a PNG".to_string(),
        vec![image(2_048)],
    );
    assert_eq!(ctx.open_image_views(), 2);
}

/// **Closing an image view frees its slot.** The count is derived from the live window, so this is
/// not a counter that has to be decremented anywhere — it is simply what the window now holds.
#[test]
fn closing_an_image_view_frees_its_slot() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_file_view_deduped(
        "mock/a.png".to_string(),
        None,
        "a PNG".to_string(),
        vec![image(1_024)],
    );
    assert_eq!(ctx.open_image_views(), 1);

    ctx.evict_file_views(Some("mock/a.png"));
    assert_eq!(ctx.open_image_views(), 0);
}

/// **A pinned autoloaded specification image does not count.**
///
/// It is the operator's choice, placed before the agent's first turn, and `view.close` cannot touch
/// it. Counting it would let a configuration that pins four reference mockups make the cap
/// permanently unreachable — every image view the agent ever tried to open refused, with the only
/// remedy unable to reach the views occupying the cap.
#[test]
fn a_pinned_specification_image_does_not_occupy_the_cap() {
    let mut ctx = code_model();
    ctx.push_file_view_with_retention(
        Some("specs/mockup.png".to_string()),
        None,
        "c1",
        "the mockup",
        vec![image(4_096)],
        Retention::Pinned,
    );
    ctx.begin_turn(1);

    assert_eq!(
        ctx.open_image_views(),
        0,
        "a view the agent cannot close must not spend the budget it is refused against"
    );
    assert!(
        !ctx.holds_image_view("specs/mockup.png", None),
        "a pinned copy is never superseded, so re-opening the path is a NEW occupant"
    );
}

/// The supersede check keys on `(path, region)` — the same key the push supersedes on — and knows
/// the difference between a path that holds a picture and one that holds text.
#[test]
fn holds_image_view_answers_for_the_key_the_push_supersedes_on() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_file_view_deduped(
        "mock/a.png".to_string(),
        None,
        "a PNG".to_string(),
        vec![image(1_024)],
    );
    ctx.open_file_view_deduped("src/a.ts".to_string(), None, "code".to_string(), Vec::new());

    assert!(ctx.holds_image_view("mock/a.png", None));
    assert!(
        !ctx.holds_image_view("src/a.ts", None),
        "a text view is not an image view"
    );
    assert!(!ctx.holds_image_view("mock/never-opened.png", None));
    assert!(
        !ctx.holds_image_view(
            "mock/a.png",
            Some(FileRegion {
                offset: 1,
                limit: 20
            })
        ),
        "a different region is a different key, and would open a second view"
    );
}

/// **A superseded copy stops occupying the cap.**
///
/// Re-opening across turns retags the older copy to `History` in place — its bytes stay in the
/// window to protect a provider's cached prefix — but it is no longer a view, no longer closable by
/// path, and therefore no longer an occupant. Counting it would leave an agent that refreshed one
/// mockup four times unable to open anything, with `view.current()` listing a single view.
#[test]
fn a_superseded_image_view_stops_occupying_the_cap() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_file_view_deduped(
        "mock/a.png".to_string(),
        None,
        "a PNG".to_string(),
        vec![image(1_024)],
    );
    ctx.begin_turn(2);
    ctx.open_file_view_deduped(
        "mock/a.png".to_string(),
        None,
        "a PNG, again".to_string(),
        vec![image(1_024)],
    );

    assert_eq!(
        ctx.items().len(),
        2,
        "the retagged copy stays in the window"
    );
    assert_eq!(
        ctx.open_image_views(),
        1,
        "but only the live view occupies the cap"
    );
    assert_eq!(
        resident_images(&ctx),
        1,
        "and only the live view still carries a picture, so the cap counts what is uploaded"
    );
    let retired = &ctx.items()[0];
    assert!(
        retired.message().images.is_empty(),
        "the retired copy's picture is taken out rather than left to be re-uploaded forever"
    );
    assert!(
        retired
            .message()
            .content
            .as_deref()
            .expect("the retired copy keeps its text")
            .contains("no longer shown here"),
        "and it says so, so the model does not read a description of a picture it cannot see"
    );
    assert!(
        retired.tokens() < ctx.items()[1].tokens(),
        "its estimate follows the bytes: the live copy carries the picture and costs more"
    );
}

#[test]
fn re_opening_one_picture_every_turn_leaves_exactly_one_picture_resident() {
    let mut ctx = code_model();

    // The workflow the supersede carve-out exists for: a program re-renders a screenshot and looks
    // at it again, turn after turn. Every one of these is admitted (a supersede is never refused),
    // so if a retired copy kept its bytes the window would end up holding twenty pictures that
    // `open_image_views` reports as one — the cap counting a number that had stopped mattering.
    for turn in 1..=20 {
        ctx.begin_turn(turn);
        ctx.open_file_view_deduped(
            "shot.png".to_string(),
            None,
            format!("screenshot after turn {turn}"),
            vec![image(4_096)],
        );
    }

    assert_eq!(ctx.open_image_views(), 1, "one view is open");
    assert_eq!(
        resident_images(&ctx),
        1,
        "and one picture is resident: the cap bounds what the run actually pays per request"
    );
}

#[test]
fn a_superseded_text_view_is_left_exactly_as_it_was() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("notes".to_string(), "first pass".to_string());
    ctx.begin_turn(2);
    ctx.open_text_view("notes".to_string(), "second pass".to_string());

    // The picture correction is scoped to pictures. A retired text body is already-sent text: it
    // costs what it cost, rewriting it would invalidate a cached prefix for nothing, and the note
    // would be describing a removal that never happened.
    assert!(
        bodies(&ctx)[0].contains("first pass"),
        "the retired body is untouched"
    );
    assert!(
        !bodies(&ctx)[0].contains("no longer shown here"),
        "and gains no note about a picture it never carried"
    );
}

#[test]
fn a_picture_re_opened_inside_one_program_leaves_no_note_behind() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_file_view_deduped(
        "shot.png".to_string(),
        None,
        "first look".to_string(),
        vec![image(1_024)],
    );
    ctx.open_file_view_deduped(
        "shot.png".to_string(),
        None,
        "second look".to_string(),
        vec![image(1_024)],
    );

    // Nothing was sent between the two opens, so the first copy is removed outright rather than
    // retired — there is no corpse to correct and no reader to correct it for.
    assert_eq!(ctx.items().len(), 1);
    assert_eq!(resident_images(&ctx), 1);
    assert!(!bodies(&ctx)[0].contains("no longer shown here"));
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

#[test]
fn a_view_opened_and_closed_in_one_program_reaches_the_window_not_at_all() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("scratch".to_string(), "working it out".to_string());

    let closed = ctx.close_text_views(Some("scratch"));

    assert_eq!(closed.items, 1);
    assert_eq!(closed.paths, vec!["scratch".to_string()]);
    assert!(closed.tokens > 0);
    assert!(ctx.items().is_empty());
    assert_eq!(ctx.tokens_for(GgContextSource::TextView), 0);
}

#[test]
fn closing_a_text_view_leaves_the_other_bands_alone() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("a".to_string(), "first".to_string());
    ctx.open_text_view("b".to_string(), "second".to_string());
    ctx.open_file_view_deduped(
        "a".to_string(),
        None,
        "a file also called a".to_string(),
        Vec::new(),
    );

    let closed = ctx.close_text_views(Some("a"));

    // A close is routed by *kind*: a path closes file views, a label closes text views, and a name
    // that happens to be both closes only the one asked for.
    assert_eq!(closed.items, 1);
    assert_eq!(
        keys(&ctx),
        vec![
            (GgContextSource::TextView, Some("b".to_string()), None),
            (GgContextSource::FileView, Some("a".to_string()), None),
        ]
    );
}

#[test]
fn a_blanket_close_removes_every_text_view() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("a".to_string(), "first".to_string());
    ctx.open_text_view("b".to_string(), "second".to_string());

    let closed = ctx.close_text_views(None);

    assert_eq!(closed.items, 2);
    assert_eq!(closed.paths, vec!["a".to_string(), "b".to_string()]);
    assert!(ctx.items().is_empty());
}

#[test]
fn closing_an_unopened_label_reclaims_nothing_and_is_not_a_failure() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("a".to_string(), "first".to_string());

    assert_eq!(
        ctx.close_text_views(Some("missing")),
        EvictionResult::default()
    );
    assert_eq!(ctx.items().len(), 1);
}

#[test]
fn a_pinned_text_view_survives_a_blanket_close() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.push_labeled(
        GgContextSource::TextView,
        Retention::Pinned,
        Message::user("kept"),
        Some("pinned".to_string()),
    );
    ctx.open_text_view("scratch".to_string(), "dropped".to_string());

    let closed = ctx.close_text_views(None);

    // The same carve-out `evict_file_views` makes: pinning is what says an item is kept in the
    // window, and removal is what pinning prevents.
    assert_eq!(closed.items, 1);
    assert_eq!(closed.paths, vec!["scratch".to_string()]);
    assert_eq!(
        keys(&ctx),
        vec![(GgContextSource::TextView, Some("pinned".to_string()), None)]
    );
}

#[test]
fn closing_a_file_view_by_path_closes_every_page_of_it() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(FileRegion {
            offset: 1,
            limit: 200,
        }),
        "page 1".to_string(),
        Vec::new(),
    );
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(FileRegion {
            offset: 201,
            limit: 200,
        }),
        "page 2".to_string(),
        Vec::new(),
    );
    ctx.open_file_view_deduped(
        "b.ts".to_string(),
        None,
        "another file".to_string(),
        Vec::new(),
    );

    let evicted = ctx.evict_file_views(Some("a.ts"));

    // Opening keys on `(path, region)`; closing keys on the path alone — an agent that wants a file
    // gone wants the whole file gone, and that is the established eviction semantics.
    assert_eq!(evicted.items, 2);
    assert_eq!(evicted.paths, vec!["a.ts".to_string()]);
    assert_eq!(
        keys(&ctx),
        vec![(GgContextSource::FileView, Some("b.ts".to_string()), None)]
    );
}

// ---------------------------------------------------------------------------
// Reporting: `view.current()` and persistence
// ---------------------------------------------------------------------------

#[test]
fn open_views_reports_both_kinds_with_their_own_token_cost() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    let region = FileRegion {
        offset: 201,
        limit: 200,
    };
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(region),
        "export {}".to_string(),
        Vec::new(),
    );

    let open = ctx.open_views();

    assert_eq!(
        open,
        vec![
            OpenViewInfo {
                kind: ViewKind::Text,
                selector: "summary".to_string(),
                tokens: ctx.items()[0].tokens() as u64,
                region: None,
            },
            OpenViewInfo {
                kind: ViewKind::File,
                selector: "a.ts".to_string(),
                tokens: ctx.items()[1].tokens() as u64,
                region: Some(region),
            },
        ]
    );
    // Every view is accounted, and the two bands together are what the views cost the window.
    assert_eq!(
        open.iter().map(|view| view.tokens).sum::<u64>(),
        ctx.tokens_for(GgContextSource::TextView) + ctx.tokens_for(GgContextSource::FileView)
    );
}

#[test]
fn open_views_folds_duplicate_native_reads_into_one_entry() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.push_file_view(Some("a.ts".to_string()), None, "c1", "once", Vec::new());
    ctx.push_file_view(Some("a.ts".to_string()), None, "c2", "once", Vec::new());

    let open = ctx.open_views();

    // What closing the selector reclaims is both of them, so one entry carrying the combined cost is
    // what the model needs to decide whether to.
    assert_eq!(open.len(), 1);
    assert_eq!(
        open[0].tokens,
        (ctx.items()[0].tokens() + ctx.items()[1].tokens()) as u64
    );
}

#[test]
fn open_views_omits_what_cannot_be_closed() {
    let mut ctx = code_model();
    ctx.push_file_view_with_retention(
        Some("specs/rules.md".to_string()),
        None,
        "c1",
        "the rules",
        Vec::new(),
        Retention::Pinned,
    );
    // A malformed native read has no selector at all, so no call could name it.
    ctx.push_file_view(None, None, "c2", "unattributable", Vec::new());
    ctx.begin_turn(1);
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());

    assert_eq!(
        ctx.open_views(),
        vec![OpenViewInfo {
            kind: ViewKind::Text,
            selector: "summary".to_string(),
            tokens: ctx.items()[2].tokens() as u64,
            region: None,
        }]
    );
}

#[test]
fn open_text_views_report_the_body_the_agent_supplied() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());
    ctx.begin_turn(2);
    ctx.open_text_view("summary".to_string(), "0 tests failed".to_string());
    ctx.open_text_view("plan".to_string(), "fix the parser".to_string());
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        None,
        "export {}".to_string(),
        Vec::new(),
    );

    // Persistence records the *material*, not a reference to it: a text view has no on-disk truth to
    // go stale against, so a reference would restore nothing. The heading the window adds is not
    // part of it — re-opening one must not head it twice.
    assert_eq!(
        ctx.open_text_views(),
        vec![
            OpenTextView {
                label: "summary".to_string(),
                body: "0 tests failed".to_string(),
            },
            OpenTextView {
                label: "plan".to_string(),
                body: "fix the parser".to_string(),
            },
        ]
    );
}

#[test]
fn a_persisted_text_view_reopens_byte_identically() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());
    let recorded = ctx.open_text_views();

    let mut next = code_model();
    for view in recorded {
        next.open_text_view(view.label, view.body);
    }

    assert_eq!(bodies(&next), bodies(&ctx));
    assert_eq!(next.open_text_views(), ctx.open_text_views());
}

// ---------------------------------------------------------------------------
// The rest of the window
// ---------------------------------------------------------------------------

#[test]
fn views_render_into_the_prompt_in_the_order_they_were_opened() {
    let mut ctx = code_model();
    ctx.set_system("system");
    ctx.push_user_prompt("build a game");
    ctx.begin_turn(1);
    ctx.push_assistant(Some("a program".to_string()), Vec::new());
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        None,
        "export {}".to_string(),
        Vec::new(),
    );
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());

    // The assistant message carrying the program, then the view messages: a view mutates the live
    // window there and then, so there is no staging buffer to reconcile at turn end.
    assert_eq!(
        ctx.prompt_items()
            .map(|item| item.source)
            .collect::<Vec<_>>(),
        vec![
            GgContextSource::System,
            GgContextSource::UserPrompt,
            GgContextSource::Assistant,
            GgContextSource::FileView,
            GgContextSource::TextView,
        ]
    );
    assert_eq!(
        ctx.prompt_items()
            .map(|item| item.label)
            .collect::<Vec<_>>(),
        vec![None, None, None, Some("a.ts"), Some("summary")]
    );
    assert_eq!(
        ctx.prompt_items()
            .map(|item| item.tokens as u64)
            .sum::<u64>(),
        ctx.total_tokens()
    );
}

#[test]
fn a_compaction_drops_text_views_like_any_other_ephemeral_item() {
    let mut ctx = code_model();
    ctx.push_user_prompt("build a game");
    ctx.begin_turn(1);
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());

    ctx.clear_ephemeral();

    // A text view has nowhere to be re-seeded *from*, so it does not survive a compaction — the
    // agent writes it to a memory or a file if it needs it to.
    assert_eq!(keys(&ctx), vec![(GgContextSource::UserPrompt, None, None)]);
    assert!(ctx.open_text_views().is_empty());
}

/// The usage block's whole premise is that it only reports what the reading agent can *do*
/// something about. A text view is reclaimed by `view.close` and by nothing else — `evict_file_view`
/// cannot touch it — so a block that names the `Text Views` band must also name that call, or it has
/// charged the agent for tokens and told it no way to get them back.
#[test]
fn the_context_usage_signal_names_the_text_view_band_and_the_call_that_closes_it() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());
    ctx.refresh_context_usage_signal(UsageSignalOptions {
        can_evict: true,
        program_language: Some(GgProgramLanguage::TypeScript),
        can_archive: false,
        top_file_views: 3,
    });

    let signal = ctx
        .prompt_items()
        .find(|item| item.slot == PromptSlot::ContextUsage)
        .expect("a usage signal");
    let text = signal
        .message
        .content
        .as_deref()
        .expect("the signal carries text");
    assert!(
        text.contains("Text Views"),
        "the signal must name the band the agent can act on: {text}"
    );
    assert!(
        text.contains("`view.close`"),
        "the signal must name the only call that reclaims that band: {text}"
    );
}

/// The mirror of the above: a tool-calling agent has no `view` object, so the block must not point
/// at a call it cannot make. This is the same rule that keeps `evict_file_view` out of the block for
/// an agent whose registry withholds it.
#[test]
fn a_tool_calling_agent_is_never_pointed_at_view_close() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());
    ctx.refresh_context_usage_signal(UsageSignalOptions {
        can_evict: true,
        program_language: None,
        can_archive: false,
        top_file_views: 3,
    });

    let signal = ctx
        .prompt_items()
        .find(|item| item.slot == PromptSlot::ContextUsage)
        .expect("a usage signal");
    let text = signal
        .message
        .content
        .as_deref()
        .expect("the signal carries text");
    assert!(!text.contains("view.close"), "{text}");
}

// ---------------------------------------------------------------------------
// Documentation views
// ---------------------------------------------------------------------------

/// **A documentation view is a view**, not the pinned block a doc lookup used to leave behind.
///
/// The whole of what `view.openDocsView` changed. A pin could not be closed, could not be
/// superseded, and grew for the life of the agent; this is keyed by the function's name, replaces
/// its own earlier copy, and answers to `view.close`. It shares the `Skill` band with a read skill
/// because both are reference material gg holds — but a read skill is pinned and this is not, which
/// is the only thing telling the two apart.
#[test]
fn a_docs_view_is_ephemeral_keyed_and_closable() {
    let mut ctx = code_model();
    ctx.open_docs_view(
        "readFile".to_string(),
        "readFile(path): FileRead".to_string(),
    );

    let item = ctx
        .items()
        .iter()
        .find(|item| item.source() == GgContextSource::Skill)
        .expect("the docs view is in the Documentation band");
    assert_eq!(item.retention(), Retention::Ephemeral);
    assert_eq!(item.label(), Some("readFile"));
    assert_eq!(item.message().role, Role::User);
    assert!(
        item.message()
            .content
            .as_deref()
            .expect("a body")
            .starts_with("Documentation: readFile\n----\n"),
        "it is headed by the function it documents, so the model can name it in a close"
    );

    // Closing it by that name reclaims it.
    let closed = ctx.close_docs_views(Some("readFile"));
    assert_eq!(closed.items, 1);
    assert!(
        !ctx.items()
            .iter()
            .any(|item| item.source() == GgContextSource::Skill)
    );
}

/// Re-opening the same function's docs **replaces** the view rather than stacking a second copy —
/// the same intent semantics `view.openText` has, and the reason a model may ask again freely.
#[test]
fn re_opening_a_functions_docs_supersedes_the_copy_that_was_there() {
    let mut ctx = code_model();
    ctx.open_docs_view("readFile".to_string(), "the first copy".to_string());
    let opened = ctx.open_docs_view("readFile".to_string(), "the second copy".to_string());
    assert!(opened.superseded);

    let bodies: Vec<String> = ctx
        .items()
        .iter()
        .filter(|item| item.source() == GgContextSource::Skill)
        .map(|item| item.message().content.clone().unwrap_or_default())
        .collect();
    assert_eq!(bodies.len(), 1, "one copy, not two: {bodies:?}");
    assert!(bodies[0].contains("the second copy"), "{bodies:?}");
}

/// **Closing docs views never touches a read skill.**
///
/// The two share a band and are told apart by retention alone, so the pinned carve-out
/// `remove_views` already applies is exactly the rule that makes `view.close` safe here. Without it
/// a program tidying up its documentation would silently drop an authored skill it cannot get back.
#[test]
fn closing_docs_views_spares_a_read_skill() {
    let mut ctx = code_model();
    ctx.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::user("the authored skill's body".to_string()),
    );
    ctx.open_docs_view("readFile".to_string(), "the function's docs".to_string());

    // A blanket close — the most dangerous form — still spares the skill.
    let closed = ctx.close_docs_views(None);
    assert_eq!(closed.items, 1);
    let left: Vec<String> = ctx
        .items()
        .iter()
        .filter(|item| item.source() == GgContextSource::Skill)
        .map(|item| item.message().content.clone().unwrap_or_default())
        .collect();
    assert_eq!(left.len(), 1);
    assert!(left[0].contains("the authored skill's body"), "{left:?}");
}

/// A docs view shows up in `view.current()` as its own kind, so a model deciding what to close can
/// see it — and a read skill does not, because it cannot be closed.
#[test]
fn open_views_reports_a_docs_view_and_not_a_read_skill() {
    let mut ctx = code_model();
    ctx.push(
        GgContextSource::Skill,
        Retention::Pinned,
        Message::user("the authored skill's body".to_string()),
    );
    ctx.open_docs_view("readFile".to_string(), "the function's docs".to_string());

    let open: Vec<(ViewKind, String)> = ctx
        .open_views()
        .into_iter()
        .map(|view| (view.kind, view.selector))
        .collect();
    assert_eq!(open, vec![(ViewKind::Docs, "readFile".to_string())]);
}
