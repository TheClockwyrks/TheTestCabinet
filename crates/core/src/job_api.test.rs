use super::*;

fn summary() -> JobSummary {
    JobSummary {
        test_case_slug: "carom".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness_slug: "claude-code".to_string(),
        model_id: "claude-opus-4".to_string(),
        gg_preset: None,
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

/// The launch shape used by the engine tests below. Every optional dimension is
/// left unset, which is what a launcher that predates a given dimension sends.
fn launch_body() -> LaunchBody {
    LaunchBody {
        test_case: "carom".to_string(),
        version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness: HarnessSlug::Claude,
        model: "anthropic/claude-opus-4".to_string(),
        orchestrator: None,
        engine: None,
        max_runtime_seconds: None,
        auth_mode: None,
        retry_count: None,
        gg_capability_set: None,
        gg_model_windows: Default::default(),
        gg_model_modalities: Default::default(),
    }
}

/// A launch that names no engine is the `none` default. The key must be absent
/// from the wire body rather than written as null, because the backend stores the
/// body verbatim and every launcher written before engines existed must keep
/// producing — and keep matching — exactly the JSON it produced before.
#[test]
fn a_launch_without_an_engine_omits_the_key_entirely() {
    let value = serde_json::to_value(launch_body()).expect("serialize");
    assert!(value.get("engine").is_none());

    let parsed: LaunchBody = serde_json::from_value(value).expect("deserialize");
    assert!(parsed.engine.is_none());
}

/// …and a body that never carried the key at all still deserializes, since a job
/// enqueued before engines existed is replayed to the driver from its stored body.
#[test]
fn a_stored_launch_body_predating_engines_deserializes() {
    let parsed: LaunchBody = serde_json::from_str(
        r#"{"testCase":"carom","version":"v1.0.0","variant":"base",
            "harness":"claude","model":"anthropic/claude-opus-4"}"#,
    )
    .expect("deserialize");

    assert!(parsed.engine.is_none());
}

/// A selected engine travels as its bare slug; resolution against the catalogue
/// and against the case's supported set happens when the run executes.
#[test]
fn a_selected_engine_round_trips_as_its_slug() {
    let mut body = launch_body();
    body.engine = Some("simple-2d".to_string());

    let value = serde_json::to_value(&body).expect("serialize");
    assert_eq!(value["engine"], "simple-2d");

    let parsed: LaunchBody = serde_json::from_value(value).expect("deserialize");
    assert_eq!(parsed.engine.as_deref(), Some("simple-2d"));
}
