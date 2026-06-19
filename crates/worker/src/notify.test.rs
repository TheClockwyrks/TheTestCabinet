//! Tests for the worker notification payload shape and fan-out. The console
//! deserializes these by exact field names, so the JSON contract is asserted here.

use super::*;

fn summary() -> RunSummary {
    RunSummary {
        test_case_slug: "pong".to_string(),
        variant: "base".to_string(),
        harness_slug: "claude".to_string(),
        model_id: "claude-sonnet-4-5".to_string(),
    }
}

#[test]
fn completed_serializes_with_flattened_summary_and_record_id() {
    let json = serde_json::to_value(WorkerNotification::completed(
        "job-1",
        &summary(),
        "record-9",
    ))
    .expect("serialize");

    assert_eq!(json["kind"], "run-completed");
    assert_eq!(json["jobId"], "job-1");
    // The summary is flattened, in camelCase, alongside the outcome.
    assert_eq!(json["testCaseSlug"], "pong");
    assert_eq!(json["variant"], "base");
    assert_eq!(json["harnessSlug"], "claude");
    assert_eq!(json["modelId"], "claude-sonnet-4-5");
    assert_eq!(json["outcome"], "completed");
    assert_eq!(json["recordId"], "record-9");
    // A completed run carries no failure message.
    assert!(json.get("message").is_none());
}

#[test]
fn failed_serializes_with_message_and_no_record_id() {
    let json =
        serde_json::to_value(WorkerNotification::failed("job-2", &summary(), "boom")).expect("ser");

    assert_eq!(json["outcome"], "failed");
    assert_eq!(json["message"], "boom");
    assert!(json.get("recordId").is_none());
}

#[tokio::test]
async fn notify_fans_out_to_subscribers() {
    let notifier = WorkerNotifier::new();
    let mut rx = notifier.subscribe();
    notifier.notify(WorkerNotification::completed(
        "job-3",
        &summary(),
        "record-1",
    ));

    let received = rx
        .recv()
        .await
        .expect("a subscriber receives the notification");
    assert_eq!(received.job_id, "job-3");
    assert_eq!(received.record_id.as_deref(), Some("record-1"));
}
