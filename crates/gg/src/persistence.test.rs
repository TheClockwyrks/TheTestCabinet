//! Tests for agent persistence: the per-profile record of open file views, the exclusivity key that
//! serializes a persistent profile's instances, and the restore that re-reads a recorded desk.

use std::sync::Arc;

use tempfile::TempDir;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_PERSISTENCE, GgCapabilityConfig, GgCapabilitySet, GgContextSource,
    GgSubagentRef,
};

use super::*;
use crate::context::{FileRegion, HeuristicTokenEstimator, Retention};
use crate::telemetry::CollectingSink;

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

/// A capability set whose named agents are persistent, plus one that is not.
fn set_with(persistent: &[&str], plain: &[&str]) -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/x");
    for name in persistent {
        set.agents.push(GgAgentConfig {
            name: (*name).to_string(),
            capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_AGENT_PERSISTENCE)],
            ..GgAgentConfig::root()
        });
    }
    for name in plain {
        set.agents.push(GgAgentConfig {
            name: (*name).to_string(),
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

// ---------------------------------------------------------------------------
// The exclusivity key
// ---------------------------------------------------------------------------

/// Only a persistent profile takes a key, and the key is the profile's own name — so every instance
/// of it contends with every other instance and with nothing else.
#[test]
fn only_a_persistent_profile_takes_an_exclusivity_key() {
    let set = set_with(&["Owner"], &["Worker"]);
    assert_eq!(
        exclusive_key(set.agent("Owner").unwrap()),
        Some("Owner".to_string())
    );
    assert_eq!(exclusive_key(set.agent("Worker").unwrap()), None);
    // The root of this set has the default capabilities, which do not include persistence.
    assert_eq!(exclusive_key(set.root()), None);
}

/// The capability being *present but disabled* is off, like every other capability — so an ablation's
/// control arm keeps the configuration it would have used without serializing anything.
#[test]
fn a_disabled_persistence_capability_takes_no_key() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    set.agents.push(GgAgentConfig {
        name: "Owner".to_string(),
        capabilities: vec![GgCapabilityConfig::disabled(CAPABILITY_AGENT_PERSISTENCE)],
        subagents: vec![GgSubagentRef::any("Owner")],
        ..GgAgentConfig::root()
    });
    assert!(!is_persistent(set.agent("Owner").unwrap()));
    assert_eq!(exclusive_key(set.agent("Owner").unwrap()), None);
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/// A profile with nothing recorded restores nothing; a later instance reads what an earlier one
/// recorded; and each record is scoped to its own profile.
#[test]
fn the_record_is_per_profile_and_starts_empty() {
    let store = AgentPersistence::new();
    assert!(store.views("Owner").is_empty());

    store.record("Owner", vec![whole("src/main.rs")]);
    store.record("Reviewer", vec![whole("README.md")]);
    assert_eq!(store.views("Owner"), vec![whole("src/main.rs")]);
    assert_eq!(store.views("Reviewer"), vec![whole("README.md")]);
}

/// Recording **replaces** rather than merges: the record is the desk as the last instance left it, so
/// a file that instance closed must not come back — including when it closed all of them.
#[test]
fn recording_replaces_the_previous_desk() {
    let store = AgentPersistence::new();
    store.record("Owner", vec![whole("a.rs"), whole("b.rs")]);
    store.record("Owner", vec![whole("b.rs")]);
    assert_eq!(store.views("Owner"), vec![whole("b.rs")]);

    store.record("Owner", Vec::new());
    assert!(
        store.views("Owner").is_empty(),
        "an instance that finished with nothing open leaves nothing behind"
    );
}

/// A non-persistent agent's setup records nothing and restores nothing, so the loop needs no branch of
/// its own — and a persistent one round-trips its window's views through the shared record.
#[test]
fn the_setup_records_only_for_a_persistent_profile() {
    let set = set_with(&["Owner"], &["Worker"]);
    let store = AgentPersistence::new();

    let mut window = context();
    window.push_file_view(
        Some("src/main.rs".to_string()),
        None,
        "c1",
        "fn main",
        vec![],
    );

    let plain = PersistenceSetup::resolve(set.agent("Worker").unwrap(), Arc::clone(&store));
    assert!(!plain.enabled());
    plain.record(&window);
    assert!(store.views("Worker").is_empty());
    assert!(plain.restored().is_empty());

    let owner = PersistenceSetup::resolve(set.agent("Owner").unwrap(), Arc::clone(&store));
    assert!(owner.enabled());
    owner.record(&window);
    assert_eq!(owner.restored(), vec![whole("src/main.rs")]);

    // A *second* instance of the profile — a fresh setup over the same run-global record — sees it.
    let next = PersistenceSetup::resolve(set.agent("Owner").unwrap(), Arc::clone(&store));
    assert_eq!(next.restored(), vec![whole("src/main.rs")]);
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
        ReadPolicy::Unlimited,
        &ctx,
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
        ReadPolicy::DefaultCap(100),
        &ctx,
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
    let restored =
        restore_file_views(&mut window, &desk, ReadPolicy::Unlimited, &ctx, &emitter).await;
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
        ReadPolicy::Unlimited,
        &ctx,
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
        ReadPolicy::Unlimited,
        &ctx,
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
        restore_file_views(&mut window, &[], ReadPolicy::Unlimited, &ctx, &emitter).await,
        0
    );
    // Nothing was added to the thread; the system prompt is a slot, not an item.
    assert!(window.items().is_empty());
    assert!(window.system().is_some());
}
