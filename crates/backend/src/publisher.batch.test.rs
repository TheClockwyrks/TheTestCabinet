//! The batching's timing, on a paused clock. The target is a recorder, so a test
//! reads exactly when each batch was released, why, and how many requests it
//! carried, and nothing here depends on how fast the machine is.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use super::*;
use crate::error::BackendError;

/// The quiet window and minimum interval the tests use, matching the defaults.
const QUIET: Duration = Duration::from_secs(120);
const MIN_INTERVAL: Duration = Duration::from_secs(600);
/// The refresh timeout the tests use, matching the default.
const REFRESH_TIMEOUT: Duration = Duration::from_secs(1800);

/// One release as the recorder saw it: seconds since the test started, the reason
/// and the requests carried.
type Release = (u64, ReleaseReason, u64);

/// A [`RefreshTarget`] that records each release instead of publishing anything.
struct Recorder {
    started: Instant,
    releases: Mutex<Vec<Release>>,
    /// How long one refresh takes.
    refresh_takes: Duration,
    /// How many of the next refreshes fail.
    failures: AtomicU64,
    /// How many times pending requests were recorded durably.
    persisted: AtomicU64,
}

impl Recorder {
    fn new(refresh_takes: Duration) -> Arc<Self> {
        Arc::new(Self {
            started: Instant::now(),
            releases: Mutex::new(Vec::new()),
            refresh_takes,
            failures: AtomicU64::new(0),
            persisted: AtomicU64::new(0),
        })
    }

    fn releases(&self) -> Vec<Release> {
        self.releases.lock().unwrap().clone()
    }
}

impl RefreshTarget for Recorder {
    type Output = ();

    async fn refresh(&self, batch: Batch) -> Result<()> {
        self.releases.lock().unwrap().push((
            self.started.elapsed().as_secs(),
            batch.reason,
            batch.requests,
        ));
        tokio::time::sleep(self.refresh_takes).await;
        let fail = self
            .failures
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                left.checked_sub(1)
            })
            .is_ok();
        if fail {
            return Err(BackendError::Snapshot("the bucket is unreachable".into()));
        }
        Ok(())
    }

    async fn persist_pending(&self) {
        self.persisted.fetch_add(1, Ordering::SeqCst);
    }
}

/// A running batching loop over a [`Recorder`].
struct Harness {
    batcher: Arc<Batcher>,
    recorder: Arc<Recorder>,
    shutdown: mpsc::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

impl Harness {
    fn start(timing: BatchTiming, refresh_takes: Duration, recover: Option<Duration>) -> Self {
        let batcher = Arc::new(Batcher::new(timing));
        let recorder = Recorder::new(refresh_takes);
        let (shutdown, shutdown_rx) = mpsc::channel(1);
        let task = tokio::spawn({
            let batcher = Arc::clone(&batcher);
            let recorder = Arc::clone(&recorder);
            async move { batcher.run(recorder.as_ref(), recover, shutdown_rx).await }
        });
        Self {
            batcher,
            recorder,
            shutdown,
            task,
        }
    }

    fn requests(&self, count: u64) {
        for _ in 0..count {
            self.batcher.request();
        }
    }

    /// Stop the loop and return every release it made.
    async fn stop(self) -> Vec<Release> {
        drop(self.shutdown);
        self.task.await.unwrap();
        self.recorder.releases()
    }
}

fn timing(threshold: u64, min_interval: Duration) -> BatchTiming {
    BatchTiming {
        threshold,
        quiet_window: QUIET,
        min_interval,
        refresh_timeout: REFRESH_TIMEOUT,
    }
}

/// Let the paused clock run `seconds` forward, running every task that comes due.
async fn pass(seconds: u64) {
    tokio::time::sleep(Duration::from_secs(seconds)).await;
}

/// Let the loop act on what was just requested without moving a whole second.
async fn settle() {
    tokio::time::sleep(Duration::from_millis(1)).await;
}

#[tokio::test(start_paused = true)]
async fn the_threshold_releases_before_the_quiet_window() {
    let harness = Harness::start(timing(20, MIN_INTERVAL), Duration::ZERO, None);
    harness.requests(19);
    settle().await;
    assert!(
        harness.recorder.releases().is_empty(),
        "one short of the threshold waits for the quiet window"
    );

    harness.requests(1);
    settle().await;
    assert_eq!(
        harness.stop().await,
        vec![(0, ReleaseReason::Threshold, 20)]
    );
}

#[tokio::test(start_paused = true)]
async fn a_steady_trickle_faster_than_the_quiet_window_releases_at_the_threshold() {
    // One request a minute never leaves the two-minute quiet window to run out, so
    // only the threshold can release it.
    let harness = Harness::start(timing(5, Duration::ZERO), Duration::ZERO, None);
    for sent in 1..=12u64 {
        harness.requests(1);
        settle().await;
        assert_eq!(
            harness.recorder.releases().len() as u64,
            sent / 5,
            "after request {sent}"
        );
        pass(60).await;
    }
    // The fifth request went out at 240s and the tenth at 540s. The last two are
    // released by the quiet window once the trickle stops.
    pass(QUIET.as_secs()).await;
    assert_eq!(
        harness.stop().await,
        vec![
            (240, ReleaseReason::Threshold, 5),
            (540, ReleaseReason::Threshold, 5),
            (780, ReleaseReason::Quiet, 2),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn the_quiet_window_releases_a_batch_below_the_threshold() {
    let harness = Harness::start(timing(20, MIN_INTERVAL), Duration::ZERO, None);
    harness.requests(1);
    pass(30).await;
    harness.requests(1);

    // The window is measured from the newest request, at 30s.
    pass(119).await;
    assert!(harness.recorder.releases().is_empty());
    pass(2).await;
    assert_eq!(harness.stop().await, vec![(150, ReleaseReason::Quiet, 2)]);
}

#[tokio::test(start_paused = true)]
async fn a_trickle_that_stops_short_of_the_threshold_still_releases() {
    let harness = Harness::start(timing(20, MIN_INTERVAL), Duration::ZERO, None);
    // Seven requests a minute apart, the last at 360s, and then nothing.
    for _ in 0..7 {
        harness.requests(1);
        pass(60).await;
    }
    // A day later exactly one batch went out, one quiet window after the last
    // request, and nothing was released after it.
    pass(24 * 3600).await;
    assert_eq!(harness.stop().await, vec![(480, ReleaseReason::Quiet, 7)]);
}

#[tokio::test(start_paused = true)]
async fn the_minimum_interval_holds_a_second_batch_then_releases_everything_pending() {
    // A burst of 100 with a refresh that takes a minute.
    let harness = Harness::start(timing(20, MIN_INTERVAL), Duration::from_secs(60), None);
    harness.requests(20);
    settle().await;
    harness.requests(80);

    // The interval runs from the end of the first refresh, at 60s, to 660s.
    pass(658).await;
    assert_eq!(
        harness.recorder.releases(),
        vec![(0, ReleaseReason::Threshold, 20)],
        "the second batch is held"
    );
    pass(3).await;
    assert_eq!(
        harness.recorder.releases(),
        vec![
            (0, ReleaseReason::Threshold, 20),
            (660, ReleaseReason::Threshold, 80),
        ]
    );

    // Nothing is pending, so the interval ending again releases nothing.
    pass(24 * 3600).await;
    assert_eq!(harness.stop().await.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_quiet_batch_inside_the_minimum_interval_waits_for_it() {
    let harness = Harness::start(timing(20, MIN_INTERVAL), Duration::ZERO, None);
    harness.requests(20);
    settle().await;
    // One request at 10s: its quiet window ends at 130s, inside the interval.
    pass(10).await;
    harness.requests(1);

    pass(589).await;
    assert_eq!(harness.recorder.releases().len(), 1);
    pass(2).await;
    assert_eq!(
        harness.stop().await,
        vec![
            (0, ReleaseReason::Threshold, 20),
            (600, ReleaseReason::Quiet, 1),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn requests_during_a_running_refresh_are_carried_by_the_next_batch() {
    let harness = Harness::start(timing(3, Duration::ZERO), Duration::from_secs(300), None);
    harness.requests(3);
    settle().await;
    // The refresh runs until 300s. Two requests land while it does.
    pass(100).await;
    harness.requests(1);
    pass(100).await;
    harness.requests(1);

    // Their quiet window ends at 320s, after the refresh has finished.
    pass(24 * 3600).await;
    assert_eq!(
        harness.stop().await,
        vec![
            (0, ReleaseReason::Threshold, 3),
            (320, ReleaseReason::Quiet, 2),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_threshold_reached_during_a_running_refresh_releases_when_it_ends() {
    let harness = Harness::start(timing(3, Duration::ZERO), Duration::from_secs(300), None);
    harness.requests(3);
    settle().await;
    pass(100).await;
    harness.requests(4);

    pass(24 * 3600).await;
    assert_eq!(
        harness.stop().await,
        vec![
            (0, ReleaseReason::Threshold, 3),
            (300, ReleaseReason::Threshold, 4),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_refresh_keeps_its_requests_and_is_retried() {
    let harness = Harness::start(timing(3, MIN_INTERVAL), Duration::ZERO, None);
    harness.recorder.failures.store(1, Ordering::SeqCst);
    harness.requests(3);
    settle().await;
    // One more arrives while the failed batch waits.
    pass(10).await;
    harness.requests(1);

    pass(24 * 3600).await;
    assert_eq!(
        harness.stop().await,
        vec![
            (0, ReleaseReason::Threshold, 3),
            (600, ReleaseReason::Threshold, 4),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_refresh_is_not_retried_at_once_without_a_minimum_interval() {
    let harness = Harness::start(timing(3, Duration::ZERO), Duration::ZERO, None);
    harness.recorder.failures.store(2, Ordering::SeqCst);
    harness.requests(3);

    pass(24 * 3600).await;
    assert_eq!(
        harness.stop().await,
        vec![
            (0, ReleaseReason::Threshold, 3),
            (60, ReleaseReason::Threshold, 3),
            // The second failure in a row doubles the wait.
            (180, ReleaseReason::Threshold, 3),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_release_that_keeps_failing_is_retried_less_and_less_often() {
    let harness = Harness::start(timing(1, MIN_INTERVAL), Duration::ZERO, None);
    harness.recorder.failures.store(u64::MAX, Ordering::SeqCst);
    harness.requests(1);

    pass(24 * 3600).await;
    let at: Vec<u64> = harness
        .recorder
        .releases()
        .iter()
        .map(|release| release.0)
        .collect();
    // Waits of 10, 20, 40, 80, 160 and 320 minutes, then the six-hour cap.
    assert_eq!(
        at,
        [0, 600, 1800, 4200, 9000, 18600, 37800, 59400, 81000],
        "a day of failures is nine tries, not one per minimum interval"
    );

    // One success puts the wait back to the minimum interval.
    harness.recorder.failures.store(0, Ordering::SeqCst);
    pass(6 * 3600).await;
    harness.requests(1);
    pass(MIN_INTERVAL.as_secs()).await;
    let releases = harness.stop().await;
    assert_eq!(
        releases[releases.len() - 2..],
        [
            (102_600, ReleaseReason::Threshold, 1),
            (108_000, ReleaseReason::Threshold, 1),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_refresh_that_never_returns_is_abandoned_and_retried() {
    // A refresh that would take a day: a stalled bucket call.
    let harness = Harness::start(
        timing(1, MIN_INTERVAL),
        Duration::from_secs(24 * 3600),
        None,
    );
    harness.requests(1);
    settle().await;

    // Abandoned at the timeout, retried one minimum interval later.
    pass(REFRESH_TIMEOUT.as_secs() + MIN_INTERVAL.as_secs()).await;
    assert_eq!(
        harness.recorder.releases(),
        vec![
            (0, ReleaseReason::Threshold, 1),
            (2400, ReleaseReason::Threshold, 1),
        ]
    );
    harness.task.abort();
}

#[tokio::test(start_paused = true)]
async fn a_forced_refresh_is_not_blocked_for_good_by_a_stalled_one() {
    let harness = Harness::start(
        timing(1, MIN_INTERVAL),
        Duration::from_secs(24 * 3600),
        None,
    );
    harness.requests(1);
    settle().await;

    // The operator forces a refresh a minute into the stall. It waits for the
    // stalled refresh to be abandoned and then runs, carrying its request.
    pass(60).await;
    let forced = tokio::spawn({
        let batcher = Arc::clone(&harness.batcher);
        let recorder = Arc::clone(&harness.recorder);
        async move { batcher.forced(recorder.as_ref()).await }
    });
    pass(REFRESH_TIMEOUT.as_secs()).await;
    assert_eq!(
        harness.recorder.releases(),
        vec![
            (0, ReleaseReason::Threshold, 1),
            (1800, ReleaseReason::Forced, 1),
        ]
    );
    forced.abort();
    harness.task.abort();
}

#[tokio::test(start_paused = true)]
async fn no_refresh_timeout_lets_a_long_refresh_finish() {
    let unbounded = BatchTiming {
        refresh_timeout: Duration::ZERO,
        ..timing(1, MIN_INTERVAL)
    };
    let harness = Harness::start(unbounded, Duration::from_secs(2 * 3600), None);
    harness.requests(1);
    pass(24 * 3600).await;
    assert_eq!(harness.stop().await, vec![(0, ReleaseReason::Threshold, 1)]);
}

#[tokio::test(start_paused = true)]
async fn requests_pending_at_the_last_stop_are_released_at_startup() {
    let harness = Harness::start(
        timing(20, MIN_INTERVAL),
        Duration::ZERO,
        Some(Duration::ZERO),
    );
    settle().await;
    assert_eq!(
        harness.recorder.releases(),
        vec![(0, ReleaseReason::Recovery, 1)]
    );
    // The durable record is where the recovery came from, so it is not rewritten.
    assert_eq!(harness.recorder.persisted.load(Ordering::SeqCst), 0);

    // The recovery starts the minimum interval like any other release.
    harness.requests(20);
    pass(24 * 3600).await;
    assert_eq!(
        harness.stop().await,
        vec![
            (0, ReleaseReason::Recovery, 1),
            (600, ReleaseReason::Threshold, 20),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_recovery_waits_out_what_is_left_of_the_minimum_interval() {
    // The last release before the stop was four minutes ago, so six of the ten
    // minutes are left.
    let harness = Harness::start(
        timing(20, MIN_INTERVAL),
        Duration::ZERO,
        Some(Duration::from_secs(360)),
    );
    pass(359).await;
    assert_eq!(harness.recorder.releases(), vec![]);
    // Requests arriving meanwhile ride the same release.
    harness.requests(2);
    pass(24 * 3600).await;
    assert_eq!(
        harness.stop().await,
        vec![(360, ReleaseReason::Recovery, 3)]
    );
}

#[tokio::test(start_paused = true)]
async fn a_forced_refresh_carries_the_pending_requests_and_starts_the_interval() {
    let harness = Harness::start(timing(20, MIN_INTERVAL), Duration::ZERO, None);
    harness.requests(4);
    pass(30).await;
    harness
        .batcher
        .forced(harness.recorder.as_ref())
        .await
        .unwrap();

    // The loop has nothing left to release when the quiet window runs out.
    pass(200).await;
    assert_eq!(
        harness.recorder.releases(),
        vec![(30, ReleaseReason::Forced, 4)]
    );

    // A full batch after the forced refresh is held from 30s to 630s.
    harness.requests(20);
    pass(24 * 3600).await;
    assert_eq!(
        harness.stop().await,
        vec![
            (30, ReleaseReason::Forced, 4),
            (630, ReleaseReason::Threshold, 20),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_forced_refresh_waits_for_the_one_already_running() {
    let harness = Harness::start(timing(2, Duration::ZERO), Duration::from_secs(300), None);
    harness.requests(2);
    pass(100).await;
    harness
        .batcher
        .forced(harness.recorder.as_ref())
        .await
        .unwrap();

    assert_eq!(
        harness.stop().await,
        vec![
            (0, ReleaseReason::Threshold, 2),
            (300, ReleaseReason::Forced, 0),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_forced_refresh_abandoned_midway_returns_its_requests() {
    let harness = Harness::start(timing(20, Duration::ZERO), Duration::from_secs(300), None);
    harness.requests(4);
    pass(30).await;
    // The caller goes away 10s into a refresh that takes 300s.
    let abandoned = tokio::time::timeout(
        Duration::from_secs(10),
        harness.batcher.forced(harness.recorder.as_ref()),
    )
    .await;
    assert!(abandoned.is_err(), "the forced refresh was cut short");

    // The four requests are still owed a release, by the quiet window at 120s.
    pass(24 * 3600).await;
    assert_eq!(
        harness.stop().await,
        vec![
            (30, ReleaseReason::Forced, 4),
            (120, ReleaseReason::Quiet, 4),
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn pending_requests_are_recorded_once_per_batch() {
    let harness = Harness::start(timing(3, Duration::ZERO), Duration::from_secs(300), None);
    harness.requests(1);
    settle().await;
    harness.requests(1);
    settle().await;
    assert_eq!(harness.recorder.persisted.load(Ordering::SeqCst), 1);

    // The third request releases the batch. One arriving while the refresh runs is
    // recorded again once it ends, because the finished refresh cleared the record.
    harness.requests(1);
    pass(100).await;
    harness.requests(1);
    pass(150).await;
    assert_eq!(harness.recorder.persisted.load(Ordering::SeqCst), 1);
    pass(51).await;
    assert_eq!(harness.recorder.persisted.load(Ordering::SeqCst), 2);

    harness.stop().await;
}

#[tokio::test(start_paused = true)]
async fn shutdown_stops_the_loop_and_leaves_pending_requests_unreleased() {
    let harness = Harness::start(timing(20, MIN_INTERVAL), Duration::ZERO, None);
    harness.requests(5);
    settle().await;
    // Recorded durably, which is what the next start recovers from.
    assert_eq!(harness.recorder.persisted.load(Ordering::SeqCst), 1);
    let recorder = Arc::clone(&harness.recorder);

    assert!(harness.stop().await.is_empty());
    // The loop is gone, so the quiet window running out releases nothing.
    pass(24 * 3600).await;
    assert!(recorder.releases().is_empty());
}

#[tokio::test(start_paused = true)]
async fn shutdown_stops_an_idle_loop() {
    let harness = Harness::start(timing(20, MIN_INTERVAL), Duration::ZERO, None);
    settle().await;
    assert!(harness.stop().await.is_empty());
}

#[tokio::test(start_paused = true)]
async fn a_threshold_below_one_releases_every_request() {
    let harness = Harness::start(timing(0, Duration::ZERO), Duration::ZERO, None);
    harness.requests(1);
    settle().await;
    assert_eq!(harness.stop().await, vec![(0, ReleaseReason::Threshold, 1)]);
}
