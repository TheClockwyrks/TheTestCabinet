//! The migration that collapses a review's three account columns into the one
//! reviewer identity (`m20261018_000058_collapse_review_reviewer`), run over the
//! rows a deployment holds before it.

use super::tests::{links, record};
use super::*;
use sea_orm::{ConnectionTrait, Statement};
use test_cabinet_migration::MigratorTrait;

const MIGRATION: &str = "m20261018_000058_collapse_review_reviewer";

/// How many steps from the head the migration under test is, counted from the
/// registered list so a later migration does not move the test off it.
fn steps() -> u32 {
    let migrations = test_cabinet_migration::Migrator::migrations();
    let index = migrations
        .iter()
        .position(|migration| migration.name() == MIGRATION)
        .expect("the migration is registered");
    (migrations.len() - index) as u32
}

/// A store holding runs `r1` and `r2`, rolled back to before the migration.
async fn rolled_back() -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    db.push(&record("r2"), &links(), None, None).await.unwrap();
    test_cabinet_migration::Migrator::down(&db.connection(), Some(steps()))
        .await
        .unwrap();
    db
}

/// Write a review row in the legacy shape: an account id, a username and a display
/// name.
async fn legacy_review(db: &Db, id: &str, run: &str, account: (&str, &str, &str)) {
    let (user_id, username, display_name) = account;
    let conn = db.connection();
    conn.execute(Statement::from_string(
        conn.get_database_backend(),
        format!(
            "INSERT INTO review (id, run_id, reviewer_user_id, reviewer_username, \
             reviewer_display_name, writeup, reviewed_at) VALUES ('{id}', '{run}', \
             '{user_id}', '{username}', '{display_name}', 'Plays well.', \
             '2026-06-17T22:00:00Z')"
        ),
    ))
    .await
    .unwrap();
}

/// Every review's `(id, reviewer)`, ordered by id.
async fn reviewers(db: &Db) -> Vec<(String, String)> {
    let mut rows: Vec<(String, String)> = review::Entity::find()
        .all(&db.conn())
        .await
        .unwrap()
        .into_iter()
        .map(|review| (review.id, review.reviewer))
        .collect();
    rows.sort();
    rows
}

/// Whether the store holds an index named `name`.
async fn has_index(db: &Db, name: &str) -> bool {
    let conn = db.connection();
    conn.query_one(Statement::from_string(
        conn.get_database_backend(),
        format!("SELECT name FROM sqlite_master WHERE type = 'index' AND name = '{name}'"),
    ))
    .await
    .unwrap()
    .is_some()
}

#[tokio::test]
async fn each_legacy_review_takes_the_name_it_was_shown_under() {
    let db = rolled_back().await;
    legacy_review(&db, "a", "r1", ("acct_ada", "ada", "Ada L.")).await;
    // No display name: the username stands in for it.
    legacy_review(&db, "b", "r1", ("acct_bao", "bao", "")).await;
    // Neither: the account id is all there is.
    legacy_review(&db, "c", "r2", ("acct_cy", "", "")).await;

    test_cabinet_migration::Migrator::up(&db.connection(), None)
        .await
        .unwrap();

    assert_eq!(
        reviewers(&db).await,
        vec![
            ("a".to_string(), "Ada L.".to_string()),
            ("b".to_string(), "bao".to_string()),
            ("c".to_string(), "acct_cy".to_string()),
        ]
    );
}

#[tokio::test]
async fn two_accounts_sharing_a_name_on_one_run_stay_distinct() {
    let db = rolled_back().await;
    legacy_review(&db, "a", "r1", ("acct_1", "ada", "Ada")).await;
    legacy_review(&db, "b", "r1", ("acct_2", "ada2", "Ada")).await;
    // The same name on another run collides with nothing and is left alone.
    legacy_review(&db, "c", "r2", ("acct_1", "ada", "Ada")).await;

    test_cabinet_migration::Migrator::up(&db.connection(), None)
        .await
        .unwrap();

    assert_eq!(
        reviewers(&db).await,
        vec![
            ("a".to_string(), "Ada (acct_1)".to_string()),
            ("b".to_string(), "Ada (acct_2)".to_string()),
            ("c".to_string(), "Ada".to_string()),
        ]
    );
}

#[tokio::test]
async fn an_identity_reviews_a_run_once_after_the_migration() {
    let db = rolled_back().await;
    legacy_review(&db, "a", "r1", ("acct_ada", "ada", "ada@clockwyrks.com")).await;
    test_cabinet_migration::Migrator::up(&db.connection(), None)
        .await
        .unwrap();

    // A second row under the same identity on the same run is refused by the index.
    let conn = db.connection();
    let duplicate = conn
        .execute(Statement::from_string(
            conn.get_database_backend(),
            "INSERT INTO review (id, run_id, reviewer, writeup, reviewed_at) VALUES \
             ('b', 'r1', 'ada@clockwyrks.com', 'Again.', '2026-06-18T22:00:00Z')"
                .to_string(),
        ))
        .await;
    assert!(duplicate.is_err(), "(run_id, reviewer) is unique");

    // A review submitted under that identity now updates the migrated row.
    let review = StoredReview {
        reviewer: "ada@clockwyrks.com".to_string(),
        ratings: Vec::new(),
        aesthetics: Vec::new(),
        aesthetic: None,
        writeup: "Plays well.".to_string(),
        checklist: Vec::new(),
        reviewed_at: "2026-06-18T22:00:00Z".to_string(),
        edited_at: None,
        revisions: Vec::new(),
    };
    db.add_review("r1", &review, None, None).await.unwrap();
    assert_eq!(
        reviewers(&db).await,
        vec![("a".to_string(), "ada@clockwyrks.com".to_string())]
    );
}

#[tokio::test]
async fn the_job_tokens_are_indexed_and_the_rollback_restores_the_account_columns() {
    let db = Db::connect_in_memory().await.unwrap();
    assert!(has_index(&db, "idx_job_job_token").await);
    assert!(has_index(&db, "idx_publish_job_job_token").await);
    db.push(&record("r1"), &links(), None, None).await.unwrap();
    let conn = db.connection();
    conn.execute(Statement::from_string(
        conn.get_database_backend(),
        "INSERT INTO review (id, run_id, reviewer, writeup, reviewed_at) VALUES \
         ('a', 'r1', 'ada@clockwyrks.com', 'Plays well.', '2026-06-17T22:00:00Z')"
            .to_string(),
    ))
    .await
    .unwrap();

    test_cabinet_migration::Migrator::down(&conn, Some(steps()))
        .await
        .unwrap();
    assert!(!has_index(&db, "idx_job_job_token").await);
    assert!(!has_index(&db, "idx_publish_job_job_token").await);
    let row = conn
        .query_one(Statement::from_string(
            conn.get_database_backend(),
            "SELECT reviewer_user_id, reviewer_username, reviewer_display_name \
             FROM review WHERE id = 'a'"
                .to_string(),
        ))
        .await
        .unwrap()
        .expect("the review survives the rollback");
    for column in [
        "reviewer_user_id",
        "reviewer_username",
        "reviewer_display_name",
    ] {
        let value: String = row.try_get("", column).unwrap();
        assert_eq!(value, "ada@clockwyrks.com", "{column}");
    }

    // And forward again, to the identity it started as.
    test_cabinet_migration::Migrator::up(&conn, None)
        .await
        .unwrap();
    assert_eq!(
        reviewers(&db).await,
        vec![("a".to_string(), "ada@clockwyrks.com".to_string())]
    );
}
