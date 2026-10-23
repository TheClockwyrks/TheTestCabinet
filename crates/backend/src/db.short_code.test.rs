//! Short codes and the stored published media: minting a run's code at its first
//! publish (the backend overview's "Short codes"), keeping it through a repeated
//! success and a re-push, the backfill a refresh starts with, and the media keys
//! the artifacts service answered.

use super::tests::{links, new_publish_job, record, review};
use super::*;

/// Push and review `id`, then complete a publish job for it at `at`.
async fn publish(db: &Db, id: &str, at: &str) -> PublishRunOutcome {
    if db.get_run(id).await.unwrap().is_none() {
        db.push(&record(id), &RunLinks::default(), None, None)
            .await
            .unwrap();
        db.add_review(id, &review(), None, None).await.unwrap();
    }
    let job = format!("p-{id}-{at}");
    db.enqueue_publish_job(new_publish_job(&job, id, at))
        .await
        .unwrap();
    db.complete_publish_job(
        &job,
        id,
        Some("https://github.com/x/y"),
        Some("https://abc.pages.dev"),
        at,
    )
    .await
    .unwrap()
}

/// The code `id`'s links and its record blob carry, asserting they agree.
async fn code_of(db: &Db, id: &str) -> Option<String> {
    let run = db.get_run(id).await.unwrap().unwrap();
    assert_eq!(
        run.links.code, run.record.links.code,
        "the record blob and the links row disagree on {id}'s code"
    );
    let row = lifted(db, id).await;
    let blob: RunRecord = serde_json::from_str(&row.record_json).unwrap();
    assert_eq!(blob.links.code, run.links.code, "the stored blob of {id}");
    run.links.code
}

/// The stored `run` row of `id`.
async fn lifted(db: &Db, id: &str) -> run::Model {
    run::Entity::find_by_id(id.to_string())
        .one(&db.conn())
        .await
        .unwrap()
        .unwrap()
}

/// Forget every stored code, as a database from before codes existed holds none.
async fn forget_codes(db: &Db) {
    run_link::Entity::update_many()
        .col_expr(run_link::Column::Code, Expr::value(Option::<String>::None))
        .exec(&db.conn())
        .await
        .unwrap();
    for run in run::Entity::find().all(&db.conn()).await.unwrap() {
        let record_json = with_code(&run.record_json, None).unwrap();
        let mut active = run.into_active_model();
        active.record_json = Set(record_json);
        active.update(&db.conn()).await.unwrap();
    }
}

#[tokio::test]
async fn an_unpublished_run_has_no_code() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("cuid2abcdefghij"), &links(), None, None)
        .await
        .unwrap();
    assert_eq!(code_of(&db, "cuid2abcdefghij").await, None);
}

#[tokio::test]
async fn the_first_publish_mints_the_eight_character_prefix() {
    let db = Db::connect_in_memory().await.unwrap();
    publish(&db, "cuid2abcdefghij", "2026-06-27T01:00:00Z").await;
    assert_eq!(
        code_of(&db, "cuid2abcdefghij").await.as_deref(),
        Some("cuid2abc")
    );
}

#[tokio::test]
async fn a_prefix_another_run_holds_extends_the_code() {
    let db = Db::connect_in_memory().await.unwrap();
    publish(&db, "sharedpr1xxxxx", "2026-06-27T01:00:00Z").await;
    publish(&db, "sharedpr2xxxxx", "2026-06-27T02:00:00Z").await;
    publish(&db, "sharedpr2yyyyy", "2026-06-27T03:00:00Z").await;
    assert_eq!(
        code_of(&db, "sharedpr1xxxxx").await.as_deref(),
        Some("sharedpr")
    );
    assert_eq!(
        code_of(&db, "sharedpr2xxxxx").await.as_deref(),
        Some("sharedpr2")
    );
    assert_eq!(
        code_of(&db, "sharedpr2yyyyy").await.as_deref(),
        Some("sharedpr2y")
    );
}

#[tokio::test]
async fn a_repeated_success_keeps_the_code() {
    let db = Db::connect_in_memory().await.unwrap();
    publish(&db, "repeatedxxxx", "2026-06-27T01:00:00Z").await;
    let outcome = publish(&db, "repeatedxxxx", "2026-06-27T02:00:00Z").await;
    assert!(!outcome.newly_published);
    assert_eq!(
        code_of(&db, "repeatedxxxx").await.as_deref(),
        Some("repeated")
    );
}

#[tokio::test]
async fn a_re_push_keeps_the_code_and_a_pushed_code_is_ignored() {
    let db = Db::connect_in_memory().await.unwrap();
    // A pushed record's links never set the code: only a publish mints one.
    let mut pushed = links();
    pushed.code = Some("forged".to_string());
    let mut forged = record("repushedxxxx");
    forged.links.code = Some("forged".to_string());
    db.push(&forged, &pushed, None, None).await.unwrap();
    assert_eq!(code_of(&db, "repushedxxxx").await, None);

    db.add_review("repushedxxxx", &review(), None, None)
        .await
        .unwrap();
    publish(&db, "repushedxxxx", "2026-06-27T01:00:00Z").await;
    db.push(&forged, &pushed, None, None).await.unwrap();
    assert_eq!(
        code_of(&db, "repushedxxxx").await.as_deref(),
        Some("repushed")
    );
}

#[tokio::test]
async fn the_synchronous_publish_mints_too() {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("directlyxxxx"), &links(), None, None)
        .await
        .unwrap();
    db.add_review("directlyxxxx", &review(), None, None)
        .await
        .unwrap();
    db.publish("directlyxxxx", "2026-06-27T01:00:00Z")
        .await
        .unwrap();
    assert_eq!(
        code_of(&db, "directlyxxxx").await.as_deref(),
        Some("directly")
    );
}

#[tokio::test]
async fn a_run_whose_whole_id_is_taken_publishes_without_a_code() {
    let db = Db::connect_in_memory().await.unwrap();
    publish(&db, "prefixedlonger", "2026-06-27T01:00:00Z").await;
    // Every prefix of this id, the whole id included, is the other run's code.
    let outcome = publish(&db, "prefixed", "2026-06-27T02:00:00Z").await;
    assert!(outcome.newly_published);
    assert_eq!(
        code_of(&db, "prefixedlonger").await.as_deref(),
        Some("prefixed")
    );
    assert_eq!(code_of(&db, "prefixed").await, None);
    assert!(db.get_run("prefixed").await.unwrap().unwrap().published);
}

#[tokio::test]
async fn the_backfill_mints_in_publication_order() {
    let db = Db::connect_in_memory().await.unwrap();
    // Published second but pushed first, so only the publication time orders them.
    publish(&db, "backfillAAAA", "2026-06-27T02:00:00Z").await;
    publish(&db, "backfillBBBB", "2026-06-27T01:00:00Z").await;
    db.push(&record("backfillCCCC"), &links(), None, None)
        .await
        .unwrap();
    forget_codes(&db).await;

    assert_eq!(db.assign_missing_codes().await.unwrap(), 2);
    assert_eq!(
        code_of(&db, "backfillBBBB").await.as_deref(),
        Some("backfill")
    );
    assert_eq!(
        code_of(&db, "backfillAAAA").await.as_deref(),
        Some("backfillA")
    );
    // An unpublished run is given none.
    assert_eq!(code_of(&db, "backfillCCCC").await, None);
    // A second pass has nothing left to do and moves nothing.
    assert_eq!(db.assign_missing_codes().await.unwrap(), 0);
    assert_eq!(
        code_of(&db, "backfillAAAA").await.as_deref(),
        Some("backfillA")
    );
}

#[tokio::test]
async fn the_published_media_is_stored_per_run_and_survives_a_re_push() {
    let db = Db::connect_in_memory().await.unwrap();
    publish(&db, "mediarunxxxx", "2026-06-27T01:00:00Z").await;
    assert!(db.public_media().await.unwrap().is_empty());

    db.set_public_media("mediarunxxxx", r#"{"proofMedia":[]}"#)
        .await
        .unwrap();
    db.push(&record("mediarunxxxx"), &links(), None, None)
        .await
        .unwrap();
    let stored = db.public_media().await.unwrap();
    assert_eq!(
        stored.get("mediarunxxxx").map(String::as_str),
        Some(r#"{"proofMedia":[]}"#)
    );
    assert_eq!(
        code_of(&db, "mediarunxxxx").await.as_deref(),
        Some("mediarun")
    );
}
