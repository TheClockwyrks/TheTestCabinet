//! Tests for the gg execution branch's pure, container-free logic: telemetry
//! ingestion (against a recorded mock-session fixture), install-path resolution, the
//! release download-command builder, invocation construction, and the event bridge.
//!
//! None of these touch the network or a real container — the ingest tests drive the
//! [`GgIngestSink`] directly with recorded NDJSON, and the install tests inject the
//! environment and filesystem.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::*;
use crate::event::EventKind;
use crate::execution::OutputStream;
use crate::gg::{GgCallFailure, GgCapabilitySet, GgUndocumentedCalls, ROOT_PROFILE_ID};
use crate::run_record::HarnessSlug;

/// A real mock-session telemetry stream captured from the `gg` binary (mock provider,
/// no credentials), used to verify the ingest bridge end to end.
const MOCK_SESSION: &str = include_str!("testdata/gg_mock_session.ndjson");

/// An [`EventSink`] that records every emitted event.
#[derive(Default)]
struct CollectingSink {
    events: Vec<HarnessEvent>,
}

impl EventSink for CollectingSink {
    fn emit(&mut self, event: &HarnessEvent) {
        self.events.push(event.clone());
    }
}

/// Drive `stream`'s lines through a fresh [`GgIngestSink`] as stdout, returning the
/// sink's final accumulators and the events the run's live sink observed.
fn ingest(stream: &str) -> (Vec<HarnessEvent>, IngestResult) {
    ingest_both(stream, "")
}

/// [`ingest`], with a stderr stream driven through the same sink after stdout — the order
/// gg's pre-telemetry fatals arrive in, since a session that wrote one never got as far as
/// telemetry.
fn ingest_both(stdout: &str, stderr: &str) -> (Vec<HarnessEvent>, IngestResult) {
    let mut collecting = CollectingSink::default();
    let mut sink = GgIngestSink::new(&mut collecting);
    for line in stdout.lines() {
        sink.on_line(OutputStream::Stdout, line);
    }
    for line in stderr.lines() {
        sink.on_line(OutputStream::Stderr, line);
    }
    let GgIngestSink {
        tokens,
        reported_cost,
        raw_output,
        translated_events,
        terminal_status,
        gg_summary,
        error_logs,
        stderr_lines,
        limit_breach,
        ..
    } = sink;
    (
        collecting.events,
        IngestResult {
            tokens,
            reported_cost,
            raw_output,
            translated_events,
            terminal_status,
            gg_summary,
            error_logs,
            stderr_lines,
            limit_breach,
        },
    )
}

/// The accumulators [`ingest`] extracts from the sink.
struct IngestResult {
    tokens: TokenCounts,
    reported_cost: Option<f64>,
    raw_output: Vec<RawOutputLine>,
    translated_events: Vec<HarnessEvent>,
    terminal_status: Option<String>,
    gg_summary: Option<crate::gg::GgSessionSummary>,
    error_logs: Vec<String>,
    stderr_lines: Vec<String>,
    limit_breach: Option<String>,
}

impl IngestResult {
    /// Classify a non-zero `exit_code` exactly as the branch does after draining this stream:
    /// the terminal status and the reasons come off the sink, the code off the process.
    fn classify(&self, exit_code: i32) -> Error {
        classify_exit(
            exit_code,
            self.terminal_status.as_deref(),
            &ExitReasons {
                error_logs: &self.error_logs,
                stderr_lines: &self.stderr_lines,
                limit_breach: self.limit_breach.as_deref(),
            },
        )
    }
}

/// The detail an [`Error::HarnessInvocation`] carries, or a panic for any other error.
fn invocation_detail(error: Error) -> String {
    match error {
        Error::HarnessInvocation { detail, .. } => detail,
        other => panic!("{other:?}"),
    }
}

/// One gg `log` telemetry line at `level`, as gg's stream carries it before any agent context
/// exists — the launch pass's own lines, which no agent stamps.
fn log_line(level: &str, message: &str) -> String {
    serde_json::json!({
        "type": "log",
        "timestamp": "2026-01-01T00:00:00Z",
        "level": level,
        "message": message,
    })
    .to_string()
}

/// One gg `log` telemetry line at `level` on `agent`'s emitter, as every line an agent's loop
/// emits is stamped.
fn agent_log_line(agent: &str, level: &str, message: &str) -> String {
    serde_json::json!({
        "type": "log",
        "timestamp": "2026-01-01T00:00:00Z",
        "agentId": agent,
        "level": level,
        "message": message,
    })
    .to_string()
}

/// One gg `limit_exceeded` telemetry line for the consecutive-errors ceiling, observed by
/// `agent`, stamped with the same id on its envelope exactly as gg's emitter stamps it.
fn breach_line(agent: &str) -> String {
    serde_json::json!({
        "type": "limit_exceeded",
        "timestamp": "2026-01-01T00:00:00Z",
        "agentId": agent,
        "breach": {
            "limit": "consecutive_errors",
            "threshold": 5.0,
            "observed": 5.0,
            "turns": 12,
            "agentId": agent,
        },
    })
    .to_string()
}

/// The sentence gg logs for the consecutive-errors ceiling the tests breach.
const BREACH_SENTENCE: &str = "5 consecutive turns failed";

/// One gg `session_ended` telemetry line with `status`.
fn session_ended_line(status: &str) -> String {
    serde_json::json!({
        "type": "session_ended",
        "timestamp": "2026-01-01T00:00:00Z",
        "status": status,
    })
    .to_string()
}

fn count_kind(events: &[HarnessEvent], predicate: impl Fn(&EventKind) -> bool) -> usize {
    events.iter().filter(|e| predicate(&e.kind)).count()
}

#[test]
fn ingest_sums_usage_deltas_across_the_session() {
    let (_emitted, result) = ingest(MOCK_SESSION);

    // The fixture carries two usage deltas: (1200 uncached, 180 output) and
    // (1400 uncached, 60 output). They sum to 2600 + 240 = 2840 total tokens.
    assert_eq!(result.tokens.uncached_input, Some(2600));
    assert_eq!(result.tokens.output, Some(240));
    // A class no delta reported stays `None`, never a misleading zero.
    assert_eq!(result.tokens.cached_input, None);
    assert_eq!(result.tokens.reasoning, None);
    assert_eq!(result.tokens.total(), Some(2840));

    // Cost deltas 0.0042 + 0.0021 = 0.0063.
    let cost = result.reported_cost.expect("a cost was reported");
    assert!((cost - 0.0063).abs() < 1e-9, "summed cost was {cost}");

    assert_eq!(result.terminal_status.as_deref(), Some("completed"));
}

#[test]
fn ingest_lifts_the_session_summary_for_the_run_record() {
    let (_emitted, result) = ingest(MOCK_SESSION);

    // The terminal `session_summary` event is captured so it can be recorded on the run,
    // recoverable without re-parsing the whole stream.
    let summary = result
        .gg_summary
        .expect("the session summary was lifted from the stream");
    assert_eq!(summary.terminal_status, "completed");
    assert_eq!(summary.agents_spawned, 1);
    assert_eq!(summary.subagent_count, 0);
    assert!(!summary.ran_out_of_context);
    assert_eq!(summary.slot_costs.len(), 1);
    assert_eq!(summary.slot_costs[0].profile_id, ROOT_PROFILE_ID);
    assert_eq!(summary.slot_costs[0].model_id, "mock/echo");
    assert_eq!(summary.slot_costs[0].tokens.output, Some(240));
}

#[test]
fn ingest_bridges_every_event_natively_and_maps_salient_ones() {
    let (emitted, result) = ingest(MOCK_SESSION);

    // The live sink sees exactly what the run records — nothing is dropped between
    // the two.
    assert_eq!(emitted.len(), result.translated_events.len());
    let events = &result.translated_events;

    // The fixture is 14 telemetry lines, so there are 14 native gg carries — one per
    // event, lossless.
    let native = count_kind(events, |k| matches!(k, EventKind::Gg { .. }));
    assert_eq!(native, 14, "one native gg carry per telemetry line");
    // Every raw line is recorded for the run's raw stream.
    assert_eq!(result.raw_output.len(), 14);

    // Two assistant messages map to agent events; the write_file tool call maps to a
    // write event. Info logs, usage, lifecycle, and the successful tool result carry
    // *only* natively (no mapped duplicate).
    assert_eq!(
        count_kind(events, |k| matches!(k, EventKind::Agent { .. })),
        2,
    );
    let writes: Vec<&String> = events
        .iter()
        .filter_map(|e| match &e.kind {
            EventKind::Write { path, .. } => Some(path),
            _ => None,
        })
        .collect();
    assert_eq!(writes, vec!["index.html"]);

    // 14 native + 2 agent + 1 write = 17 total (the session_summary carries only natively).
    assert_eq!(events.len(), 17);

    // The native carry preserves the gg event's own timestamp verbatim.
    let first_native = events
        .iter()
        .find_map(|e| match &e.kind {
            EventKind::Gg { event } => Some(event),
            _ => None,
        })
        .unwrap();
    assert!(matches!(
        first_native.kind,
        crate::gg::GgTelemetryKind::SessionStarted { .. }
    ));
}

#[test]
fn bridge_maps_a_shell_tool_call_to_a_command() {
    let gg = GgTelemetryEvent::new(
        "2026-07-24T00:00:00Z",
        GgTelemetryKind::ToolCall {
            name: "shell".to_string(),
            args: serde_json::json!({ "command": "npm test" }),
        },
    );
    let events = bridge(&gg);
    // Mapped command first, then the native carry.
    assert_eq!(events.len(), 2);
    match &events[0].kind {
        EventKind::Command { command, .. } => assert_eq!(command, "npm test"),
        other => panic!("expected a command, got {other:?}"),
    }
    assert!(matches!(events[1].kind, EventKind::Gg { .. }));
}

#[test]
fn bridge_maps_logs_by_level_and_skips_info() {
    let error = GgTelemetryEvent::new(
        "t",
        GgTelemetryKind::Log {
            level: "error".to_string(),
            message: "model turn failed".to_string(),
        },
    );
    assert!(matches!(bridge(&error)[0].kind, EventKind::Error { .. }));

    let warn = GgTelemetryEvent::new(
        "t",
        GgTelemetryKind::Log {
            level: "warn".to_string(),
            message: "budget nearly spent".to_string(),
        },
    );
    assert!(matches!(bridge(&warn)[0].kind, EventKind::Warning { .. }));

    // An info log has no mapped kind, so the only event is the native carry.
    let info = GgTelemetryEvent::new(
        "t",
        GgTelemetryKind::Log {
            level: "info".to_string(),
            message: "offering tools".to_string(),
        },
    );
    let events = bridge(&info);
    assert_eq!(events.len(), 1);
    assert!(matches!(events[0].kind, EventKind::Gg { .. }));
}

#[test]
fn bridge_maps_a_failed_tool_result_to_a_warning() {
    let gg = GgTelemetryEvent::new(
        "t",
        GgTelemetryKind::ToolResult {
            name: "write_file".to_string(),
            ok: false,
            summary: Some("permission denied".to_string()),
            failure: Some(GgCallFailure::IoError),
        },
    );
    let events = bridge(&gg);
    match &events[0].kind {
        EventKind::Warning { message, .. } => {
            assert!(message.contains("write_file") && message.contains("permission denied"));
        }
        other => panic!("expected a warning, got {other:?}"),
    }
    // A *successful* tool result maps to nothing but the native carry.
    let ok = GgTelemetryEvent::new(
        "t",
        GgTelemetryKind::ToolResult {
            name: "write_file".to_string(),
            ok: true,
            summary: None,
            failure: None,
        },
    );
    assert_eq!(bridge(&ok).len(), 1);
}

/// Under responses-as-code every assistant message is a page of TypeScript, so the model's actual
/// conclusion lives only on the turn that called `finish`. Without this mapping a reviewer opening
/// the run's feed would see N programs and no answer.
#[test]
fn a_finished_code_execution_reaches_the_human_facing_feed() {
    let finished = GgTelemetryEvent::new(
        "t",
        GgTelemetryKind::CodeExecution {
            undocumented_calls: GgUndocumentedCalls::default(),
            ok: true,
            tool_calls: 2,
            api_calls: 2,
            duration_ms: Some(12_000),
            error: None,
            finished: Some("Built the game and wrote MANIFEST.md.".to_string()),
            logs: Vec::new(),
            logs_suppressed: 0,
            compile_wait_ms: None,
            compile_ms: None,
        },
    );
    let events = bridge(&finished);
    assert_eq!(events.len(), 2);
    match &events[0].kind {
        EventKind::Agent { message } => {
            assert_eq!(message, "Built the game and wrote MANIFEST.md.");
        }
        other => panic!("expected the summary as an agent message, got {other:?}"),
    }
    assert!(matches!(events[1].kind, EventKind::Gg { .. }));
}

/// Only the finishing turn carries a summary, so every other code turn maps to nothing but its
/// native carry — the feed shows one conclusion per run, not one per program.
#[test]
fn a_code_execution_without_a_completion_maps_to_nothing() {
    for finished in [None, Some("   ".to_string())] {
        let event = GgTelemetryEvent::new(
            "t",
            GgTelemetryKind::CodeExecution {
                undocumented_calls: GgUndocumentedCalls::default(),
                ok: true,
                tool_calls: 1,
                api_calls: 1,
                duration_ms: Some(900),
                error: None,
                finished,
                logs: Vec::new(),
                logs_suppressed: 0,
                compile_wait_ms: None,
                compile_ms: None,
            },
        );
        let events = bridge(&event);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0].kind, EventKind::Gg { .. }));
    }
}

#[test]
fn tool_call_kind_classifies_the_phase0_tools() {
    let write = tool_call_kind("write_file", &serde_json::json!({ "path": "a.txt" }));
    assert!(matches!(write, EventKind::Write { path, .. } if path == "a.txt"));

    let read = tool_call_kind("read_file", &serde_json::json!({ "path": "b.txt" }));
    assert!(matches!(read, EventKind::Read { path, .. } if path == "b.txt"));

    let list = tool_call_kind("list_dir", &serde_json::json!({ "path": "src" }));
    assert!(matches!(list, EventKind::List { path, .. } if path.as_deref() == Some("src")));

    // An unknown tool degrades to a generic command so it still shows as activity.
    let other = tool_call_kind("browse", &serde_json::json!({}));
    assert!(matches!(other, EventKind::Command { command, .. } if command == "browse"));
}

#[test]
fn unparseable_stdout_line_surfaces_as_a_warning() {
    let (_emitted, result) = ingest("not json at all");
    assert_eq!(result.translated_events.len(), 1);
    assert!(matches!(
        result.translated_events[0].kind,
        EventKind::Warning { .. }
    ));
    // The raw line is still recorded.
    assert_eq!(result.raw_output.len(), 1);
}

// ---- install-path resolution --------------------------------------------------

/// Build an env lookup over a fixed map for [`resolve_install_with`].
fn env_map(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |key: &str| map.get(key).cloned()
}

#[test]
fn explicit_binary_override_resolves_local_when_it_exists() {
    let env = env_map(&[("TCAB_GG_BINARY", "/custom/gg")]);
    let exists = |p: &Path| p == Path::new("/custom/gg");
    let install = resolve_install_with(env, exists, "0.7.0", "x86_64").unwrap();
    assert_eq!(
        install,
        GgInstall::Local {
            host_path: PathBuf::from("/custom/gg"),
            container_path: "/tmp/gg".to_string(),
        }
    );
}

#[test]
fn explicit_binary_override_errors_when_missing() {
    let env = env_map(&[("TCAB_GG_BINARY", "/missing/gg")]);
    let exists = |_: &Path| false;
    let err = resolve_install_with(env, exists, "0.7.0", "x86_64").unwrap_err();
    assert!(matches!(err, Error::HarnessUnavailable { .. }));
}

#[test]
fn auto_detects_a_default_local_build() {
    let env = env_map(&[]);
    let exists = |p: &Path| p == Path::new("/cargo-target/the-test-cabinet/debug/gg");
    let install = resolve_install_with(env, exists, "0.7.0", "x86_64").unwrap();
    assert!(matches!(install, GgInstall::Local { .. }));
    assert_eq!(install.container_path(), "/tmp/gg");
}

#[test]
fn auto_falls_back_to_a_release_download() {
    let env = env_map(&[]);
    let exists = |_: &Path| false;
    let install = resolve_install_with(env, exists, "0.7.0", "aarch64").unwrap();
    assert_eq!(
        install,
        GgInstall::Release {
            repo: "TheClockwyrks/test-cabinet".to_string(),
            version: "0.7.0".to_string(),
            // The default release asset is the fully static musl build (see
            // `resolve_install_with`), so one asset runs across every run-container image.
            target: "aarch64-unknown-linux-musl".to_string(),
            container_path: "/tmp/gg".to_string(),
        }
    );
}

#[test]
fn release_mode_forces_a_release_even_with_a_local_build_present() {
    let env = env_map(&[
        ("TCAB_GG_INSTALL", "release"),
        ("TCAB_GG_RELEASE_VERSION", "0.9.1"),
        ("TCAB_GG_RELEASE_REPO", "acme/gg"),
        ("TCAB_GG_RELEASE_TARGET", "x86_64-unknown-linux-musl"),
    ]);
    // Even though a local build "exists", the mode override wins.
    let exists = |_: &Path| true;
    let install = resolve_install_with(env, exists, "0.7.0", "x86_64").unwrap();
    assert_eq!(
        install,
        GgInstall::Release {
            repo: "acme/gg".to_string(),
            version: "0.9.1".to_string(),
            target: "x86_64-unknown-linux-musl".to_string(),
            container_path: "/tmp/gg".to_string(),
        }
    );
}

#[test]
fn local_mode_errors_when_no_binary_is_found() {
    let env = env_map(&[("TCAB_GG_INSTALL", "local")]);
    let exists = |_: &Path| false;
    let err = resolve_install_with(env, exists, "0.7.0", "x86_64").unwrap_err();
    assert!(matches!(err, Error::HarnessUnavailable { .. }));
}

/// An install mode gg does not recognize is **refused**, exactly as a `TCAB_GG_BINARY` pointing at
/// a missing file is.
///
/// Auto-detection is what an *unset* variable gets. An operator who wrote `TCAB_GG_INSTALL=relase`
/// asked for a specific install and would otherwise silently get whichever one this machine happens
/// to have — which on a developer box is a local build and in the cluster is a download, so the
/// same typo means two different things and neither is visible afterwards.
#[test]
fn an_unrecognized_install_mode_is_refused() {
    // A local build is present, so auto-detection would happily have succeeded.
    let exists = |_: &Path| true;
    for mode in ["relase", "locall", "true", "auto"] {
        let pairs = [("TCAB_GG_INSTALL", mode)];
        let env = env_map(&pairs);
        let err = resolve_install_with(env, exists, "0.7.0", "x86_64")
            .expect_err("an unrecognized install mode must not fall through to auto-detection");
        let Error::HarnessUnavailable { detail, .. } = &err else {
            panic!("{mode:?}: expected a harness-unavailable error, got {err:?}");
        };
        assert!(
            detail.contains("TCAB_GG_INSTALL") && detail.contains("local, release"),
            "{mode:?}: the diagnostic must name the variable and the modes it accepts: {detail}"
        );
    }

    // Case and surrounding whitespace are still normalized away, so the two real modes keep
    // working when they are written untidily.
    let env = env_map(&[("TCAB_GG_INSTALL", " RELEASE ")]);
    assert!(matches!(
        resolve_install_with(env, |_: &Path| true, "0.7.0", "x86_64").unwrap(),
        GgInstall::Release { .. }
    ));
}

#[test]
fn release_download_command_builds_the_expected_url_and_script() {
    let script = release_download_command(
        "TheClockwyrks/test-cabinet",
        "0.7.0",
        "x86_64-unknown-linux-gnu",
        "/tmp/gg",
    );
    assert!(script.contains(
        "https://github.com/TheClockwyrks/test-cabinet/releases/download/v0.7.0/gg-x86_64-unknown-linux-gnu"
    ));
    assert!(script.contains("--output /tmp/gg"));
    assert!(script.contains("chmod 0755 /tmp/gg"));
}

/// The asset URL is the contract with `.github/workflows/release.yml`: the release is
/// cut at the tag `v{version}` and gg is uploaded to it as a bare `gg-{target}`
/// executable. Pinning the whole string here means a change to either half of that
/// convention has to be made deliberately, in a place that names the workflow.
#[test]
fn the_release_asset_url_names_the_version_tag_not_a_gg_prefixed_one() {
    assert_eq!(
        release_asset_url(
            "TheClockwyrks/test-cabinet",
            "0.7.0",
            "aarch64-unknown-linux-musl"
        ),
        "https://github.com/TheClockwyrks/test-cabinet/releases/download/v0.7.0/gg-aarch64-unknown-linux-musl"
    );
}

/// A release install with nothing overridden must resolve to a version that could
/// actually have been published — i.e. this crate's real version, not the `0.0.0`
/// every workspace member carried before gg had a release pipeline.
#[test]
fn the_default_release_version_is_a_real_published_version() {
    assert_ne!(DEFAULT_RELEASE_VERSION, "0.0.0");

    let install = resolve_install_with(
        env_map(&[("TCAB_GG_INSTALL", "release")]),
        |_: &Path| true,
        DEFAULT_RELEASE_VERSION,
        "x86_64",
    )
    .unwrap();
    let GgInstall::Release { version, .. } = install else {
        panic!("release mode must resolve to a release install");
    };
    assert_eq!(version, DEFAULT_RELEASE_VERSION);
}

// ---- invocation construction --------------------------------------------------

fn gg_request(model: &str) -> RunRequest {
    RunRequest {
        test_case_slug: "carom".to_string(),
        test_case_version: Some("v1.0.0".to_string()),
        variant: "base".to_string(),
        harness: HarnessSlug::Gg,
        model_id: model.to_string(),
        orchestrator: crate::OrchestratorSelection::default(),
        engine: crate::EngineSelection::default(),
        max_runtime_override: None,
        container_image: None,
        gg_capability_set: Some(GgCapabilitySet::minimal(model)),
        // What a launch pushes in: a context window per bound model.
        gg_model_windows: std::collections::BTreeMap::from([(model.to_string(), 200_000)]),
        gg_model_providers: std::collections::BTreeMap::from([(
            model.to_string(),
            vec![crate::gg::GgProviderCandidate::new(
                model.split(['/', ':']).next().unwrap_or(model),
                "fp8",
            )],
        )]),
        // And the input modalities the catalog observed for it.
        gg_model_modalities: std::collections::BTreeMap::from([(
            model.to_string(),
            vec!["text".to_string(), "image".to_string()],
        )]),
        gg_model_prices: std::collections::BTreeMap::new(),
        model_prices: None,
    }
}

#[test]
fn build_invocation_carries_the_run_id_workspace_prompt_and_set() {
    let request = gg_request("mock/echo");
    let invocation =
        build_invocation(&request, "the build prompt", "/work", &[], "run-123").unwrap();
    assert_eq!(invocation.session_id, "run-123");
    assert_eq!(invocation.workspace_dir, PathBuf::from("/work"));
    assert_eq!(invocation.prompt, "the build prompt");
    assert_eq!(
        invocation.capability_set.root().resolved_model_id(),
        Some("mock/echo")
    );
}

/// The per-model context windows the launch resolved from the model catalog travel into
/// the invocation verbatim — this is how gg learns a window without holding a model table
/// (or reaching back out of the run container) of its own.
#[test]
fn build_invocation_carries_the_resolved_model_windows() {
    let mut request = gg_request("anthropic/claude-opus-4.8");
    request.gg_model_windows =
        std::collections::BTreeMap::from([("anthropic/claude-opus-4.8".to_string(), 200_000)]);
    let invocation =
        build_invocation(&request, "the build prompt", "/work", &[], "run-123").unwrap();
    assert_eq!(
        invocation.model_windows.get("anthropic/claude-opus-4.8"),
        Some(&200_000)
    );

    // A request carrying no window for a model it binds never reaches here: the run is
    // refused before any container work, because gg assumes no default.
    let mut request = gg_request("mock/echo");
    request.gg_model_windows.clear();
    let err = build_invocation(&request, "prompt", "/work", &[], "run-123")
        .expect_err("a bound model with no window is a configuration error");
    assert!(
        err.to_string().contains("mock/echo"),
        "unexpected error: {err}"
    );
}

/// The per-model input modalities travel into the invocation on the same terms — how gg
/// learns which of its models may be shown a reference image without holding a model
/// table of its own.
///
/// Unlike the windows, a **missing** entry is not an error: a model the catalog has no
/// modality list for is simply absent, and gg reads that as unknown (try an image, and
/// recover if the provider refuses it) rather than as text-only.
#[test]
fn build_invocation_carries_the_resolved_model_modalities() {
    let request = gg_request("anthropic/claude-opus-4.8");
    let invocation =
        build_invocation(&request, "the build prompt", "/work", &[], "run-123").unwrap();
    assert_eq!(
        invocation
            .model_modalities
            .get("anthropic/claude-opus-4.8")
            .map(Vec::as_slice),
        Some(["text".to_string(), "image".to_string()].as_slice())
    );

    // No modalities at all is a launchable configuration, unlike a missing window.
    let mut request = gg_request("mock/echo");
    request.gg_model_modalities.clear();
    let invocation = build_invocation(&request, "prompt", "/work", &[], "run-123")
        .expect("unknown modalities never block a run");
    assert!(invocation.model_modalities.is_empty());
}

/// The cancellation path, driven through a prepared session against a container double: raising the
/// sentinel, draining the wind-down, and the partial outcome that comes back.
///
/// Separate from the tests above because those are deliberately container-free (pure ingest
/// and path resolution) while these need a runtime to drive the branch's race at all.
#[path = "gg_exec.cancel.test.rs"]
mod cancel_tests;

// --- The non-zero-exit classification --------------------------------------

/// Reasons for an exit gg said nothing about: no error log, no stderr, no ceiling.
const SILENT: ExitReasons<'static> = ExitReasons {
    error_logs: &[],
    stderr_lines: &[],
    limit_breach: None,
};

#[test]
fn a_breached_ceiling_is_classified_apart_from_every_other_non_zero_exit() {
    // The two non-zero codes say opposite things about the configuration, and the split is what
    // keeps a run that spent its own safeguard out of the retry loop.
    let ceiling = classify_exit(
        i32::from(crate::gg::EXIT_LIMIT_EXCEEDED),
        Some("limit_exceeded"),
        &SILENT,
    );
    assert!(
        // Nothing to quote: the breach sentence would have displaced the code and the
        // status, and with no sentence to quote they are the figures the failure has.
        matches!(&ceiling, Error::HarnessLimitExceeded { slug, detail }
            if slug == GG_SLUG && detail == "code 3, session ended `limit_exceeded`"),
        "{ceiling:?}",
    );
    assert_eq!(
        ceiling.to_string(),
        "gg execution ceiling hit (code 3, session ended `limit_exceeded`)",
    );
    assert_eq!(
        crate::run_record::RunState::classify_failure(&ceiling),
        crate::run_record::RunState::LimitExceeded,
    );

    // A launch fatal, a refused credential and a gg defect all leave `1`, and all of them mean
    // there was no run to score.
    let broken = classify_exit(1, Some("internal_error"), &SILENT);
    assert!(
        matches!(&broken, Error::HarnessInvocation { slug, detail }
            if slug == GG_SLUG && detail.contains("internal_error")),
        "{broken:?}",
    );
    assert_eq!(
        crate::run_record::RunState::classify_failure(&broken),
        crate::run_record::RunState::HarnessError,
    );
}

#[test]
fn an_exit_with_no_terminal_status_still_names_its_code() {
    // A session killed before it emitted a `session_ended` reports nothing to quote, and the
    // detail has to stay useful anyway.
    let detail = invocation_detail(classify_exit(1, None, &SILENT));
    assert_eq!(detail, "code 1");
}

#[test]
fn a_session_that_said_nothing_is_recorded_as_before() {
    // The reasons are an addition to the detail, not a replacement: with no error log, no stderr
    // and no ceiling there is nothing to quote and the code and status stand alone.
    let (_emitted, result) = ingest(&session_ended_line("error"));
    let detail = invocation_detail(result.classify(1));
    assert_eq!(detail, "code 1, session ended `error`");
}

#[test]
fn a_launch_refusal_is_recorded_with_the_defect_gg_logged() {
    // gg logs each launch defect at error level and then ends the session `error`; the exit code
    // says only that there was no run, and the detail must say why.
    let defect = "agent `rac`: context-window-override.params.windowLimit = `400000` — larger \
                  than the bound model's window";
    let stream = [
        log_line("info", "session started"),
        log_line("error", defect),
        session_ended_line("error"),
    ]
    .join("\n");
    let (emitted, result) = ingest(&stream);
    // The feed still shows it as it arrived; the copy on the sink is for the status detail.
    assert_eq!(
        count_kind(
            &emitted,
            |k| matches!(k, EventKind::Error { message, .. } if message == defect)
        ),
        1,
    );
    let detail = invocation_detail(result.classify(1));
    assert_eq!(detail, format!("code 1, session ended `error`; {defect}"),);
}

#[test]
fn every_launch_defect_is_named_in_order() {
    // A refusal names every defect at once so an operator fixes the configuration in one pass;
    // the detail must not keep only the first or the last. Info and warn logs in between are not
    // reasons and are not quoted.
    let stream = [
        log_line("error", "agent `rac`: unknown tool `frobnicate`"),
        log_line("warn", "skills library is empty"),
        log_line(
            "error",
            "agent `rac`: context-window-override.params.windowLimit = `400000`",
        ),
        log_line("Error", "profile `reviewer`: no model bound"),
        session_ended_line("error"),
    ]
    .join("\n");
    let (_emitted, result) = ingest(&stream);
    let detail = invocation_detail(result.classify(1));
    assert_eq!(
        detail,
        "code 1, session ended `error`; \
         agent `rac`: unknown tool `frobnicate`; \
         agent `rac`: context-window-override.params.windowLimit = `400000`; \
         profile `reviewer`: no model bound",
    );
}

#[test]
fn a_pre_telemetry_fatal_on_stderr_is_the_reason_when_there_is_no_error_log() {
    // A fatal gg meets before its telemetry stream is up never reaches the stream at all: it is
    // written to stderr, and the session ends with no `session_ended` to quote. The detail falls
    // back to the stderr lines, and to those alone — blank lines are not diagnostics.
    let (_emitted, result) = ingest_both(
        "",
        "error: could not read capability set: /work/.gg/set.json: No such file\n\n  \n\
         hint: seed the workspace before launching\n",
    );
    assert!(result.terminal_status.is_none());
    let detail = invocation_detail(result.classify(1));
    assert_eq!(
        detail,
        "code 1; \
         error: could not read capability set: /work/.gg/set.json: No such file; \
         hint: seed the workspace before launching",
    );
}

#[test]
fn error_logs_take_precedence_over_stderr() {
    // When gg got far enough to log the defect, that log is the authoritative account and the
    // stderr noise around it (a runtime's own chatter, say) must not dilute it.
    let (_emitted, result) = ingest_both(
        &[
            log_line("error", "profile `root`: no model bound"),
            session_ended_line("error"),
        ]
        .join("\n"),
        "some runtime noise\n",
    );
    let detail = invocation_detail(result.classify(1));
    assert_eq!(
        detail,
        "code 1, session ended `error`; profile `root`: no model bound",
    );
}

#[test]
fn a_ceiling_exit_quotes_the_breach_sentence_gg_logged() {
    // gg logs the ceiling sentence at warn level and emits the breach event immediately after; the
    // pairing is what lets the detail quote that sentence and not the unrelated warning before it.
    let stream = [
        agent_log_line("root", "warn", "a view call was refused: not a file"),
        agent_log_line("root", "warn", BREACH_SENTENCE),
        breach_line("root"),
        session_ended_line("limit_exceeded"),
    ]
    .join("\n");
    let (emitted, result) = ingest(&stream);
    // The breach event parsed — the pairing below depends on it, not on a stray warning.
    assert_eq!(
        count_kind(&emitted, |k| matches!(k, EventKind::Gg { event }
            if matches!(event.kind, GgTelemetryKind::LimitExceeded { .. }))),
        1,
    );
    assert_eq!(result.limit_breach.as_deref(), Some(BREACH_SENTENCE));
    let detail = match result.classify(i32::from(crate::gg::EXIT_LIMIT_EXCEEDED)) {
        Error::HarnessLimitExceeded { detail, .. } => detail,
        other => panic!("{other:?}"),
    };
    assert_eq!(detail, BREACH_SENTENCE);
}

#[test]
fn a_ceiling_stop_reads_as_one_clause_end_to_end() {
    // The composed sentence is what an operator reads off a failed run, and every layer that
    // contributes to it states its fact once: gg's own breach sentence carries the figures,
    // this crate's classification adds nothing to it, and the error names the subsystem. The
    // driver prefixes `run failed: ` to what is asserted here.
    let ceiling = classify_exit(
        i32::from(crate::gg::EXIT_LIMIT_EXCEEDED),
        Some("limit_exceeded"),
        &ExitReasons {
            error_logs: &[],
            stderr_lines: &[],
            limit_breach: Some(BREACH_SENTENCE),
        },
    );
    assert_eq!(
        ceiling.to_string(),
        "gg execution ceiling hit (5 consecutive turns failed)",
    );
}

#[test]
fn a_concurrent_agents_warning_is_not_mistaken_for_the_ceiling() {
    // Subagents run concurrently on one sink, and gg's warn-then-breach pair is two emits with
    // nothing keeping them adjacent: another agent's warning can land between them. The pairing
    // is by the agent the breach names, so that interloper is not quoted as the ceiling.
    let stream = [
        agent_log_line("root", "warn", BREACH_SENTENCE),
        agent_log_line("worker-1", "warn", "a view call was refused: not a file"),
        breach_line("root"),
        session_ended_line("limit_exceeded"),
    ]
    .join("\n");
    let (_emitted, result) = ingest(&stream);
    assert_eq!(result.limit_breach.as_deref(), Some(BREACH_SENTENCE));

    // And a breach whose agent never logged a sentence claims nobody else's, however recent:
    // the run is recorded as a ceiling stop with nothing quoted, rather than with a warning
    // about something else.
    let stream = [
        agent_log_line("root", "warn", "a view call was refused: not a file"),
        breach_line("worker-1"),
        session_ended_line("limit_exceeded"),
    ]
    .join("\n");
    let (_emitted, result) = ingest(&stream);
    assert_eq!(result.limit_breach, None);
}

#[test]
fn a_ceiling_exit_without_a_breach_sentence_falls_back_to_the_exit_figures() {
    // The pairing is best-effort: a stream that ended `limit_exceeded` with no breach event to
    // claim a sentence quotes no stray warning in its place — but it still carries the figures
    // this layer holds, so the reader is never handed a failure with no figure at all.
    let stream = [
        log_line("warn", "skills library is empty"),
        session_ended_line("limit_exceeded"),
    ]
    .join("\n");
    let (_emitted, result) = ingest(&stream);
    let detail = match result.classify(i32::from(crate::gg::EXIT_LIMIT_EXCEEDED)) {
        Error::HarnessLimitExceeded { detail, .. } => detail,
        other => panic!("{other:?}"),
    };
    assert_eq!(detail, "code 3, session ended `limit_exceeded`");
}

#[test]
fn the_quoted_reasons_are_bounded_and_the_rest_are_counted() {
    // A session that logged an error on every retried turn for hundreds of turns must not leave a
    // status detail the size of its stream. The first reasons are kept whole in order until the
    // next would not fit, the remainder is named by count so the reader knows what was left
    // unsaid, and the last reason — the defect gg broke on, logged after every retry that led to
    // it — is kept whole at the end, because it is the one that says why.
    let mut reasons: Vec<String> = (0..499)
        .map(|turn| format!("turn {turn}: the model call was retried after a 529 overload"))
        .collect();
    let fatal = "the runtime exited before the turn's program finished: signal 9";
    reasons.push(fatal.to_string());
    let mut lines: Vec<String> = reasons.iter().map(|r| log_line("error", r)).collect();
    lines.push(session_ended_line("internal_error"));
    let (_emitted, result) = ingest(&lines.join("\n"));
    assert_eq!(result.error_logs.len(), 500);

    let detail = invocation_detail(result.classify(1));
    let prefix = "code 1, session ended `internal_error`; ";
    let quoted = detail
        .strip_prefix(prefix)
        .expect("the code and status still lead");
    assert!(
        quoted.len() <= MAX_EXIT_REASON_BYTES,
        "quoted {} bytes against a bound of {MAX_EXIT_REASON_BYTES}",
        quoted.len(),
    );
    assert!(quoted.starts_with(&reasons[0]), "{quoted}");
    assert!(quoted.ends_with(fatal), "{quoted}");
    // The count names exactly the reasons that were not quoted, on either side of it.
    let (kept, rest) = quoted
        .split_once("; …and ")
        .unwrap_or_else(|| panic!("an elision marker: {quoted}"));
    let more: usize = rest
        .strip_suffix(&format!(" more; {fatal}"))
        .and_then(|n| n.parse().ok())
        .unwrap_or_else(|| panic!("a count of the elided reasons, then the last: {rest}"));
    let named = kept.split("; ").count();
    assert_eq!(
        named + more + 1,
        500,
        "{named} named + {more} elided + the last"
    );
    assert!(
        named > 10,
        "the bound holds several whole reasons, not a handful: {named}"
    );
    assert!(
        kept.ends_with(&reasons[named - 1]),
        "the last quoted reason of the head is whole",
    );
}

#[test]
fn reasons_that_fit_are_joined_whole_and_nothing_is_counted() {
    // The count is for what was left unsaid; when nothing was, there is no count, and the order
    // is the stream's.
    let reasons = ["one".to_string(), "two".to_string(), "three".to_string()];
    assert_eq!(join_bounded(&reasons, 20), "one; two; three");
    assert_eq!(join_bounded(&reasons[..1], 20), "one");
    assert_eq!(join_bounded(&[], 20), "");
}

#[test]
fn the_bound_holds_whatever_the_reasons_sizes() {
    // The count and the last reason are reserved before the head is filled, so the shapes that
    // would once have run a few bytes past the limit — a head that exactly fills it, a first
    // reason as long as the whole budget — stay inside it. The bound is the whole promise the
    // constant makes to the run record's column.
    let limit = 2000;
    let shapes: [Vec<String>; 4] = [
        vec!["a".repeat(1995), "b".repeat(50), "c".to_string()],
        vec!["a".repeat(2000), "b".to_string()],
        vec!["a".repeat(2500)],
        vec!["a".repeat(10), "b".repeat(2500)],
    ];
    for reasons in &shapes {
        let joined = join_bounded(reasons, limit);
        assert!(
            joined.len() <= limit,
            "{} bytes for {:?}",
            joined.len(),
            reasons.iter().map(String::len).collect::<Vec<_>>(),
        );
        // Whatever was cut, the last reason's start is there: it is the one that says why.
        let last = reasons.last().unwrap();
        assert!(joined.ends_with(last) || joined.ends_with('…'), "{joined}");
    }
    // The elided head is counted, and the last is whole, when the first alone is too long.
    assert_eq!(
        join_bounded(&["a".repeat(2500), "why".to_string()], limit),
        "…and 1 more; why"
    );
}

#[test]
fn a_single_reason_longer_than_the_bound_is_cut_on_a_character_boundary() {
    // One enormous message is still the only explanation there is, so most of it is kept, cut
    // where a character ends — the em dash gg's own messages are full of must not be split.
    let long = "x".repeat(MAX_EXIT_REASON_BYTES - 4) + "——";
    let joined = join_bounded(&[long], MAX_EXIT_REASON_BYTES);
    assert!(joined.len() <= MAX_EXIT_REASON_BYTES, "{}", joined.len());
    assert!(joined.starts_with(&"x".repeat(MAX_EXIT_REASON_BYTES - 4)));
    assert!(joined.ends_with('…'), "{joined}");
    assert!(!joined.contains("——"), "the dash pair was cut, not carried");
}
