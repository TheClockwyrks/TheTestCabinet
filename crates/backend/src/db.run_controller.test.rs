//! An adversarial run's pushed controller in the database: stored before or after its
//! run's row, replaced by a re-push, listed by key, and deleted with the run.

use std::collections::HashSet;

use super::tests::{links, record};
use super::*;

#[tokio::test]
async fn a_controller_round_trips_and_a_re_push_replaces_it() {
    let db = Db::connect_in_memory().await.unwrap();
    assert_eq!(db.run_controller("r1").await.unwrap(), None);

    db.store_run_controller("r1", b"\0asm-first").await.unwrap();
    assert_eq!(
        db.run_controller("r1").await.unwrap().as_deref(),
        Some(&b"\0asm-first"[..])
    );

    db.store_run_controller("r1", b"\0asm-second")
        .await
        .unwrap();
    assert_eq!(
        db.run_controller("r1").await.unwrap().as_deref(),
        Some(&b"\0asm-second"[..])
    );
}

#[tokio::test]
async fn a_controller_is_stored_before_its_run_s_row_exists() {
    // The driver pushes the controller ahead of the terminal report that creates the
    // row, so the store must take it with no row to point at.
    let db = Db::connect_in_memory().await.unwrap();
    assert!(!db.run_exists("r1").await.unwrap());
    db.store_run_controller("r1", b"\0asm").await.unwrap();

    db.push(&record("r1"), &links(), None, None).await.unwrap();
    assert!(db.run_exists("r1").await.unwrap());
    assert_eq!(
        db.run_controller("r1").await.unwrap().as_deref(),
        Some(&b"\0asm"[..])
    );
}

#[tokio::test]
async fn the_listing_names_only_the_asked_runs_that_hold_a_controller() {
    let db = Db::connect_in_memory().await.unwrap();
    db.store_run_controller("with", b"\0asm").await.unwrap();
    db.store_run_controller("unasked", b"\0asm").await.unwrap();

    let asked = ["with".to_string(), "without".to_string()];
    let held = db.runs_with_controllers(&asked).await.unwrap();
    assert_eq!(held, HashSet::from(["with".to_string()]));
    assert!(db.runs_with_controllers(&[]).await.unwrap().is_empty());
}

#[tokio::test]
async fn deleting_a_run_deletes_its_controller_and_no_other() {
    let db = Db::connect_in_memory().await.unwrap();
    for id in ["r1", "r2"] {
        db.push(&record(id), &links(), None, None).await.unwrap();
        db.store_run_controller(id, b"\0asm").await.unwrap();
    }

    db.delete_run("r1").await.unwrap();
    assert_eq!(db.run_controller("r1").await.unwrap(), None);
    assert!(db.run_controller("r2").await.unwrap().is_some());
}
