//! Tests for the step sequence and its `SIGTERM` handling, driven through a fake
//! [`Steps`] whose steps take a scripted time, with a hand-fired or timed
//! [`Shutdown`] and paused time, so every interleaving is deterministic.

use super::*;

use std::sync::{Arc, Mutex};

/// What happened, and when (seconds since the test started, under paused time).
type Log = Arc<Mutex<Vec<(u64, String)>>>;

/// A fake [`Steps`]: each step sleeps for its scripted time and logs its start
/// and end; the progress line named in `fire_on_progress` fires the trigger.
struct FakeSteps {
    start: Instant,
    log: Log,
    published: Option<ReleasedLinks>,
    download: Duration,
    deploy: Duration,
    deploy_fails: bool,
    publish: Duration,
    report: Duration,
    report_fails: bool,
    fire_on_progress: Option<(&'static str, ShutdownTrigger)>,
}

impl FakeSteps {
    fn new() -> Self {
        Self {
            start: Instant::now(),
            log: Log::default(),
            published: None,
            download: Duration::from_secs(1),
            deploy: Duration::from_secs(1),
            deploy_fails: false,
            publish: Duration::from_secs(1),
            report: Duration::ZERO,
            report_fails: false,
            fire_on_progress: None,
        }
    }

    fn note(&self, what: impl Into<String>) {
        let at = self.start.elapsed().as_secs();
        self.log.lock().expect("lock").push((at, what.into()));
    }

    /// The logged events, without their times.
    fn events(&self) -> Vec<String> {
        self.log
            .lock()
            .expect("lock")
            .iter()
            .map(|(_, what)| what.clone())
            .collect()
    }

    /// When `what` was logged, in seconds since the start.
    fn at(&self, what: &str) -> Option<u64> {
        self.log
            .lock()
            .expect("lock")
            .iter()
            .find(|(_, logged)| logged == what)
            .map(|(at, _)| *at)
    }

    async fn timed(&self, name: &str, time: Duration) {
        self.note(format!("{name} start"));
        tokio::time::sleep(time).await;
        self.note(format!("{name} end"));
    }
}

#[async_trait::async_trait(?Send)]
impl Steps for FakeSteps {
    async fn preflight(&mut self) -> Result<Option<ReleasedLinks>, String> {
        self.note("preflight");
        Ok(self.published.clone())
    }

    async fn download(&mut self) -> Result<(), String> {
        self.timed("download", self.download).await;
        Ok(())
    }

    async fn deploy(&mut self) -> Result<Option<String>, String> {
        self.timed("deploy", self.deploy).await;
        if self.deploy_fails {
            return Err("wrangler failed".to_string());
        }
        Ok(Some("https://abc.pages.dev".to_string()))
    }

    async fn publish_repository(&mut self) -> Result<Option<String>, String> {
        self.timed("publish", self.publish).await;
        Ok(Some("https://github.com/org/repo".to_string()))
    }

    async fn progress(&mut self, message: &str) {
        self.note(format!("progress: {message}"));
        if let Some((on, trigger)) = &self.fire_on_progress
            && *on == message
        {
            trigger.fire();
        }
    }

    async fn report(&mut self, result: &PublishResult) -> Result<(), String> {
        self.timed("report", self.report).await;
        self.note(format!(
            "reported {:?}: {}",
            result.state,
            result.detail.as_deref().unwrap_or("")
        ));
        if self.report_fails {
            return Err("backend down".to_string());
        }
        Ok(())
    }
}

/// A shutdown that fires `after` the test's start, as the signal task would.
fn signal_after(after: Duration) -> Shutdown {
    Shutdown::on(tokio::time::sleep(after))
}

fn detail(outcome: &Outcome) -> &str {
    outcome.result.detail.as_deref().unwrap_or("")
}

const GRACE: Duration = Duration::from_secs(30);

#[test]
fn the_grace_period_keeps_a_reserve_for_the_report() {
    let grace = Grace::new(GRACE);
    assert_eq!(grace.report_reserve, REPORT_RESERVE);
    assert_eq!(grace.step_budget(), Duration::from_secs(20));

    // A short grace period keeps half of itself for the report.
    let short = Grace::new(Duration::from_secs(4));
    assert_eq!(short.report_reserve, Duration::from_secs(2));
    assert_eq!(short.step_budget(), Duration::from_secs(2));

    assert_eq!(Grace::new(Duration::ZERO).step_budget(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn without_a_signal_every_step_runs_in_order_and_success_is_reported() {
    let mut steps = FakeSteps::new();
    let outcome = run(&mut steps, &Shutdown::never(), Grace::new(GRACE)).await;

    assert!(outcome.succeeded(), "{outcome:?}");
    assert_eq!(outcome.result.state, PublishState::Succeeded);
    assert_eq!(
        outcome.result.playable_build.as_deref(),
        Some("https://abc.pages.dev")
    );
    assert_eq!(
        outcome.result.source_repo.as_deref(),
        Some("https://github.com/org/repo")
    );
    assert_eq!(
        steps.events(),
        [
            "preflight",
            "progress: downloading the run's source tree",
            "download start",
            "download end",
            "progress: deploying the playable build",
            "deploy start",
            "deploy end",
            "progress: publishing the source repository",
            "publish start",
            "publish end",
            "progress: release complete",
            "report start",
            "report end",
            "reported Succeeded: ",
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn an_already_published_run_reports_its_links_and_nothing_else() {
    let mut steps = FakeSteps::new();
    steps.published = Some(ReleasedLinks {
        source_repo: Some("https://github.com/org/old".into()),
        playable_build: Some("https://old.pages.dev".into()),
    });
    let outcome = run(&mut steps, &Shutdown::never(), Grace::new(GRACE)).await;

    assert!(outcome.succeeded(), "{outcome:?}");
    assert_eq!(
        outcome.result.source_repo.as_deref(),
        Some("https://github.com/org/old")
    );
    let events = steps.events();
    assert!(
        !events.iter().any(|e| e.starts_with("download")),
        "{events:?}"
    );
    assert!(
        !events.iter().any(|e| e.starts_with("deploy")),
        "{events:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_failing_step_fails_the_publish_and_starts_nothing_after_it() {
    let mut steps = FakeSteps::new();
    steps.deploy_fails = true;
    let outcome = run(&mut steps, &Shutdown::never(), Grace::new(GRACE)).await;

    assert!(!outcome.succeeded());
    assert!(outcome.reported);
    assert_eq!(outcome.result.state, PublishState::Failed);
    assert_eq!(detail(&outcome), "wrangler failed");
    assert!(!steps.events().iter().any(|e| e.starts_with("publish ")));
}

#[tokio::test(start_paused = true)]
async fn a_signal_before_the_first_step_starts_no_step() {
    let (trigger, shutdown) = Shutdown::channel();
    trigger.fire();
    let mut steps = FakeSteps::new();
    let outcome = run(&mut steps, &shutdown, Grace::new(GRACE)).await;

    assert!(!outcome.succeeded());
    assert!(outcome.reported, "the interruption is still reported");
    assert_eq!(outcome.result.state, PublishState::Failed);
    assert_eq!(
        detail(&outcome),
        "publisher interrupted by SIGTERM before the publication preflight"
    );
    assert_eq!(
        steps.events(),
        [
            "report start",
            "report end",
            "reported Failed: publisher interrupted by SIGTERM before the publication preflight",
        ]
    );
}

#[tokio::test(start_paused = true)]
async fn a_signal_between_steps_starts_no_further_step() {
    // The signal arrives after the download ended, while the progress line
    // announcing the Pages deploy is sent: the deploy never starts.
    let (trigger, shutdown) = Shutdown::channel();
    let mut steps = FakeSteps::new();
    steps.fire_on_progress = Some(("deploying the playable build", trigger));
    let outcome = run(&mut steps, &shutdown, Grace::new(GRACE)).await;

    assert!(!outcome.succeeded());
    assert!(outcome.reported);
    assert_eq!(
        detail(&outcome),
        "publisher interrupted by SIGTERM before the Pages deploy"
    );
    let events = steps.events();
    assert!(events.contains(&"download end".to_string()), "{events:?}");
    assert!(
        !events.iter().any(|e| e.starts_with("deploy ")),
        "{events:?}"
    );
    assert!(
        !events.iter().any(|e| e.starts_with("publish ")),
        "{events:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_step_ending_within_the_grace_period_finishes_then_reports_interrupted() {
    // The download takes 1 s and the deploy 15 s from t=1; the signal at t=5
    // leaves the deploy 20 s (30 s less the 10 s reserve), so it ends at t=16.
    let mut steps = FakeSteps::new();
    steps.deploy = Duration::from_secs(15);
    let shutdown = signal_after(Duration::from_secs(5));
    let outcome = run(&mut steps, &shutdown, Grace::new(GRACE)).await;

    assert!(!outcome.succeeded());
    assert!(outcome.reported);
    assert_eq!(outcome.result.state, PublishState::Failed);
    assert_eq!(
        detail(&outcome),
        "publisher interrupted by SIGTERM during the Pages deploy"
    );
    assert_eq!(steps.at("deploy end"), Some(16), "the deploy finished");
    assert_eq!(
        steps.at("report start"),
        Some(16),
        "reported right after it"
    );
    let events = steps.events();
    assert!(
        !events.iter().any(|e| e.starts_with("publish ")),
        "{events:?}"
    );
    assert!(
        !events.iter().any(|e| e.contains("publishing the source")),
        "no progress line after the signal: {events:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_step_failing_within_the_grace_period_reports_interrupted_with_its_failure() {
    let mut steps = FakeSteps::new();
    steps.deploy = Duration::from_secs(15);
    steps.deploy_fails = true;
    let shutdown = signal_after(Duration::from_secs(5));
    let outcome = run(&mut steps, &shutdown, Grace::new(GRACE)).await;

    assert_eq!(
        detail(&outcome),
        "publisher interrupted by SIGTERM during the Pages deploy; the step failed: wrangler failed"
    );
}

#[tokio::test(start_paused = true)]
async fn a_step_outlasting_the_grace_period_is_abandoned_and_reports_interrupted() {
    // The deploy would take 60 s from t=1; the signal at t=5 gives it until
    // t=25, when it is abandoned and the report is made in the reserve.
    let mut steps = FakeSteps::new();
    steps.deploy = Duration::from_secs(60);
    let shutdown = signal_after(Duration::from_secs(5));
    let outcome = run(&mut steps, &shutdown, Grace::new(GRACE)).await;

    assert!(!outcome.succeeded());
    assert!(outcome.reported);
    assert_eq!(outcome.result.state, PublishState::Failed);
    assert!(
        detail(&outcome).starts_with("publisher interrupted by SIGTERM during the Pages deploy;"),
        "{outcome:?}"
    );
    assert!(detail(&outcome).contains("abandoned"), "{outcome:?}");
    assert_eq!(steps.at("deploy start"), Some(1));
    assert_eq!(steps.at("deploy end"), None, "the deploy was abandoned");
    assert_eq!(steps.at("report start"), Some(25));
    assert!(!steps.events().iter().any(|e| e.starts_with("publish ")));
}

#[tokio::test(start_paused = true)]
async fn the_report_after_an_interruption_is_bounded_by_the_grace_period() {
    // Abandoned at t=25; the report never lands, and is given up at t=35, the
    // end of the grace period from the signal at t=5.
    let mut steps = FakeSteps::new();
    steps.deploy = Duration::from_secs(60);
    steps.report = Duration::from_secs(3600);
    let shutdown = signal_after(Duration::from_secs(5));
    let started = Instant::now();
    let outcome = run(&mut steps, &shutdown, Grace::new(GRACE)).await;

    assert!(!outcome.reported);
    assert!(!outcome.succeeded());
    assert_eq!(started.elapsed(), Duration::from_secs(35));
}

#[tokio::test(start_paused = true)]
async fn a_signal_during_the_success_report_lets_it_finish() {
    // Every step ends by t=3; the report takes 10 s and the signal comes at t=5.
    let mut steps = FakeSteps::new();
    steps.report = Duration::from_secs(10);
    let shutdown = signal_after(Duration::from_secs(5));
    let outcome = run(&mut steps, &shutdown, Grace::new(GRACE)).await;

    assert!(outcome.succeeded(), "{outcome:?}");
    assert_eq!(steps.at("report end"), Some(13));
}

#[tokio::test(start_paused = true)]
async fn a_report_that_does_not_land_is_not_a_success() {
    let mut steps = FakeSteps::new();
    steps.report_fails = true;
    let outcome = run(&mut steps, &Shutdown::never(), Grace::new(GRACE)).await;

    assert_eq!(outcome.result.state, PublishState::Succeeded);
    assert!(!outcome.reported);
    assert!(!outcome.succeeded());
}

#[tokio::test(start_paused = true)]
async fn a_shutdown_records_when_the_signal_arrived_once() {
    let (trigger, shutdown) = Shutdown::channel();
    assert_eq!(shutdown.received_at(), None);
    let start = Instant::now();
    tokio::time::sleep(Duration::from_secs(2)).await;
    trigger.fire();
    tokio::time::sleep(Duration::from_secs(2)).await;
    trigger.fire();
    assert_eq!(
        shutdown.received_at(),
        Some(start + Duration::from_secs(2)),
        "a second signal does not move the first"
    );
    assert_eq!(
        shutdown.clone().received().await,
        start + Duration::from_secs(2)
    );

    // A signal task that ended still leaves its time readable.
    let timed = signal_after(Duration::from_secs(1));
    let at = timed.received().await;
    assert_eq!(timed.received_at(), Some(at));
}
