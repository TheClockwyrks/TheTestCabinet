//! Two replicas over one PostgreSQL database: what one accepts reaches a subscriber
//! of the other, the database locks hold the shared work to one replica, and a
//! replica whose listening connection drops resynchronizes its streams (the backend
//! overview's "Replicas").

use std::time::Duration;

use test_cabinet_contracts::event::{EventKind, HarnessEvent};
use test_cabinet_contracts::job_api::{JobState, JobSummary};
use test_cabinet_contracts::preview::AssetPreview;
use tokio::sync::broadcast;

use super::*;
use crate::db::DbLockKey;
use crate::db::tests::new_job;
use crate::relay::{StreamHandle, StreamItem};
use crate::test_postgres::TestPostgres;

/// How long a test waits for something another replica announced.
const WAIT: Duration = Duration::from_secs(10);

/// One replica: its state, its announcer and its running bus.
struct Replica {
    db: Arc<Db>,
    relay: crate::relay::Relay,
    publish_relay: crate::publish_relay::PublishRelay,
    publisher: crate::publisher::Publisher,
    announcer: Announcer,
    bus: BusHandle,
    _store: tempfile::TempDir,
}

impl Replica {
    /// A replica over `url`, migrated, its bus listening.
    async fn start(url: &str) -> Self {
        use test_cabinet_migration::MigratorTrait;
        let dir = tempfile::tempdir().unwrap();
        // nextest runs each test in its own process, so this environment is this
        // test's alone.
        unsafe {
            std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
            std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
        }
        let config = Arc::new(crate::config::Config::from_env().unwrap());
        let db = Db::connect(url).await.unwrap();
        test_cabinet_migration::Migrator::up(&db.connection(), None)
            .await
            .unwrap();
        let db = Arc::new(db);
        let store = crate::store::DefinitionStore::open(&config.store).unwrap();
        let (announcer, queue) = Announcer::new();
        let publisher = crate::publisher::Publisher::new(
            Arc::clone(&db),
            store.clone(),
            None,
            crate::publisher::PublisherTiming {
                coalesce: Duration::from_millis(10),
                snapshot_retention: Duration::from_secs(3600),
            },
        );
        publisher.share(announcer.clone());
        let state = AppState {
            db: Arc::clone(&db),
            store,
            ready: crate::readiness::Readiness::new(true),
            publisher: publisher.clone(),
            access: None,
            relay: crate::relay::Relay::shared(announcer.clone()),
            publish_relay: crate::publish_relay::PublishRelay::shared(announcer.clone()),
            config,
            http: reqwest::Client::new(),
            prices: crate::pricing::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models"),
            gg_docs: crate::gg_docs::GgDocIndex::new(),
        };
        let bus = spawn(state.clone(), announcer.clone(), queue);
        assert!(bus.wait_listening(WAIT).await, "the bus never listened");
        Self {
            db,
            relay: state.relay,
            publish_relay: state.publish_relay,
            publisher,
            announcer,
            bus,
            _store: dir,
        }
    }

    /// Wait until the bus listens.
    async fn listening(&self) {
        assert!(
            self.bus.wait_listening(WAIT).await,
            "the bus never listened"
        );
    }
}

/// Two replicas over a fresh server, with job `j1` queued, or `None` when the
/// machine has no PostgreSQL to start (see [`TestPostgres::start`]).
async fn two_replicas() -> Option<(TestPostgres, Replica, Replica)> {
    let postgres = TestPostgres::start()?;
    let a = Replica::start(&postgres.url).await;
    let b = Replica::start(&postgres.url).await;
    a.db.enqueue_job(new_job("j1", "2026-10-26T00:00:00Z"))
        .await
        .unwrap();
    Some((postgres, a, b))
}

fn event(message: &str) -> HarnessEvent {
    HarnessEvent {
        timestamp: "2026-10-26T00:00:00Z".to_string(),
        session_id: None,
        kind: EventKind::Agent {
            message: message.to_string(),
        },
    }
}

fn message(event: &HarnessEvent) -> &str {
    match &event.kind {
        EventKind::Agent { message } => message,
        other => panic!("not an agent event: {other:?}"),
    }
}

fn preview(frame: u32, operation_count: usize) -> AssetPreview {
    serde_json::from_value(serde_json::json!({
        "frame": frame,
        "operationCount": operation_count,
        "image": "iVBORw0KGgo=",
    }))
    .unwrap()
}

fn summary() -> JobSummary {
    JobSummary {
        test_case_slug: "carom".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        harness_slug: "claude".to_string(),
        model_id: "m".to_string(),
        engine: None,
        started_at: None,
        gg_preset: None,
    }
}

/// The next item on a job's live receiver.
async fn next_item(receiver: &mut broadcast::Receiver<StreamItem>) -> StreamItem {
    tokio::time::timeout(WAIT, receiver.recv())
        .await
        .expect("nothing arrived")
        .unwrap()
}

/// The next message on a console stream.
async fn next_message(stream: &mut StreamHandle) -> StreamMessage {
    tokio::time::timeout(WAIT, stream.receiver.recv())
        .await
        .expect("nothing arrived")
        .unwrap()
}

#[tokio::test]
async fn a_batch_stored_by_one_replica_reaches_a_subscriber_of_the_other() {
    let Some((_postgres, a, b)) = two_replicas().await else {
        return;
    };
    let mut subscription = b.relay.live("j1").subscribe();

    let stored =
        a.db.store_job_events("j1", 0, &[event("one"), event("two")])
            .await
            .unwrap();
    a.relay.live("j1").push_events(stored);

    for (expected_sequence, expected) in [(0, "one"), (1, "two")] {
        let StreamItem::Event { sequence, event } = next_item(&mut subscription.receiver).await
        else {
            panic!("not an event");
        };
        assert_eq!((sequence, message(&event)), (expected_sequence, expected));
    }
}

#[tokio::test]
async fn a_preview_reaches_the_other_replica_and_its_end_deletes_the_stored_frames() {
    let Some((_postgres, a, b)) = two_replicas().await else {
        return;
    };
    let mut subscription = b.relay.live("j1").subscribe();

    a.db.store_job_preview("j1", &preview(0, 1)).await.unwrap();
    a.db.store_job_preview("j1", &preview(0, 2)).await.unwrap();
    a.relay.live("j1").push_preview(preview(0, 2));
    let StreamItem::Preview(received) = next_item(&mut subscription.receiver).await else {
        panic!("not a preview");
    };
    assert_eq!((received.frame, received.operation_count), (0, 2));
    // A subscriber connecting now is sent the latest stored frame per index.
    let stored = b.db.job_previews("j1").await.unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].operation_count, 2);

    a.relay.live("j1").finish();
    assert!(matches!(
        next_item(&mut subscription.receiver).await,
        StreamItem::Done
    ));
    // The frames are deleted before the end is announced.
    assert!(b.db.job_previews("j1").await.unwrap().is_empty());
}

#[tokio::test]
async fn console_messages_reach_the_other_replica_however_long() {
    let Some((_postgres, a, b)) = two_replicas().await else {
        return;
    };
    let mut stream = b.relay.notifier().open_stream();

    a.relay
        .notifier()
        .publish_run(RunEvent::state_changed("j1", summary(), JobState::Running));
    let StreamMessage::Run(run) = next_message(&mut stream).await else {
        panic!("not a run event");
    };
    assert_eq!(run.run_id, "j1");

    // Past the notification payload limit, so it travels through `relay_overflow`.
    let long = "x".repeat(PAYLOAD_LIMIT * 2);
    a.relay
        .notifier()
        .notify(Notification::failed("j1", summary(), &long, None));
    let StreamMessage::Notification(notification) = next_message(&mut stream).await else {
        panic!("not a notification");
    };
    assert_eq!(notification.message.as_deref(), Some(long.as_str()));
}

#[tokio::test]
async fn a_topic_change_reaches_a_stream_another_replica_serves() {
    let Some((_postgres, a, b)) = two_replicas().await else {
        return;
    };
    let stream = b.relay.notifier().open_stream();
    let run = StreamMessage::Run(Box::new(RunEvent::state_changed(
        "j1",
        summary(),
        JobState::Running,
    )));
    assert!(!stream.wants(&run));

    assert!(
        a.announcer
            .forward_topics(&stream.id, None, Some(true))
            .await
    );
    assert!(stream.wants(&run));
    // No replica serves this one, so nobody acknowledges it.
    assert!(!a.announcer.forward_topics("gone", None, Some(true)).await);
}

#[tokio::test]
async fn a_publish_job_s_items_reach_the_other_replica() {
    use test_cabinet_contracts::publish_job_api::{PublishProgress, PublishResult, PublishState};
    let Some((_postgres, a, b)) = two_replicas().await else {
        return;
    };
    let mut subscription = b.publish_relay.live("p1").subscribe();

    a.publish_relay.live("p1").push_progress(PublishProgress {
        message: "deploying".to_string(),
    });
    a.publish_relay.live("p1").finish(PublishResult {
        state: PublishState::Failed,
        source_repo: None,
        playable_build: None,
        detail: Some("refused".to_string()),
    });
    for _ in 0..2 {
        tokio::time::timeout(WAIT, subscription.receiver.recv())
            .await
            .expect("nothing arrived")
            .unwrap();
    }
    let late = b.publish_relay.live("p1").subscribe();
    assert_eq!(late.backlog.len(), 2);
    assert!(late.terminated);
}

#[tokio::test]
async fn a_lock_one_replica_holds_is_refused_to_the_other_until_released() {
    let Some((_postgres, a, b)) = two_replicas().await else {
        return;
    };

    let held = a.db.lock(DbLockKey::Snapshot).await.unwrap();
    assert!(b.db.try_lock(DbLockKey::Snapshot).await.unwrap().is_none());
    let sweep = b.db.try_lock(DbLockKey::Sweep).await.unwrap();
    assert!(sweep.is_some(), "another key's lock is free");
    held.release().await;
    let taken = b.db.try_lock(DbLockKey::Snapshot).await.unwrap();
    assert!(taken.is_some());
    taken.unwrap().release().await;

    // A holder dropped without releasing closes its connection, which releases it.
    let dropped = a.db.lock(DbLockKey::Snapshot).await.unwrap();
    drop(dropped);
    tokio::time::timeout(WAIT, b.db.lock(DbLockKey::Snapshot))
        .await
        .expect("the dropped lock was never released")
        .unwrap()
        .release()
        .await;
}

#[tokio::test]
async fn a_replica_whose_listening_connection_drops_resynchronizes_its_streams() {
    use sea_orm::ConnectionTrait;
    let Some((_postgres, a, b)) = two_replicas().await else {
        return;
    };
    let mut subscription = b.relay.live("j1").subscribe();
    let mut stream = b.relay.notifier().open_stream();

    a.db.connection()
        .execute_unprepared(&format!(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
             WHERE query = 'LISTEN \"{CHANNEL}\"' AND pid <> pg_backend_pid()"
        ))
        .await
        .unwrap();

    assert!(matches!(
        next_item(&mut subscription.receiver).await,
        StreamItem::Resync
    ));
    assert!(matches!(
        next_message(&mut stream).await,
        StreamMessage::Resync
    ));
    // And it listens again, so the next batch arrives.
    b.listening().await;
    a.listening().await;
    let stored =
        a.db.store_job_events("j1", 0, &[event("after")])
            .await
            .unwrap();
    a.relay.live("j1").push_events(stored);
    let StreamItem::Event { event, .. } = next_item(&mut subscription.receiver).await else {
        panic!("not an event");
    };
    assert_eq!(message(&event), "after");
}

/// Issue one request against a backend's router, under the local operator's
/// identity unless `bearer` names a token.
async fn request(
    router: &axum::Router,
    method: &str,
    uri: &str,
    bearer: Option<&str>,
    body: Vec<u8>,
) -> axum::response::Response {
    use tower::ServiceExt;
    let mut request = axum::http::Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    request = match bearer {
        Some(token) => request.header("authorization", format!("Bearer {token}")),
        None => request.header(crate::auth::LOCAL_IDENTITY_HEADER, "dev@local"),
    };
    router
        .clone()
        .oneshot(request.body(axum::body::Body::from(body)).unwrap())
        .await
        .unwrap()
}

/// Two backends built over one fresh server, their buses listening, with job `j1`
/// queued, or `None` when the machine has no PostgreSQL to start.
async fn two_backends() -> Option<(
    TestPostgres,
    tempfile::TempDir,
    crate::Backend,
    crate::Backend,
)> {
    let postgres = TestPostgres::start()?;
    // nextest runs each test in its own process, so this environment is this test's alone.
    let dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store-a"));
        std::env::set_var("TCAB_BACKEND_DATABASE_URL", &postgres.url);
    }
    let config = crate::config::Config::from_env().unwrap();
    let prices = crate::pricing::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models");
    const NO_GATEWAY: &str = "http://127.0.0.1:0/chat/completions";
    let a = crate::build_with_prices(config.clone(), prices.clone(), NO_GATEWAY)
        .await
        .unwrap();
    let b = crate::build_with_prices(
        crate::config::Config {
            store: dir.path().join("store-b"),
            ..config
        },
        prices,
        NO_GATEWAY,
    )
    .await
    .unwrap();
    for backend in [&a, &b] {
        let bus = backend.bus.as_ref().expect("a bus on PostgreSQL");
        assert!(bus.wait_listening(WAIT).await, "the bus never listened");
    }
    Db::connect(&postgres.url)
        .await
        .unwrap()
        .enqueue_job(new_job("j1", "2026-10-26T00:00:00Z"))
        .await
        .unwrap();
    Some((postgres, dir, a, b))
}

/// The next non-empty NDJSON line of a live stream, decoded as an event.
async fn next_line(
    body: &mut axum::body::BodyDataStream,
    pending: &mut Vec<String>,
) -> HarnessEvent {
    use futures_util::StreamExt;
    let line = tokio::time::timeout(WAIT, async {
        loop {
            if !pending.is_empty() {
                return pending.remove(0);
            }
            let chunk = body.next().await.expect("the stream ended").unwrap();
            let text = String::from_utf8(chunk.to_vec()).unwrap();
            pending.extend(
                text.lines()
                    .filter(|line| !line.trim().is_empty())
                    .map(str::to_string),
            );
        }
    })
    .await
    .expect("no line arrived");
    serde_json::from_str(&line).unwrap()
}

/// Post `messages` to `router` as job `j1`'s batch from `sequence`.
async fn post_batch(router: &axum::Router, sequence: u64, messages: &[&str]) {
    let events: Vec<HarnessEvent> = messages.iter().map(|m| event(m)).collect();
    let batch = serde_json::json!({ "sequence": sequence, "events": events });
    let posted = request(
        router,
        "POST",
        "/jobs/j1/events",
        Some("token-j1"),
        serde_json::to_vec(&batch).unwrap(),
    )
    .await;
    assert_eq!(posted.status(), axum::http::StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn two_backends_over_one_database_serve_a_batch_posted_to_one_live_from_the_other() {
    let Some((_postgres, _dir, a, b)) = two_backends().await else {
        return;
    };
    let live = request(&b.router, "GET", "/jobs/j1/live", None, Vec::new()).await;
    assert_eq!(live.status(), axum::http::StatusCode::OK);
    let mut body = live.into_body().into_data_stream();
    let mut pending = Vec::new();

    post_batch(&a.router, 0, &["posted to a"]).await;

    assert_eq!(
        message(&next_line(&mut body, &mut pending).await),
        "posted to a"
    );
}

#[tokio::test]
async fn a_stream_reads_back_a_batch_whose_announcement_it_never_received() {
    let Some((postgres, _dir, _a, b)) = two_backends().await else {
        return;
    };
    let live = request(&b.router, "GET", "/jobs/j1/live", None, Vec::new()).await;
    let mut body = live.into_body().into_data_stream();
    let mut pending = Vec::new();

    // A batch stored with no announcement, as one whose NOTIFY failed, or whose
    // announcement is still behind the next batch.
    Db::connect(&postgres.url)
        .await
        .unwrap()
        .store_job_events("j1", 0, &[event("unannounced 0"), event("unannounced 1")])
        .await
        .unwrap();
    post_batch(&b.router, 2, &["posted to b"]).await;

    for expected in ["unannounced 0", "unannounced 1", "posted to b"] {
        assert_eq!(message(&next_line(&mut body, &mut pending).await), expected);
    }
}

#[tokio::test]
async fn a_cancelled_wait_for_a_lock_leaves_it_free() {
    let Some((_postgres, a, b)) = two_replicas().await else {
        return;
    };
    let held = b.db.lock(DbLockKey::Snapshot).await.unwrap();
    // A caller that gives up waiting, as a request whose client went away.
    assert!(
        tokio::time::timeout(Duration::from_millis(300), a.db.lock(DbLockKey::Snapshot))
            .await
            .is_err()
    );
    held.release().await;

    let taken = tokio::time::timeout(WAIT, b.db.lock(DbLockKey::Snapshot))
        .await
        .expect("the abandoned wait kept the lock")
        .unwrap();
    taken.release().await;
}

#[tokio::test]
async fn a_refresh_queued_on_one_replica_wakes_the_other() {
    let Some((_postgres, a, b)) = two_replicas().await else {
        return;
    };
    // Only B runs its loop, as when A stopped inside the coalescing window.
    let refresher = b.publisher.spawn();
    let mut refreshes = refresher.refreshes();

    assert!(a.publisher.queue_refresh().await);

    tokio::time::timeout(WAIT, refreshes.changed())
        .await
        .expect("the other replica never refreshed")
        .unwrap();
    assert!(!b.db.snapshot_state().await.unwrap().dirty);
    refresher.join().await;
}
