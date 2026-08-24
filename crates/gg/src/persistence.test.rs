//! Tests for agent persistence: the per-profile record of open file views, the exclusivity key that
//! serializes a persistent profile's instances, and the restore that re-reads a recorded desk.

use std::sync::Arc;

use tempfile::TempDir;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_PERSISTENCE, GgCapabilityConfig, GgCapabilitySet, GgContextSource,
    GgSubagentRef,
};

use super::*;
use crate::context::{FileRegion, HeuristicTokenEstimator, OpenTextView, Retention};
use crate::telemetry::CollectingSink;

/// A documentation runtime for an agent granted the read-file capability and every call it offers —
/// enough to bind `readFile` and the type it hands back, and nothing else.
fn reader() -> DocsRuntime {
    let capability = test_cabinet_core::gg::CAPABILITY_READ_FILE;
    DocsRuntime::new(
        vec![capability.to_string()],
        crate::ending::EndingRole::Standard,
        &crate::sandbox::capability_operations([capability]),
        GgProgramLanguage::TypeScript,
    )
}

/// A context model measuring with the deterministic heuristic estimator, in tool-calling mode.
fn context() -> ContextModel {
    ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        false,
    )
}

/// A temp workspace holding `files` (path, contents), and a tool context rooted at it.
fn workspace(files: &[(&str, &str)]) -> (TempDir, ToolContext) {
    let dir = TempDir::new().unwrap();
    for (path, contents) in files {
        std::fs::write(dir.path().join(path), contents).unwrap();
    }
    let ctx = ToolContext::new(dir.path());
    (dir, ctx)
}

/// An emitter over a collecting sink, for the paths that warn.
fn emitter() -> (Emitter, CollectingSink) {
    let sink = CollectingSink::new();
    (
        Emitter::with_sink(None, Box::new(sink.clone())),
        sink.clone(),
    )
}

/// A capability set whose profiles with the given [slugs](GgAgentConfig::slug) are persistent, plus one
/// per id in `plain` that is not.
///
/// Each display name is deliberately unlike its id, because persistence keys on the id: a record
/// filed under a name would be a record two profiles could share.
fn set_with(persistent: &[&str], plain: &[&str]) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/x");
    for id in persistent {
        set.agents.push(GgAgentConfig {
            slug: (*id).to_string(),
            name: format!("The {id} agent"),
            capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_AGENT_PERSISTENCE)],
            ..GgAgentConfig::root()
        });
    }
    for id in plain {
        set.agents.push(GgAgentConfig {
            slug: (*id).to_string(),
            name: format!("The {id} agent"),
            capabilities: Vec::new(),
            ..GgAgentConfig::root()
        });
    }
    set
}

/// A whole-file view of `path`, as `open_file_views` reports one.
fn whole(path: &str) -> OpenFileView {
    OpenFileView {
        path: path.to_string(),
        region: None,
    }
}

/// A desk holding `files` and nothing else — the shape every pre-views test asserts against.
fn desk(files: Vec<OpenFileView>) -> PersistedDesk {
    PersistedDesk {
        files,
        texts: Vec::new(),
        docviews: Vec::new(),
    }
}

/// A text view with `label` and `body`, as `open_text_views` reports one.
fn text(label: &str, body: &str) -> OpenTextView {
    OpenTextView {
        label: label.to_string(),
        body: body.to_string(),
    }
}

// ---------------------------------------------------------------------------
// The exclusivity key
// ---------------------------------------------------------------------------

/// Only a persistent profile takes a key, and the key is the profile's own id — so every instance
/// of it contends with every other instance and with nothing else.
#[test]
fn only_a_persistent_profile_takes_an_exclusivity_key() {
    let set = set_with(&["owner"], &["worker"]);
    assert_eq!(
        exclusive_key(set.agent("owner").unwrap()),
        Some("owner".to_string())
    );
    assert_eq!(exclusive_key(set.agent("worker").unwrap()), None);
    // The root of this set has the default capabilities, which do not include persistence.
    assert_eq!(exclusive_key(set.root()), None);
}

/// The capability being *present but disabled* is off, like every other capability — so a comparison's
/// control arm keeps the configuration it would have used without serializing anything.
#[test]
fn a_disabled_persistence_capability_takes_no_key() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    set.agents.push(GgAgentConfig {
        slug: "owner".to_string(),
        name: "The owner agent".to_string(),
        capabilities: vec![GgCapabilityConfig::disabled(CAPABILITY_AGENT_PERSISTENCE)],
        subagents: vec![GgSubagentRef::any("owner")],
        ..GgAgentConfig::root()
    });
    assert!(!is_persistent(set.agent("owner").unwrap()));
    assert_eq!(exclusive_key(set.agent("owner").unwrap()), None);
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/// A profile with nothing recorded restores nothing; a later instance reads what an earlier one
/// recorded; and each record is scoped to its own profile.
#[test]
fn the_record_is_per_profile_and_starts_empty() {
    let store = AgentPersistence::new();
    assert!(store.desk("owner").files.is_empty());

    store.record("owner", desk(vec![whole("src/main.rs")]));
    store.record("reviewer", desk(vec![whole("README.md")]));
    assert_eq!(store.desk("owner").files, vec![whole("src/main.rs")]);
    assert_eq!(store.desk("reviewer").files, vec![whole("README.md")]);
}

/// Recording **replaces** rather than merges: the record is the desk as the last instance left it, so
/// a file that instance closed must not come back — including when it closed all of them.
#[test]
fn recording_replaces_the_previous_desk() {
    let store = AgentPersistence::new();
    store.record("owner", desk(vec![whole("a.rs"), whole("b.rs")]));
    store.record("owner", desk(vec![whole("b.rs")]));
    assert_eq!(store.desk("owner").files, vec![whole("b.rs")]);

    store.record("owner", PersistedDesk::default());
    assert!(
        store.desk("owner").files.is_empty(),
        "an instance that finished with nothing open leaves nothing behind"
    );
}

/// A non-persistent agent's setup records nothing and restores nothing, so the loop needs no branch of
/// its own — and a persistent one round-trips its window's views through the shared record.
#[test]
fn the_setup_records_only_for_a_persistent_profile() {
    let set = set_with(&["owner"], &["worker"]);
    let store = AgentPersistence::new();

    let mut window = context();
    window.push_file_view(
        Some("src/main.rs".to_string()),
        None,
        "c1",
        "fn main",
        vec![],
    );

    let plain = PersistenceSetup::resolve(set.agent("worker").unwrap(), Arc::clone(&store));
    assert!(!plain.enabled());
    plain.record(&window);
    assert!(store.desk("worker").files.is_empty());
    assert_eq!(plain.restored(), PersistedDesk::default());

    let owner = PersistenceSetup::resolve(set.agent("owner").unwrap(), Arc::clone(&store));
    assert!(owner.enabled());
    owner.record(&window);
    assert_eq!(owner.restored(), desk(vec![whole("src/main.rs")]));

    // A *second* instance of the profile — a fresh setup over the same run-global record — sees it.
    let next = PersistenceSetup::resolve(set.agent("owner").unwrap(), Arc::clone(&store));
    assert_eq!(next.restored(), desk(vec![whole("src/main.rs")]));
}

// ---------------------------------------------------------------------------
// What counts as an open file view
// ---------------------------------------------------------------------------

/// The recorded desk is the paths and regions of the ephemeral file views in the window: paged reads
/// keep their region, exact duplicates collapse, evicted views are gone, and a locked (pinned)
/// autoloaded spec is left to autoload rather than persisted as an ordinary read.
#[test]
fn the_recorded_desk_is_the_windows_ephemeral_file_views() {
    let mut window = context();
    window.set_system("system");
    window.push_file_view(Some("a.rs".to_string()), None, "c1", "whole a", vec![]);
    window.push_file_view(
        Some("b.rs".to_string()),
        Some(FileRegion {
            offset: 200,
            limit: 50,
        }),
        "c2",
        "a window of b",
        vec![],
    );
    // The same read again — one desk entry, not two.
    window.push_file_view(Some("a.rs".to_string()), None, "c3", "whole a", vec![]);
    // A locked autoloaded spec: pinned, so autoload owns it, not persistence.
    window.push_file_view_with_retention(
        Some("specs/spec.md".to_string()),
        None,
        "c4",
        "the spec",
        vec![],
        Retention::Pinned,
    );
    // Ordinary tool output is not a file view at all.
    window.push_tool_result(GgContextSource::ToolOutput, "c5", "shell output");

    assert_eq!(
        window.open_file_views(),
        vec![
            whole("a.rs"),
            OpenFileView {
                path: "b.rs".to_string(),
                region: Some(FileRegion {
                    offset: 200,
                    limit: 50
                }),
            },
        ]
    );

    // Two *different* windows of one file are two entries: the dedupe is on the whole view (path and
    // region), not on the path, so an agent paging through a large file keeps every page it holds.
    // Eviction, by contrast, is per path — so all of a file's windows go together.
    let mut paged = context();
    for (id, offset) in [("c1", 1), ("c2", 100), ("c3", 200)] {
        paged.push_file_view(
            Some("big.rs".to_string()),
            Some(FileRegion { offset, limit: 100 }),
            id,
            format!("lines from {offset}"),
            vec![],
        );
    }
    assert_eq!(
        paged
            .open_file_views()
            .iter()
            .map(|view| view.region.map(|region| region.offset))
            .collect::<Vec<_>>(),
        vec![Some(1), Some(100), Some(200)],
        "every page the agent holds is on the desk, in the order it opened them"
    );
    assert_eq!(paged.evict_file_views(Some("big.rs")).items, 3);
    assert!(paged.open_file_views().is_empty());

    // A view the agent evicted is no longer open, so it is not carried over.
    window.evict_file_views(Some("a.rs"));
    assert_eq!(
        window.open_file_views(),
        vec![OpenFileView {
            path: "b.rs".to_string(),
            region: Some(FileRegion {
                offset: 200,
                limit: 50
            }),
        }]
    );
}

// ---------------------------------------------------------------------------
// The restore
// ---------------------------------------------------------------------------

/// Restoring re-opens each recorded view as a well-formed `read_file` call/result pair carrying the
/// file's **current** contents — not the bytes the last instance saw.
#[tokio::test]
async fn restoring_re_reads_each_view_from_the_workspace_as_it_stands_now() {
    let (dir, ctx) = workspace(&[("a.rs", "the original a\n")]);
    let (emitter, _sink) = emitter();
    let mut window = context();

    // The file changed since the view was recorded — which is the whole reason it is re-read.
    std::fs::write(dir.path().join("a.rs"), "a, as rewritten by someone else\n").unwrap();

    let restored = restore_file_views(
        &mut window,
        &[whole("a.rs")],
        Some(ReadPolicy::Unlimited),
        &ctx,
        GgProgramLanguage::TypeScript,
        &emitter,
    )
    .await;
    assert_eq!(restored, 1);

    let items = window.items();
    assert_eq!(items.len(), 2, "one assistant call and its file view");
    let call = &items[0].message().tool_calls[0];
    assert_eq!(call.name, READ_FILE_TOOL);
    assert_eq!(call.arguments["path"], "a.rs");
    assert_eq!(items[1].source(), GgContextSource::FileView);
    assert_eq!(items[1].label(), Some("a.rs"));
    assert_eq!(
        items[1].message().tool_call_id.as_deref(),
        Some(call.id.as_str()),
        "the synthesized pair is well-formed"
    );
    assert!(
        items[1]
            .message()
            .content
            .as_deref()
            .unwrap()
            .contains("as rewritten by someone else"),
        "the view shows the file now, not as it was recorded: {:?}",
        items[1].message().content
    );
    // And the restored view is ordinary working material the agent can evict, not a pinned one.
    assert_eq!(window.evict_file_views(None).items, 1);
}

/// A paged view is re-read over the region it covered, and the region rides along on the restored view
/// so it survives being recorded again.
#[tokio::test]
async fn restoring_a_paged_view_re_reads_the_same_region() {
    let body: String = (1..=300).map(|n| format!("line {n}\n")).collect();
    let (_dir, ctx) = workspace(&[("big.rs", &body)]);
    let (emitter, _sink) = emitter();
    let mut window = context();

    let view = OpenFileView {
        path: "big.rs".to_string(),
        region: Some(FileRegion {
            offset: 200,
            limit: 5,
        }),
    };
    let restored = restore_file_views(
        &mut window,
        std::slice::from_ref(&view),
        Some(ReadPolicy::DefaultCap(100)),
        &ctx,
        GgProgramLanguage::TypeScript,
        &emitter,
    )
    .await;
    assert_eq!(restored, 1);

    let items = window.items();
    let call = &items[0].message().tool_calls[0];
    assert_eq!(call.arguments["offset"], 200);
    assert_eq!(call.arguments["limit"], 5);
    let content = items[1].message().content.clone().unwrap();
    assert!(content.contains("line 200"), "{content}");
    assert!(!content.contains("line 199"), "{content}");
    assert!(!content.contains("line 210"), "{content}");
    assert_eq!(
        window.open_file_views(),
        vec![view],
        "the region survives the round trip, so it can be recorded again"
    );
}

/// A desk holding two different **windows of one file** gets both back: the skip is against the window
/// as it stood on entry, not against the views the restore is itself adding, so paging through a large
/// file does not collapse to its first page.
#[tokio::test]
async fn two_windows_of_one_file_both_come_back() {
    let body: String = (1..=300).map(|n| format!("line {n}\n")).collect();
    let (_dir, ctx) = workspace(&[("big.rs", &body)]);
    let (emitter, _sink) = emitter();
    let mut window = context();

    let desk = vec![
        OpenFileView {
            path: "big.rs".to_string(),
            region: Some(FileRegion {
                offset: 1,
                limit: 3,
            }),
        },
        OpenFileView {
            path: "big.rs".to_string(),
            region: Some(FileRegion {
                offset: 200,
                limit: 3,
            }),
        },
    ];
    let restored = restore_file_views(
        &mut window,
        &desk,
        Some(ReadPolicy::Unlimited),
        &ctx,
        GgProgramLanguage::TypeScript,
        &emitter,
    )
    .await;
    assert_eq!(restored, 2);
    assert_eq!(window.open_file_views(), desk);
}

/// A file that can no longer be read is skipped with a warning rather than failing the agent: the desk
/// it was on is gone, which is a normal thing to come back to.
#[tokio::test]
async fn a_view_whose_file_is_gone_is_skipped_with_a_warning() {
    let (_dir, ctx) = workspace(&[("here.rs", "still here\n")]);
    let (emitter, sink) = emitter();
    let mut window = context();

    let restored = restore_file_views(
        &mut window,
        &[whole("gone.rs"), whole("here.rs")],
        Some(ReadPolicy::Unlimited),
        &ctx,
        GgProgramLanguage::TypeScript,
        &emitter,
    )
    .await;
    assert_eq!(restored, 1, "the readable view still opens");
    assert_eq!(window.open_file_views(), vec![whole("here.rs")]);

    let warnings: Vec<String> = sink
        .events()
        .into_iter()
        .filter_map(|event| match event.kind {
            GgTelemetryKind::Log { level, message } if level == "warn" => Some(message),
            _ => None,
        })
        .collect();
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("gone.rs"), "{}", warnings[0]);
}

/// A path already open in the window is not opened twice — what keeps a persistent agent that also
/// autoloads specifications from getting two copies of every spec it had read.
#[tokio::test]
async fn a_view_already_open_is_not_re_opened() {
    let (_dir, ctx) = workspace(&[("spec.md", "the spec\n")]);
    let (emitter, _sink) = emitter();
    let mut window = context();
    // As autoload would have seeded it, before the restore runs.
    window.push_file_view(
        Some("spec.md".to_string()),
        None,
        "autoload-0",
        "the spec",
        vec![],
    );

    let restored = restore_file_views(
        &mut window,
        &[whole("spec.md")],
        Some(ReadPolicy::Unlimited),
        &ctx,
        GgProgramLanguage::TypeScript,
        &emitter,
    )
    .await;
    assert_eq!(restored, 0);
    assert_eq!(window.open_file_views(), vec![whole("spec.md")]);
}

/// An empty record touches nothing at all — the shape a profile's very first instance opens in.
#[tokio::test]
async fn an_empty_record_seeds_nothing() {
    let (_dir, ctx) = workspace(&[]);
    let (emitter, _sink) = emitter();
    let mut window = context();
    window.set_system("system");

    assert_eq!(
        restore_file_views(
            &mut window,
            &[],
            Some(ReadPolicy::Unlimited),
            &ctx,
            GgProgramLanguage::TypeScript,
            &emitter,
        )
        .await,
        0
    );
    // Nothing was added to the thread; the system prompt is a slot, not an item.
    assert!(window.items().is_empty());
    assert!(window.system().is_some());
}

// ---------------------------------------------------------------------------
// Text views on the desk
// ---------------------------------------------------------------------------

/// The desk is **both** bands, and they are recorded by two different rules: a file view by
/// reference (path and region, never the bytes) and a text view **with its body**.
///
/// The asymmetry is the point. A file has an on-disk truth the reference stays true against; a text
/// view is whatever the agent composed and the window is its only copy, so a reference to it would
/// name nothing re-readable and restore an empty desk while reporting a full one.
#[test]
fn the_desk_records_files_by_reference_and_text_views_by_body() {
    let mut window = context();
    window.push_file_view(
        Some("a.rs".to_string()),
        None,
        "c1",
        "the bytes of a",
        vec![],
    );
    window.open_text_view("plan".to_string(), "1. read\n2. fix".to_string());

    let recorded = PersistedDesk::of(&window);
    assert_eq!(recorded.files, vec![whole("a.rs")]);
    assert_eq!(recorded.texts, vec![text("plan", "1. read\n2. fix")]);
    assert!(
        !format!("{:?}", recorded.files).contains("the bytes of a"),
        "a file view records the reference, never what the read returned: {:?}",
        recorded.files
    );
}

/// Restoring a text view hands the body back **byte for byte** under its own label, as an ordinary
/// ephemeral item the agent can close — and the restored window records the same desk again, so the
/// material survives an arbitrary succession of instances rather than degrading at each hop.
#[test]
fn restoring_a_text_view_hands_the_body_back_verbatim() {
    let desk = vec![
        text("plan", "1. read\n2. fix"),
        text("failures", "x.ts:12 expected 3, got 4"),
    ];
    let mut window = context();
    assert_eq!(restore_text_views(&mut window, &desk), 2);

    assert_eq!(window.open_text_views(), desk);
    assert_eq!(
        window.close_text_views(None).items,
        2,
        "a restored view is ordinary working material, not a pinned one"
    );

    // A second hop: the window that was restored into records exactly what it was handed.
    let mut again = context();
    restore_text_views(&mut again, &desk);
    assert_eq!(PersistedDesk::of(&again).texts, desk);
}

/// The text half of the restore is **idempotent by construction**: re-opening a label supersedes
/// rather than duplicates, so — unlike the file half, which needs an explicit already-open skip —
/// running it twice leaves one view per label.
#[test]
fn restoring_the_same_text_view_twice_leaves_one_of_it() {
    let desk = vec![text("plan", "1. read\n2. fix")];
    let mut window = context();
    restore_text_views(&mut window, &desk);
    restore_text_views(&mut window, &desk);
    assert_eq!(window.open_text_views(), desk);
}

/// A view the agent **closed** is off the desk, exactly as an evicted file view is: the record is
/// the desk as the last instance left it, and material it decided it was done with must not follow
/// it into the next session.
#[test]
fn a_closed_text_view_is_not_carried_over() {
    let mut window = context();
    window.open_text_view("plan".to_string(), "1. read".to_string());
    window.open_text_view("scratch".to_string(), "noise".to_string());
    window.close_text_views(Some("scratch"));

    assert_eq!(
        PersistedDesk::of(&window).texts,
        vec![text("plan", "1. read")]
    );
}

/// **A documentation view is recorded as its key and restored by re-rendering it.**
///
/// The third mechanism, and the only one that is neither a re-read nor a replay. Storing the
/// rendered text would put a second copy of gg's own catalogue in a profile's desk — and a stale one
/// the moment the next instance's scope differs by a tool, which is exactly when re-rendering is the
/// right answer and replaying is the wrong one.
#[test]
fn a_documentation_view_is_recorded_by_key_and_re_rendered() {
    let docs = reader();

    let mut window = context();
    window.open_docview(
        "readFile".to_string(),
        docs.read("readFile").expect("readFile is bound"),
    );
    window.open_docview(
        "FileRead".to_string(),
        docs.read_type("FileRead").expect("FileRead is catalogued"),
    );

    let recorded = PersistedDesk::of(&window);
    assert_eq!(
        recorded.docviews,
        vec!["readFile".to_string(), "FileRead".to_string()],
        "keys, in first-open order, and no bodies"
    );

    let mut next = context();
    assert_eq!(restore_docviews(&mut next, &recorded.docviews, &docs), 2);
    assert_eq!(next.open_docviews(), window.open_docviews());

    // Idempotent by construction, and for a stronger reason than the text half's: re-opening a key
    // that is already open is a no-op rather than a supersede, so nothing moves either.
    assert_eq!(
        restore_docviews(&mut next, &recorded.docviews, &docs),
        0,
        "the count is what arrived, not what was attempted: nothing came back, so the note this \
         number is written into must not claim two views did"
    );
    assert_eq!(next.open_docviews(), window.open_docviews());

    // The mixed case, which is the one a real code agent is always in: the `bootstrap` turn puts
    // its key in the window before this restore runs, so a desk that holds it plus one more must
    // report one.
    let mut seeded = context();
    seeded.open_docview(
        "readFile".to_string(),
        docs.read("readFile").expect("readFile is bound"),
    );
    assert_eq!(
        restore_docviews(&mut seeded, &recorded.docviews, &docs),
        1,
        "the key already open is a no-op and the other is a placement"
    );
}

/// **A key this instance's scope does not bind is skipped, not restored.**
///
/// The runtime answers through *this* agent's scope, so a profile whose next instance runs with
/// `read_file` withheld must not open documentation for a call it cannot make. That is the whole
/// reason the desk stores a key rather than the text: replaying the text would have restored it.
#[test]
fn a_key_this_instance_cannot_bind_is_not_restored() {
    let full = reader();
    let mut window = context();
    window.open_docview(
        "readFile".to_string(),
        full.read("readFile").expect("readFile is bound"),
    );
    let recorded = PersistedDesk::of(&window);

    let withheld = DocsRuntime::new(
        Vec::new(),
        crate::ending::EndingRole::Standard,
        &[],
        GgProgramLanguage::TypeScript,
    );
    let mut next = context();
    assert_eq!(
        restore_docviews(&mut next, &recorded.docviews, &withheld),
        0,
        "the next instance cannot call `readFile`, so it is not shown its documentation"
    );
    assert!(next.open_docviews().is_empty());
}

/// A view the agent **closed** is off the desk, on the same terms a closed text view is.
#[test]
fn a_closed_documentation_view_is_not_carried_over() {
    let docs = reader();
    let mut window = context();
    for key in ["readFile", "FileRead"] {
        window.open_docview(
            key.to_string(),
            docs.read_any(key).expect("both keys resolve"),
        );
    }
    window.close_docviews(Some("FileRead"));

    assert_eq!(
        PersistedDesk::of(&window).docviews,
        vec!["readFile".to_string()]
    );
}

/// The note an instance logs names **which mechanism** brought what back, because the two make
/// different promises: the file views are the workspace as it stands now (and may well differ from
/// what the last instance saw), while the text views are that instance's own material reproduced
/// exactly.
#[test]
fn the_restore_note_says_which_mechanism_brought_what_back() {
    let none = restore_note(0, 0, 0);
    assert!(none.contains("nothing carried over"), "{none}");

    let files = restore_note(2, 0, 0);
    assert!(files.contains("re-opened 2 file view(s)"), "{files}");
    assert!(files.contains("as it stands now"), "{files}");
    assert!(!files.contains("text view"), "{files}");

    let texts = restore_note(0, 3, 0);
    assert!(texts.contains("restored 3 text view(s)"), "{texts}");
    assert!(!texts.contains("file view"), "{texts}");

    let docviews = restore_note(0, 0, 4);
    assert!(
        docviews.contains("re-opened 4 documentation view(s)"),
        "{docviews}"
    );
    assert!(
        docviews.contains("this agent's own scope"),
        "the third mechanism makes its own promise — re-rendered, not replayed: {docviews}"
    );

    let all = restore_note(2, 3, 4);
    assert!(all.contains("re-opened 2 file view(s)"), "{all}");
    assert!(all.contains("restored 3 text view(s)"), "{all}");
    assert!(all.contains("re-opened 4 documentation view(s)"), "{all}");
}

// ---------------------------------------------------------------------------
// Responses-as-code
// ---------------------------------------------------------------------------

/// **The claim the handoff asked to be verified rather than asserted:** persistence now works for a
/// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) agent, and the file half
/// of it needed no change to this module at all.
///
/// It used to record nothing because a program's reads were consumed inside the program and never
/// reached the window. `view.openFile` and `view.openText` push real context items, so
/// `open_file_views` and `open_text_views` see them like any other — this drives the two
/// `ContextModel` entry points the loop's `LoopOperationApi` calls, over a **code-mode** window (the
/// heading a text view carries is code-mode-only, and it must not leak into the recorded body).
///
/// The loop-side half of the same claim — that a finishing code-mode instance really hands its desk
/// to the next one — is `agent.persistence.test.rs`.
#[tokio::test]
async fn a_code_mode_window_records_and_restores_the_views_a_program_opened() {
    let (dir, ctx) = workspace(&[("game.js", "// the first draft\n")]);
    let (emitter, _sink) = emitter();

    // A code-mode window, as an agent running programs holds one.
    let mut window = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        true,
    );
    // What `LoopOperationApi::open_file_view` and `open_text_view` do, and all a program's `view.*` calls
    // ever amount to.
    window.open_file_view_deduped(
        "game.js".to_string(),
        None,
        None,
        "// the first draft\n".to_string(),
        vec![],
    );
    window.open_text_view("plan".to_string(), "1. read\n2. fix".to_string());

    let recorded = PersistedDesk::of(&window);
    assert_eq!(
        recorded.files,
        vec![whole("game.js")],
        "a program's view.openFile is on the desk"
    );
    assert_eq!(
        recorded.texts,
        vec![text("plan", "1. read\n2. fix")],
        "the recorded body is what the program supplied, without the window's `View:` heading"
    );

    // Somebody else rewrites the file while the profile is idle.
    std::fs::write(dir.path().join("game.js"), "// rewritten by someone else\n").unwrap();

    let mut next = ContextModel::new(
        Arc::new(HeuristicTokenEstimator::new()),
        Some(100_000),
        true,
    );
    let files = restore_file_views(
        &mut next,
        &recorded.files,
        Some(ReadPolicy::Unlimited),
        &ctx,
        GgProgramLanguage::TypeScript,
        &emitter,
    )
    .await;
    let texts = restore_text_views(&mut next, &recorded.texts);
    assert_eq!((files, texts), (1, 1));

    // The file came back as the workspace stands *now*; the text view came back as it was composed.
    let bodies: String = next
        .items()
        .iter()
        .filter_map(|item| item.message().content.clone())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(bodies.contains("rewritten by someone else"), "{bodies}");
    assert!(!bodies.contains("the first draft"), "{bodies}");
    assert!(
        bodies.contains("View: plan\n----\n1. read\n2. fix"),
        "{bodies}"
    );
    assert_eq!(PersistedDesk::of(&next), recorded);
}
