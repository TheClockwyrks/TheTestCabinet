//! Tests for the artifact capacity watch's reading of free space: the threshold
//! rule and its hysteresis, the monitor's derivation of a state from a reading and
//! the clock, the poll loop on a paused clock against a scripted source, and the
//! one HTTP read. The conditions that hold the queue beyond free space (a failed
//! read, a failed write check, runs waiting to store) are in
//! `capacity.hold.test.rs`.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;

use super::*;
use crate::relay::StreamMessage;

const GIB: u64 = 1024 * MIB;

/// The settings the backend ships with: warn under 3 GiB, stop under 2 GiB, a
/// 256 MiB recovery margin, a reading every 10 s.
fn settings() -> CapacitySettings {
    CapacitySettings::default()
}

/// A store in a directory of its own, for a monitor that is handed one. These
/// tests are about the artifact store, so their settings leave the volume the
/// store is on unread: what it holds is the machine's, not the test's.
fn test_store() -> (tempfile::TempDir, crate::store::DefinitionStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = crate::store::DefinitionStore::open(dir.path().join("store")).unwrap();
    (dir, store)
}

/// The shipped settings with the state volume's two thresholds turned off.
fn artifact_store_only() -> CapacitySettings {
    CapacitySettings {
        state_warn_bytes: 0,
        state_stop_bytes: 0,
        ..settings()
    }
}

fn reading(free_bytes: u64) -> StoreCapacity {
    StoreCapacity::writable(free_bytes, 20 * GIB)
}

/// A source of waiting runs that never finds one.
fn nobody_waiting() -> impl FnMut() -> std::future::Ready<Option<WaitingRuns>> {
    || std::future::ready(Some(WaitingRuns::default()))
}

// --- The threshold rule -----------------------------------------------------

#[test]
fn the_defaults_warn_under_three_gibibytes_and_stop_under_two() {
    let settings = settings();
    assert_eq!(settings.warn_bytes, 3 * GIB);
    assert_eq!(settings.stop_bytes, 2 * GIB);
    assert_eq!(settings.recover_bytes, 256 * MIB);
    assert_eq!(settings.poll_interval, Duration::from_secs(10));
    assert_eq!(settings.stale_after(), Duration::from_secs(30));
    assert_eq!(settings.pause_after(), Duration::from_secs(20));
}

#[test]
fn a_first_reading_is_classified_by_the_two_thresholds() {
    let settings = settings();
    for (free, expected) in [
        (10 * GIB, Level::Ok),
        // A threshold is "under", so free space exactly at it has not crossed.
        (3 * GIB, Level::Ok),
        (3 * GIB - 1, Level::Low),
        (2 * GIB, Level::Low),
        (2 * GIB - 1, Level::Blocked),
        (0, Level::Blocked),
    ] {
        assert_eq!(
            classify(Level::Ok, free, &settings),
            expected,
            "{free} bytes free"
        );
    }
}

#[test]
fn low_returns_to_ok_only_once_free_space_clears_the_warn_threshold_by_the_margin() {
    let settings = settings();
    let exit = 3 * GIB + 256 * MIB;
    assert_eq!(classify(Level::Low, 3 * GIB, &settings), Level::Low);
    assert_eq!(classify(Level::Low, exit - 1, &settings), Level::Low);
    assert_eq!(classify(Level::Low, exit, &settings), Level::Ok);
    // Falling further still blocks.
    assert_eq!(classify(Level::Low, 2 * GIB - 1, &settings), Level::Blocked);
}

#[test]
fn blocked_lifts_only_once_free_space_clears_the_stop_threshold_by_the_margin() {
    let settings = settings();
    let exit = 2 * GIB + 256 * MIB;
    assert_eq!(classify(Level::Blocked, 2 * GIB, &settings), Level::Blocked);
    assert_eq!(
        classify(Level::Blocked, exit - 1, &settings),
        Level::Blocked
    );
    // Clear of the stop threshold, still under the warn one.
    assert_eq!(classify(Level::Blocked, exit, &settings), Level::Low);
    // Clear of the warn threshold but not by the margin: it passed through `low`.
    assert_eq!(classify(Level::Blocked, 3 * GIB, &settings), Level::Low);
    assert_eq!(
        classify(Level::Blocked, 3 * GIB + 256 * MIB, &settings),
        Level::Ok
    );
}

#[test]
fn readings_hovering_at_a_threshold_hold_one_state() {
    // The flapping the margin exists to prevent: free space alternating just under
    // and just over the stop threshold on successive polls.
    let settings = settings();
    let mut level = Level::Ok;
    let mut seen = Vec::new();
    for free in [
        2 * GIB + MIB,
        2 * GIB - MIB,
        2 * GIB + MIB,
        2 * GIB - MIB,
        2 * GIB + MIB,
    ] {
        level = classify(level, free, &settings);
        seen.push(level);
    }
    assert_eq!(
        seen,
        [
            Level::Low,
            Level::Blocked,
            Level::Blocked,
            Level::Blocked,
            Level::Blocked
        ]
    );
}

#[test]
fn equal_thresholds_skip_low_on_the_way_down() {
    let settings = CapacitySettings {
        warn_bytes: 2 * GIB,
        stop_bytes: 2 * GIB,
        ..settings()
    };
    assert_eq!(classify(Level::Ok, 2 * GIB, &settings), Level::Ok);
    assert_eq!(classify(Level::Ok, 2 * GIB - 1, &settings), Level::Blocked);
}

// --- The monitor ------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_reading_decides_the_state_and_the_hold() {
    let monitor = CapacityMonitor::watching(settings());

    monitor.record(reading(10 * GIB));
    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Ok);
    assert!(!status.runs_on_hold);
    assert_eq!(status.free_bytes, Some(10 * GIB));
    assert_eq!(status.total_bytes, Some(20 * GIB));
    assert_eq!(status.warn_bytes, 3 * GIB);
    assert_eq!(status.stop_bytes, 2 * GIB);

    monitor.record(reading(5 * GIB / 2));
    assert_eq!(monitor.status().state, ArtifactStorageState::Low);
    assert!(!monitor.runs_on_hold(), "low only warns");

    monitor.record(reading(GIB));
    assert_eq!(monitor.status().state, ArtifactStorageState::Blocked);
    assert!(monitor.runs_on_hold());

    // Back over the stop threshold but inside the margin: still held.
    monitor.record(reading(2 * GIB + MIB));
    assert!(monitor.runs_on_hold());

    monitor.record(reading(2 * GIB + 256 * MIB));
    assert_eq!(monitor.status().state, ArtifactStorageState::Low);
    assert!(!monitor.runs_on_hold(), "the hold lifts with the reading");
}

#[tokio::test(start_paused = true)]
async fn a_stale_reading_is_unavailable_and_holds_runs_at_once() {
    let monitor = CapacityMonitor::watching(settings());
    monitor.record(reading(10 * GIB));

    // Current for three poll intervals.
    tokio::time::advance(Duration::from_secs(30)).await;
    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Ok);
    assert!(!status.runs_on_hold);

    // Then stale: unavailable and on hold from that moment, with the last figures
    // still reported.
    tokio::time::advance(Duration::from_secs(1)).await;
    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Unavailable);
    assert!(status.runs_on_hold, "there is no grace for an unread store");
    assert_eq!(status.hold_reason, Some(HoldReason::Unreadable));
    assert_eq!(status.free_bytes, Some(10 * GIB));

    // Readings end the hold, once there are three of them in a row.
    monitor.record(reading(10 * GIB));
    assert!(monitor.status().runs_on_hold);
    monitor.record(reading(10 * GIB));
    monitor.record(reading(10 * GIB));
    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Ok);
    assert!(!status.runs_on_hold);
    assert_eq!(status.hold_reason, None);
}

#[tokio::test(start_paused = true)]
async fn a_store_never_read_holds_runs_until_its_first_reading() {
    let monitor = CapacityMonitor::watching(settings());

    // No grace: nothing says a store never read has room.
    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Unavailable);
    assert!(status.runs_on_hold);
    assert_eq!(status.free_bytes, None);
    assert_eq!(status.total_bytes, None);

    tokio::time::advance(Duration::from_secs(3600)).await;
    assert!(monitor.runs_on_hold(), "silence never opens the queue");

    monitor.record(reading(10 * GIB));
    assert!(!monitor.runs_on_hold(), "the first reading decides");
}

#[tokio::test(start_paused = true)]
async fn a_blocked_store_stays_on_hold_while_it_cannot_be_read() {
    let monitor = CapacityMonitor::watching(settings());
    monitor.record(reading(GIB));
    assert!(monitor.runs_on_hold());

    // Every second from the blocked reading, through its going stale at 30 s and
    // long past it: the queue never opens.
    for second in 1..=200 {
        tokio::time::advance(Duration::from_secs(1)).await;
        let status = monitor.status();
        assert!(status.runs_on_hold, "{second} s after a blocked reading");
        let expected = if second <= 30 {
            ArtifactStorageState::Blocked
        } else {
            ArtifactStorageState::Unavailable
        };
        assert_eq!(status.state, expected, "{second} s");
    }
}

#[tokio::test(start_paused = true)]
async fn an_outage_resumes_the_hysteresis_from_the_last_reading() {
    let monitor = CapacityMonitor::watching(settings());
    monitor.record(reading(GIB));
    tokio::time::advance(Duration::from_secs(600)).await;
    assert_eq!(monitor.status().state, ArtifactStorageState::Unavailable);

    // Inside the stop threshold's margin: a store that was blocked before the
    // outage is still blocked after it.
    monitor.record(reading(2 * GIB + MIB));
    assert_eq!(monitor.status().state, ArtifactStorageState::Blocked);
}

#[tokio::test(start_paused = true)]
async fn an_unmonitored_store_never_holds_a_run() {
    let monitor = CapacityMonitor::unmonitored(settings());

    // Neither a reading nor any amount of silence changes it.
    monitor.record(reading(0));
    tokio::time::advance(Duration::from_secs(3600)).await;

    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Unmonitored);
    assert!(!status.runs_on_hold);
    assert_eq!(status.free_bytes, None);
    assert!(monitor.take_change().is_none());
}

#[tokio::test(start_paused = true)]
async fn a_change_is_reported_once() {
    let monitor = CapacityMonitor::watching(settings());

    monitor.record(reading(10 * GIB));
    let change = monitor
        .take_change()
        .expect("the first reading is a change");
    assert_eq!(change.previous, ArtifactStorageState::Unavailable);
    assert!(change.previously_on_hold, "a store never read was held");
    assert_eq!(change.status.state, ArtifactStorageState::Ok);
    assert!(monitor.take_change().is_none());

    // Another reading in the same state is no change.
    monitor.record(reading(9 * GIB));
    assert!(monitor.take_change().is_none());

    monitor.record(reading(GIB));
    let change = monitor.take_change().expect("blocked is a change");
    assert_eq!(change.previous, ArtifactStorageState::Ok);
    assert!(!change.previously_on_hold);
    assert!(change.status.runs_on_hold);
}

#[test]
fn the_status_serializes_in_the_shape_the_console_reads() {
    let status = ArtifactStorageStatus {
        state: ArtifactStorageState::Low,
        runs_on_hold: false,
        hold_reason: None,
        runs_waiting_to_store: 0,
        detail: None,
        publish_failing_runs: None,
        free_bytes: Some(5 * GIB / 2),
        total_bytes: Some(20 * GIB),
        writable: Some(true),
        warn_bytes: 3 * GIB,
        stop_bytes: 2 * GIB,
        state_volume: None,
    };
    assert_eq!(
        serde_json::to_value(&status).unwrap(),
        serde_json::json!({
            "state": "low",
            "runsOnHold": false,
            "runsWaitingToStore": 0,
            "freeBytes": 2_684_354_560u64,
            "totalBytes": 21_474_836_480u64,
            "writable": true,
            "warnBytes": 3_221_225_472u64,
            "stopBytes": 2_147_483_648u64,
        })
    );

    // A hold names its reason and carries the error behind it.
    let held = ArtifactStorageStatus {
        state: ArtifactStorageState::Unwritable,
        runs_on_hold: true,
        hold_reason: Some(HoldReason::Unwritable),
        runs_waiting_to_store: 2,
        detail: Some("Read-only file system (os error 30)".to_string()),
        writable: Some(false),
        ..status.clone()
    };
    assert_eq!(
        serde_json::to_value(&held).unwrap(),
        serde_json::json!({
            "state": "unwritable",
            "runsOnHold": true,
            "holdReason": "unwritable",
            "runsWaitingToStore": 2,
            "detail": "Read-only file system (os error 30)",
            "freeBytes": 2_684_354_560u64,
            "totalBytes": 21_474_836_480u64,
            "writable": false,
            "warnBytes": 3_221_225_472u64,
            "stopBytes": 2_147_483_648u64,
        })
    );

    // With no reading the reading's figures are absent rather than null.
    let unread = ArtifactStorageStatus {
        state: ArtifactStorageState::Unavailable,
        runs_on_hold: true,
        hold_reason: Some(HoldReason::Unreadable),
        free_bytes: None,
        total_bytes: None,
        writable: None,
        ..status
    };
    assert_eq!(
        serde_json::to_value(&unread).unwrap(),
        serde_json::json!({
            "state": "unavailable",
            "runsOnHold": true,
            "holdReason": "unreadable",
            "runsWaitingToStore": 0,
            "warnBytes": 3_221_225_472u64,
            "stopBytes": 2_147_483_648u64,
        })
    );
    assert_eq!(
        serde_json::to_value(ArtifactStorageState::Unmonitored).unwrap(),
        "unmonitored"
    );
    for (reason, wire) in [
        (HoldReason::Unreadable, "unreadable"),
        (HoldReason::LowSpace, "low-space"),
        (HoldReason::Unwritable, "unwritable"),
        (HoldReason::UploadsWaiting, "uploads-waiting"),
        (HoldReason::WriteCheckPending, "write-check-pending"),
    ] {
        assert_eq!(serde_json::to_value(reason).unwrap(), wire);
    }
}

// --- The poll loop ----------------------------------------------------------

/// A scripted source: each poll takes the next answer, and once the script is
/// spent every poll fails as an unreachable service does.
fn scripted(
    answers: impl IntoIterator<Item = Option<u64>>,
) -> impl FnMut() -> std::future::Ready<Result<StoreCapacity, CapacityReadError>> {
    let answers: Arc<Mutex<VecDeque<Option<u64>>>> =
        Arc::new(Mutex::new(answers.into_iter().collect()));
    move || {
        let next = answers.lock().unwrap().pop_front().flatten();
        std::future::ready(match next {
            Some(free) => Ok(reading(free)),
            None => Err(CapacityReadError::Refused(
                reqwest::StatusCode::SERVICE_UNAVAILABLE,
            )),
        })
    }
}

/// Every storage status announced so far on `receiver`.
fn announced(
    receiver: &mut tokio::sync::broadcast::Receiver<StreamMessage>,
) -> Vec<(ArtifactStorageState, bool)> {
    let mut seen = Vec::new();
    while let Ok(message) = receiver.try_recv() {
        if let StreamMessage::Storage(status) = message {
            seen.push((status.state, status.runs_on_hold));
        }
    }
    seen
}

#[tokio::test(start_paused = true)]
async fn the_loop_announces_each_change_of_state_and_nothing_between() {
    let notifier = Notifier::new();
    let mut stream = notifier.open_stream();
    let monitor = CapacityMonitor::watching(settings());
    // One reading per 10 s poll: ok, ok, low, low, blocked, blocked, low, ok.
    let task = tokio::spawn(run_capacity_monitor(
        monitor.clone(),
        notifier.clone(),
        scripted(
            [
                10 * GIB,
                9 * GIB,
                5 * GIB / 2,
                5 * GIB / 2,
                GIB,
                GIB,
                5 * GIB / 2,
                10 * GIB,
            ]
            .map(Some),
        ),
        nobody_waiting(),
    ));

    // 75 s covers the eight polls at 0, 10, … 70 s.
    tokio::time::sleep(Duration::from_secs(75)).await;
    assert_eq!(
        announced(&mut stream.receiver),
        [
            (ArtifactStorageState::Ok, false),
            (ArtifactStorageState::Low, false),
            (ArtifactStorageState::Blocked, true),
            (ArtifactStorageState::Low, false),
            (ArtifactStorageState::Ok, false),
        ]
    );
    task.abort();
}

#[tokio::test(start_paused = true)]
async fn the_loop_puts_runs_on_hold_when_the_service_stays_unreachable() {
    let notifier = Notifier::new();
    let mut stream = notifier.open_stream();
    let monitor = CapacityMonitor::watching(settings());
    // One good reading at 0 s, then nothing.
    let task = tokio::spawn(run_capacity_monitor(
        monitor.clone(),
        notifier.clone(),
        scripted([Some(10 * GIB)]),
        nobody_waiting(),
    ));

    tokio::time::sleep(Duration::from_secs(35)).await;
    assert_eq!(
        announced(&mut stream.receiver),
        [(ArtifactStorageState::Ok, false)],
        "three missed polls are announced as nothing yet"
    );

    // Stale from 30 s; the poll at 40 s is the first to see it.
    tokio::time::sleep(Duration::from_secs(10)).await;
    assert!(monitor.runs_on_hold());
    assert_eq!(
        announced(&mut stream.receiver),
        [(ArtifactStorageState::Unavailable, true)]
    );

    // However long it lasts, it is announced once.
    tokio::time::sleep(Duration::from_secs(600)).await;
    assert!(monitor.runs_on_hold());
    assert_eq!(announced(&mut stream.receiver), []);
    task.abort();
}

// --- The HTTP read ----------------------------------------------------------

const TOKEN: &str = "service-secret";

/// An empty job table for the monitor to count waiting runs from.
async fn test_db() -> Arc<crate::db::Db> {
    Arc::new(crate::db::Db::connect_in_memory().await.unwrap())
}

/// Spawn a stand-in artifact service whose `GET /capacity` requires [`TOKEN`] and
/// answers `status`, with the capacity body when that is `200`.
async fn spawn_capacity_stub(status: StatusCode) -> String {
    let app = Router::new().route(
        "/capacity",
        get(move |headers: HeaderMap| async move {
            let authorized = headers
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                == Some(&format!("Bearer {TOKEN}"));
            if !authorized {
                return Err(StatusCode::UNAUTHORIZED);
            }
            if status != StatusCode::OK {
                return Err(status);
            }
            Ok(Json(serde_json::json!({
                "freeBytes": 2_684_354_560u64,
                "totalBytes": 21_474_836_480u64,
            })))
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn read_capacity_presents_the_service_token_and_reads_both_figures() {
    let base = spawn_capacity_stub(StatusCode::OK).await;
    let http = reqwest::Client::new();

    // A trailing slash on the base is tolerated.
    let capacity = read_capacity(&http, &format!("{base}/"), TOKEN)
        .await
        .unwrap();
    // The stub answers as a service without a write check does, which reads as a
    // check that passed.
    assert_eq!(
        capacity,
        StoreCapacity::writable(2_684_354_560, 21_474_836_480)
    );

    assert!(matches!(
        read_capacity(&http, &base, "not-the-secret").await,
        Err(CapacityReadError::Refused(StatusCode::UNAUTHORIZED))
    ));
}

#[tokio::test]
async fn read_capacity_treats_a_failing_or_absent_service_as_no_reading() {
    let http = reqwest::Client::new();

    let failing = spawn_capacity_stub(StatusCode::INTERNAL_SERVER_ERROR).await;
    assert!(matches!(
        read_capacity(&http, &failing, TOKEN).await,
        Err(CapacityReadError::Refused(
            StatusCode::INTERNAL_SERVER_ERROR
        ))
    ));

    // A listener that was bound and dropped: nothing answers on the port.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gone = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    assert!(matches!(
        read_capacity(&http, &gone, TOKEN).await,
        Err(CapacityReadError::Transport(_))
    ));
}

#[tokio::test]
async fn read_capacity_carries_the_reason_the_service_gave_for_refusing() {
    // The artifact service's error envelope, as it answers a capacity read made
    // while an earlier write check has not returned and no figures are known.
    let app = Router::new().route(
        "/capacity",
        get(|| async {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": {
                        "code": "unavailable",
                        "message": "the previous write check has not returned",
                    }
                })),
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let error = read_capacity(&reqwest::Client::new(), &base, TOKEN)
        .await
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "the artifact service answered HTTP 503 Service Unavailable: \
         the previous write check has not returned"
    );
    // And that text is what the hold reports.
    let monitor = CapacityMonitor::watching(settings());
    monitor.record_failure(&error);
    assert_eq!(
        monitor.status().detail.as_deref(),
        Some(&*error.to_string())
    );
}

#[tokio::test]
async fn with_no_artifact_service_configured_nothing_is_watched() {
    let (_dir, store) = test_store();
    for (url, token) in [
        (None, None),
        (Some("http://tcab-artifacts:8790".to_string()), None),
        (None, Some(TOKEN.to_string())),
    ] {
        let (monitor, task) = spawn_capacity_monitor(
            artifact_store_only(),
            reqwest::Client::new(),
            url,
            token,
            Notifier::new(),
            test_db().await,
            store.clone(),
        )
        .await;
        assert!(task.is_none(), "no loop is spawned");
        assert_eq!(monitor.status().state, ArtifactStorageState::Unmonitored);
        assert!(!monitor.runs_on_hold());
    }
}

#[tokio::test]
async fn a_configured_artifact_service_is_read_before_the_monitor_is_handed_out() {
    let (_dir, store) = test_store();
    let base = spawn_capacity_stub(StatusCode::OK).await;
    let notifier = Notifier::new();
    let mut stream = notifier.open_stream();
    let (monitor, task) = spawn_capacity_monitor(
        artifact_store_only(),
        reqwest::Client::new(),
        Some(base),
        Some(TOKEN.to_string()),
        notifier,
        test_db().await,
        store.clone(),
    )
    .await;

    // No waiting: the reading is already in, so the first claim is decided on it.
    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Low);
    assert_eq!(status.free_bytes, Some(2_684_354_560));
    assert_eq!(
        announced(&mut stream.receiver),
        [(ArtifactStorageState::Low, false)]
    );
    task.expect("the loop is spawned").abort();
}

#[tokio::test]
async fn a_service_that_does_not_answer_at_startup_leaves_the_monitor_unavailable() {
    let (_dir, store) = test_store();
    let failing = spawn_capacity_stub(StatusCode::INTERNAL_SERVER_ERROR).await;
    let (monitor, task) = spawn_capacity_monitor(
        artifact_store_only(),
        reqwest::Client::new(),
        Some(failing),
        Some(TOKEN.to_string()),
        Notifier::new(),
        test_db().await,
        store.clone(),
    )
    .await;

    let status = monitor.status();
    assert_eq!(status.state, ArtifactStorageState::Unavailable);
    assert!(
        status.runs_on_hold,
        "a backend that could not read the store at startup dispatches nothing"
    );
    task.expect("the loop is spawned").abort();
}

// --- The log line of a change -------------------------------------------------

/// The change that entering `state`, held for `hold_reason`, is.
fn change_to(state: ArtifactStorageState, hold_reason: Option<HoldReason>) -> CapacityChange {
    CapacityChange {
        previous: ArtifactStorageState::Ok,
        previously_on_hold: false,
        previous_hold_reason: None,
        previous_state_volume: None,
        state_volume_only: false,
        status: ArtifactStorageStatus {
            state,
            runs_on_hold: hold_reason.is_some(),
            hold_reason,
            runs_waiting_to_store: 0,
            detail: None,
            publish_failing_runs: None,
            free_bytes: Some(GIB),
            total_bytes: Some(20 * GIB),
            writable: Some(true),
            warn_bytes: 3 * GIB,
            stop_bytes: 2 * GIB,
            state_volume: None,
        },
    }
}

#[test]
fn each_change_is_announced_at_the_level_it_calls_for() {
    use ArtifactStorageState as State;
    let level = |state, reason| announcement(&change_to(state, reason)).map(|(level, _)| level);
    let (error, warn, info) = (
        Some(tracing::Level::ERROR),
        Some(tracing::Level::WARN),
        Some(tracing::Level::INFO),
    );

    // A hold the store itself causes is an error.
    assert_eq!(level(State::Blocked, Some(HoldReason::LowSpace)), error);
    assert_eq!(
        level(State::Unavailable, Some(HoldReason::Unreadable)),
        error
    );
    assert_eq!(
        level(State::Unwritable, Some(HoldReason::Unwritable)),
        error
    );
    // A hold for waiting runs is a warning, whatever the space reads.
    for state in [State::Ok, State::Low] {
        assert_eq!(level(state, Some(HoldReason::UploadsWaiting)), warn);
        assert_eq!(level(state, Some(HoldReason::WriteCheckPending)), warn);
    }
    // An open queue: low warns, and room is the `info` a cleared hold logs.
    assert_eq!(level(State::Low, None), warn);
    assert_eq!(level(State::Ok, None), info);
    assert_eq!(level(State::Unmonitored, None), None);
}

#[tokio::test(start_paused = true)]
async fn a_change_into_unavailable_carries_why_the_store_could_not_be_read() {
    let monitor = CapacityMonitor::watching(settings());
    monitor.record(reading(10 * GIB));
    monitor.take_change().expect("the first reading");

    // A refusal, which a console reading "cannot be reached" would not explain.
    monitor.record_failure(&CapacityReadError::Refused(StatusCode::UNAUTHORIZED));
    tokio::time::advance(Duration::from_secs(31)).await;
    let change = monitor.take_change().expect("stale is a change");
    assert_eq!(change.status.state, ArtifactStorageState::Unavailable);
    assert_eq!(
        change.status.detail.as_deref(),
        Some("the artifact service answered HTTP 401 Unauthorized")
    );

    // A reading clears it.
    monitor.record(reading(GIB));
    let change = monitor.take_change().expect("blocked is a change");
    assert_eq!(change.status.detail, None);
}
