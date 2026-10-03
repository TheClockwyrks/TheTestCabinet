//! Tests of the backend's assembly.

use super::*;

#[tokio::test]
async fn a_restart_leaves_every_job_in_flight_alone() {
    // nextest runs each test in its own process, so this environment is this test's alone.
    let dir = tempfile::tempdir().unwrap();
    let url = format!(
        "sqlite://{}?mode=rwc",
        dir.path().join("backend.sqlite").display()
    );
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
        std::env::set_var("TCAB_BACKEND_DATABASE_URL", &url);
    }

    // The previous process left a job of each in-flight state behind.
    let states = ["queued", "pending", "dispatched", "starting", "running"];
    {
        use test_cabinet_migration::MigratorTrait;
        let db = Db::connect(&url).await.unwrap();
        test_cabinet_migration::Migrator::up(&db.connection(), None)
            .await
            .unwrap();
        for state in states {
            db.enqueue_job(crate::db::tests::new_job(state, "2026-10-01T00:00:00Z"))
                .await
                .unwrap();
            if state != "queued" {
                db.set_job_state(state, state, "2026-10-01T00:01:00Z", None, None)
                    .await
                    .unwrap();
            }
        }
    }

    let backend = build(Config::from_env().unwrap()).await.unwrap();
    let db = Db::connect(&url).await.unwrap();
    for state in states {
        let job = db.get_job(state).await.unwrap().unwrap();
        assert_eq!(job.state, state, "the restart reaped a {state} job");
    }
    drop(backend);
}
