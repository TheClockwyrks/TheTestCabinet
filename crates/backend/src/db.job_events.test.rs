//! A job's stored events: each batch written as it arrives, keyed by job and sequence,
//! a resent or overlapping batch storing only what is new, and the rows going only
//! with the job row itself (the driver's events page, "Delivery to the backend").

use test_cabinet_contracts::event::{EventKind, HarnessEvent};

use super::tests::{links, new_job, record};
use super::*;

/// An agent event saying `message`.
fn event(message: &str) -> HarnessEvent {
    HarnessEvent {
        timestamp: "2026-10-19T12:00:00Z".to_string(),
        session_id: None,
        kind: EventKind::Agent {
            message: message.to_string(),
        },
    }
}

/// Agent events saying each of `messages`, in order.
fn events(messages: &[&str]) -> Vec<HarnessEvent> {
    messages.iter().copied().map(event).collect()
}

/// The messages of `stream`, in order.
fn messages(stream: &[HarnessEvent]) -> Vec<String> {
    stream
        .iter()
        .map(|event| match &event.kind {
            EventKind::Agent { message } => message.clone(),
            other => panic!("not an agent event: {other:?}"),
        })
        .collect()
}

/// The sequences and messages of a store's answer.
fn stored(answer: &[(u64, HarnessEvent)]) -> Vec<(u64, String)> {
    answer
        .iter()
        .map(|(sequence, event)| (*sequence, messages(std::slice::from_ref(event)).remove(0)))
        .collect()
}

/// A database holding the given jobs, queued.
async fn with_jobs(ids: &[&str]) -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    for id in ids {
        db.enqueue_job(new_job(id, "2026-10-19T11:00:00Z"))
            .await
            .unwrap();
    }
    db
}

#[tokio::test]
async fn a_batch_is_stored_from_its_first_sequence_and_answered_in_full() {
    let db = with_jobs(&["j1"]).await;

    let answer = db
        .store_job_events("j1", 0, &events(&["a", "b", "c"]))
        .await
        .unwrap();

    assert_eq!(
        stored(&answer),
        [(0, "a".into()), (1, "b".into()), (2, "c".into())]
    );
    assert_eq!(
        messages(&db.job_events("j1").await.unwrap()),
        ["a", "b", "c"]
    );
}

#[tokio::test]
async fn a_resent_batch_stores_nothing_and_answers_nothing_new() {
    let db = with_jobs(&["j1"]).await;
    db.store_job_events("j1", 0, &events(&["a", "b"]))
        .await
        .unwrap();

    let answer = db
        .store_job_events("j1", 0, &events(&["a", "b"]))
        .await
        .unwrap();

    assert!(answer.is_empty());
    assert_eq!(messages(&db.job_events("j1").await.unwrap()), ["a", "b"]);
}

#[tokio::test]
async fn a_batch_overlapping_stored_events_stores_only_the_new_ones() {
    let db = with_jobs(&["j1"]).await;
    db.store_job_events("j1", 0, &events(&["a", "b", "c"]))
        .await
        .unwrap();

    // Sequences 2..=4: the first is stored already, and keeps what was stored first.
    let answer = db
        .store_job_events("j1", 2, &events(&["c again", "d", "e"]))
        .await
        .unwrap();

    assert_eq!(stored(&answer), [(3, "d".into()), (4, "e".into())]);
    assert_eq!(
        messages(&db.job_events("j1").await.unwrap()),
        ["a", "b", "c", "d", "e"]
    );
}

#[tokio::test]
async fn a_jobs_stream_reads_in_sequence_order_whatever_order_it_was_stored_in() {
    let db = with_jobs(&["j1"]).await;
    // Past ten, so a textual ordering would put `10` before `2`.
    let late: Vec<String> = (2..12).map(|n| format!("e{n}")).collect();
    let late: Vec<&str> = late.iter().map(String::as_str).collect();
    db.store_job_events("j1", 2, &events(&late)).await.unwrap();
    db.store_job_events("j1", 0, &events(&["e0", "e1"]))
        .await
        .unwrap();

    let expected: Vec<String> = (0..12).map(|n| format!("e{n}")).collect();
    assert_eq!(messages(&db.job_events("j1").await.unwrap()), expected);
}

#[tokio::test]
async fn each_jobs_stream_is_its_own() {
    let db = with_jobs(&["j1", "j2"]).await;
    db.store_job_events("j1", 0, &events(&["one"]))
        .await
        .unwrap();

    // The same sequence under another job is another key.
    let answer = db
        .store_job_events("j2", 0, &events(&["two"]))
        .await
        .unwrap();

    assert_eq!(stored(&answer), [(0, "two".into())]);
    assert_eq!(messages(&db.job_events("j1").await.unwrap()), ["one"]);
    assert_eq!(messages(&db.job_events("j2").await.unwrap()), ["two"]);
    assert!(db.job_events("unknown").await.unwrap().is_empty());
}

#[tokio::test]
async fn an_empty_batch_stores_nothing() {
    let db = with_jobs(&["j1"]).await;

    assert!(db.store_job_events("j1", 7, &[]).await.unwrap().is_empty());
    assert!(db.job_events("j1").await.unwrap().is_empty());
}

#[tokio::test]
async fn a_sequence_past_the_stored_range_is_refused_before_anything_is_written() {
    let db = with_jobs(&["j1"]).await;

    // The first event fits; the second would be stored past `i64::MAX`.
    let first = u64::try_from(i64::MAX).unwrap();
    let err = db
        .store_job_events("j1", first, &events(&["fits", "does not"]))
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::BadRequest(_)), "{err:?}");

    let err = db
        .store_job_events("j1", u64::MAX, &events(&["overflows"]))
        .await
        .unwrap_err();
    assert!(matches!(err, BackendError::BadRequest(_)), "{err:?}");

    assert!(db.job_events("j1").await.unwrap().is_empty());
}

#[tokio::test]
async fn events_of_an_unknown_job_are_not_stored() {
    let db = with_jobs(&[]).await;

    assert!(
        db.store_job_events("ghost", 0, &events(&["a"]))
            .await
            .is_err()
    );
    assert!(db.job_events("ghost").await.unwrap().is_empty());
}

#[tokio::test]
async fn a_job_that_ends_with_no_record_keeps_its_stream() {
    let db = with_jobs(&["j1"]).await;
    db.store_job_events("j1", 0, &events(&["a", "b"]))
        .await
        .unwrap();

    db.set_job_state("j1", "canceled", "2026-10-19T12:05:00Z", None, None)
        .await
        .unwrap();

    assert_eq!(messages(&db.job_events("j1").await.unwrap()), ["a", "b"]);
}

#[tokio::test]
async fn deleting_a_run_takes_its_jobs_stream_with_the_job() {
    let db = with_jobs(&["j1", "j2"]).await;
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.set_job_state("j1", "succeeded", "2026-10-19T12:05:00Z", None, Some("r1"))
        .await
        .unwrap();
    db.store_job_events("j1", 0, &events(&["a", "b"]))
        .await
        .unwrap();
    db.store_job_events("j2", 0, &events(&["kept"]))
        .await
        .unwrap();

    db.delete_run("r1").await.unwrap();

    assert!(db.get_job("j1").await.unwrap().is_none());
    assert!(db.job_events("j1").await.unwrap().is_empty());
    // A job the delete does not reach keeps its stream.
    assert_eq!(messages(&db.job_events("j2").await.unwrap()), ["kept"]);
}

#[tokio::test]
async fn a_retried_attempt_goes_with_its_run_and_takes_its_stream() {
    let db = with_jobs(&["attempt"]).await;
    db.store_job_events("attempt", 0, &events(&["a"]))
        .await
        .unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    let retry = NewJob {
        attempt: 1,
        ..new_job("retry", "2026-10-19T11:30:00Z")
    };
    assert!(
        db.enqueue_retry("attempt", Some("r1"), retry)
            .await
            .unwrap()
    );

    db.delete_run("r1").await.unwrap();

    // A comparison arm holds its runs' ids, so nothing keeps the attempt.
    assert!(db.get_job("attempt").await.unwrap().is_none());
    assert!(db.job_events("attempt").await.unwrap().is_empty());
    assert!(db.get_job("retry").await.unwrap().is_some());
}

#[tokio::test]
async fn withdrawing_a_waiting_retry_takes_its_stream_with_it() {
    let db = with_jobs(&["attempt"]).await;
    let retry = NewJob {
        attempt: 1,
        ..new_job("retry", "2026-10-19T11:30:00Z")
    };
    assert!(db.enqueue_retry("attempt", None, retry).await.unwrap());
    db.store_job_events("retry", 0, &events(&["a"]))
        .await
        .unwrap();
    db.store_job_events("attempt", 0, &events(&["kept"]))
        .await
        .unwrap();

    let withdrawn = db
        .withdraw_retry("attempt", "2026-10-19T12:00:00Z", "withdrawn")
        .await
        .unwrap();

    assert!(matches!(withdrawn, Some(WithdrawnRetry::Deleted(_))));
    assert!(db.job_events("retry").await.unwrap().is_empty());
    assert_eq!(messages(&db.job_events("attempt").await.unwrap()), ["kept"]);
}
