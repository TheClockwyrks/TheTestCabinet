use super::*;

fn summary() -> JobSummary {
    JobSummary {
        test_case_slug: "carom".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness_slug: "claude-code".to_string(),
        model_id: "claude-opus-4".to_string(),
    }
}

/// The console reads a notification's identity off the top level, not out of a
/// nested object: `JobSummary` is flattened into every notification.
#[test]
fn a_notification_flattens_the_run_identity() {
    let value = serde_json::to_value(Notification::completed("j1", summary(), "r1")).unwrap();
    assert_eq!(value["testCaseSlug"], "carom");
    assert_eq!(value["testCaseVersion"], "v1.0.0");
    assert_eq!(value["variant"], "base");
    assert_eq!(value["harnessSlug"], "claude-code");
    assert_eq!(value["modelId"], "claude-opus-4");
}

/// A completed run points the console at the record it produced; the kind is the
/// kebab-case wire token the console switches on.
#[test]
fn a_completed_notification_carries_the_record_and_no_message() {
    let value = serde_json::to_value(Notification::completed("j1", summary(), "r1")).unwrap();
    assert_eq!(value["kind"], "run-completed");
    assert_eq!(value["outcome"], "completed");
    assert_eq!(value["jobId"], "j1");
    assert_eq!(value["recordId"], "r1");
    assert!(value.get("message").is_none());
}

/// An infrastructure failure that produced no record carries the reason and no
/// record id, so the console raises an alert with no link to follow.
#[test]
fn a_failed_notification_without_a_record_omits_the_record_id() {
    let value = serde_json::to_value(Notification::failed(
        "j1",
        summary(),
        "image pull failed",
        None,
    ))
    .unwrap();
    assert_eq!(value["kind"], "run-completed");
    assert_eq!(value["outcome"], "failed");
    assert_eq!(value["message"], "image pull failed");
    assert!(value.get("recordId").is_none());
}

/// A publish failure is its own kind — the console must not treat it as a run
/// completion and prune the in-flight list — and it is keyed by the **publish** job
/// while linking to the run that could not be released, so two failed attempts at
/// the same run are two distinct alerts rather than one overwriting the other.
#[test]
fn a_publish_failed_notification_keys_on_the_publish_job_and_links_to_the_run() {
    let value = serde_json::to_value(Notification::publish_failed(
        "p1",
        summary(),
        "r1",
        "`gh repo create` failed: HTTP 503",
    ))
    .unwrap();
    assert_eq!(value["kind"], "publish-failed");
    assert_eq!(value["outcome"], "failed");
    assert_eq!(value["jobId"], "p1");
    assert_eq!(value["recordId"], "r1");
    assert_eq!(value["message"], "`gh repo create` failed: HTTP 503");
    assert_eq!(value["testCaseSlug"], "carom");
}
