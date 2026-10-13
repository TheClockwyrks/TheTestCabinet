//! Tests for the conditions that hold the run queue beyond free space: a store
//! that cannot be read, a failed write check and the readings it takes to leave
//! either, runs waiting to store their trees, and the evidence a hold caused by a
//! failed upload ends on.
//!
//! Every test runs on a paused clock against values handed to the monitor, so
//! each boundary is exact.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::*;
use crate::relay::StreamMessage;

const GIB: u64 = 1024 * MIB;

fn monitor() -> CapacityMonitor {
    CapacityMonitor::watching(CapacitySettings::default())
}

/// A store with room whose write check passed.
fn green() -> StoreCapacity {
    StoreCapacity::writable(10 * GIB, 20 * GIB)
}

/// A store with room whose write check failed.
fn read_only() -> StoreCapacity {
    StoreCapacity::unwritable(10 * GIB, 20 * GIB, "Read-only file system (os error 30)")
}

fn waiting(count: u32, reason: &str) -> WaitingRuns {
    WaitingRuns {
        count,
        reason: Some(reason.to_string()),
    }
}

fn unreachable() -> CapacityReadError {
    CapacityReadError::Refused(reqwest::StatusCode::SERVICE_UNAVAILABLE)
}

// --- A store that cannot be read ----------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_failed_read_pauses_the_claim_at_once_and_changes_nothing_shown() {
    let monitor = monitor();
    monitor.record(green());
    monitor.take_change().expect("the first reading");
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);

    // Ten seconds on, the next poll fails.
    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record_failure(&unreachable());

    assert_eq!(
        monitor.claim_gate(),
        ClaimGate::Paused,
        "no run is dispatched into a store the backend cannot see"
    );
    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Ok);
    assert!(!status.runs_on_hold, "one missed poll is not announced");
    assert!(
        monitor.take_change().is_none(),
        "nothing a console shows moves"
    );
}

#[tokio::test(start_paused = true)]
async fn one_missed_poll_then_a_reading_never_shows_a_hold() {
    let monitor = monitor();
    monitor.record(green());
    monitor.take_change().expect("the first reading");

    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record_failure(&unreachable());
    // Every second until the next poll: paused throughout, never on hold.
    for _ in 0..10 {
        assert_eq!(monitor.claim_gate(), ClaimGate::Paused);
        assert!(monitor.take_change().is_none());
        tokio::time::advance(Duration::from_secs(1)).await;
    }

    monitor.record(green());
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    assert!(monitor.take_change().is_none());
}

#[tokio::test(start_paused = true)]
async fn a_read_that_keeps_failing_becomes_an_announced_hold_at_three_intervals() {
    let monitor = monitor();
    monitor.record(green());
    monitor.take_change().expect("the first reading");

    for second in 1..=60u64 {
        tokio::time::advance(Duration::from_secs(1)).await;
        if second % 10 == 0 {
            monitor.record_failure(&unreachable());
        }
        let expected = match second {
            // The poll at 10 s is the first to fail.
            0..=9 => ClaimGate::Open,
            10..=30 => ClaimGate::Paused,
            _ => ClaimGate::Hold,
        };
        assert_eq!(monitor.claim_gate(), expected, "{second} s");
        assert_eq!(monitor.status().runs_on_hold, second > 30, "{second} s");
    }
    let change = monitor.take_change().expect("the hold is announced");
    assert_eq!(change.status.state, ArtifactStorageState::Unavailable);
    assert_eq!(change.status.hold_reason, Some(HoldReason::Unreadable));
    assert_eq!(
        change.status.detail.as_deref(),
        Some("the artifact service answered HTTP 503 Service Unavailable")
    );
}

#[tokio::test(start_paused = true)]
async fn a_poll_loop_that_stalls_pauses_the_claim_on_the_clock_alone() {
    let monitor = monitor();
    monitor.record(green());

    // No poll reports at all, neither a reading nor a failure.
    tokio::time::advance(Duration::from_secs(20)).await;
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    tokio::time::advance(Duration::from_secs(1)).await;
    assert_eq!(monitor.claim_gate(), ClaimGate::Paused);
    tokio::time::advance(Duration::from_secs(10)).await;
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
}

#[tokio::test(start_paused = true)]
async fn a_store_never_read_is_held_rather_than_paused() {
    let monitor = monitor();
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
    assert_eq!(monitor.status().hold_reason, Some(HoldReason::Unreadable));
}

#[tokio::test(start_paused = true)]
async fn an_unmonitored_store_is_always_open() {
    let monitor = CapacityMonitor::unmonitored(CapacitySettings::default());
    monitor.record_failure(&unreachable());
    monitor.set_waiting(waiting(3, "HTTP 500"));
    tokio::time::advance(Duration::from_secs(3600)).await;

    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    assert_eq!(monitor.status().runs_waiting_to_store, 0);
}

// --- The write check ----------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_failed_write_check_holds_the_queue_with_its_error() {
    let monitor = monitor();
    monitor.record(green());
    monitor.take_change().expect("the first reading");

    monitor.record(read_only());

    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Unwritable);
    assert!(status.runs_on_hold);
    assert_eq!(status.hold_reason, Some(HoldReason::Unwritable));
    assert_eq!(status.writable, Some(false));
    assert_eq!(
        status.detail.as_deref(),
        Some("Read-only file system (os error 30)")
    );
    assert_eq!(
        status.free_bytes,
        Some(10 * GIB),
        "the space is still reported"
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
    assert_eq!(
        monitor.take_change().expect("a change").status.hold_reason,
        Some(HoldReason::Unwritable)
    );
}

#[tokio::test(start_paused = true)]
async fn one_passing_check_does_not_reopen_the_queue_and_three_in_a_row_do() {
    let monitor = monitor();
    monitor.record(green());
    monitor.record(read_only());
    monitor.take_change().expect("the hold");

    // Two passing readings: still held, and nothing a console shows has moved,
    // the error it was entered with included.
    for _ in 0..2 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record(green());
        let status = monitor.status();
        assert_eq!(status.state, ArtifactStorageState::Unwritable);
        assert_eq!(status.hold_reason, Some(HoldReason::Unwritable));
        assert_eq!(
            status.detail.as_deref(),
            Some("Read-only file system (os error 30)")
        );
        assert_eq!(
            status.writable,
            Some(true),
            "the reading itself is reported"
        );
        assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
        assert!(monitor.take_change().is_none(), "recovering is no change");
    }

    // The third.
    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record(green());
    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Ok);
    assert!(!status.runs_on_hold);
    assert_eq!(status.detail, None);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[tokio::test(start_paused = true)]
async fn a_store_whose_check_passes_every_other_poll_never_reopens_the_queue() {
    let monitor = monitor();
    monitor.record(green());
    monitor.take_change().expect("the first reading");

    // Ten minutes of a write check that alternates.
    for poll in 0..60 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record(if poll % 2 == 0 { read_only() } else { green() });
        assert_eq!(monitor.claim_gate(), ClaimGate::Hold, "poll {poll}");
    }
    // One announcement for the whole of it: the queue did not flap, and neither
    // did the log.
    assert!(monitor.take_change().is_some());
    assert!(monitor.take_change().is_none());
}

#[tokio::test(start_paused = true)]
async fn a_failed_poll_during_the_recovery_starts_the_count_again() {
    let monitor = monitor();
    monitor.record(green());
    monitor.record(read_only());

    for _ in 0..2 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record(green());
    }
    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record_failure(&unreachable());
    // Two more passing readings are not the three in a row.
    for _ in 0..2 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record(green());
        assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
    }
    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record(green());
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[tokio::test(start_paused = true)]
async fn an_announced_unreadable_store_takes_three_readings_to_leave() {
    let monitor = monitor();
    monitor.record(green());
    // Four failed polls: the reading ages past three intervals.
    for _ in 0..4 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record_failure(&unreachable());
    }
    assert_eq!(monitor.status().state, ArtifactStorageState::Unavailable);
    monitor.take_change().expect("the hold");

    for _ in 0..2 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record(green());
        let status = monitor.status();
        assert_eq!(status.state, ArtifactStorageState::Unavailable);
        assert_eq!(status.hold_reason, Some(HoldReason::Unreadable));
        assert_eq!(
            status.detail.as_deref(),
            Some("the artifact service answered HTTP 503 Service Unavailable"),
            "the error the outage was announced with stays while it recovers"
        );
        assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
        assert!(monitor.take_change().is_none());
    }
    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record(green());
    assert_eq!(monitor.status().state, ArtifactStorageState::Ok);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[tokio::test(start_paused = true)]
async fn a_store_that_answers_one_poll_in_three_stays_held() {
    let monitor = monitor();
    monitor.record(green());
    for _ in 0..4 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record_failure(&unreachable());
    }
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    // Fail, fail, answer, for ten minutes: never three good readings in a row,
    // and never an open claim for the dispatcher to fill its lane through.
    for poll in 0..60 {
        tokio::time::advance(Duration::from_secs(10)).await;
        if poll % 3 == 2 {
            monitor.record(green());
        } else {
            monitor.record_failure(&unreachable());
        }
        assert_eq!(monitor.claim_gate(), ClaimGate::Hold, "poll {poll}");
    }
}

#[tokio::test(start_paused = true)]
async fn the_first_reading_of_a_store_never_read_opens_the_queue_at_once() {
    // A backend that has just started holds nothing against the store: one
    // reading decides, as it would have before the store was ever in doubt.
    let monitor = monitor();
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
    tokio::time::advance(Duration::from_secs(3600)).await;

    monitor.record(green());

    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    assert_eq!(monitor.status().state, ArtifactStorageState::Ok);
}

#[tokio::test(start_paused = true)]
async fn a_full_volume_reads_blocked_though_its_write_check_fails_too() {
    let monitor = monitor();
    monitor.record(StoreCapacity::unwritable(
        GIB,
        20 * GIB,
        "No space left on device (os error 28)",
    ));

    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Blocked);
    assert_eq!(status.hold_reason, Some(HoldReason::LowSpace));
}

#[tokio::test(start_paused = true)]
async fn a_low_store_that_cannot_be_written_is_unwritable() {
    let monitor = monitor();
    monitor.record(StoreCapacity::unwritable(5 * GIB / 2, 20 * GIB, "EIO"));
    assert_eq!(monitor.status().state, ArtifactStorageState::Unwritable);
    assert!(monitor.runs_on_hold());

    for _ in 0..3 {
        monitor.record(StoreCapacity::writable(5 * GIB / 2, 20 * GIB));
    }
    assert_eq!(monitor.status().state, ArtifactStorageState::Low);
    assert!(!monitor.runs_on_hold());
}

#[test]
fn a_reading_without_a_write_check_reads_as_one_that_passed() {
    // An artifact service that predates the check.
    let old: StoreCapacity =
        serde_json::from_str(r#"{"freeBytes": 10, "totalBytes": 20}"#).unwrap();
    assert_eq!(old, StoreCapacity::writable(10, 20));

    let failed: StoreCapacity = serde_json::from_str(
        r#"{"freeBytes": 10, "totalBytes": 20, "writable": false, "writeError": "EROFS"}"#,
    )
    .unwrap();
    assert_eq!(failed, StoreCapacity::unwritable(10, 20, "EROFS"));
}

// --- Runs waiting to store ----------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_run_waiting_to_store_holds_the_queue_on_a_store_that_reads_green() {
    let monitor = monitor();
    monitor.record(green());
    monitor.take_change().expect("the first reading");

    monitor.set_waiting(waiting(
        1,
        "the artifact service rejected the upload: HTTP 500",
    ));

    let status = monitor.status();
    assert_eq!(
        status.state,
        ArtifactStorageState::Ok,
        "the store itself reads fine"
    );
    assert!(status.runs_on_hold);
    assert_eq!(status.hold_reason, Some(HoldReason::UploadsWaiting));
    assert_eq!(status.runs_waiting_to_store, 1);
    assert_eq!(
        status.detail.as_deref(),
        Some("the artifact service rejected the upload: HTTP 500")
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    // Readings that pass while it waits do not lift the hold.
    monitor.record(green());
    assert!(monitor.runs_on_hold());
}

#[tokio::test(start_paused = true)]
async fn a_change_in_the_number_waiting_is_announced() {
    let monitor = monitor();
    monitor.record(green());
    monitor.take_change().expect("the first reading");

    monitor.set_waiting(waiting(1, "HTTP 500"));
    let change = monitor.take_change().expect("a hold is a change");
    assert!(!change.previously_on_hold);
    assert_eq!(change.status.runs_waiting_to_store, 1);

    monitor.set_waiting(waiting(1, "HTTP 500"));
    assert!(
        monitor.take_change().is_none(),
        "the same count is no change"
    );

    monitor.set_waiting(waiting(2, "HTTP 500"));
    assert_eq!(
        monitor
            .take_change()
            .expect("a second waiter")
            .status
            .runs_waiting_to_store,
        2
    );
}

#[tokio::test(start_paused = true)]
async fn a_change_in_the_reason_alone_is_announced_once() {
    // The store's own fault was fixed and the uploads now fail for another
    // reason. An operator reading the banner has to see the new one.
    let monitor = monitor();
    monitor.record(green());
    monitor.set_waiting(waiting(1, "HTTP 500: no space left"));
    monitor.take_change().expect("the hold");

    monitor.set_waiting(waiting(1, "HTTP 401: invalid job token"));

    let change = monitor.take_change().expect("a new reason is a change");
    assert_eq!(change.status.hold_reason, Some(HoldReason::UploadsWaiting));
    assert_eq!(
        change.status.detail.as_deref(),
        Some("HTTP 401: invalid job token")
    );
    assert!(change.previously_on_hold);
    monitor.set_waiting(waiting(1, "HTTP 401: invalid job token"));
    assert!(monitor.take_change().is_none());
}

// --- Evidence from uploads ----------------------------------------------------

#[tokio::test(start_paused = true)]
async fn an_upload_that_failed_on_a_store_reading_green_is_not_ended_by_a_passing_check() {
    // The write check passed the whole time the uploads were failing, so it cannot
    // be what says the fault is gone.
    let monitor = monitor();
    monitor.record(green());
    monitor.upload_failed(Some("HTTP 502: verifying the job token with the backend"));
    monitor.set_waiting(waiting(
        2,
        "HTTP 502: verifying the job token with the backend",
    ));
    assert_eq!(
        monitor.status().hold_reason,
        Some(HoldReason::UploadsWaiting)
    );

    // Both waiters end without a tree landing: they gave up, were canceled, or
    // their drivers died.
    monitor.set_waiting(WaitingRuns::default());

    let status = monitor.status();
    assert!(status.runs_on_hold);
    assert_eq!(status.hold_reason, Some(HoldReason::ProvingStore));
    assert_eq!(status.runs_waiting_to_store, 0);
    assert_eq!(
        status.detail.as_deref(),
        Some("HTTP 502: verifying the job token with the backend"),
        "the reason the last failure gave is kept while the hold is"
    );
    assert_eq!(
        monitor.claim_gate(),
        ClaimGate::Trial,
        "one run at a time, not the whole lane"
    );

    // An hour of passing readings changes nothing.
    for _ in 0..360 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record(green());
    }
    assert_eq!(monitor.status().hold_reason, Some(HoldReason::ProvingStore));
    assert_eq!(monitor.claim_gate(), ClaimGate::Trial);

    // A tree lands: the store took a whole upload.
    monitor.tree_landed();
    let status = monitor.status();
    assert!(!status.runs_on_hold);
    assert_eq!(status.detail, None);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[tokio::test(start_paused = true)]
async fn an_upload_that_failed_on_a_store_reading_faulty_is_ended_by_a_passing_reading() {
    // The check saw this fault, so the check passing again is the repair.
    let monitor = monitor();
    monitor.record(green());
    monitor.record(read_only());
    monitor.upload_failed(Some("HTTP 500: Read-only file system"));
    monitor.set_waiting(waiting(1, "HTTP 500: Read-only file system"));
    assert_eq!(monitor.status().hold_reason, Some(HoldReason::Unwritable));

    // The volume is repaired while the run is still waiting. Three readings later
    // the store reads green, and the run still holds the queue.
    for _ in 0..3 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record(green());
    }
    assert_eq!(
        monitor.status().hold_reason,
        Some(HoldReason::UploadsWaiting)
    );

    // The operator cancels the run before its next attempt. Nothing landed, and
    // the queue waits for one more reading taken with nobody waiting.
    monitor.set_waiting(WaitingRuns::default());
    let status = monitor.status();
    assert_eq!(status.hold_reason, Some(HoldReason::WriteCheckPending));
    assert_eq!(
        status.detail.as_deref(),
        Some("HTTP 500: Read-only file system")
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record(green());
    assert!(!monitor.runs_on_hold());
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[tokio::test(start_paused = true)]
async fn a_fault_the_check_saw_does_not_end_on_the_last_waiter_leaving() {
    let monitor = monitor();
    monitor.record(green());
    monitor.record(read_only());
    monitor.set_waiting(waiting(2, "HTTP 500"));

    monitor.set_waiting(WaitingRuns::default());

    // Still unwritable: the hold is the store's own.
    assert_eq!(monitor.status().hold_reason, Some(HoldReason::Unwritable));
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
}

#[tokio::test(start_paused = true)]
async fn a_later_failure_on_a_green_store_makes_a_seen_fault_a_blind_one() {
    // The read-only volume was repaired, and the upload then failed again while
    // the store read green: whatever fails it now, the check cannot see.
    let monitor = monitor();
    monitor.record(green());
    monitor.record(read_only());
    monitor.upload_failed(Some("HTTP 500: Read-only file system"));
    for _ in 0..3 {
        tokio::time::advance(Duration::from_secs(10)).await;
        monitor.record(green());
    }

    monitor.upload_failed(Some("HTTP 500: quota exceeded"));

    assert_eq!(monitor.status().hold_reason, Some(HoldReason::ProvingStore));
    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record(green());
    assert_eq!(monitor.status().hold_reason, Some(HoldReason::ProvingStore));
}

#[tokio::test(start_paused = true)]
async fn a_failed_upload_with_no_run_waiting_still_counts() {
    // The upload of a canceled run, or of a run already reported lost: no job is
    // in `storing`, and the store is no less broken for it.
    let monitor = monitor();
    monitor.record(green());
    monitor.take_change().expect("the first reading");

    monitor.upload_failed(Some("HTTP 500"));

    let change = monitor.take_change().expect("a hold");
    assert_eq!(change.status.hold_reason, Some(HoldReason::ProvingStore));
    assert_eq!(change.status.runs_waiting_to_store, 0);
    assert_eq!(change.status.detail.as_deref(), Some("HTTP 500"));
}

#[tokio::test(start_paused = true)]
async fn a_tree_landing_does_not_release_the_runs_still_waiting() {
    let monitor = monitor();
    monitor.record(green());
    monitor.upload_failed(Some("HTTP 500"));
    monitor.set_waiting(waiting(2, "HTTP 500"));

    // One of the two lands.
    monitor.tree_landed();
    monitor.set_waiting(waiting(1, "HTTP 500"));

    assert_eq!(
        monitor.status().hold_reason,
        Some(HoldReason::UploadsWaiting)
    );
    // And if the other then leaves without landing, its failure is still on
    // record.
    monitor.set_waiting(WaitingRuns::default());
    assert!(monitor.runs_on_hold());
}

#[tokio::test(start_paused = true)]
async fn a_run_found_waiting_with_no_failure_on_record_is_recorded_as_one() {
    // What a backend that restarted during a wait finds in its job table.
    let monitor = monitor();
    monitor.record(green());

    monitor.set_waiting(waiting(1, "HTTP 500"));
    monitor.set_waiting(WaitingRuns::default());

    assert_eq!(monitor.status().hold_reason, Some(HoldReason::ProvingStore));
}

#[tokio::test(start_paused = true)]
async fn the_store_is_proved_only_while_it_can_be_read() {
    let monitor = monitor();
    monitor.record(green());
    monitor.upload_failed(Some("HTTP 500"));
    assert_eq!(monitor.claim_gate(), ClaimGate::Trial);

    // A missed poll pauses the trial like any other claim.
    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record_failure(&unreachable());
    assert_eq!(monitor.claim_gate(), ClaimGate::Paused);

    tokio::time::advance(Duration::from_secs(10)).await;
    monitor.record(green());
    assert_eq!(monitor.claim_gate(), ClaimGate::Trial);

    // And a store that goes unwritable holds it outright.
    monitor.record(read_only());
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
    assert_eq!(monitor.status().hold_reason, Some(HoldReason::Unwritable));
}

#[tokio::test(start_paused = true)]
async fn a_backend_that_starts_after_a_lost_tree_proves_the_store_before_it_opens_the_queue() {
    let monitor = monitor();
    monitor.restore_unproven("the most recently finished run's tree was not stored");
    // Never read yet: that comes first.
    assert_eq!(monitor.status().hold_reason, Some(HoldReason::Unreadable));

    monitor.record(green());

    let status = monitor.status();
    assert_eq!(status.hold_reason, Some(HoldReason::ProvingStore));
    assert_eq!(
        status.detail.as_deref(),
        Some("the most recently finished run's tree was not stored")
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Trial);
    monitor.tree_landed();
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[tokio::test(start_paused = true)]
async fn evidence_from_uploads_means_nothing_to_an_unmonitored_store() {
    let monitor = CapacityMonitor::unmonitored(CapacitySettings::default());
    monitor.upload_failed(Some("HTTP 500"));
    monitor.restore_unproven("lost");
    monitor.tree_landed();

    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    assert!(!monitor.runs_on_hold());
}

// --- What is logged -----------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn the_state_a_backend_starts_in_is_announced() {
    // A backend that starts beside a store it cannot read holds the queue from
    // its first moment, and has to say so.
    let monitor = monitor();
    monitor.record_failure(&CapacityReadError::Refused(
        reqwest::StatusCode::UNAUTHORIZED,
    ));

    let change = monitor
        .take_change()
        .expect("the starting state is a change");

    assert_eq!(change.status.state, ArtifactStorageState::Unavailable);
    assert_eq!(change.status.hold_reason, Some(HoldReason::Unreadable));
    assert_eq!(
        change.status.detail.as_deref(),
        Some("the artifact service answered HTTP 401 Unauthorized")
    );
    let (level, _) = announcement(&change).expect("a line");
    assert_eq!(level, tracing::Level::ERROR);
    assert!(monitor.take_change().is_none(), "and only once");
}

#[tokio::test(start_paused = true)]
async fn a_backend_that_starts_beside_a_healthy_store_says_that_too() {
    let monitor = monitor();
    monitor.record(green());

    let change = monitor.take_change().expect("the starting state");

    assert!(
        change.previously_on_hold,
        "nothing was dispatched before it"
    );
    assert!(!change.status.runs_on_hold);
    assert_eq!(
        announcement(&change).map(|(level, _)| level),
        Some(tracing::Level::INFO)
    );
}

#[tokio::test(start_paused = true)]
async fn each_hold_that_comes_from_uploads_is_entered_at_warn() {
    let monitor = monitor();
    monitor.record(green());
    monitor.take_change().expect("the first reading");

    monitor.set_waiting(waiting(1, "HTTP 500"));
    let change = monitor.take_change().expect("waiting");
    assert_eq!(change.status.hold_reason, Some(HoldReason::UploadsWaiting));
    assert_eq!(
        announcement(&change).map(|(level, _)| level),
        Some(tracing::Level::WARN)
    );

    monitor.set_waiting(WaitingRuns::default());
    let change = monitor.take_change().expect("proving");
    assert_eq!(change.status.hold_reason, Some(HoldReason::ProvingStore));
    let (level, message) = announcement(&change).expect("a line");
    assert_eq!(level, tracing::Level::WARN);
    assert!(message.contains("one run at a time"), "{message}");

    monitor.tree_landed();
    let change = monitor.take_change().expect("cleared");
    assert!(change.previously_on_hold);
    assert_eq!(
        announcement(&change).map(|(level, _)| level),
        Some(tracing::Level::INFO)
    );
}

// --- The loop -----------------------------------------------------------------

/// Sources scripted per poll: the reading each poll takes (`None` is a failed
/// read) and the number of runs waiting when it does. Past the script's end the
/// store is green and nobody waits.
#[allow(clippy::type_complexity)]
fn scripted(
    polls: impl IntoIterator<Item = (Option<StoreCapacity>, u32)>,
) -> (
    impl FnMut() -> std::future::Ready<Result<StoreCapacity, CapacityReadError>>,
    impl FnMut() -> std::future::Ready<Option<WaitingRuns>>,
) {
    let (readings, counts): (VecDeque<_>, VecDeque<_>) = polls.into_iter().unzip();
    let readings = Arc::new(Mutex::new(readings));
    let counts = Arc::new(Mutex::new(counts));
    (
        move || {
            let next = readings
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Some(green()));
            std::future::ready(next.ok_or_else(unreachable))
        },
        move || {
            let count = counts.lock().unwrap().pop_front().unwrap_or(0);
            std::future::ready(Some(if count == 0 {
                WaitingRuns::default()
            } else {
                waiting(count, "HTTP 500")
            }))
        },
    )
}

/// Every storage status announced so far on `receiver`, as its hold reason and
/// its number of waiting runs.
fn announced(
    receiver: &mut tokio::sync::broadcast::Receiver<StreamMessage>,
) -> Vec<(Option<HoldReason>, u32)> {
    let mut seen = Vec::new();
    while let Ok(message) = receiver.try_recv() {
        if let StreamMessage::Storage(status) = message {
            seen.push((status.hold_reason, status.runs_waiting_to_store));
        }
    }
    seen
}

#[tokio::test(start_paused = true)]
async fn the_loop_holds_through_a_fault_it_saw_and_resumes_when_the_store_reads_green() {
    let notifier = Notifier::new();
    let mut stream = notifier.open_stream();
    let monitor = monitor();
    // One poll every 10 s: green; the volume goes read-only; a run starts waiting
    // on it; a second; both end while the check still fails; then the check
    // passes three times running.
    let (read, waiting) = scripted([
        (Some(green()), 0),
        (Some(read_only()), 0),
        (Some(read_only()), 1),
        (Some(read_only()), 2),
        (Some(read_only()), 0),
        (Some(green()), 0),
        (Some(green()), 0),
        (Some(green()), 0),
    ]);
    let task = tokio::spawn(run_capacity_monitor(
        monitor.clone(),
        notifier.clone(),
        read,
        waiting,
    ));

    tokio::time::sleep(Duration::from_secs(65)).await;
    assert_eq!(
        announced(&mut stream.receiver),
        [
            (None, 0),
            (Some(HoldReason::Unwritable), 0),
            (Some(HoldReason::Unwritable), 1),
            (Some(HoldReason::Unwritable), 2),
            (Some(HoldReason::Unwritable), 0),
        ],
        "two passing readings in, the queue is still held"
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    tokio::time::sleep(Duration::from_secs(10)).await;
    assert_eq!(announced(&mut stream.receiver), [(None, 0)]);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    task.abort();
}

#[tokio::test(start_paused = true)]
async fn the_loop_does_not_resume_on_the_last_waiter_leaving_a_store_that_read_green() {
    let notifier = Notifier::new();
    let mut stream = notifier.open_stream();
    let monitor = monitor();
    // The store reads green throughout. A run waits, then is gone.
    let (read, waiting) = scripted([(Some(green()), 0), (Some(green()), 1), (Some(green()), 0)]);
    let task = tokio::spawn(run_capacity_monitor(
        monitor.clone(),
        notifier.clone(),
        read,
        waiting,
    ));

    // Ten minutes of green readings after the waiter left.
    tokio::time::sleep(Duration::from_secs(625)).await;
    assert_eq!(
        announced(&mut stream.receiver),
        [
            (None, 0),
            (Some(HoldReason::UploadsWaiting), 1),
            (Some(HoldReason::ProvingStore), 0),
        ]
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Trial);

    // The run the trial let through stores its tree.
    monitor.tree_landed();
    monitor.announce(&notifier);
    assert_eq!(announced(&mut stream.receiver), [(None, 0)]);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    task.abort();
}

#[tokio::test(start_paused = true)]
async fn a_brief_outage_dispatches_nothing_and_announces_nothing() {
    // An artifact pod that restarts: two failed polls between good readings.
    let notifier = Notifier::new();
    let mut stream = notifier.open_stream();
    let monitor = monitor();
    let (read, waiting) = scripted([(Some(green()), 0), (None, 0), (None, 0), (Some(green()), 0)]);
    let task = tokio::spawn(run_capacity_monitor(
        monitor.clone(),
        notifier.clone(),
        read,
        waiting,
    ));

    // The polls land at 0, 10, 20 and 30 s. Sampled half a second after each
    // second so no sample coincides with a poll.
    tokio::time::sleep(Duration::from_millis(500)).await;
    for second in 0..40u64 {
        let expected = match second {
            10..=29 => ClaimGate::Paused,
            _ => ClaimGate::Open,
        };
        assert_eq!(monitor.claim_gate(), expected, "{second}.5 s");
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    assert_eq!(announced(&mut stream.receiver), [(None, 0)]);
    task.abort();
}
