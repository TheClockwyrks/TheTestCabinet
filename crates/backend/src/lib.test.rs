//! Tests of the backend's assembly.

use super::*;

/// A chat/completions endpoint nothing listens on (port 0 is never connectable), for
/// the backends whose tests resume no probe.
const NO_GATEWAY: &str = "http://127.0.0.1:0/chat/completions";

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
    let backend = build_with_prices(Config::from_env().unwrap(), prices, NO_GATEWAY)
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
    let backend = build_with_prices(Config::from_env().unwrap(), prices, NO_GATEWAY)
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

    let backend = build_with_prices(Config::from_env().unwrap(), prices(), NO_GATEWAY)
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

    let backend = build_with_prices(Config::from_env().unwrap(), prices(), NO_GATEWAY)
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

#[tokio::test]
async fn a_probe_whose_lease_lapsed_is_resumed_with_only_its_missing_calls() {
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
        std::env::set_var("TCAB_OPENROUTER_API_KEY", "test-key");
    }

    // A gateway counting the calls it answers, each with a reply that submits nothing.
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let counter = Arc::clone(&calls);
    let app = axum::Router::new().route(
        "/chat/completions",
        axum::routing::post(move || {
            let counter = Arc::clone(&counter);
            async move {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                axum::Json(serde_json::json!({
                    "choices": [{ "finish_reason": "stop", "message": { "content": "" } }],
                    "usage": { "cost": 0.001 },
                }))
            }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let endpoint = format!("http://{addr}/chat/completions");

    // The previous process ran a probe of two samples per input prompt and recorded three of
    // its calls before it stopped; the lease it held has lapsed.
    let cases = crate::probe::plan_cases(Some("typescript")).unwrap();
    let samples = 2;
    let planned = cases.len() * samples as usize;
    let recorded = 3;
    {
        use test_cabinet_migration::MigratorTrait;
        let db = Db::connect(&url).await.unwrap();
        test_cabinet_migration::Migrator::up(&db.connection(), None)
            .await
            .unwrap();
        db.insert_model_probe(test_cabinet_entities::model_probe::Model {
            id: "probe-1".to_string(),
            model_slug: "test-model".to_string(),
            openrouter_slug: "test/model".to_string(),
            provider: None,
            user_id: "user-1".to_string(),
            language: Some("typescript".to_string()),
            samples,
            max_tokens: 3500,
            request_json: "[]".to_string(),
            status: "running".to_string(),
            error: None,
            verdict: None,
            pass_rate: None,
            spend: 0.0,
            created_at: "2026-08-23T00:00:00Z".to_string(),
            finished_at: None,
            lease_expires_at: Some("2026-08-23T00:02:00Z".to_string()),
            lease_holder: Some("gone".to_string()),
        })
        .await
        .unwrap();
        let coordinates = cases
            .iter()
            .flat_map(|case| (0..samples).map(move |sample| (case, sample)));
        for (n, (case, sample)) in coordinates.take(recorded).enumerate() {
            db.insert_model_probe_item(test_cabinet_entities::model_probe_item::Model {
                id: format!("item-{n}"),
                probe_id: "probe-1".to_string(),
                language: case.language().to_string(),
                scenario: case.scenario().to_string(),
                prompt: case.prompt().to_string(),
                sample,
                provider: None,
                finish_reason: Some("tool_calls".to_string()),
                native_finish_reason: None,
                label: Some("correct-calls".to_string()),
                pass: true,
                program_text: Some("x".to_string()),
                response_text: String::new(),
                reasoning_text: None,
                prompt_tokens: None,
                completion_tokens: None,
                cost: Some(0.01),
                duration_ms: 1,
                error: None,
                created_at: format!("2026-08-23T00:00:0{n}Z"),
            })
            .await
            .unwrap();
        }
    }

    // Port 0 is never connectable, so startup's price seeding fails fast instead of
    // waiting on OpenRouter's public catalog.
    let prices = crate::pricing::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models");
    let backend = build_with_prices(Config::from_env().unwrap(), prices, &endpoint)
        .await
        .unwrap();
    let db = Db::connect(&url).await.unwrap();
    let probe = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let probe = db.get_model_probe("probe-1").await.unwrap().unwrap();
            if probe.status != "running" {
                return probe;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the started backend resumes the probe");

    assert_eq!(probe.status, "complete");
    assert_eq!(
        calls.load(std::sync::atomic::Ordering::SeqCst),
        planned - recorded,
        "only the calls with no item are issued"
    );
    let items = db.list_model_probe_items("probe-1").await.unwrap();
    assert_eq!(items.len(), planned);
    let coordinates: std::collections::BTreeSet<_> = items
        .iter()
        .map(|i| (&i.scenario, &i.prompt, i.sample))
        .collect();
    assert_eq!(
        coordinates.len(),
        planned,
        "every coordinate holds one item"
    );
    // The verdict and spend are over the recorded and the new calls together.
    assert_eq!(probe.verdict.as_deref(), Some("not-ready"));
    assert_eq!(
        probe.pass_rate,
        Some(recorded as f64 / planned as f64),
        "the recorded passes count"
    );
    let spend = recorded as f64 * 0.01 + (planned - recorded) as f64 * 0.001;
    assert!((probe.spend - spend).abs() < 1e-9, "spend {}", probe.spend);
    assert_eq!(probe.lease_holder, None);
    drop(backend);
}
