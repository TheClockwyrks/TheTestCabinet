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
use crate::gg::{GgCapabilitySet, PRIMARY_SLOT};
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
    let mut collecting = CollectingSink::default();
    let mut sink = GgIngestSink::new(&mut collecting);
    for line in stream.lines() {
        sink.on_line(OutputStream::Stdout, line);
    }
    let GgIngestSink {
        tokens,
        reported_cost,
        raw_output,
        translated_events,
        terminal_status,
        gg_summary,
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
    assert_eq!(summary.slot_costs[0].slot, PRIMARY_SLOT);
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
        crate::gg::GgTelemetryKind::SessionStarted {
            capability_set: None
        }
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
        },
    );
    assert_eq!(bridge(&ok).len(), 1);
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

#[test]
fn release_download_command_builds_the_expected_url_and_script() {
    let script = release_download_command(
        "TheClockwyrks/test-cabinet",
        "0.7.0",
        "x86_64-unknown-linux-gnu",
        "/tmp/gg",
    );
    assert!(script.contains(
        "https://github.com/TheClockwyrks/test-cabinet/releases/download/gg-v0.7.0/gg-x86_64-unknown-linux-gnu"
    ));
    assert!(script.contains("--output /tmp/gg"));
    assert!(script.contains("chmod 0755 /tmp/gg"));
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
        max_runtime_override: None,
        container_image: None,
        gg_capability_set: Some(GgCapabilitySet::minimal(model)),
    }
}

#[test]
fn build_invocation_carries_the_run_id_workspace_prompt_and_set() {
    let request = gg_request("mock/echo");
    let invocation = build_invocation(&request, "the build prompt", "/work", "run-123").unwrap();
    assert_eq!(invocation.session_id, "run-123");
    assert_eq!(invocation.workspace_dir, PathBuf::from("/work"));
    assert_eq!(invocation.prompt, "the build prompt");
    assert_eq!(
        invocation.capability_set.model_for_slot(PRIMARY_SLOT),
        Some("mock/echo")
    );
}
