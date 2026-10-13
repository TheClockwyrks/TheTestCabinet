//! Tests for the hold publish failures put on the run queue, as the capacity
//! monitor carries and reports it. The rule that decides the hold is tested in
//! `publish_health.test.rs`; here the monitor is handed its answer.

use super::*;
use crate::relay::StreamMessage;

const GIB: u64 = 1024 * MIB;

fn hold(failing_runs: u32, error: &str) -> PublishHold {
    PublishHold {
        failing_runs,
        latest_error: Some(error.to_string()),
    }
}

/// A watching monitor whose store reads green.
fn green_monitor() -> CapacityMonitor {
    let monitor = CapacityMonitor::watching(CapacitySettings::default());
    monitor.record(StoreCapacity::writable(10 * GIB, 20 * GIB));
    monitor
}

#[tokio::test(start_paused = true)]
async fn publish_failures_hold_the_queue_of_a_healthy_store() {
    let monitor = green_monitor();
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);

    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));

    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Ok, "the store is fine");
    assert!(status.runs_on_hold);
    assert_eq!(status.hold_reason, Some(HoldReason::PublishFailing));
    assert_eq!(status.detail.as_deref(), Some("gh: HTTP 502"));
    assert_eq!(status.publish_failing_runs, Some(5));
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
    assert!(monitor.runs_on_hold());
}

#[tokio::test(start_paused = true)]
async fn the_hold_ends_the_moment_the_table_calls_for_none() {
    let monitor = green_monitor();
    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    monitor.set_publish_hold(None);

    let status = monitor.status();
    assert!(!status.runs_on_hold);
    assert_eq!(status.hold_reason, None);
    assert_eq!(status.detail, None);
    assert_eq!(status.publish_failing_runs, None);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[test]
fn publish_failures_hold_the_queue_with_no_artifact_service() {
    let monitor = CapacityMonitor::unmonitored(CapacitySettings::default());
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    assert!(
        monitor.take_change().is_none(),
        "nothing to say at the start"
    );

    monitor.set_publish_hold(Some(hold(5, "wrangler: 503")));

    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Unmonitored);
    assert!(status.runs_on_hold);
    assert_eq!(status.hold_reason, Some(HoldReason::PublishFailing));
    assert_eq!(status.detail.as_deref(), Some("wrangler: 503"));
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    let change = monitor.take_change().expect("the hold is a change");
    assert!(!change.previously_on_hold);
    assert_eq!(change.previous, ArtifactStorageState::Unmonitored);
    assert!(monitor.take_change().is_none(), "announced once");

    monitor.set_publish_hold(None);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    let change = monitor.take_change().expect("the end of it is a change");
    assert_eq!(
        change.previous_hold_reason,
        Some(HoldReason::PublishFailing)
    );
    assert!(!change.status.runs_on_hold);
}

#[tokio::test(start_paused = true)]
async fn a_fault_of_the_store_is_the_reason_reported_ahead_of_publish_failures() {
    let monitor = green_monitor();
    monitor.set_publish_hold(Some(hold(6, "gh: HTTP 502")));
    monitor.set_waiting(WaitingRuns {
        count: 1,
        reason: Some("HTTP 500".to_string()),
    });

    let status = monitor.status();
    assert_eq!(status.hold_reason, Some(HoldReason::UploadsWaiting));
    assert_eq!(status.detail.as_deref(), Some("HTTP 500"));
    assert_eq!(
        status.publish_failing_runs,
        Some(6),
        "the count is reported under any reason"
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
}

#[tokio::test(start_paused = true)]
async fn publish_failures_hold_a_store_that_is_being_proved() {
    let monitor = green_monitor();
    // An upload failed on a store that read healthy: one run at a time.
    monitor.upload_failed(Some("HTTP 500"));
    assert_eq!(monitor.status().hold_reason, Some(HoldReason::ProvingStore));
    assert_eq!(monitor.claim_gate(), ClaimGate::Trial);

    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));

    assert_eq!(
        monitor.status().hold_reason,
        Some(HoldReason::PublishFailing),
        "no run is handed out, so the reason is the one that says so"
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    monitor.set_publish_hold(None);
    assert_eq!(
        monitor.claim_gate(),
        ClaimGate::Trial,
        "the store is still to be proved"
    );
}

#[tokio::test(start_paused = true)]
async fn a_change_in_the_failing_runs_or_the_error_is_announced() {
    let monitor = green_monitor();
    monitor.take_change().expect("the first reading");

    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    let change = monitor.take_change().expect("entering the hold");
    assert_eq!(change.previous_hold_reason, None);
    assert!(monitor.take_change().is_none());

    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    assert!(monitor.take_change().is_none(), "the same answer again");

    monitor.set_publish_hold(Some(hold(6, "gh: HTTP 502")));
    assert_eq!(
        monitor
            .take_change()
            .expect("a sixth run")
            .status
            .publish_failing_runs,
        Some(6)
    );

    monitor.set_publish_hold(Some(hold(6, "wrangler: 503")));
    assert_eq!(
        monitor.take_change().expect("a new error").status.detail,
        Some("wrangler: 503".to_string())
    );
}

#[tokio::test(start_paused = true)]
async fn entering_the_hold_warns_with_the_error_and_leaving_it_is_info() {
    let monitor = green_monitor();
    monitor.take_change().expect("the first reading");

    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    let entering = monitor.take_change().unwrap();
    let (level, message) = announcement(&entering).unwrap();
    assert_eq!(level, tracing::Level::WARN);
    assert!(message.contains("publishing is failing"), "{message}");
    assert_eq!(entering.status.detail.as_deref(), Some("gh: HTTP 502"));

    monitor.set_publish_hold(None);
    let leaving = monitor.take_change().unwrap();
    let (level, message) = announcement(&leaving).unwrap();
    assert_eq!(level, tracing::Level::INFO);
    assert_eq!(message, "publish failures no longer hold new runs");
    assert!(
        !message.contains("succeeded"),
        "the hold also ends when too few failing runs are left to count"
    );
}

#[test]
fn both_ends_of_the_hold_are_logged_with_no_artifact_service() {
    let monitor = CapacityMonitor::unmonitored(CapacitySettings::default());
    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    let entering = monitor.take_change().unwrap();
    assert_eq!(
        announcement(&entering).map(|(level, _)| level),
        Some(tracing::Level::WARN)
    );

    monitor.set_publish_hold(None);
    let leaving = monitor.take_change().unwrap();
    assert_eq!(
        announcement(&leaving).map(|(level, _)| level),
        Some(tracing::Level::INFO)
    );
}

#[test]
fn the_hold_is_announced_on_the_console_stream() {
    let notifier = Notifier::new();
    let mut stream = notifier.open_stream();
    let monitor = CapacityMonitor::unmonitored(CapacitySettings::default());

    monitor.announce(&notifier);
    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    monitor.announce(&notifier);
    monitor.announce(&notifier);
    monitor.set_publish_hold(None);
    monitor.announce(&notifier);

    let mut seen = Vec::new();
    while let Ok(message) = stream.receiver.try_recv() {
        if let StreamMessage::Storage(status) = message {
            seen.push((status.hold_reason, status.publish_failing_runs));
        }
    }
    assert_eq!(
        seen,
        [(Some(HoldReason::PublishFailing), Some(5)), (None, None)]
    );
}

#[test]
fn the_reason_serializes_as_the_console_reads_it() {
    assert_eq!(
        serde_json::to_value(HoldReason::PublishFailing).unwrap(),
        "publish-failing"
    );
    let monitor = CapacityMonitor::unmonitored(CapacitySettings::default());
    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    let body = serde_json::to_value(monitor.status()).unwrap();
    assert_eq!(body["runsOnHold"], true);
    assert_eq!(body["holdReason"], "publish-failing");
    assert_eq!(body["detail"], "gh: HTTP 502");
    assert_eq!(body["publishFailingRuns"], 5);
}

#[tokio::test(start_paused = true)]
async fn a_claim_decides_on_the_hold_it_was_handed_not_on_the_monitors_copy() {
    // A status request that read the table before the fifth failure stores "no
    // hold" after the claim derived the hold. The claim must not be opened by it.
    let monitor = green_monitor();
    monitor.set_publish_hold(None);
    assert_eq!(monitor.claim_gate_with(true), ClaimGate::Hold);

    // And the other way round: a copy that still says "held" does not hold a
    // claim that has just read that publishing recovered.
    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    assert_eq!(monitor.claim_gate_with(false), ClaimGate::Open);

    let unmonitored = CapacityMonitor::unmonitored(CapacitySettings::default());
    assert_eq!(unmonitored.claim_gate_with(true), ClaimGate::Hold);
    assert_eq!(unmonitored.claim_gate_with(false), ClaimGate::Open);
}

#[tokio::test(start_paused = true)]
async fn a_claim_handed_a_publish_hold_gets_no_trial_run() {
    let monitor = green_monitor();
    monitor.upload_failed(Some("HTTP 500"));
    assert_eq!(monitor.claim_gate_with(false), ClaimGate::Trial);
    assert_eq!(monitor.claim_gate_with(true), ClaimGate::Hold);
}

#[tokio::test(start_paused = true)]
async fn a_publish_hold_that_ends_under_another_reason_is_still_said_to_have_ended() {
    let monitor = green_monitor();
    monitor.take_change().expect("the first reading");
    monitor.upload_failed(Some("HTTP 500"));
    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    monitor.take_change().expect("entering the hold");

    // The publish hold ends, and the store is still being proved.
    monitor.set_publish_hold(None);
    let leaving = monitor.take_change().unwrap();

    assert_eq!(leaving.status.hold_reason, Some(HoldReason::ProvingStore));
    assert!(publish_hold_ended_under_another(&leaving));

    // A store fault that takes the lead over a publish hold still in force is
    // not the end of that hold.
    let monitor = green_monitor();
    monitor.set_publish_hold(Some(hold(5, "gh: HTTP 502")));
    monitor.take_change().expect("entering the hold");
    monitor.record(StoreCapacity::writable(0, 20 * GIB));
    let overtaken = monitor.take_change().unwrap();
    assert_eq!(overtaken.status.hold_reason, Some(HoldReason::LowSpace));
    assert!(!publish_hold_ended_under_another(&overtaken));
}
