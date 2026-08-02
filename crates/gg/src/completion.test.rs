use super::*;

use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{CAPABILITY_COMPLETION, GgAgentConfig, GgCapabilityConfig};

use crate::telemetry::{CollectingSink, Emitter};
use crate::tools::ToolContext;

/// A completion capability config with the given enabled flag, implementation, and params.
fn completion_cap(
    enabled: bool,
    implementation: Option<&str>,
    params: serde_json::Value,
) -> GgCapabilityConfig {
    GgCapabilityConfig {
        id: CAPABILITY_COMPLETION.to_string(),
        enabled,
        implementation: implementation.map(str::to_string),
        params,
    }
}

/// A root profile carrying exactly the given completion capability (its default capabilities are
/// irrelevant to completion resolution, which reads only the completion capability).
fn profile_with(cap: GgCapabilityConfig) -> GgAgentConfig {
    let mut profile = GgAgentConfig::root();
    profile.capabilities.push(cap);
    profile
}

/// An emitter whose telemetry is discarded — [`run_validation`] emits progress logs we do not
/// assert on here.
fn emitter() -> Emitter {
    Emitter::with_sink(None, Box::new(CollectingSink::new())).for_agent("root", None)
}

/// An absent completion capability leaves the ending ungated.
#[test]
fn resolve_leaves_the_ending_ungated_when_absent() {
    let setup = CompletionSetup::resolve(&GgAgentConfig::root());
    assert!(!setup.has_validation());
}

/// A present-but-disabled completion capability is the unchanged control: it records its config but
/// applies none of the validation it would have run.
#[test]
fn disabled_capability_gates_nothing() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        false,
        None,
        json!({ "validation": ["cargo test"] }),
    )));
    assert!(!setup.has_validation());
}

/// Each [role](EndingRole) is offered exactly its own ending calls, and each definition demands what
/// that role's verdict is made of — a change list that cannot be empty, a bounded attempt number.
#[test]
fn role_tool_definitions_carry_each_role_s_shape() {
    let standard = role_tool_definitions(EndingRole::Standard);
    assert_eq!(
        standard.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        [FINISH_TOOL]
    );

    let review = role_tool_definitions(EndingRole::Review);
    assert_eq!(
        review.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        [APPROVE_TOOL, REQUEST_CHANGES_TOOL]
    );
    let items = &review[1].parameters["properties"]["items"];
    assert_eq!(
        items["minItems"], 1,
        "a rejection must name at least one change"
    );

    let judge = role_tool_definitions(EndingRole::Judge { attempts: 4 });
    assert_eq!(
        judge.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        [SELECT_WINNER_TOOL]
    );
    let attempt = &judge[0].parameters["properties"]["attempt"];
    assert_eq!(attempt["minimum"], 1);
    assert_eq!(
        attempt["maximum"], 4,
        "the judge may only pick among the attempts it was shown"
    );
}

/// The feedback for a text-only reply names the calls the reader actually has — never one its role
/// was not given.
#[test]
fn missing_completion_feedback_names_only_this_role_s_calls() {
    let standard = missing_completion_feedback(EndingRole::Standard);
    assert!(standard.contains(FINISH_TOOL), "{standard}");

    let review = missing_completion_feedback(EndingRole::Review);
    assert!(review.contains(APPROVE_TOOL), "{review}");
    assert!(review.contains(REQUEST_CHANGES_TOOL), "{review}");
    assert!(
        !review.contains(FINISH_TOOL),
        "a reviewer is never pointed at a `finish` it does not have: {review}"
    );
}

/// The validation param parses the object form, including a per-command `cwd`.
#[test]
fn resolve_parses_validation_object_form() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        None,
        json!({
            "validation": [
                { "command": "cargo build", "cwd": "sub", "timeoutSecs": 30 },
                { "command": "cargo test" }
            ]
        }),
    )));
    assert!(setup.has_validation());
    let displays: Vec<String> = setup
        .validation()
        .iter()
        .map(ValidationCommand::display)
        .collect();
    assert_eq!(displays, vec!["cargo build (in sub)", "cargo test"]);
}

/// A bare string is shorthand for a command in gg's working directory.
#[test]
fn resolve_parses_validation_string_shorthand() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        None,
        json!({ "validation": ["make check"] }),
    )));
    assert_eq!(
        setup
            .validation()
            .iter()
            .map(ValidationCommand::display)
            .collect::<Vec<_>>(),
        vec!["make check".to_string()],
    );
}

/// Malformed validation entries (no usable command) are dropped rather than failing the whole run.
#[test]
fn resolve_drops_malformed_validation_entries() {
    let setup = CompletionSetup::resolve(&profile_with(completion_cap(
        true,
        None,
        json!({
            "validation": [
                "",
                { "cwd": "sub" },
                42,
                { "command": "  " },
                { "command": "cargo test" }
            ]
        }),
    )));
    assert_eq!(
        setup
            .validation()
            .iter()
            .map(ValidationCommand::display)
            .collect::<Vec<_>>(),
        vec!["cargo test".to_string()],
    );
}

/// The finish tool is named `finish` and requires a `summary`.
#[test]
fn finish_tool_definition_names_finish_and_requires_summary() {
    let definition = &role_tool_definitions(EndingRole::Standard)[0];
    assert_eq!(definition.name, FINISH_TOOL);
    assert_eq!(
        definition.parameters["required"],
        json!(["summary"]),
        "the finish tool requires a summary",
    );
}

/// Validation passes when every command exits 0, so completion is allowed (`None`).
#[tokio::test]
async fn run_validation_passes_when_all_commands_succeed() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let commands = vec![
        ValidationCommand::from_value(&json!("true")).unwrap(),
        ValidationCommand::from_value(&json!({ "command": "exit 0" })).unwrap(),
    ];
    assert!(
        run_validation(&commands, &ctx, &OffloadPolicy::Inline, &emitter(), None)
            .await
            .is_none()
    );
}

/// The first failing command rejects completion, and its feedback names the command and carries its
/// output.
#[tokio::test]
async fn run_validation_reports_first_failure() {
    let dir = TempDir::new().unwrap();
    let ctx = ToolContext::new(dir.path());
    let commands = vec![
        ValidationCommand::from_value(&json!("echo building")).unwrap(),
        ValidationCommand::from_value(&json!("echo boom && exit 1")).unwrap(),
        // Never reached — the batch is fail-fast.
        ValidationCommand::from_value(&json!("echo unreached")).unwrap(),
    ];
    let feedback = run_validation(&commands, &ctx, &OffloadPolicy::Inline, &emitter(), None)
        .await
        .expect("a failing command rejects the completion");
    assert!(
        feedback.contains("Completion attempt rejected"),
        "{feedback}"
    );
    assert!(
        feedback.contains("echo boom"),
        "names the failing command: {feedback}"
    );
    assert!(
        feedback.contains("boom"),
        "carries the command output: {feedback}"
    );
    assert!(
        !feedback.contains("unreached"),
        "stops at the first failure: {feedback}"
    );
}

/// A command with no `cwd` runs in gg's working directory (the passed context's workspace).
#[tokio::test]
async fn run_validation_defaults_cwd_to_workspace() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("marker.txt"), "x").unwrap();
    let ctx = ToolContext::new(dir.path());
    let commands = vec![ValidationCommand::from_value(&json!("test -f marker.txt")).unwrap()];
    assert!(
        run_validation(&commands, &ctx, &OffloadPolicy::Inline, &emitter(), None)
            .await
            .is_none()
    );
}

/// A relative `cwd` is resolved against gg's working directory, so the command runs in the subdir.
#[tokio::test]
async fn run_validation_runs_in_declared_cwd() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    std::fs::write(sub.join("inner.txt"), "x").unwrap();
    let ctx = ToolContext::new(dir.path());

    // In the workspace root the marker is absent (fails); in `sub` it is present (passes).
    let at_root = vec![ValidationCommand::from_value(&json!("test -f inner.txt")).unwrap()];
    assert!(
        run_validation(&at_root, &ctx, &OffloadPolicy::Inline, &emitter(), None)
            .await
            .is_some()
    );

    let in_sub = vec![
        ValidationCommand::from_value(&json!({ "command": "test -f inner.txt", "cwd": "sub" }))
            .unwrap(),
    ];
    assert!(
        run_validation(&in_sub, &ctx, &OffloadPolicy::Inline, &emitter(), None)
            .await
            .is_none()
    );
}

/// A validation command is a **recorded input**: it runs `sh -c` and decides whether the session
/// may end, but it never reaches tool dispatch, so before this seam existed it was captured
/// nowhere at all.
///
/// The three things a reconstruction needs are asserted here: the
/// [origin](GgShellOrigin::CompletionValidation), which keeps it off the agent's ordinary tool
/// queue; the working directory as a *relationship* to the workspace, so a command declaring a
/// `cwd` stays distinguishable from one that did not; and the process's own exit code and streams
/// rather than the model-facing text gg wrapped around them.
#[tokio::test]
async fn a_validation_command_is_recorded_with_its_origin_cwd_and_streams() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("web");
    std::fs::create_dir(&sub).unwrap();
    let ctx = ToolContext::new(dir.path());
    let journal = TempDir::new().unwrap();
    let recorder = crate::replay::GgRecorder::start(
        &journal.path().join("replay.ndjson"),
        "run_1",
        &serde_json::from_value(json!({})).unwrap(),
        test_cabinet_core::gg_replay::GgReplayFidelity::Standard,
        None,
    )
    .expect("the journal opens");

    let commands = vec![
        ValidationCommand::from_value(
            &json!({ "command": "echo built >&2; exit 0", "cwd": "web" }),
        )
        .unwrap(),
        ValidationCommand::from_value(&json!("echo boom && exit 3")).unwrap(),
    ];
    let feedback = run_validation(
        &commands,
        &ctx,
        &OffloadPolicy::Inline,
        &emitter(),
        Some((&recorder, "root")),
    )
    .await;
    assert!(feedback.is_some(), "the second command fails the gate");
    recorder.finish();

    let text = std::fs::read_to_string(journal.path().join("replay.ndjson")).unwrap();
    let lines: Vec<serde_json::Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let texts: Vec<&str> = lines
        .iter()
        .filter(|line| line["type"] == "text")
        .map(|line| line["text"].as_str().unwrap())
        .collect();
    let shells: Vec<&serde_json::Value> = lines
        .iter()
        .filter(|line| line["type"] == "entry" && line["entry"]["type"] == "shell")
        .map(|line| &line["entry"])
        .collect();

    assert_eq!(shells.len(), 2, "both commands that ran are recorded");
    assert_eq!(shells[0]["origin"], "completion_validation");
    assert_eq!(shells[0]["agentId"], "root");
    assert_eq!(shells[0]["command"]["cwd"]["type"], "relative");
    assert_eq!(shells[0]["command"]["cwd"]["path"], "web");
    assert_eq!(shells[0]["command"]["exitCode"], 0);
    assert_eq!(
        texts[shells[0]["command"]["stderr"].as_u64().unwrap() as usize],
        "built\n",
        "the process's own stderr, not the merged body the model was shown"
    );
    assert_eq!(shells[1]["command"]["cwd"]["type"], "workspace");
    assert_eq!(shells[1]["command"]["exitCode"], 3);
    assert_eq!(
        texts[shells[1]["command"]["stdout"].as_u64().unwrap() as usize],
        "boom\n"
    );
}

/// The completion gate's commands run through the **calling agent's** shell seam, including one
/// that declared its own `cwd`.
///
/// This is the path the seam is easiest to lose: gg runs these commands on the agent's behalf, they
/// never reach tool dispatch, and a command with a `cwd` needs a re-rooted context. Building that
/// context fresh would silently hand the one input that decides whether a session may end back to
/// the real shell — during a reconstruction, that means running a real `npm test` against a scratch
/// tree — and would leave its commands on an unattributed queue.
#[tokio::test]
async fn validation_commands_run_through_the_calling_agent_s_shell() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir(dir.path().join("web")).unwrap();
    let stub = std::sync::Arc::new(crate::tools::StubShellRunner::exiting(0, ""));
    let ctx = ToolContext::new(dir.path())
        .with_agent("agent-4")
        .with_shell(stub.clone());

    let commands = vec![
        ValidationCommand::from_value(&json!("npm test")).unwrap(),
        ValidationCommand::from_value(&json!({ "command": "npm run build", "cwd": "web" }))
            .unwrap(),
    ];
    assert!(
        run_validation(&commands, &ctx, &OffloadPolicy::Inline, &emitter(), None)
            .await
            .is_none(),
        "the stub answers both commands successfully"
    );

    let requests = stub.requests();
    assert_eq!(requests.len(), 2, "both commands went through the seam");
    assert_eq!(requests[0].command, "npm test");
    assert_eq!(requests[0].cwd, dir.path());
    assert_eq!(requests[1].command, "npm run build");
    assert_eq!(
        requests[1].cwd,
        dir.path().join("web"),
        "a declared `cwd` re-roots the context rather than replacing it"
    );
    // Attributed to the agent whose ending they gate, both of them — the re-rooted one included.
    assert!(
        requests.iter().all(|request| request.agent_id == "agent-4"),
        "every validation command names the agent it gates"
    );
}
