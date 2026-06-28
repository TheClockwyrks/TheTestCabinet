use super::*;
use test_cabinet_core::PublishState;

fn progress(message: &str) -> PublishProgress {
    PublishProgress {
        message: message.to_string(),
    }
}

fn success() -> PublishResult {
    PublishResult {
        state: PublishState::Succeeded,
        source_repo: Some("https://github.com/x/y".to_string()),
        playable_build: Some("https://abc.pages.dev".to_string()),
        detail: None,
    }
}

/// A subscriber present before any item is emitted receives each progress line and
/// then the terminal result over its live receiver, in order.
#[tokio::test]
async fn a_live_subscriber_sees_progress_then_the_terminal_result() {
    let relay = PublishRelay::new();
    let live = relay.live("p1");
    let mut sub = live.subscribe().receiver;

    live.push_progress(progress("creating repo"));
    live.finish(success());

    let first = sub.recv().await.unwrap();
    assert!(
        matches!(&first, PublishStreamItem::Progress(p) if p.message == "creating repo"),
        "the first live item is the progress line"
    );
    let second = sub.recv().await.unwrap();
    assert!(
        matches!(&second, PublishStreamItem::Result(r) if r.state == PublishState::Succeeded),
        "the terminal item is the result"
    );
}

/// A subscriber that connects *after* the publish finished is replayed the whole
/// backlog — the progress lines and the terminal result — and sees `terminated`.
#[tokio::test]
async fn a_late_subscriber_replays_the_backlog_ending_in_the_result() {
    let relay = PublishRelay::new();
    let live = relay.live("p1");
    live.push_progress(progress("creating repo"));
    live.push_progress(progress("deploying"));
    live.finish(success());

    let sub = live.subscribe();
    assert!(
        sub.terminated,
        "the publish is already terminal at subscribe"
    );
    assert_eq!(sub.backlog.len(), 3, "two progress lines plus the result");
    assert!(matches!(
        &sub.backlog[0],
        PublishStreamItem::Progress(p) if p.message == "creating repo"
    ));
    assert!(matches!(
        &sub.backlog[2],
        PublishStreamItem::Result(r) if r.state == PublishState::Succeeded
    ));
}

/// The terminal result is recorded once: a second `finish` (e.g. a retried report)
/// and any post-terminal progress are ignored, so the recorded outcome is stable.
#[tokio::test]
async fn finish_is_idempotent_and_progress_after_terminal_is_dropped() {
    let relay = PublishRelay::new();
    let live = relay.live("p1");
    live.finish(success());
    // A second terminal result and a late progress line must not change the backlog.
    live.finish(PublishResult {
        state: PublishState::Failed,
        source_repo: None,
        playable_build: None,
        detail: Some("late failure".to_string()),
    });
    live.push_progress(progress("too late"));

    let sub = live.subscribe();
    assert_eq!(
        sub.backlog.len(),
        1,
        "only the first terminal result is kept"
    );
    assert!(matches!(
        &sub.backlog[0],
        PublishStreamItem::Result(r) if r.state == PublishState::Succeeded
    ));
}

/// `live(id)` returns the same shared relay for the same id, so the ingestion
/// handler and a subscriber connecting separately see one backlog.
#[tokio::test]
async fn live_returns_the_same_shared_relay_per_id() {
    let relay = PublishRelay::new();
    relay.live("p1").push_progress(progress("hello"));
    // A handle resolved separately sees the already-pushed item.
    let sub = relay.live("p1").subscribe();
    assert_eq!(sub.backlog.len(), 1);
    // A different id is a distinct, empty relay.
    assert!(relay.live("p2").subscribe().backlog.is_empty());
}
