use super::*;
// `GgRunLimits` and `GgLimitBreach` already ride in on the glob; only the ceiling taxonomy the
// emitter itself never names has to be named here.
use test_cabinet_core::gg::{GgCapabilitySet, GgContextSource, GgLimitKind};

use crate::context::{PromptSlot, Retention};

/// One untagged request item, the shape most of these tests log: a message in its band at a
/// given estimate, carrying no selector tag (see [`tagged`] for the file-view case).
fn item<'a>(source: GgContextSource, message: &'a Message, tokens: usize) -> PromptItem<'a> {
    PromptItem {
        source,
        message,
        tokens,
        label: None,
        // The window-model fields belong to replay's prompt frame, not to the message log, which
        // reads none of them; a thread item on the opening turn is the neutral shape here.
        slot: PromptSlot::Thread,
        retention: Retention::Ephemeral,
        turn: 0,
        region: None,
        lines: None,
    }
}

/// One request item carrying a selector tag — a file view under the path it shows.
fn tagged<'a>(
    source: GgContextSource,
    message: &'a Message,
    tokens: usize,
    label: &'a str,
) -> PromptItem<'a> {
    PromptItem {
        source,
        message,
        tokens,
        label: Some(label),
        slot: PromptSlot::Thread,
        retention: Retention::Ephemeral,
        turn: 0,
        region: None,
        lines: None,
    }
}

/// The emitter serializes each event as one NDJSON line to its sink, stamped with the
/// session id and a timestamp, and the collecting sink captures them in order.
#[test]
fn emits_ndjson_lines_to_the_injected_sink() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-42".to_string()), Box::new(sink.clone()));

    emitter.emit(GgTelemetryKind::SessionStarted {
        capability_set: Box::new(GgCapabilitySet::minimal("mock/echo")),
        model_providers: Default::default(),
    });
    emitter.emit(GgTelemetryKind::AssistantMessage {
        text: "hello".to_string(),
    });
    emitter.emit(GgTelemetryKind::SessionEnded {
        status: "completed".to_string(),
    });

    // One line per event, each valid NDJSON (no embedded newline).
    let lines = sink.lines();
    assert_eq!(lines.len(), 3);
    assert!(lines.iter().all(|line| !line.contains('\n')));

    // Round-trips back to the typed events, in order, all stamped with the session id
    // and a non-empty timestamp.
    let events = sink.events();
    assert!(matches!(
        events[0].kind,
        GgTelemetryKind::SessionStarted { .. }
    ));
    assert!(matches!(
        events[1].kind,
        GgTelemetryKind::AssistantMessage { ref text } if text == "hello"
    ));
    assert!(matches!(
        events[2].kind,
        GgTelemetryKind::SessionEnded { ref status } if status == "completed"
    ));
    assert!(events.iter().all(|event| {
        event.session_id.as_deref() == Some("run-42") && !event.timestamp.is_empty()
    }));
}

/// An agent-scoped emitter stamps every event with that agent's id and its spawner's id,
/// while sharing the base emitter's session id and its underlying sink.
#[test]
fn for_agent_stamps_the_agent_and_parent_ids() {
    let sink = CollectingSink::new();
    let base = Emitter::with_sink(Some("run-7".to_string()), Box::new(sink.clone()));

    // The base (unscoped) emitter carries no agent id.
    base.emit(GgTelemetryKind::SessionStarted {
        capability_set: Box::new(GgCapabilitySet::minimal("mock/echo")),
        model_providers: Default::default(),
    });

    // A root-scoped emitter: its own id, no parent.
    let root = base.for_agent("root", None);
    root.emit(GgTelemetryKind::TurnStarted {});

    // A child-scoped emitter derived from the root: its own id, the root as parent. It writes to
    // the same shared sink.
    let child = root.for_agent("agent-1", Some("root".to_string()));
    child.emit(GgTelemetryKind::TurnStarted {});

    let events = sink.events();
    assert_eq!(events.len(), 3, "all three emitters share the one sink");

    // Base: no agent context.
    assert!(events[0].agent_id.is_none());
    assert!(events[0].parent_agent_id.is_none());
    // Root: tagged as root, no parent.
    assert_eq!(events[1].agent_id.as_deref(), Some("root"));
    assert!(events[1].parent_agent_id.is_none());
    // Child: tagged as itself, spawned by root.
    assert_eq!(events[2].agent_id.as_deref(), Some("agent-1"));
    assert_eq!(events[2].parent_agent_id.as_deref(), Some("root"));

    // The session id is inherited by every scope.
    assert!(
        events
            .iter()
            .all(|e| e.session_id.as_deref() == Some("run-7"))
    );
}

/// The four recorded (rather than folded) summary facts land on the **shared** tracker, so it does
/// not matter which derived emitter records them, and they survive onto the finalized summary. A
/// `LimitExceeded` an agent emits on the same stream is deliberately not folded, so a subagent's
/// ceiling never becomes the run's recorded outcome.
#[test]
fn the_recorded_summary_facts_reach_the_shared_tracker() {
    let sink = CollectingSink::new();
    let base = Emitter::with_sink(Some("run-9".to_string()), Box::new(sink.clone()));
    let root = base.for_agent("root", None);
    let child = root.for_agent("agent-1", Some("root".to_string()));

    let limits = GgRunLimits {
        max_turns: Some(12),
        max_cost: Some(2.5),
        ..GgRunLimits::default()
    };
    let child_breach = GgLimitBreach {
        limit: GgLimitKind::ErrorRate,
        threshold: 0.5,
        observed: 0.6,
        turns: 10,
        agent_id: "agent-1".to_string(),
        window: Some(10),
    };

    // The child records the run's configuration facts and stops on its own ceiling, emitting the
    // event the tracker observes but must not fold.
    child.record_execution_mode("responses_as_code");
    child.record_effective_tools(vec!["shell".to_string()]);
    child.record_limits(limits);
    child.emit(GgTelemetryKind::LimitExceeded {
        breach: child_breach.clone(),
    });
    // The root ended on its own terms, so the run hit no ceiling.
    root.record_limit_hit(None);

    // Any emitter can finalize: they all share one tracker.
    let summary = base.finalize_summary("completed");
    assert_eq!(summary.execution_mode, "responses_as_code");
    assert_eq!(summary.effective_tools, vec!["shell".to_string()]);
    assert_eq!(summary.limits, limits);
    assert_eq!(
        summary.limit_hit, None,
        "the child's ceiling stopped the child, not the run"
    );

    // The child's breach is still on the wire, attributed to the child's own stream — recording and
    // emitting are independent, and dropping the fold does not drop the event.
    let events = sink.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].agent_id.as_deref(), Some("agent-1"));
    assert!(matches!(
        events[0].kind,
        GgTelemetryKind::LimitExceeded { ref breach } if *breach == child_breach
    ));
}

/// `now_rfc3339` yields a parseable RFC 3339 timestamp (not the empty fallback).
#[test]
fn now_rfc3339_is_parseable() {
    let stamp = now_rfc3339();
    assert!(!stamp.is_empty());
    OffsetDateTime::parse(&stamp, &Rfc3339).expect("valid RFC 3339 timestamp");
}

/// `log_prompt` streams each message's body once (as a `ContextMessage`) and each turn's
/// request/response as pointers into that pool: a message repeated on a later turn is not
/// re-defined, and the `Prompt` refs carry the ids in order with their bands.
#[test]
fn log_prompt_deduplicates_across_turns() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-1".to_string()), Box::new(sink.clone()))
        .for_agent("root", None);

    let system = Message::system("you are gg");
    let prompt = Message::user("build a game");
    let reply1 = Message::assistant(Some("on it".to_string()), Vec::new());

    // Turn 1: system + user prompt → assistant reply.
    let request1 = [
        item(GgContextSource::System, &system, 10),
        item(GgContextSource::UserPrompt, &prompt, 20),
    ];
    emitter.log_prompt(
        &request1,
        Some((&reply1, 5)),
        TokenCounts::default(),
        None,
        "stop".to_string(),
        None,
        None,
    );

    // Turn 2: the same system + prompt (repeats) + turn 1's reply now in the window as
    // history → a new assistant reply.
    let reply2 = Message::assistant(Some("done".to_string()), Vec::new());
    let request2 = [
        item(GgContextSource::System, &system, 10),
        item(GgContextSource::UserPrompt, &prompt, 20),
        item(GgContextSource::Assistant, &reply1, 5),
    ];
    emitter.log_prompt(
        &request2,
        Some((&reply2, 4)),
        TokenCounts::default(),
        None,
        "stop".to_string(),
        None,
        None,
    );

    let events = sink.events();

    // Every unique message is defined exactly once: system, prompt, reply1, reply2 = 4.
    let defined: Vec<&str> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextMessage { id, .. } => Some(id.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        defined.len(),
        4,
        "one definition per unique message: {defined:?}"
    );
    let unique: std::collections::HashSet<&str> = defined.iter().copied().collect();
    assert_eq!(unique.len(), 4, "no message is defined twice");

    // Two prompts, in order.
    let prompts: Vec<&GgTelemetryKind> = events
        .iter()
        .map(|e| &e.kind)
        .filter(|k| matches!(k, GgTelemetryKind::Prompt { .. }))
        .collect();
    assert_eq!(prompts.len(), 2);

    // Turn 1's request points at the system + prompt ids (in order, with bands), and its
    // response points at reply1.
    let sys_id = fingerprint(&system);
    let prompt_id = fingerprint(&prompt);
    let reply1_id = fingerprint(&reply1);
    match prompts[0] {
        GgTelemetryKind::Prompt {
            request,
            response_id,
            total_tokens,
            ..
        } => {
            assert_eq!(request.len(), 2);
            assert_eq!(request[0].id, sys_id);
            assert_eq!(request[0].source, GgContextSource::System);
            assert_eq!(request[1].id, prompt_id);
            assert_eq!(*total_tokens, 30);
            assert_eq!(response_id.as_deref(), Some(reply1_id.as_str()));
        }
        other => panic!("expected Prompt, got {other:?}"),
    }

    // Turn 2 references reply1 by its unchanged id — proving the response pooled on turn 1
    // is reused as a request pointer, not redefined.
    match prompts[1] {
        GgTelemetryKind::Prompt { request, .. } => {
            assert_eq!(request.len(), 3);
            assert_eq!(request[2].id, reply1_id);
            assert_eq!(request[2].source, GgContextSource::Assistant);
        }
        other => panic!("expected Prompt, got {other:?}"),
    }

    // reply1 is defined once (on turn 1) and never redefined on turn 2.
    assert_eq!(
        defined.iter().filter(|id| **id == reply1_id).count(),
        1,
        "reply1 is defined exactly once"
    );
}

/// A turn that produced no assistant message carries no response pointer.
#[test]
fn log_prompt_omits_absent_response() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone())).for_agent("root", None);
    let system = Message::system("s");
    emitter.log_prompt(
        &[item(GgContextSource::System, &system, 3)],
        None,
        TokenCounts::default(),
        None,
        "stop".to_string(),
        None,
        None,
    );
    let events = sink.events();
    let prompt = events
        .iter()
        .find_map(|e| match &e.kind {
            GgTelemetryKind::Prompt { response_id, .. } => Some(response_id.clone()),
            _ => None,
        })
        .expect("a prompt was emitted");
    assert_eq!(prompt, None);
}

/// A tagged window item defines its pooled message under that tag, so a file view's tokens
/// stay attributable to the path that filled the window — while an untagged message beside
/// it carries none. The tag rides on the definition (emitted once), not on the per-turn
/// pointer, so a second turn over the same file adds no further label.
#[test]
fn log_prompt_carries_a_file_views_path_onto_its_pooled_definition() {
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(None, Box::new(sink.clone())).for_agent("root", None);
    let system = Message::system("you are gg");
    let view = Message::tool_result("call_1", "export const LEVELS = [];");
    let request = [
        item(GgContextSource::System, &system, 10),
        tagged(GgContextSource::FileView, &view, 120, "src/levels.ts"),
    ];
    for _ in 0..2 {
        emitter.log_prompt(
            &request,
            None,
            TokenCounts::default(),
            None,
            "stop".to_string(),
            None,
            None,
        );
    }

    let events = sink.events();
    let labels: Vec<(u64, Option<String>)> = events
        .iter()
        .filter_map(|e| match &e.kind {
            GgTelemetryKind::ContextMessage { tokens, label, .. } => Some((*tokens, label.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(
        labels,
        vec![(10, None), (120, Some("src/levels.ts".to_string()))],
        "each message is defined once, the file view under its path"
    );
}

// ---------------------------------------------------------------------------
// The emitting shell decorator
// ---------------------------------------------------------------------------

/// Every command the decorated runner runs is reported as one `Shell` event on the emitter's
/// stream — under the origin the caller stamped, with the exit code the process returned, both
/// streams, and the working directory measured against the agent's own root.
#[tokio::test]
async fn the_emitting_shell_decorator_reports_every_command() {
    use crate::tools::ShellRunner as _;
    use test_cabinet_core::gg_session_record::{GgShellCwd, GgShellOrigin};

    let dir = tempfile::tempdir().expect("the agent's root");
    std::fs::create_dir_all(dir.path().join("web")).expect("the subdirectory");
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-9".to_string()), Box::new(sink.clone()))
        .for_agent("agent-1", None);
    let runner = EmittingShellRunner::new(crate::tools::real_shell(), emitter, dir.path());

    runner
        .run(crate::tools::ShellRequest {
            command: "printf out; printf err >&2; exit 3".to_string(),
            cwd: dir.path().join("web"),
            timeout: std::time::Duration::from_secs(30),
            agent_id: "agent-1".to_string(),
            origin: GgShellOrigin::Hook,
        })
        .await;

    let events = sink.events();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].agent_id.as_deref(),
        Some("agent-1"),
        "the event lands on the stream of the agent the command ran for"
    );
    match &events[0].kind {
        GgTelemetryKind::Shell {
            origin,
            command,
            cwd,
            exit_code,
            stdout,
            stderr,
            stdout_dropped,
            stderr_dropped,
        } => {
            assert_eq!(*origin, GgShellOrigin::Hook);
            assert_eq!(command, "printf out; printf err >&2; exit 3");
            assert_eq!(
                *cwd,
                GgShellCwd::Relative {
                    path: "web".to_string()
                }
            );
            assert_eq!(*exit_code, 3);
            assert_eq!(stdout, "out");
            assert_eq!(stderr, "err");
            assert_eq!((*stdout_dropped, *stderr_dropped), (0, 0));
        }
        other => panic!("expected a Shell event, got {other:?}"),
    }
}

/// A stream under the cap passes through untouched; one over it keeps the trailing
/// [`GG_SHELL_EVENT_STREAM_CHARS`] characters — characters, so a multibyte tail is cut on a
/// character rather than mid-encoding — and counts what was removed.
#[test]
fn the_shell_stream_tail_keeps_the_trailing_characters() {
    let short = "a".repeat(GG_SHELL_EVENT_STREAM_CHARS);
    assert_eq!(shell_stream_tail(&short), (short.clone(), 0));

    let long = format!("é{}", "b".repeat(GG_SHELL_EVENT_STREAM_CHARS + 2));
    let (tail, dropped) = shell_stream_tail(&long);
    assert_eq!(
        dropped, 3,
        "the leading characters are what the cap removes"
    );
    assert_eq!(tail.chars().count(), GG_SHELL_EVENT_STREAM_CHARS);
    assert!(tail.chars().all(|c| c == 'b'));
}
