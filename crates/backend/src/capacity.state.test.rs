//! Tests for the watch on the backend's own state volume: its two thresholds and
//! their hysteresis, the hold it places on new runs, the reading that fails and
//! holds nothing, and what a console and the log are told.
//!
//! Every reading is handed to the monitor, so no test depends on the free space
//! of the machine it runs on.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use super::*;
use crate::publish_health::PublishHold;
use crate::store::StateVolume;

const GIB: u64 = 1024 * MIB;

/// The settings the backend ships with: for the state volume, warn under 3 GiB
/// and stop under 1.5 GiB, with the artifact store's 256 MiB recovery margin.
fn settings() -> CapacitySettings {
    CapacitySettings::default()
}

/// A reading of a 16 GiB state volume with `free_bytes` free.
fn volume(free_bytes: u64) -> Result<StateVolume, String> {
    Ok(StateVolume {
        free_bytes,
        total_bytes: 16 * GIB,
    })
}

/// A monitor of an artifact store that reads green, so whatever holds the queue
/// in a test is the state volume.
fn monitor() -> CapacityMonitor {
    monitor_with(settings())
}

fn monitor_with(settings: CapacitySettings) -> CapacityMonitor {
    let monitor = CapacityMonitor::watching(settings);
    monitor.record(StoreCapacity::writable(10 * GIB, 20 * GIB));
    monitor
}

fn level(monitor: &CapacityMonitor) -> Option<StateVolumeLevel> {
    monitor.status().state_volume.map(|volume| volume.level)
}

// --- The thresholds -----------------------------------------------------------

#[test]
fn the_defaults_warn_under_three_gibibytes_and_stop_under_one_and_a_half() {
    let settings = settings();
    assert_eq!(settings.state_warn_bytes, 3072 * MIB);
    assert_eq!(settings.state_stop_bytes, 1536 * MIB);
    assert!(settings.watches_state_volume());
}

#[test]
fn a_first_reading_is_classified_by_the_two_thresholds() {
    let settings = settings();
    for (free, expected) in [
        (10 * GIB, Level::Ok),
        // A threshold is "under", so free space exactly at it has not crossed.
        (3072 * MIB, Level::Ok),
        (3072 * MIB - 1, Level::Low),
        (1536 * MIB, Level::Low),
        (1536 * MIB - 1, Level::Blocked),
        (0, Level::Blocked),
    ] {
        assert_eq!(
            classify_state_volume(Level::Ok, free, &settings),
            expected,
            "{free} bytes free"
        );
    }
}

#[test]
fn leaving_a_level_takes_the_recovery_margin_above_its_threshold() {
    let settings = settings();
    let margin = settings.recover_bytes;
    // A blocked volume stays blocked until free space clears the stop threshold
    // by the margin.
    assert_eq!(
        classify_state_volume(Level::Blocked, 1536 * MIB, &settings),
        Level::Blocked
    );
    assert_eq!(
        classify_state_volume(Level::Blocked, 1536 * MIB + margin - 1, &settings),
        Level::Blocked
    );
    assert_eq!(
        classify_state_volume(Level::Blocked, 1536 * MIB + margin, &settings),
        Level::Low
    );
    // And a low one stays low until it clears the warn threshold by it.
    assert_eq!(
        classify_state_volume(Level::Low, 3072 * MIB + margin - 1, &settings),
        Level::Low
    );
    assert_eq!(
        classify_state_volume(Level::Low, 3072 * MIB + margin, &settings),
        Level::Ok
    );
    // A blocked volume that gains all the room at once is ok at once.
    assert_eq!(
        classify_state_volume(Level::Blocked, 10 * GIB, &settings),
        Level::Ok
    );
}

#[test]
fn a_threshold_of_zero_is_turned_off() {
    // No hold: the volume warns and never blocks.
    let no_hold = CapacitySettings {
        state_stop_bytes: 0,
        ..settings()
    };
    assert_eq!(classify_state_volume(Level::Ok, 0, &no_hold), Level::Low);
    assert_eq!(
        classify_state_volume(Level::Ok, 4 * GIB, &no_hold),
        Level::Ok
    );
    // No warning: the volume blocks and never reads low.
    let no_warning = CapacitySettings {
        state_warn_bytes: 0,
        ..settings()
    };
    assert_eq!(
        classify_state_volume(Level::Ok, 2 * GIB, &no_warning),
        Level::Ok
    );
    assert_eq!(
        classify_state_volume(Level::Ok, GIB, &no_warning),
        Level::Blocked
    );
    // Leaving the hold with the warning off lands on ok, past the margin.
    assert_eq!(
        classify_state_volume(Level::Blocked, 1536 * MIB + 1, &no_warning),
        Level::Blocked
    );
    assert_eq!(
        classify_state_volume(Level::Blocked, 2 * GIB, &no_warning),
        Level::Ok
    );
    // Both off: nothing is classified as anything but ok, and nothing is read.
    let off = CapacitySettings {
        state_warn_bytes: 0,
        state_stop_bytes: 0,
        ..settings()
    };
    assert_eq!(classify_state_volume(Level::Ok, 0, &off), Level::Ok);
    assert!(!off.watches_state_volume());
}

// --- The hold -----------------------------------------------------------------

#[tokio::test]
async fn a_volume_under_its_stop_threshold_holds_new_runs() {
    let monitor = monitor();
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    assert_eq!(monitor.status().state_volume, None, "not read yet");

    monitor.record_state_volume(volume(2 * GIB));
    assert_eq!(level(&monitor), Some(StateVolumeLevel::Low));
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    assert!(!monitor.runs_on_hold());

    monitor.record_state_volume(volume(GIB));
    let status = monitor.status();
    assert_eq!(level(&monitor), Some(StateVolumeLevel::Blocked));
    assert!(status.runs_on_hold);
    assert_eq!(status.hold_reason, Some(HoldReason::StateLowSpace));
    // The artifact store's own state is as it read: the hold is not its.
    assert_eq!(status.state, ArtifactStorageState::Ok);
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
    assert!(monitor.runs_on_hold());
}

#[tokio::test]
async fn the_hold_ends_once_the_volume_clears_the_threshold_by_the_margin() {
    let monitor = monitor();
    monitor.record_state_volume(volume(GIB));
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    // Back over the threshold, inside the margin: still held.
    monitor.record_state_volume(volume(1536 * MIB + 100 * MIB));
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
    assert_eq!(
        monitor.status().hold_reason,
        Some(HoldReason::StateLowSpace)
    );

    monitor.record_state_volume(volume(1536 * MIB + 256 * MIB));
    assert_eq!(level(&monitor), Some(StateVolumeLevel::Low));
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    let status = monitor.status();
    assert!(!status.runs_on_hold);
    assert_eq!(status.hold_reason, None);
}

#[tokio::test]
async fn a_reading_that_fails_holds_nothing() {
    let monitor = monitor();
    monitor.record_state_volume(Err("Input/output error (os error 5)".to_string()));

    let status = monitor.status();
    let volume_status = status.state_volume.clone().unwrap();
    assert_eq!(volume_status.level, StateVolumeLevel::Unreadable);
    assert_eq!(
        volume_status.error.as_deref(),
        Some("Input/output error (os error 5)")
    );
    assert_eq!(volume_status.free_bytes, None);
    assert!(!status.runs_on_hold);
    assert_eq!(status.hold_reason, None);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[tokio::test]
async fn a_reading_that_fails_on_a_held_volume_releases_the_hold_and_keeps_the_level() {
    let monitor = monitor();
    monitor.record_state_volume(volume(GIB));
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    // The backend cannot say the volume is full, so it holds nothing on it.
    monitor.record_state_volume(Err("the reading timed out".to_string()));
    assert_eq!(level(&monitor), Some(StateVolumeLevel::Unreadable));
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
    // The last figures that were read are still reported beside the error.
    let reported = monitor.status().state_volume.unwrap();
    assert_eq!(reported.free_bytes, Some(GIB));
    assert_eq!(reported.total_bytes, Some(16 * GIB));

    // The next reading is judged from where the volume was: inside the margin
    // above the stop threshold it is blocked again, as it would have stayed.
    monitor.record_state_volume(volume(1536 * MIB + 100 * MIB));
    assert_eq!(level(&monitor), Some(StateVolumeLevel::Blocked));
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
}

#[tokio::test]
async fn the_store_s_own_reasons_lead_and_the_state_volume_leads_a_publish_hold() {
    let monitor = monitor();
    monitor.record_state_volume(volume(GIB));

    // Publishing failing as well: the volume is the reason shown, since freeing
    // it is what a publish needs too.
    monitor.set_publish_hold(Some(PublishHold {
        failing_runs: 5,
        latest_error: Some("the bucket refused the upload".to_string()),
    }));
    assert_eq!(
        monitor.status().hold_reason,
        Some(HoldReason::StateLowSpace)
    );
    monitor.set_publish_hold(None);

    // The artifact store full as well: its reason is the one shown, and the
    // state volume is still reported as blocked beside it.
    monitor.record(StoreCapacity::writable(GIB, 20 * GIB));
    let status = monitor.status();
    assert_eq!(status.hold_reason, Some(HoldReason::LowSpace));
    assert_eq!(status.state, ArtifactStorageState::Blocked);
    assert_eq!(
        status.state_volume.unwrap().level,
        StateVolumeLevel::Blocked
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    // The artifact store recovers and the state volume still holds.
    monitor.record(StoreCapacity::writable(10 * GIB, 20 * GIB));
    assert_eq!(
        monitor.status().hold_reason,
        Some(HoldReason::StateLowSpace)
    );
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);
}

#[tokio::test]
async fn an_unmonitored_backend_reads_no_state_volume() {
    let monitor = CapacityMonitor::unmonitored(settings());
    monitor.poll_state_volume().await;
    assert_eq!(monitor.status().state_volume, None);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

// --- The poll -----------------------------------------------------------------

#[tokio::test]
async fn the_poll_reads_the_volume_through_the_reader_it_was_given() {
    let free = Arc::new(AtomicU64::new(10 * GIB));
    let reader = Arc::clone(&free);
    let monitor = monitor().with_state_volume(move || match reader.load(Ordering::SeqCst) {
        u64::MAX => Err(std::io::Error::other("the volume is gone")),
        free_bytes => Ok(StateVolume {
            free_bytes,
            total_bytes: 16 * GIB,
        }),
    });

    monitor.poll_state_volume().await;
    assert_eq!(level(&monitor), Some(StateVolumeLevel::Ok));

    free.store(GIB, Ordering::SeqCst);
    monitor.poll_state_volume().await;
    assert_eq!(level(&monitor), Some(StateVolumeLevel::Blocked));
    assert_eq!(monitor.claim_gate(), ClaimGate::Hold);

    free.store(u64::MAX, Ordering::SeqCst);
    monitor.poll_state_volume().await;
    let reported = monitor.status().state_volume.unwrap();
    assert_eq!(reported.level, StateVolumeLevel::Unreadable);
    assert_eq!(reported.error.as_deref(), Some("the volume is gone"));
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[tokio::test]
async fn a_monitor_with_both_thresholds_off_never_reads_the_volume() {
    let off = CapacitySettings {
        state_warn_bytes: 0,
        state_stop_bytes: 0,
        ..settings()
    };
    let monitor = monitor_with(off)
        .with_state_volume(|| panic!("a volume nothing is decided on is not read"));

    monitor.poll_state_volume().await;

    assert_eq!(monitor.status().state_volume, None);
    assert_eq!(monitor.claim_gate(), ClaimGate::Open);
}

#[tokio::test]
async fn the_store_s_own_volume_reads_as_a_volume_with_a_size() {
    let dir = tempfile::tempdir().unwrap();
    let store = crate::store::DefinitionStore::open(dir.path().join("store")).unwrap();

    let volume = store.state_volume().unwrap();

    assert!(volume.total_bytes > 0);
    assert!(volume.free_bytes <= volume.total_bytes);
}

// --- What a console is told ---------------------------------------------------

#[tokio::test]
async fn the_status_reports_the_state_volume_beside_the_artifact_store() {
    let monitor = monitor();
    // Unread, the status carries no state volume at all.
    let unread = serde_json::to_value(monitor.status()).unwrap();
    assert_eq!(unread.get("stateVolume"), None);

    monitor.record_state_volume(volume(GIB));
    let status = serde_json::to_value(monitor.status()).unwrap();
    assert_eq!(status["state"], "ok");
    assert_eq!(status["runsOnHold"], true);
    assert_eq!(status["holdReason"], "state-low-space");
    assert_eq!(
        status["stateVolume"],
        serde_json::json!({
            "level": "blocked",
            "freeBytes": GIB,
            "totalBytes": 16 * GIB,
            "warnBytes": 3072 * MIB,
            "stopBytes": 1536 * MIB,
        })
    );

    monitor.record_state_volume(Err("Input/output error (os error 5)".to_string()));
    let status = serde_json::to_value(monitor.status()).unwrap();
    assert_eq!(status["runsOnHold"], false);
    assert_eq!(status.get("holdReason"), None);
    assert_eq!(status["stateVolume"]["level"], "unreadable");
    assert_eq!(
        status["stateVolume"]["error"],
        "Input/output error (os error 5)"
    );
}

#[tokio::test]
async fn each_change_of_the_volume_s_level_is_reported_once() {
    let monitor = monitor();
    // The store's first reading.
    assert!(monitor.take_change().is_some());
    assert!(monitor.take_change().is_none());

    // A first reading of a volume with room is a change, with nothing to say.
    monitor.record_state_volume(volume(10 * GIB));
    let change = monitor.take_change().unwrap();
    assert!(change.state_volume_only);
    assert_eq!(change.previous_state_volume, None);
    assert_eq!(state_volume_announcement(&change), None);

    monitor.record_state_volume(volume(9 * GIB));
    assert!(monitor.take_change().is_none(), "the level did not change");

    monitor.record_state_volume(volume(2 * GIB));
    let change = monitor.take_change().unwrap();
    assert!(change.state_volume_only);
    assert_eq!(change.previous_state_volume, Some(StateVolumeLevel::Ok));
    assert_eq!(
        state_volume_announcement(&change).map(|(level, _)| level),
        Some(tracing::Level::WARN)
    );

    // Entering the hold is the hold's own line, at `error`, and no second line.
    monitor.record_state_volume(volume(GIB));
    let change = monitor.take_change().unwrap();
    assert!(!change.state_volume_only);
    assert!(!change.previously_on_hold);
    assert_eq!(state_volume_announcement(&change), None);
    let (log, message) = announcement(&change).unwrap();
    assert_eq!(log, tracing::Level::ERROR);
    assert!(message.contains("state volume"), "{message}");

    // A reading that fails ends the hold and is a warning of its own.
    monitor.record_state_volume(Err("the reading timed out".to_string()));
    let change = monitor.take_change().unwrap();
    assert_eq!(change.previous_hold_reason, Some(HoldReason::StateLowSpace));
    assert_eq!(change.status.hold_reason, None);
    let (log, message) = state_volume_announcement(&change).unwrap();
    assert_eq!(log, tracing::Level::WARN);
    assert!(message.contains("no run is held"), "{message}");

    // And room again is `info`.
    monitor.record_state_volume(volume(10 * GIB));
    let change = monitor.take_change().unwrap();
    assert_eq!(
        state_volume_announcement(&change).map(|(level, _)| level),
        Some(tracing::Level::INFO)
    );
    assert!(monitor.take_change().is_none());
}

#[tokio::test]
async fn leaving_the_hold_is_logged_as_the_queue_reopening() {
    let monitor = monitor();
    monitor.take_change();
    monitor.record_state_volume(volume(GIB));
    monitor.take_change();

    monitor.record_state_volume(volume(10 * GIB));
    let change = monitor.take_change().unwrap();

    assert!(change.previously_on_hold);
    assert!(!change.status.runs_on_hold);
    let (log, _) = announcement(&change).unwrap();
    assert_eq!(log, tracing::Level::INFO);
}

#[tokio::test]
async fn a_volume_filling_under_another_hold_is_an_error_of_its_own() {
    let monitor = monitor();
    monitor.record(StoreCapacity::writable(GIB, 20 * GIB));
    monitor.take_change();

    monitor.record_state_volume(volume(GIB));
    let change = monitor.take_change().unwrap();

    assert_eq!(change.status.hold_reason, Some(HoldReason::LowSpace));
    let (log, message) = state_volume_announcement(&change).unwrap();
    assert_eq!(log, tracing::Level::ERROR);
    assert!(message.contains("another reason"), "{message}");
}

#[tokio::test]
async fn a_hold_on_the_state_volume_is_announced_to_the_consoles() {
    let notifier = Notifier::new();
    let mut stream = notifier.open_stream();
    let monitor = monitor();
    monitor.announce(&notifier);

    monitor.record_state_volume(volume(GIB));
    monitor.announce(&notifier);
    monitor.announce(&notifier);

    let mut seen = Vec::new();
    while let Ok(message) = stream.receiver.try_recv() {
        if let crate::relay::StreamMessage::Storage(status) = message {
            seen.push((status.hold_reason, status.state_volume.map(|v| v.level)));
        }
    }
    assert_eq!(
        seen,
        [
            (None, None),
            (
                Some(HoldReason::StateLowSpace),
                Some(StateVolumeLevel::Blocked)
            ),
        ]
    );
}
