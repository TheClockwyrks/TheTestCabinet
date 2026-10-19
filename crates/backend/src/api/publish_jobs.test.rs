use super::*;
use test_cabinet_contracts::run_record::RunLinks;

fn success_result() -> PublishResult {
    PublishResult {
        state: PublishState::Succeeded,
        source_repo: Some("https://github.com/x/y".to_string()),
        playable_build: Some("https://abc.pages.dev".to_string()),
        detail: None,
    }
}

/// Drain a publish NDJSON stream to its close, returning each non-empty line parsed
/// as JSON. A heartbeat-free publish stream closes promptly on the terminal result,
/// so this completes without a timeout.
async fn drain(stream: impl Stream<Item = Result<Bytes, Infallible>>) -> Vec<serde_json::Value> {
    let bytes: Vec<u8> = stream
        .map(|chunk| chunk.unwrap())
        .collect::<Vec<_>>()
        .await
        .concat();
    String::from_utf8(bytes)
        .unwrap()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

/// Each stream item is tagged with a `type` discriminator so a subscriber tells a
/// progress line from the terminal result.
#[test]
fn encode_item_tags_progress_and_result() {
    let progress = encode_item(&PublishStreamItem::Progress(Box::new(PublishProgress {
        message: "creating repo".to_string(),
    })));
    let value: serde_json::Value = serde_json::from_slice(&progress).unwrap();
    assert_eq!(value["type"], "progress");
    assert_eq!(value["message"], "creating repo");

    let result = encode_item(&PublishStreamItem::Result(Box::new(success_result())));
    let value: serde_json::Value = serde_json::from_slice(&result).unwrap();
    assert_eq!(value["type"], "result");
    assert_eq!(value["state"], "succeeded");
    assert_eq!(value["sourceRepo"], "https://github.com/x/y");
}

/// A subscriber to a live publish receives the progress lines and the terminal
/// result as NDJSON, and the stream closes once the result is delivered.
#[tokio::test]
async fn publish_stream_replays_progress_then_result_then_closes() {
    let relay = crate::publish_relay::PublishRelay::new();
    let live = relay.live("p1");
    live.push_progress(PublishProgress {
        message: "creating repo".to_string(),
    });
    live.finish(success_result());

    // The publish is already terminal, so the backlog carries both items and the
    // stream closes after draining it (no persisted-terminal fallback needed).
    let lines = drain(publish_stream(live, None)).await;
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["type"], "progress");
    assert_eq!(lines[1]["type"], "result");
    assert_eq!(lines[1]["state"], "succeeded");
}

/// When the live buffer is lost (a fresh, empty relay) but the persisted row says
/// the publish finished, the synthesized terminal result is appended so the stream
/// still closes with the outcome.
#[tokio::test]
async fn publish_stream_synthesizes_a_terminal_result_when_the_buffer_is_lost() {
    let relay = crate::publish_relay::PublishRelay::new();
    let live = relay.live("p1");

    let lines = drain(publish_stream(live, Some(success_result()))).await;
    assert_eq!(lines.len(), 1, "just the synthesized terminal result");
    assert_eq!(lines[0]["type"], "result");
    assert_eq!(lines[0]["playableBuild"], "https://abc.pages.dev");
}

/// `terminal_from_row` reconstructs a succeeded result's links from a persisted
/// publish-job row, and maps any non-success terminal row to a failure carrying its
/// detail.
#[test]
fn terminal_from_row_reconstructs_succeeded_and_failed() {
    let succeeded = publish_job::Model {
        id: "p1".to_string(),
        state: "succeeded".to_string(),
        run_id: "r1".to_string(),
        job_token: "t".to_string(),
        source_repo: Some("https://github.com/x/y".to_string()),
        playable_build: Some("https://abc.pages.dev".to_string()),
        detail: None,
        created_at: "2026-06-27T00:00:00Z".to_string(),
        updated_at: "2026-06-27T00:01:00Z".to_string(),
    };
    let result = terminal_from_row(&succeeded);
    assert_eq!(result.state, PublishState::Succeeded);
    assert_eq!(
        result.source_repo.as_deref(),
        Some("https://github.com/x/y")
    );

    let failed = publish_job::Model {
        state: "failed".to_string(),
        source_repo: None,
        playable_build: None,
        detail: Some("wrangler exploded".to_string()),
        ..succeeded
    };
    let result = terminal_from_row(&failed);
    assert_eq!(result.state, PublishState::Failed);
    assert_eq!(result.detail.as_deref(), Some("wrangler exploded"));
}

/// The publish-failure alert describes the run in the same terms every other
/// notification uses, lifted straight off the run row rather than out of its
/// record blob.
#[test]
fn run_summary_lifts_the_runs_display_identity() {
    let run = run::Model {
        id: "r1".to_string(),
        started_at: "2026-06-27T00:00:00Z".to_string(),
        finished_at: "2026-06-27T00:30:00Z".to_string(),
        published_at: None,
        test_case_slug: "carom".to_string(),
        test_case_version: "v1.0.0".to_string(),
        variant: "base".to_string(),
        engine_slug: Some("none".to_string()),
        harness_slug: "claude-code".to_string(),
        harness_version: None,
        model_id: "claude-opus-4".to_string(),
        gg_preset: None,
        gg_config_id: None,
        gg_models: None,
        test_type: "end-to-end".to_string(),
        run_state: "completed".to_string(),
        run_time_seconds: 12.0,
        total_tokens: 100,
        cost_comparable: None,
        rating: Some("great".to_string()),
        validator_rating: None,

        aesthetic: None,

        validator_rated: false,
        review_count: 1,
        loaded: true,
        published: false,
        record_json: "{}".to_string(),
        record_readable: true,
        record_format: 1,
        events_json: None,
        artifacts_stored: None,
        code_analyzer_version: None,
        updated_at: "2026-06-27T00:30:00Z".to_string(),
    };

    let summary = run_summary(&run);
    assert_eq!(summary.test_case_slug, "carom");
    assert_eq!(summary.test_case_version, "v1.0.0");
    assert_eq!(summary.variant, "base");
    assert_eq!(summary.harness_slug, "claude-code");
    assert_eq!(summary.model_id, "claude-opus-4");
}

// --- A repeated success through the route ---------------------------------------

/// A backend over an in-memory database with no Access application, holding run
/// `r1` pushed with `links` and a queued publish job `p1` for it.
async fn publish_backend(links: RunLinks) -> (tempfile::TempDir, AppState, axum::Router) {
    let dir = tempfile::tempdir().unwrap();
    // SAFETY: nextest runs each test in its own process, so this environment is this
    // test's alone.
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
        std::env::set_var("TCAB_BACKEND_SERVICE_TOKEN", "service-secret");
    }
    let config = std::sync::Arc::new(crate::config::Config::from_env().unwrap());
    let db = std::sync::Arc::new(crate::db::Db::connect_in_memory().await.unwrap());
    let store = crate::store::DefinitionStore::open(&config.store).unwrap();
    let publisher = crate::publisher::Publisher::new(
        std::sync::Arc::clone(&db),
        store.clone(),
        None,
        None,
        None,
        None,
        crate::publisher::PublisherTiming {
            coalesce: config.coalesce,
            snapshot_retention: config.snapshot_retention,
        },
    );
    let state = AppState {
        db: std::sync::Arc::clone(&db),
        store,
        ready: crate::readiness::Readiness::new(true),
        publisher,
        access: None,
        relay: crate::relay::Relay::new(),
        publish_relay: crate::publish_relay::PublishRelay::new(),
        config,
        http: reqwest::Client::new(),
        prices: crate::pricing::OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models"),
        gg_docs: crate::gg_docs::GgDocIndex::new(),
    };
    db.push(&crate::db::tests::record("r1"), &links, None, None)
        .await
        .unwrap();
    enqueue(&state, "p1").await;
    let router = crate::api::router(state.clone());
    (dir, state, router)
}

/// Queue publish job `job` for run `r1`, its token `token-<job>`.
async fn enqueue(state: &AppState, job: &str) {
    state
        .db
        .enqueue_publish_job(crate::db::NewPublishJob {
            id: job.to_string(),
            run_id: "r1".to_string(),
            job_token: format!("token-{job}"),
            created_at: "2026-10-18T00:00:00Z".to_string(),
        })
        .await
        .unwrap();
}

/// `POST /publish-jobs/{job}/result` with the job's own token, returning the status.
async fn report(router: &axum::Router, job: &str, result: &PublishResult) -> StatusCode {
    use tower::ServiceExt;
    let request = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/publish-jobs/{job}/result"))
        .header("Authorization", format!("Bearer token-{job}"))
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(result).unwrap()))
        .unwrap();
    router.clone().oneshot(request).await.unwrap().status()
}

/// The run `r1` as stored: its links, published flag and publication time.
async fn stored_r1(state: &AppState) -> (RunLinks, bool, Option<String>) {
    let run = state.db.get_run("r1").await.unwrap().unwrap();
    (run.links, run.published, run.published_at)
}

fn no_links() -> RunLinks {
    RunLinks {
        source_repo: None,
        playable_build: None,
    }
}

fn result_links() -> RunLinks {
    let result = success_result();
    RunLinks {
        source_repo: result.source_repo,
        playable_build: result.playable_build,
    }
}

/// A publisher that reported its success and then reported it again (its first
/// report's response was lost, or it was restarted after the report landed) is
/// accepted both times: the run keeps the links and the publication time the first
/// report gave it, and the job stays succeeded.
#[tokio::test]
async fn the_same_job_reporting_success_twice_is_accepted_and_keeps_the_publication_time() {
    let (_dir, state, router) = publish_backend(no_links()).await;

    assert_eq!(
        report(&router, "p1", &success_result()).await,
        StatusCode::NO_CONTENT
    );
    let (links, published, first_published_at) = stored_r1(&state).await;
    assert_eq!(links, result_links());
    assert!(published);
    let first_published_at = first_published_at.expect("the first success stamps a time");

    assert_eq!(
        report(&router, "p1", &success_result()).await,
        StatusCode::NO_CONTENT,
        "a repeated success is accepted"
    );
    let (links, published, published_at) = stored_r1(&state).await;
    assert_eq!(links, result_links(), "the same links are asserted again");
    assert!(published);
    assert_eq!(published_at.as_deref(), Some(first_published_at.as_str()));

    let job = state.db.get_publish_job("p1").await.unwrap().unwrap();
    assert_eq!(job.state, "succeeded");
    assert_eq!(job.source_repo, result_links().source_repo);
    assert_eq!(job.playable_build, result_links().playable_build);
}

/// A second publish job for a run another job already published (a publish
/// requested again, or the sweep's retry of a job whose first publisher stopped
/// after its report) is accepted: the links are asserted again and the run keeps
/// its original publication time.
#[tokio::test]
async fn a_second_job_for_a_published_run_is_accepted_and_keeps_the_publication_time() {
    let (_dir, state, router) = publish_backend(no_links()).await;
    state
        .db
        .add_review("r1", &crate::db::tests::review(), None, None)
        .await
        .unwrap();
    state
        .db
        .publish("r1", "2026-01-02T03:04:05Z")
        .await
        .unwrap();

    assert_eq!(
        report(&router, "p1", &success_result()).await,
        StatusCode::NO_CONTENT
    );
    // One queued job per run: the second is queued once the first has ended.
    enqueue(&state, "p2").await;
    assert_eq!(
        report(&router, "p2", &success_result()).await,
        StatusCode::NO_CONTENT,
        "a second job's success for a published run is accepted"
    );

    let (links, published, published_at) = stored_r1(&state).await;
    assert_eq!(links, result_links());
    assert!(published);
    assert_eq!(published_at.as_deref(), Some("2026-01-02T03:04:05Z"));
    for job in ["p1", "p2"] {
        let job = state.db.get_publish_job(job).await.unwrap().unwrap();
        assert_eq!(job.state, "succeeded");
        assert_eq!(job.source_repo, result_links().source_repo);
        assert_eq!(job.playable_build, result_links().playable_build);
    }
}
