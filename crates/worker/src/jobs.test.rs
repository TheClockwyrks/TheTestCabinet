//! Tests for the async run-job model: event log, status transitions, and the
//! subscription replay/live semantics the event stream relies on.

use super::*;
use test_cabinet_core::EventKind;

/// Build a trivial agent event with the given message, for log/stream assertions.
fn agent_event(message: &str) -> HarnessEvent {
    HarnessEvent {
        timestamp: "2026-06-18T00:00:00Z".to_string(),
        session_id: None,
        kind: EventKind::Agent {
            message: message.to_string(),
        },
    }
}

#[test]
fn create_registers_a_running_job_with_a_unique_id() {
    let registry = JobRegistry::new();
    assert!(registry.is_empty());

    let a = registry.create();
    let b = registry.create();
    assert_ne!(a.id(), b.id(), "each job gets a fresh id");
    assert_eq!(registry.len(), 2);

    let status = a.status();
    assert_eq!(status.state, JobState::Running);
    assert!(status.record.is_none());
    assert!(status.detail.is_none());
    assert!(!a.terminal_for_test());
}

#[test]
fn get_returns_the_same_job_and_none_for_unknown() {
    let registry = JobRegistry::new();
    let job = registry.create();
    let id = job.id().to_string();
    assert_eq!(registry.get(&id).unwrap().id(), id);
    assert!(registry.get("does-not-exist").is_none());
}

#[test]
fn finish_failed_records_the_reason_and_terminates() {
    let registry = JobRegistry::new();
    let job = registry.create();
    job.finish_failed("the container would not start");

    assert!(job.terminal_for_test());
    let status = job.status();
    assert_eq!(status.state, JobState::Failed);
    assert_eq!(
        status.detail.as_deref(),
        Some("the container would not start")
    );
    assert!(status.record.is_none());
}

#[tokio::test]
async fn subscribe_replays_the_backlog_then_streams_live_events() {
    let registry = JobRegistry::new();
    let job = registry.create();

    // Two events arrive before anyone subscribes; they must still be delivered.
    job.push_event(agent_event("first"));
    job.push_event(agent_event("second"));

    let mut sub = job.subscribe();
    assert_eq!(sub.backlog.len(), 2, "backlog replays pre-subscribe events");
    assert!(!sub.terminated);

    // A live event after subscribe is delivered on the receiver.
    job.push_event(agent_event("third"));
    match sub.receiver.recv().await.unwrap() {
        StreamItem::Event(event) => assert_eq!(
            event.kind,
            EventKind::Agent {
                message: "third".to_string()
            }
        ),
        other => panic!("expected an event, got {other:?}"),
    }

    // Finishing the run signals the stream to close.
    let record_id = "00000000-0000-0000-0000-000000000000";
    job.finish_succeeded(record_with_id(record_id));
    match sub.receiver.recv().await.unwrap() {
        StreamItem::Done => {}
        other => panic!("expected Done, got {other:?}"),
    }

    let status = job.status();
    assert_eq!(status.state, JobState::Succeeded);
    assert_eq!(status.record.unwrap().id, record_id);
}

#[test]
fn subscribing_after_completion_reports_terminated_with_full_backlog() {
    let registry = JobRegistry::new();
    let job = registry.create();
    job.push_event(agent_event("only"));
    job.finish_failed("boom");

    let sub = job.subscribe();
    assert!(sub.terminated, "a finished job's subscription is terminal");
    assert_eq!(sub.backlog.len(), 1, "the full backlog is still replayed");
}

/// A minimal run record carrying the given id, for status assertions. Every other
/// field is left at a neutral default — only the id matters to the job model.
fn record_with_id(id: &str) -> RunRecord {
    use test_cabinet_core::{
        HarnessSlug, RunEnvironment, RunLinks, RunMetrics, RunState, RunStatus, RunSubject,
        RunTooling, ValidationSummary,
    };
    RunRecord {
        id: id.to_string(),
        started_at: "2026-06-18T00:00:00Z".to_string(),
        finished_at: "2026-06-18T00:10:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            model_id: "claude-sonnet-4-5".to_string(),
        },
        tooling: RunTooling::current(),
        environment: RunEnvironment {
            os: "linux".to_string(),
            container_image: "test-cabinet/claude:abc".to_string(),
            node_version: None,
        },
        metrics: RunMetrics::default(),
        validation: ValidationSummary::default(),
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
    }
}
