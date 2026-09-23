//! The cancellation branch: which disposition each harness takes, and that the race
//! acts on it — the gg run waited for and handed its outcome through, the third-party
//! run abandoned at once without ever asking for a wind-down it cannot get.
//!
//! The race is driven with its `watch` future supplied directly (`ready(())` for
//! "already canceled", `pending()` for "never canceled") and with the clock paused, so
//! the whole decision runs for real with no backend, no container, and no wall-clock
//! waiting.
//!
//! What these deliberately do **not** cover: that the destroy path tears the sandbox
//! down, posts no status and uploads nothing. Those are dispatch decisions in the
//! driver's `main`, which owns a real `JobClient` and a real Kubernetes connection and
//! is not reachable from a test. The mitigation is [`CancelRace::Destroyed`] carrying no
//! payload — the arm handling it has nothing to build a record from — leaving one short
//! arm in `main` to read rather than a path to trust.

use super::*;

use std::time::Duration;

use test_cabinet_core::{EngineSelection, HarnessSlug, OrchestratorSelection, RunRequest};

/// A run request for the given harness. Only the harness is load-bearing here; every
/// other field is the cheapest value that type admits, since the disposition reads
/// nothing else.
fn request(harness: HarnessSlug) -> RunRequest {
    RunRequest {
        test_case_slug: "pong".to_string(),
        test_case_version: Some("v1.0.0".to_string()),
        variant: "base".to_string(),
        harness,
        model_id: "some-model".to_string(),
        orchestrator: OrchestratorSelection::default(),
        engine: EngineSelection::default(),
        max_runtime_override: None,
        container_image: None,
        gg_capability_set: None,
        gg_model_windows: Default::default(),
        gg_model_providers: Default::default(),
        gg_model_modalities: Default::default(),
    }
}

/// The wind-down grace the driver uses. Any duration works for the tests below — the
/// clock is paused — but using a realistic one keeps the expiry test honest about what
/// it is skipping past.
const GRACE: Duration = Duration::from_secs(1200);

#[test]
fn a_gg_run_winds_down_for_a_cancellation() {
    // gg observes the latch at its turn boundaries, so it is the one harness that can be
    // asked to stop and produce a record of what it got through.
    assert_eq!(
        cancel_disposition(&request(HarnessSlug::Gg)),
        CancelDisposition::WindDown,
    );
}

#[test]
fn every_third_party_harness_is_destroyed_immediately() {
    // The bug this branch fixes was not about one harness: *no* third-party CLI has a
    // wind-down protocol, so the whole catalog must land on the destroy path — and a
    // harness added to `ALL` later must land there too, until someone writes it one.
    for harness in HarnessSlug::ALL {
        assert_eq!(
            cancel_disposition(&request(harness)),
            CancelDisposition::DestroyNow,
            "{} has no wind-down protocol to be asked for",
            harness.as_str(),
        );
    }
}

#[tokio::test(start_paused = true)]
async fn a_canceled_third_party_run_is_abandoned_without_raising_the_latch() {
    // Raising the latch is what asks the engine to wind a session down. Nothing on this
    // path would observe it, so raising it would only start a wind-down whose record is
    // then thrown away — the run is abandoned instead, latch untouched.
    let cancel = RunCancellation::new();
    let raced: CancelRace<()> = race_cancellation(
        std::future::pending::<()>(),
        std::future::ready(()),
        &cancel,
        CancelDisposition::DestroyNow,
        GRACE,
    )
    .await;
    assert_eq!(raced, CancelRace::Destroyed);
    assert!(
        !cancel.is_canceled(),
        "the destroy path must not ask for a wind-down it cannot get"
    );
}

#[tokio::test(start_paused = true)]
async fn a_canceled_third_party_run_does_not_wait_out_the_grace() {
    // The operator-visible symptom of the old behaviour: a canceled third-party run held
    // its driver — and so a dispatcher scheduling slot — open for the full grace. The run
    // here never ends, so an implementation that still awaited it would sit on the grace
    // instead; the paused clock auto-advances to the nearest deadline while the runtime
    // is idle, so that regression surfaces as a `WindDownExpired` (or an outer timeout)
    // rather than a hang, and either way fails the assertion below.
    let cancel = RunCancellation::new();
    let raced = tokio::time::timeout(
        GRACE,
        race_cancellation(
            std::future::pending::<()>(),
            std::future::ready(()),
            &cancel,
            CancelDisposition::DestroyNow,
            GRACE,
        ),
    )
    .await
    .expect("a destroyed run resolves at once, without waiting on the run or the grace");
    assert_eq!(raced, CancelRace::Destroyed);
}

#[tokio::test(start_paused = true)]
async fn a_canceled_gg_run_raises_the_latch_and_keeps_awaiting_the_run() {
    // The gg contract, unchanged: the session is asked to stop, the driver keeps waiting,
    // and the outcome the post-session path produced is carried through intact. That
    // outcome is the state the run accumulated up to the kill, which is the entire reason
    // this path waits at all.
    let cancel = RunCancellation::new();
    let latch = cancel.clone();
    let run = async move {
        // Stands in for a gg session: it ends only once the kill has been signalled to
        // it, exactly as the in-container sentinel makes it.
        latch.canceled().await;
        "the record the session handed back"
    };
    let raced = race_cancellation(
        run,
        std::future::ready(()),
        &cancel,
        CancelDisposition::WindDown,
        GRACE,
    )
    .await;
    assert_eq!(
        raced,
        CancelRace::WoundDown("the record the session handed back"),
    );
    assert!(cancel.is_canceled(), "the wind-down path raises the latch");
}

#[tokio::test(start_paused = true)]
async fn a_gg_run_that_will_not_wind_down_gives_up_after_the_grace() {
    // The bound on the cooperative path. A session that will not stop must not hold the
    // driver open forever; past the grace the caller records the run from what it holds
    // itself, rather than waiting on an engine that is not coming back.
    let cancel = RunCancellation::new();
    let raced = tokio::spawn({
        let cancel = cancel.clone();
        async move {
            race_cancellation(
                std::future::pending::<()>(),
                std::future::ready(()),
                &cancel,
                CancelDisposition::WindDown,
                GRACE,
            )
            .await
        }
    });
    // Let the race observe the cancellation and park on the grace before skipping past it.
    tokio::task::yield_now().await;
    tokio::time::advance(GRACE + Duration::from_secs(1)).await;
    assert_eq!(
        raced.await.expect("the race task did not panic"),
        CancelRace::<()>::WindDownExpired,
    );
    assert!(
        cancel.is_canceled(),
        "the latch was raised even though the session never acted on it"
    );
}

#[tokio::test(start_paused = true)]
async fn an_uncanceled_run_of_either_harness_is_unaffected() {
    // The overwhelmingly common case: no kill, so neither disposition touches the run or
    // the latch, and the run's own outcome comes straight back.
    for disposition in [CancelDisposition::WindDown, CancelDisposition::DestroyNow] {
        let cancel = RunCancellation::new();
        let raced = race_cancellation(
            std::future::ready("the record the run produced"),
            std::future::pending(),
            &cancel,
            disposition,
            GRACE,
        )
        .await;
        assert_eq!(raced, CancelRace::Finished("the record the run produced"));
        assert!(!cancel.is_canceled(), "an uncanceled run raises nothing");
    }
}
