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

    // Port 0 is never connectable, so startup's price seeding fails fast instead of
    // waiting on OpenRouter's public catalog.
    let prices = crate::pricing::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models");
    let backend = build_with_prices(Config::from_env().unwrap(), prices)
        .await
        .unwrap();
    let db = Db::connect(&url).await.unwrap();
    for state in states {
        let job = db.get_job(state).await.unwrap().unwrap();
        assert_eq!(job.state, state, "the restart reaped a {state} job");
    }
    drop(backend);
}

#[tokio::test]
async fn a_start_empties_the_ingest_staging_area() {
    // nextest runs each test in its own process, so this environment is this test's alone.
    let dir = tempfile::tempdir().unwrap();
    let url = format!(
        "sqlite://{}?mode=rwc",
        dir.path().join("backend.sqlite").display()
    );
    let store_root = dir.path().join("store");
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", &store_root);
        std::env::set_var("TCAB_BACKEND_DATABASE_URL", &url);
    }

    // The previous process stopped an ingest part way, leaving its staging behind,
    // beside a version it had finished.
    let store = DefinitionStore::open(&store_root).unwrap();
    let staged = store.new_staging_dir("pong", "v2.0.0").unwrap();
    std::fs::create_dir_all(staged.join("x")).unwrap();
    std::fs::write(staged.join("x/y"), "half written").unwrap();
    let served = store.version_dir("pong", "v1.0.0").join("index.html");
    std::fs::create_dir_all(served.parent().unwrap()).unwrap();
    std::fs::write(&served, "served").unwrap();

    // Port 0 is never connectable, so startup's price seeding fails fast instead of
    // waiting on OpenRouter's public catalog.
    let prices = crate::pricing::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models");
    let backend = build_with_prices(Config::from_env().unwrap(), prices)
        .await
        .unwrap();

    assert!(!staged.exists(), "the leftover staging survived the start");
    assert_eq!(
        std::fs::read_dir(store.staging_root())
            .map(|entries| entries.count())
            .unwrap_or(0),
        0
    );
    assert_eq!(std::fs::read_to_string(&served).unwrap(), "served");
    drop(backend);
}

#[tokio::test]
async fn a_refresh_queued_before_a_restart_runs_after_it() {
    use tower::ServiceExt;

    // nextest runs each test in its own process, so this environment is this test's alone.
    let dir = tempfile::tempdir().unwrap();
    let url = format!(
        "sqlite://{}?mode=rwc",
        dir.path().join("backend.sqlite").display()
    );
    let checkout = dir.path().join("checkout");
    // A minimal end-to-end case version, which ingests without a browser.
    let case = checkout.join("test-cases/end-to-end/easy/pong/v1.0.0");
    for (path, contents) in [
        ("prompt.hbs", "Build it."),
        ("changelog.md", "Introduced."),
        ("variants/base.toml", "slug = \"base\"\n"),
        (
            "test-case.toml",
            "slug = \"pong\"\nname = \"Pong\"\ndifficulty = \"easy\"\ntags = []\n\
             prompt = \"prompt.hbs\"\nchangelog = \"changelog.md\"\n\
             variants = [\"variants/base.toml\"]\n\
             [build]\ninstall = \"x\"\nbuild = \"y\"\n\
             [[domain]]\nid = \"g\"\ndescription = \"d\"\n",
        ),
    ] {
        let path = case.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", &checkout);
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
        std::env::set_var("TCAB_BACKEND_DATABASE_URL", &url);
        std::env::set_var("TCAB_BACKEND_SERVICE_TOKEN", "service-secret");
        // A coalescing window far longer than the test, so only a start can run the
        // refresh the ingest queues.
        std::env::set_var("TCAB_SNAPSHOT_COALESCE_MS", "3600000");
    }
    // Port 0 is never connectable, so startup's price seeding fails fast instead of
    // waiting on OpenRouter's public catalog.
    let prices = || crate::pricing::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models");

    let backend = build_with_prices(Config::from_env().unwrap(), prices())
        .await
        .unwrap();
    let response = backend
        .router
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/ingest")
                .header("authorization", "Bearer service-secret")
                .header("content-type", "application/json")
                .body(axum::body::Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::OK);

    // The ingest changed the store, so it queued a refresh: the mark is written, and
    // the debounce is still waiting when the process stops.
    let db = Db::connect(&url).await.unwrap();
    let queued = db.snapshot_state().await.unwrap();
    assert!(queued.dirty, "the ingest queued no refresh");
    assert_eq!(queued.last_uploaded, None);
    drop(backend);

    let backend = build_with_prices(Config::from_env().unwrap(), prices())
        .await
        .unwrap();
    backend
        .refresher
        .refreshes()
        .changed()
        .await
        .expect("the refresher is still running");
    let state = db.snapshot_state().await.unwrap();
    assert!(!state.dirty, "the start did not run the queued refresh");
    assert!(state.last_uploaded.is_some());
    drop(backend);
}
