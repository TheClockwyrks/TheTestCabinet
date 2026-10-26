//! The start's move of an earlier release's controllers and match replays, against an
//! in-memory database and the stub artifact service.

use tempfile::TempDir;

use super::*;
use crate::artifacts::stub::{self, TOKEN};
use crate::db::tests::{links, record};

/// Write `bytes` at `relative` under `root`, creating its directories.
fn write(root: &Path, relative: &str, bytes: &[u8]) -> PathBuf {
    let path = root.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, bytes).unwrap();
    path
}

/// A database holding a run row for each of `ids`.
async fn db_with_runs(ids: &[&str]) -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    for id in ids {
        db.push(&record(id), &links(), None, None).await.unwrap();
    }
    db
}

fn client(url: &str) -> ArtifactsClient {
    ArtifactsClient::from_config(reqwest::Client::new(), Some(url), Some(TOKEN)).unwrap()
}

#[tokio::test]
async fn an_empty_store_moves_nothing_and_calls_nothing() {
    let dir = TempDir::new().unwrap();
    let db = db_with_runs(&[]).await;
    let stub = stub::spawn().await;

    let outcome = move_legacy_state(dir.path(), &db, Some(&client(&stub.url))).await;
    assert_eq!(outcome, MoveOutcome::default());
    assert!(stub.held.requests().is_empty());
}

#[tokio::test]
async fn a_controller_with_a_run_row_moves_into_the_database_and_leaves_the_rest() {
    let dir = TempDir::new().unwrap();
    let db = db_with_runs(&["r1"]).await;
    let controller = write(dir.path(), "runs/r1/controller.wasm", b"\0asm-r1");
    // The run's other files are the tree's to serve; the move leaves them unread.
    let replay = write(dir.path(), "runs/r1/replay.json", b"{}");
    let proof = write(dir.path(), "runs/r1/proof/title.png", b"png");

    let outcome = move_legacy_state(dir.path(), &db, None).await;
    assert_eq!(outcome.controllers_moved, 1);
    assert_eq!(
        db.run_controller("r1").await.unwrap().as_deref(),
        Some(&b"\0asm-r1"[..])
    );
    assert!(!controller.exists());
    assert!(replay.exists() && proof.exists());
}

#[tokio::test]
async fn a_controller_s_emptied_directory_goes_with_it() {
    let dir = TempDir::new().unwrap();
    let db = db_with_runs(&["r1"]).await;
    write(dir.path(), "runs/r1/controller.wasm", b"\0asm");

    move_legacy_state(dir.path(), &db, None).await;
    assert!(!dir.path().join("runs").exists());
}

#[tokio::test]
async fn a_controller_without_a_run_row_stays_on_disk() {
    let dir = TempDir::new().unwrap();
    let db = db_with_runs(&[]).await;
    let controller = write(dir.path(), "runs/r1/controller.wasm", b"\0asm");

    let outcome = move_legacy_state(dir.path(), &db, None).await;
    assert_eq!(outcome.controllers_left, 1);
    assert_eq!(outcome.controllers_moved, 0);
    assert!(controller.exists());
    assert_eq!(db.run_controller("r1").await.unwrap(), None);
}

#[tokio::test]
async fn a_controller_the_database_already_holds_is_kept_and_the_file_removed() {
    // A re-push since the upgrade stored the newer module; the stale file must not
    // overwrite it.
    let dir = TempDir::new().unwrap();
    let db = db_with_runs(&["r1"]).await;
    db.store_run_controller("r1", b"\0asm-pushed")
        .await
        .unwrap();
    let controller = write(dir.path(), "runs/r1/controller.wasm", b"\0asm-on-disk");

    let outcome = move_legacy_state(dir.path(), &db, None).await;
    assert_eq!(outcome.controllers_moved, 1);
    assert_eq!(
        db.run_controller("r1").await.unwrap().as_deref(),
        Some(&b"\0asm-pushed"[..])
    );
    assert!(!controller.exists());
}

#[tokio::test]
async fn match_replays_move_through_the_artifact_service() {
    let dir = TempDir::new().unwrap();
    let db = db_with_runs(&[]).await;
    let stub = stub::spawn().await;
    write(
        dir.path(),
        "tournaments/t1/matches/m1/replay.json",
        b"{\"m\":1}",
    );
    write(
        dir.path(),
        "tournaments/t1/matches/m2/replay.json",
        b"{\"m\":2}",
    );

    let outcome = move_legacy_state(dir.path(), &db, Some(&client(&stub.url))).await;
    assert_eq!(outcome.replays_moved, 2);
    assert_eq!(
        stub.held.replay("t1", "m1").as_deref(),
        Some(&b"{\"m\":1}"[..])
    );
    assert_eq!(
        stub.held.replay("t1", "m2").as_deref(),
        Some(&b"{\"m\":2}"[..])
    );
    assert!(!dir.path().join("tournaments").exists());
}

#[tokio::test]
async fn a_replay_the_service_refuses_stays_and_the_others_still_move() {
    let dir = TempDir::new().unwrap();
    let db = db_with_runs(&[]).await;
    let stub = stub::spawn().await;
    let kept = write(dir.path(), "tournaments/t1/matches/m1/replay.json", b"{}");
    let client =
        ArtifactsClient::from_config(reqwest::Client::new(), Some(&stub.url), Some("wrong"))
            .unwrap();

    let outcome = move_legacy_state(dir.path(), &db, Some(&client)).await;
    assert_eq!(outcome.replays_left, 1);
    assert!(kept.exists());
}

#[tokio::test]
async fn an_unreachable_service_leaves_every_replay_after_one_attempt() {
    let dir = TempDir::new().unwrap();
    let db = db_with_runs(&["r1"]).await;
    write(dir.path(), "runs/r1/controller.wasm", b"\0asm");
    let first = write(dir.path(), "tournaments/t1/matches/m1/replay.json", b"{}");
    let second = write(dir.path(), "tournaments/t2/matches/m1/replay.json", b"{}");
    // A port bound and released: nothing listens there.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);

    let outcome = move_legacy_state(dir.path(), &db, Some(&client(&url))).await;
    assert_eq!(outcome.replays_left, 2);
    assert_eq!(outcome.replays_moved, 0);
    assert!(first.exists() && second.exists());
    // The controller does not depend on the service and still moved.
    assert_eq!(outcome.controllers_moved, 1);
}

#[tokio::test]
async fn with_no_artifact_service_the_replays_wait_on_disk() {
    let dir = TempDir::new().unwrap();
    let db = db_with_runs(&[]).await;
    let replay = write(dir.path(), "tournaments/t1/matches/m1/replay.json", b"{}");

    let outcome = move_legacy_state(dir.path(), &db, None).await;
    assert_eq!(outcome.replays_left, 1);
    assert!(replay.exists());
}
