//! Tests for **views** — the material a
//! [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/views/) program declares should be
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
        None,
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
    assert!(opened.tokens > estimate_image(&item.message().images[0]));
    // A view that shows no lines (here, none were reported) is headed by its path alone.
    assert_eq!(
        item.message().content.as_deref(),
        Some("File: a.ts\n----\nexport {}")
    );
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

#[test]
fn a_paged_file_view_is_headed_by_its_path_and_the_lines_it_shows() {
    let mut ctx = code_model();
    let region = FileRegion {
        offset: 100,
        limit: 151,
    };
    ctx.open_file_view_deduped(
        "foo/bar.ts".to_string(),
        Some(region),
        Some(ShownLines {
            first: 100,
            last: 250,
            total: 400,
        }),
        "const x = 1;".to_string(),
        Vec::new(),
    );
    assert_eq!(
        bodies(&ctx),
        vec!["File: foo/bar.ts:100-250 of 400 lines\n----\nconst x = 1;".to_string()]
    );
    // The lines are the heading's business, not the key's: the region alone still keys the view.
    assert_eq!(
        keys(&ctx),
        vec![(
            GgContextSource::FileView,
            Some("foo/bar.ts".to_string()),
            Some(region)
        )]
    );
}

#[test]
fn a_whole_file_view_is_headed_one_to_its_total_line_count() {
    let mut ctx = code_model();
    ctx.open_file_view_deduped(
        "src/main.ts".to_string(),
        None,
        Some(ShownLines {
            first: 1,
            last: 42,
            total: 42,
        }),
        "export {}".to_string(),
        Vec::new(),
    );
    assert_eq!(
        bodies(&ctx),
        vec!["File: src/main.ts:1-42 of 42 lines\n----\nexport {}".to_string()]
    );
    // A whole-file view's key is still `(path, None)`, so re-opening it supersedes it.
    ctx.open_file_view_deduped(
        "src/main.ts".to_string(),
        None,
        Some(ShownLines {
            first: 1,
            last: 43,
            total: 43,
        }),
        "export {};\n".to_string(),
        Vec::new(),
    );
    assert_eq!(ctx.open_file_views().len(), 1);
    assert_eq!(
        ctx.items().last().unwrap().message().content.as_deref(),
        Some("File: src/main.ts:1-43 of 43 lines\n----\nexport {};\n")
    );
}

#[test]
fn a_seeded_spec_is_headed_by_its_workspace_relative_path_and_whole_range() {
    let mut ctx = code_model();
    // What autoload seeds: the case's workspace-relative path, the whole file, and the lines the
    // read reported for it.
    ctx.seed_file_view(
        "specs/rules.md".to_string(),
        Some(ShownLines {
            first: 1,
            last: 7,
            total: 7,
        }),
        "# Carom\n".to_string(),
        Vec::new(),
        Retention::Pinned,
    );
    let item = &ctx.items()[0];
    assert_eq!(item.label(), Some("specs/rules.md"));
    assert_eq!(item.region(), None);
    assert_eq!(
        item.lines(),
        Some(ShownLines {
            first: 1,
            last: 7,
            total: 7,
        })
    );
    assert_eq!(
        item.message().content.as_deref(),
        Some("File: specs/rules.md:1-7 of 7 lines\n----\n# Carom\n")
    );
}

#[test]
fn shown_lines_come_from_what_the_read_reported() {
    use crate::tools::{ApiData, FileTextData};
    let text = |first_line, last_line, total_lines| {
        ApiData::FileText(FileTextData {
            contents: String::new(),
            first_line,
            last_line,
            total_lines,
            byte_truncated: false,
        })
    };
    // A paged read: the window it returned, and the file's own total.
    assert_eq!(
        ShownLines::of_read(Some(&text(100, 250, 1000))),
        Some(ShownLines {
            first: 100,
            last: 250,
            total: 1000,
        })
    );
    // A whole-file read: `1-N of N lines`.
    assert_eq!(
        ShownLines::of_read(Some(&text(1, 42, 42))),
        Some(ShownLines {
            first: 1,
            last: 42,
            total: 42,
        })
    );
    // An empty file shows no lines, and so carries no range.
    assert_eq!(ShownLines::of_read(Some(&text(1, 0, 0))), None);
    // A picture's sidecar is not a text window.
    assert_eq!(ShownLines::of_read(None), None);
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
    assert_eq!(ctx.open_text_views().len(), 1);
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
        None,
        "page 1".to_string(),
        Vec::new(),
    );
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(second),
        None,
        "page 2".to_string(),
        Vec::new(),
    );
    ctx.begin_turn(2);

    // Two pages of one file are two views and must coexist — a program paging through a file is not
    // a program changing its mind.
    assert_eq!(ctx.open_file_views().len(), 2);

    let opened = ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(second),
        None,
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
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        None,
        None,
        "whole".to_string(),
        Vec::new(),
    );
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(page),
        None,
        "page".to_string(),
        Vec::new(),
    );
    ctx.begin_turn(2);

    // `FileRegion::covered` reports `None` for a whole-file read, so the whole-file view supersedes
    // itself on re-read without disturbing the page.
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        None,
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
// The pictures the window actually holds
// ---------------------------------------------------------------------------
//
// There is no cap on how MANY views may be open — of any kind, pictures included. What these assert
// is the property that survives the cap's removal and matters more without it: a retired copy of an
// image view does not keep its bytes, so what the run uploads per request is what `view.current()`
// says is open, and re-opening one screenshot for twenty turns does not leave twenty pictures
// resident.

/// **A superseded copy stops carrying its picture.**
///
/// Re-opening across turns retags the older copy to `History` in place — its *text* stays in the
/// window to protect a provider's cached prefix — but the picture is taken out. A picture is
/// re-uploaded whole on every subsequent request for as long as it is resident, so leaving it would
/// have an agent that refreshed one mockup four times paying for four uploads a turn while
/// `view.current()` listed a single view.
#[test]
fn a_superseded_image_view_stops_carrying_its_picture() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_file_view_deduped(
        "mock/a.png".to_string(),
        None,
        None,
        "a PNG".to_string(),
        vec![image(1_024)],
    );
    ctx.begin_turn(2);
    ctx.open_file_view_deduped(
        "mock/a.png".to_string(),
        None,
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
        ctx.open_file_views().len(),
        1,
        "but only the live view is open"
    );
    assert_eq!(
        resident_images(&ctx),
        1,
        "and only the live view still carries a picture, so what is uploaded is what is open"
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

    // The workflow this exists for: a program re-renders a screenshot and looks at it again, turn
    // after turn. If a retired copy kept its bytes the window would end up holding twenty pictures
    // for what is really one open view, and the run would upload all twenty on every request.
    for turn in 1..=20 {
        ctx.begin_turn(turn);
        ctx.open_file_view_deduped(
            "shot.png".to_string(),
            None,
            None,
            format!("screenshot after turn {turn}"),
            vec![image(4_096)],
        );
    }

    assert_eq!(ctx.open_file_views().len(), 1, "one view is open");
    assert_eq!(
        resident_images(&ctx),
        1,
        "and one picture is resident: what the run pays per request follows what is open"
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
        None,
        "first look".to_string(),
        vec![image(1_024)],
    );
    ctx.open_file_view_deduped(
        "shot.png".to_string(),
        None,
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
        None,
        "page 1".to_string(),
        Vec::new(),
    );
    ctx.open_file_view_deduped(
        "a.ts".to_string(),
        Some(FileRegion {
            offset: 201,
            limit: 200,
        }),
        None,
        "page 2".to_string(),
        Vec::new(),
    );
    ctx.open_file_view_deduped(
        "b.ts".to_string(),
        None,
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
        can_close_views: true,
        can_archive: false,
        top_file_views: 3,
        threshold_percent: 0,
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
        text.contains("`gg.views.close`"),
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
        can_close_views: false,
        can_archive: false,
        top_file_views: 3,
        threshold_percent: 0,
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

/// **A code agent not granted `views.close` is not pointed at it either.** Closing a view is bought
/// by agent-managed context and granted by the allowlist, so code mode alone no longer says the
/// call exists; the block reads the grant, exactly as it reads the registry for `evict_file_view`.
#[test]
fn a_code_agent_without_the_close_grant_is_not_pointed_at_view_close() {
    let mut ctx = code_model();
    ctx.begin_turn(1);
    ctx.open_text_view("summary".to_string(), "3 tests failed".to_string());
    ctx.refresh_context_usage_signal(UsageSignalOptions {
        can_evict: true,
        program_language: Some(GgProgramLanguage::TypeScript),
        can_close_views: false,
        can_archive: false,
        top_file_views: 3,
        threshold_percent: 0,
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
        !text.contains("gg.views.close"),
        "a call the agent was not granted is not named at it: {text}"
    );
}
