//! Tests for the driver's wait on a store that cannot take its run's tree
//! (`retry_until_stored`): how long it holds the tree, what it tells the backend
//! while it does (a repeated `storing` report after each failed attempt another
//! follows), and what ends it.
//!
//! The attempts are scripted and the clock is paused, so every duration here is
//! exact and no test waits on real time or on a socket.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

use tokio::sync::Notify;
use tokio::time::Instant;

use super::{StoreWait, UploadEnd, UploadError, UploadFailure, UploadRetry, retry_until_stored};

/// What a wait told its surroundings, in order, with the second each arrived at.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Told {
    /// A failed attempt another follows, with its reason: a repeated `storing`
    /// report.
    Waiting(u64, String),
}

/// A [`StoreWait`] that records what it is told and is canceled on demand.
struct Recorder {
    started: Instant,
    told: Mutex<Vec<Told>>,
    cancel: Notify,
    /// Whether the run was canceled before its upload began.
    already_canceled: bool,
}

impl Recorder {
    fn new() -> Self {
        Self {
            started: Instant::now(),
            told: Mutex::new(Vec::new()),
            cancel: Notify::new(),
            already_canceled: false,
        }
    }

    /// The wait of a run that was canceled before its upload began.
    fn already_canceled() -> Self {
        Self {
            already_canceled: true,
            ..Self::new()
        }
    }

    fn told(&self) -> Vec<Told> {
        self.told.lock().unwrap().clone()
    }

    fn second(&self) -> u64 {
        self.started.elapsed().as_secs()
    }
}

impl StoreWait for Recorder {
    async fn already_canceled(&self) -> bool {
        self.already_canceled
    }

    async fn waiting(&self, reason: &str) {
        self.told
            .lock()
            .unwrap()
            .push(Told::Waiting(self.second(), reason.to_string()));
    }

    async fn canceled(&self) {
        self.cancel.notified().await
    }
}

fn status(code: u16) -> UploadError {
    UploadError::Status {
        status: reqwest::StatusCode::from_u16(code).unwrap(),
        body: String::new(),
    }
}

/// Attempts that answer from `script` in order and then repeat `then` for good.
/// Each attempt records the second it was made at.
struct Script {
    answers: Mutex<VecDeque<Option<u16>>>,
    then: Option<u16>,
    made_at: Mutex<Vec<u64>>,
    started: Instant,
}

impl Script {
    /// `None` is an attempt the store takes; `Some(code)` one it answers `code`.
    fn new(answers: impl IntoIterator<Item = Option<u16>>, then: Option<u16>) -> Self {
        Self {
            answers: Mutex::new(answers.into_iter().collect()),
            then,
            made_at: Mutex::new(Vec::new()),
            started: Instant::now(),
        }
    }

    fn attempt(&self) -> std::future::Ready<Result<(), UploadError>> {
        self.made_at
            .lock()
            .unwrap()
            .push(self.started.elapsed().as_secs());
        let answer = self
            .answers
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(self.then);
        std::future::ready(match answer {
            None => Ok(()),
            Some(code) => Err(status(code)),
        })
    }

    fn made_at(&self) -> Vec<u64> {
        self.made_at.lock().unwrap().clone()
    }
}

async fn run(retry: UploadRetry, wait: &Recorder, script: &Script) -> Result<(), UploadFailure> {
    retry_until_stored(&retry, wait, "run-1", || script.attempt()).await
}

#[tokio::test(start_paused = true)]
async fn an_upload_that_lands_first_time_reports_nothing() {
    let wait = Recorder::new();
    let script = Script::new([None], None);

    run(UploadRetry::default(), &wait, &script).await.unwrap();

    assert_eq!(script.made_at(), [0]);
    assert_eq!(wait.told(), [], "a run that stored its tree never waited");
}

#[tokio::test(start_paused = true)]
async fn a_store_condition_is_retried_backing_off_to_once_a_minute() {
    let wait = Recorder::new();
    // Seven failures, then the store takes the tree.
    let script = Script::new([Some(500); 7].into_iter().chain([None]), None);

    run(UploadRetry::default(), &wait, &script).await.unwrap();

    // Waits of 5, 10, 20, 40 and then 60 seconds.
    assert_eq!(script.made_at(), [0, 5, 15, 35, 75, 135, 195, 255]);
    let told = wait.told();
    // One report per failed attempt, each before the wait that follows it, and
    // none once the tree lands.
    let reported_at: Vec<u64> = told.iter().map(|Told::Waiting(at, _)| *at).collect();
    assert_eq!(reported_at, [0, 5, 15, 35, 75, 135, 195]);
    assert!(matches!(
        &told[0],
        Told::Waiting(_, reason) if reason.contains("HTTP 500")
    ));
}

#[tokio::test(start_paused = true)]
async fn the_reason_reported_is_the_latest_failure() {
    let wait = Recorder::new();
    let script = Script::new([Some(500), Some(401), None], None);

    run(UploadRetry::default(), &wait, &script).await.unwrap();

    let reasons: Vec<String> = wait
        .told()
        .into_iter()
        .map(|Told::Waiting(_, reason)| reason)
        .collect();
    assert_eq!(reasons.len(), 2);
    assert!(reasons[0].contains("HTTP 500"), "{reasons:?}");
    assert!(reasons[1].contains("HTTP 401"), "{reasons:?}");
}

#[tokio::test(start_paused = true)]
async fn the_driver_holds_the_tree_for_six_hours_before_giving_up() {
    let wait = Recorder::new();
    let script = Script::new([], Some(503));
    let started = Instant::now();

    let failure = run(UploadRetry::default(), &wait, &script)
        .await
        .expect_err("the store never takes the tree");

    assert_eq!(failure.end, UploadEnd::GaveUp);
    assert!(
        matches!(failure.error, Some(UploadError::Status { status, .. }) if status.as_u16() == 503)
    );
    // The last attempt is made as the bound passes, not a delay after it.
    assert_eq!(started.elapsed(), Duration::from_secs(6 * 3600));
    let made_at = script.made_at();
    assert_eq!(made_at.last(), Some(&(6 * 3600)));
    // 5 + 10 + 20 + 40 seconds of back-off, then one attempt a minute.
    assert!(
        made_at.windows(2).all(|pair| pair[1] - pair[0] <= 60),
        "never slower than once a minute"
    );
    assert!(made_at.len() > 6 * 60 - 2 && made_at.len() < 6 * 60 + 6);
    // Every failure another attempt followed was reported; the last one, which
    // the deadline ended the upload on, goes to the terminal report instead.
    assert_eq!(wait.told().len(), made_at.len() - 1);
}

#[tokio::test(start_paused = true)]
async fn an_outage_far_longer_than_a_restart_does_not_lose_the_tree() {
    // The store is down for three hours and then takes the tree.
    let wait = Recorder::new();
    let script = Script::new([Some(502); 181], None);

    run(UploadRetry::default(), &wait, &script).await.unwrap();

    assert!(*script.made_at().last().unwrap() > 2 * 3600);
}

#[tokio::test(start_paused = true)]
async fn the_wait_bound_is_the_configured_one() {
    let wait = Recorder::new();
    let script = Script::new([], Some(500));
    let started = Instant::now();

    let failure = run(
        UploadRetry::waiting_for(Duration::from_secs(90)),
        &wait,
        &script,
    )
    .await
    .unwrap_err();

    assert_eq!(failure.end, UploadEnd::GaveUp);
    assert_eq!(started.elapsed(), Duration::from_secs(90));
    // 0, 5, 15, 35, 75, and the last cut to the bound.
    assert_eq!(script.made_at(), [0, 5, 15, 35, 75, 90]);
}

#[tokio::test(start_paused = true)]
async fn a_zero_bound_is_one_attempt_and_no_report() {
    let wait = Recorder::new();
    let script = Script::new([], Some(500));

    let failure = run(UploadRetry::single_attempt(), &wait, &script)
        .await
        .unwrap_err();

    assert_eq!(failure.end, UploadEnd::GaveUp);
    assert_eq!(script.made_at(), [0]);
    assert_eq!(wait.told(), []);
}

#[tokio::test(start_paused = true)]
async fn a_failure_that_is_the_runs_own_is_never_waited_on() {
    for code in [413, 400, 422] {
        let wait = Recorder::new();
        let script = Script::new([], Some(code));
        let started = Instant::now();

        let failure = run(UploadRetry::default(), &wait, &script)
            .await
            .unwrap_err();

        assert_eq!(failure.end, UploadEnd::RunsOwn, "HTTP {code}");
        assert_eq!(script.made_at(), [0]);
        assert_eq!(started.elapsed(), Duration::ZERO);
        // Nothing is reported, so this run holds no other run back.
        assert_eq!(wait.told(), []);
    }
}

#[tokio::test(start_paused = true)]
async fn a_runs_own_failure_during_the_wait_ends_it_and_says_so() {
    let wait = Recorder::new();
    // The store recovers, and then refuses this tree as too large.
    let script = Script::new([Some(500), Some(500), Some(413)], None);

    let failure = run(UploadRetry::default(), &wait, &script)
        .await
        .unwrap_err();

    assert_eq!(failure.end, UploadEnd::RunsOwn);
    assert_eq!(script.made_at(), [0, 5, 15]);
    // The two store failures were reported; the refusal ends the upload unreported.
    assert_eq!(wait.told().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_cancellation_ends_the_wait_at_once() {
    let wait = Recorder::new();
    let script = Script::new([], Some(500));

    let outcome = {
        let upload = run(UploadRetry::default(), &wait, &script);
        tokio::pin!(upload);
        // An hour into the wait, mid-sleep between two attempts.
        tokio::select! {
            _ = &mut upload => panic!("the store never takes the tree"),
            () = tokio::time::sleep(Duration::from_secs(3600) + Duration::from_secs(1)) => {}
        }
        let canceled_at = Instant::now();
        wait.cancel.notify_one();
        let outcome = upload.await;
        assert_eq!(
            canceled_at.elapsed(),
            Duration::ZERO,
            "the wait ends without sleeping out its delay"
        );
        outcome
    };

    let failure = outcome.unwrap_err();
    assert_eq!(failure.end, UploadEnd::Canceled);
    // A canceled job takes no further report: the last one is the failure before
    // the cancellation, made at the hour's last attempt.
    let reported = wait.told().len();
    assert_eq!(reported, script.made_at().len());
}

#[tokio::test(start_paused = true)]
async fn a_cancellation_ends_an_attempt_in_flight_during_the_wait() {
    let wait = Recorder::new();
    let attempts = Mutex::new(0u32);
    // The first attempt fails; the second never answers, as an upload to a service
    // that has stopped reading does until its stall timeout.
    let attempt = || {
        let mut attempts = attempts.lock().unwrap();
        *attempts += 1;
        let first = *attempts == 1;
        async move {
            if first {
                Err(status(500))
            } else {
                std::future::pending().await
            }
        }
    };

    let policy = UploadRetry::default();
    let upload = retry_until_stored(&policy, &wait, "run-1", attempt);
    tokio::pin!(upload);
    tokio::select! {
        _ = &mut upload => panic!("the second attempt never answers"),
        () = tokio::time::sleep(Duration::from_secs(30)) => {}
    }
    assert_eq!(
        *attempts.lock().unwrap(),
        2,
        "the second attempt is in flight"
    );
    wait.cancel.notify_one();

    assert_eq!(upload.await.unwrap_err().end, UploadEnd::Canceled);
}

#[tokio::test(start_paused = true)]
async fn a_cancellation_ends_a_first_attempt_that_never_answers() {
    // A store that accepts the upload and then hangs fails nothing until the
    // stall timeout, and an operator's cancellation must not have to wait for it.
    let wait = Recorder::new();
    let policy = UploadRetry::default();
    let upload = retry_until_stored(&policy, &wait, "run-1", || {
        std::future::pending::<Result<(), UploadError>>()
    });
    tokio::pin!(upload);
    tokio::select! {
        _ = &mut upload => panic!("the first attempt never answers"),
        () = tokio::time::sleep(Duration::from_secs(10)) => {}
    }
    let canceled_at = Instant::now();
    wait.cancel.notify_one();

    let failure = upload.await.unwrap_err();

    assert_eq!(canceled_at.elapsed(), Duration::ZERO);
    assert_eq!(failure.end, UploadEnd::Canceled);
    // No attempt had failed, so nothing says the store was at fault.
    assert!(failure.error.is_none());
    assert_eq!(failure.store_fault(), None);
}

#[tokio::test(start_paused = true)]
async fn the_upload_of_an_already_canceled_run_is_not_ended_by_its_cancellation() {
    // A canceled gg run uploads its tree after the cancellation: the job is
    // already canceled when the first attempt starts. The store is restarting, so
    // the first two attempts fail and the third lands. A cancellation that is
    // signaled the whole time changes none of it.
    let wait = Recorder::already_canceled();
    wait.cancel.notify_one();
    let script = Script::new([Some(502), Some(502), None], None);

    run(UploadRetry::default(), &wait, &script).await.unwrap();

    assert_eq!(script.made_at(), [0, 5, 15]);
    assert_eq!(wait.told().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn an_already_canceled_run_is_waited_on_for_ten_minutes_and_no_longer() {
    // Nothing can end this wait and no console shows it, so it is bounded far
    // below the wait of a run an operator can still cancel.
    let wait = Recorder::already_canceled();
    let script = Script::new([], Some(500));
    let started = Instant::now();

    let failure = run(UploadRetry::default(), &wait, &script)
        .await
        .unwrap_err();

    assert_eq!(failure.end, UploadEnd::GaveUp);
    assert_eq!(started.elapsed(), Duration::from_secs(600));
    // Its failure is the store's, and is reported as that.
    assert!(failure.store_fault().is_some());
}

#[tokio::test(start_paused = true)]
async fn a_short_configured_wait_bounds_an_already_canceled_run_too() {
    let wait = Recorder::already_canceled();
    let script = Script::new([], Some(500));
    let started = Instant::now();

    let failure = run(
        UploadRetry::waiting_for(Duration::from_secs(120)),
        &wait,
        &script,
    )
    .await
    .unwrap_err();

    assert_eq!(failure.end, UploadEnd::GaveUp);
    assert_eq!(started.elapsed(), Duration::from_secs(120));
}

#[tokio::test(start_paused = true)]
async fn what_ended_the_upload_decides_whether_the_store_is_named_as_the_cause() {
    // Gave up on a store condition: the store's.
    let failure = run(
        UploadRetry::waiting_for(Duration::from_secs(60)),
        &Recorder::new(),
        &Script::new([], Some(500)),
    )
    .await
    .unwrap_err();
    assert_eq!(failure.end, UploadEnd::GaveUp);
    assert_eq!(
        failure.store_fault().as_deref(),
        Some("the artifact service rejected the upload: HTTP 500 Internal Server Error")
    );

    // Refused as the run's own, at once or after a wait: not the store's.
    for script in [
        Script::new([Some(413)], None),
        Script::new([Some(500), Some(413)], None),
    ] {
        let failure = run(UploadRetry::default(), &Recorder::new(), &script)
            .await
            .unwrap_err();
        assert_eq!(failure.end, UploadEnd::RunsOwn);
        assert_eq!(failure.store_fault(), None);
    }
}

#[tokio::test(start_paused = true)]
async fn a_run_canceled_out_of_a_wait_names_the_store_as_the_cause() {
    let wait = Recorder::new();
    let script = Script::new([], Some(503));
    let upload = run(UploadRetry::default(), &wait, &script);
    tokio::pin!(upload);
    tokio::select! {
        _ = &mut upload => panic!("the store never takes the tree"),
        () = tokio::time::sleep(Duration::from_secs(120)) => {}
    }
    wait.cancel.notify_one();

    let failure = upload.await.unwrap_err();

    // The operator ended the wait; the store is still why the tree is gone.
    assert_eq!(failure.end, UploadEnd::Canceled);
    assert!(failure.store_fault().is_some());
}
