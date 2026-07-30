//! [Agent persistence](crate::persistence) driven through the **live loop**.
//!
//! `persistence.test.rs` proves the record, the exclusivity key and the restore in isolation, and
//! `subagents.test.rs` proves that a held key really serializes a scheduler's grants. Neither can
//! prove the two halves this feature actually is from the loop's side: that a finishing instance's
//! open views are recorded **only when it finished its work**, and that the next instance opens its
//! very first turn on those views, re-read from the workspace as it stands then. Both live in
//! [`Agent::drive`], so they are only testable here.
//!
//! Every test drives the tool-calling path: it is the mode that puts file views in the window at all
//! (a program's reads are consumed inside the program), which is exactly what persistence carries.

use super::*;
use crate::context::OpenFileView;
use test_cabinet_core::gg::CAPABILITY_AGENT_PERSISTENCE;

/// The profile the tests below run as: a persistent agent with the filesystem tools.
fn persistent_profile() -> GgAgentConfig {
    GgAgentConfig {
        name: "Owner".to_string(),
        capabilities: vec![
            GgCapabilityConfig::enabled(CAPABILITY_READ_FILE),
            GgCapabilityConfig::enabled(CAPABILITY_AGENT_PERSISTENCE),
        ],
        ..GgAgentConfig::root()
    }
}

/// Drive one instance of `profile` against `script` in `dir`, sharing `store` with every other
/// instance — the run-global record two instances of one profile meet through.
async fn drive_instance(
    dir: &TempDir,
    profile: &GgAgentConfig,
    store: Arc<AgentPersistence>,
    script: Vec<ModelResponse>,
) -> (LoopEnd, Vec<GgTelemetryEvent>, Vec<Vec<Message>>) {
    let ctx = ToolContext::new(dir.path());
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-persist".to_string()), Box::new(sink.clone()));
    let registry = ToolRegistry::from_capabilities(profile);
    let client = RecordingClient::new("mock/echo", script);

    let end = Agent::root(&profile.name)
        .drive(
            client.as_ref(),
            "go",
            &registry,
            &ctx,
            &emitter,
            no_limits(6),
            test_context_setup(),
            no_compaction(),
            no_amc(),
            no_autoload(),
            PersistenceSetup::resolve(profile, store),
            &[],
            SkillsRuntime::disabled(),
            MemoriesRuntime::disabled(),
            TasksRuntime::disabled(),
            BoardRuntime::disabled(),
            PlanningRuntime::disabled(),
            FsmRuntime::disabled(),
            ReadPolicy::default(),
            OffloadPolicy::default(),
            false,
            no_code(),
            no_completion(),
            EndingRole::Standard,
            profile,
            None,
            None,
            None,
        )
        .await;
    let requests = client.requests();
    (end, sink.events(), requests)
}

/// A turn that reads `path`.
fn read_call(id: &str, path: &str) -> ModelResponse {
    ModelResponse {
        text: Some("looking at the file".to_string()),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: READ_FILE_TOOL.to_string(),
            arguments: json!({ "path": path }),
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// A persistent agent that reads a file and finishes hands that view to its next instance, which
/// opens its **first** turn on it — re-read from the workspace, so an edit made in between is what the
/// next instance sees.
#[tokio::test]
async fn a_finished_instance_hands_its_open_views_to_the_next_one() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("game.js"), "// the first draft\n").unwrap();
    let profile = persistent_profile();
    let store = AgentPersistence::new();

    // Instance one: read the file, then finish.
    let (first, _events, _requests) = drive_instance(
        &dir,
        &profile,
        Arc::clone(&store),
        vec![
            read_call("c1", "game.js"),
            finish_call("c2", "looked at the game"),
        ],
    )
    .await;
    assert_eq!(first.status, "completed");
    assert_eq!(
        store.views("Owner"),
        vec![OpenFileView {
            path: "game.js".to_string(),
            region: None,
        }],
        "the desk it left is recorded against the profile"
    );

    // Somebody else rewrites the file while the profile is idle.
    std::fs::write(dir.path().join("game.js"), "// rewritten by someone else\n").unwrap();

    // Instance two: finish immediately, so everything in its window was seeded before its first turn.
    let (second, events, requests) = drive_instance(
        &dir,
        &profile,
        Arc::clone(&store),
        vec![finish_call("c3", "done")],
    )
    .await;
    assert_eq!(second.status, "completed");

    // The very first request already carries the restored view, and it shows the file as it stands
    // now rather than as the previous instance saw it.
    let opening = requests.first().expect("one model call was made");
    let restored = opening
        .iter()
        .find(|message| message.tool_call_id.is_some())
        .expect("the opening prompt carries a restored file view");
    let body = restored.content.clone().unwrap_or_default();
    assert!(body.contains("rewritten by someone else"), "{body}");
    assert!(!body.contains("the first draft"), "{body}");
    assert!(
        opening.iter().any(|message| message
            .tool_calls
            .iter()
            .any(|call| call.name == READ_FILE_TOOL)),
        "the view is a well-formed call/result pair, not a narrated summary"
    );
    // And the run says so, so an operator reading the stream can see why the window opened full.
    assert!(
        events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::Log { level, message }
                if level == "info" && message.contains("re-opened 1 file view")
        )),
        "the restore is announced"
    );
}

/// An instance stopped by a ceiling records nothing: only an agent that *finished its work* has a desk
/// worth inheriting, so the previous instance's record stands rather than being replaced by whatever a
/// failed attempt happened to have open.
#[tokio::test]
async fn an_instance_stopped_by_a_ceiling_leaves_the_record_alone() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("kept.js"), "// kept\n").unwrap();
    std::fs::write(dir.path().join("other.js"), "// other\n").unwrap();
    let profile = persistent_profile();
    let store = AgentPersistence::new();

    // A first instance finishes with `kept.js` open.
    let (first, _events, _requests) = drive_instance(
        &dir,
        &profile,
        Arc::clone(&store),
        vec![read_call("c1", "kept.js"), finish_call("c2", "done")],
    )
    .await;
    assert_eq!(first.status, "completed");
    let recorded = store.views("Owner");
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].path, "kept.js");

    // A second instance opens `other.js` and never finishes — it runs out of turns.
    let (second, _events, _requests) = drive_instance(
        &dir,
        &profile,
        Arc::clone(&store),
        vec![read_call("c3", "other.js"); 8],
    )
    .await;
    assert_eq!(second.status, "exhausted");
    assert_eq!(
        store.views("Owner"),
        recorded,
        "a stopped instance does not overwrite the last finished one's desk"
    );
}

/// A non-persistent profile is untouched by any of this: nothing is seeded into its window and nothing
/// is recorded out of it, so the capability's off arm is the loop as it always was.
#[tokio::test]
async fn a_non_persistent_profile_carries_nothing() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("game.js"), "// a draft\n").unwrap();
    let profile = GgAgentConfig {
        name: "Worker".to_string(),
        capabilities: vec![GgCapabilityConfig::enabled(CAPABILITY_READ_FILE)],
        ..GgAgentConfig::root()
    };
    let store = AgentPersistence::new();

    let (first, _events, _requests) = drive_instance(
        &dir,
        &profile,
        Arc::clone(&store),
        vec![read_call("c1", "game.js"), finish_call("c2", "done")],
    )
    .await;
    assert_eq!(first.status, "completed");
    assert!(store.views("Worker").is_empty());

    let (second, events, requests) = drive_instance(
        &dir,
        &profile,
        Arc::clone(&store),
        vec![finish_call("c3", "done")],
    )
    .await;
    assert_eq!(second.status, "completed");
    assert!(
        requests
            .first()
            .expect("one model call")
            .iter()
            .all(|message| message.tool_call_id.is_none()),
        "the second agent opens with no file views at all"
    );
    assert!(
        !events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::Log { message, .. } if message.contains("agent persistence")
        )),
        "and is told nothing about a capability it does not have"
    );
}
