use super::*;

use test_cabinet_core::JobState;
use tokio::sync::broadcast::error::TryRecvError;

fn summary() -> JobSummary {
    JobSummary {
        test_case_slug: "carom".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness_slug: "claude".to_string(),
        model_id: "m".to_string(),
    }
}

fn alert() -> Notification {
    Notification::completed("job-1", summary(), "rec-1")
}

fn run_event() -> RunEvent {
    RunEvent::state_changed("job-1", summary(), JobState::Running)
}

// Drain what a stream would actually deliver: the messages on its receiver that
// pass its own topic filter. Mirrors the per-message check the SSE handler applies.
fn delivered(handle: &mut StreamHandle) -> Vec<StreamMessage> {
    let mut out = Vec::new();
    loop {
        match handle.receiver.try_recv() {
            Ok(message) => {
                if handle.wants(&message) {
                    out.push(message);
                }
            }
            Err(TryRecvError::Empty | TryRecvError::Closed) => return out,
            Err(TryRecvError::Lagged(_)) => continue,
        }
    }
}

fn is_alert(message: &StreamMessage) -> bool {
    matches!(message, StreamMessage::Notification(_))
}

fn is_run(message: &StreamMessage) -> bool {
    matches!(message, StreamMessage::Run(_))
}

// --- Default topics ---------------------------------------------------------

#[test]
fn a_new_stream_gets_alerts_but_not_run_events() {
    // The defaults are the whole reason the console can hold one stream open for the
    // session: alerts must arrive wherever the user is, while run churn is opt-in.
    let notifier = Notifier::new();
    let mut handle = notifier.open_stream();

    notifier.notify(alert());
    notifier.publish_run(run_event());

    let messages = delivered(&mut handle);
    assert_eq!(messages.len(), 1);
    assert!(is_alert(&messages[0]));
}

#[test]
fn enabling_the_runs_topic_delivers_run_events() {
    let notifier = Notifier::new();
    let mut handle = notifier.open_stream();
    assert!(notifier.set_topics(&handle.id, None, Some(true)));

    notifier.notify(alert());
    notifier.publish_run(run_event());

    let messages = delivered(&mut handle);
    assert_eq!(messages.len(), 2);
    assert!(is_alert(&messages[0]));
    assert!(is_run(&messages[1]));
}

#[test]
fn a_topic_change_applies_to_a_stream_that_is_already_connected() {
    // The point of the control endpoint: the toggle arrives on a different request
    // than the one serving the stream, and must not require a reconnect.
    let notifier = Notifier::new();
    let mut handle = notifier.open_stream();

    notifier.publish_run(run_event());
    assert!(delivered(&mut handle).is_empty());

    notifier.set_topics(&handle.id, None, Some(true));
    notifier.publish_run(run_event());
    assert_eq!(delivered(&mut handle).len(), 1);

    // ...and back off again, which is what leaving the runs pages does.
    notifier.set_topics(&handle.id, None, Some(false));
    notifier.publish_run(run_event());
    assert!(delivered(&mut handle).is_empty());
}

#[test]
fn an_omitted_topic_is_left_alone() {
    // The console toggles `runs` on navigation and must never disturb its alerts
    // doing so — which is why the body's fields are optional rather than a full
    // restatement of the topic set.
    let notifier = Notifier::new();
    let mut handle = notifier.open_stream();
    notifier.set_topics(&handle.id, None, Some(true));

    notifier.notify(alert());
    assert_eq!(delivered(&mut handle).len(), 1);

    // Turning `runs` off says nothing about `notifications`.
    notifier.set_topics(&handle.id, None, Some(false));
    notifier.notify(alert());
    assert_eq!(delivered(&mut handle).len(), 1);
}

// --- Per-stream isolation ---------------------------------------------------

#[test]
fn topics_are_per_stream_not_worker_wide() {
    // Two consoles, one on a runs page and one not. The second must not start
    // receiving run events because the first asked for them.
    let notifier = Notifier::new();
    let mut watching = notifier.open_stream();
    let mut idle = notifier.open_stream();
    notifier.set_topics(&watching.id, None, Some(true));

    notifier.publish_run(run_event());

    assert_eq!(delivered(&mut watching).len(), 1);
    assert!(delivered(&mut idle).is_empty());
}

#[test]
fn every_stream_receives_alerts_regardless_of_who_launched_the_run() {
    // The feed is deliberately worker-wide: a console is shown every run finishing,
    // not only the ones it started.
    let notifier = Notifier::new();
    let mut first = notifier.open_stream();
    let mut second = notifier.open_stream();

    notifier.notify(alert());

    assert_eq!(delivered(&mut first).len(), 1);
    assert_eq!(delivered(&mut second).len(), 1);
}

// --- Registration lifecycle -------------------------------------------------

#[test]
fn a_dropped_stream_deregisters_itself() {
    // The registry must not grow as consoles come and go — a disconnect the handler
    // never sees still has to release its entry, which is what the drop guard is for.
    let notifier = Notifier::new();
    let handle = notifier.open_stream();
    let id = handle.id.clone();
    assert_eq!(notifier.connected_streams(), 1);

    drop(handle);

    assert_eq!(notifier.connected_streams(), 0);
    // And its id stops resolving, so a late topic change is reported rather than
    // silently applied to nothing.
    assert!(!notifier.set_topics(&id, None, Some(true)));
}

#[test]
fn setting_topics_on_an_unknown_stream_is_reported() {
    // This is what tells a console its `EventSource` reconnected under a new id and
    // that it must re-apply what it wanted.
    let notifier = Notifier::new();
    assert!(!notifier.set_topics("no-such-stream", None, Some(true)));
}

#[test]
fn publishing_with_no_streams_connected_is_a_no_op() {
    // Live-only: a run finishing while nobody is watching is simply not delivered,
    // and must not error or block ingestion.
    let notifier = Notifier::new();
    notifier.notify(alert());
    notifier.publish_run(run_event());
    assert_eq!(notifier.connected_streams(), 0);
}

// --- Ordering ---------------------------------------------------------------

#[test]
fn a_runs_finish_event_precedes_its_completion_alert() {
    // Both topics share one channel precisely so this order holds: a console removes
    // the run from its in-flight list before it toasts the completion, rather than
    // toasting a run it still shows as running.
    let notifier = Notifier::new();
    let mut handle = notifier.open_stream();
    notifier.set_topics(&handle.id, None, Some(true));

    notifier.publish_run(RunEvent::finished(
        "job-1",
        summary(),
        JobState::Succeeded,
        Some("rec-1"),
        None,
    ));
    notifier.notify(alert());

    let messages = delivered(&mut handle);
    assert_eq!(messages.len(), 2);
    assert!(is_run(&messages[0]));
    assert!(is_alert(&messages[1]));
}
