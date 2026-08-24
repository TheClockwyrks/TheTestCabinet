use super::*;

use crate::db::{AliasEntry, ModelConfigWrite};

/// Serve a fixed OpenRouter `/models` catalog on a loopback port and return an
/// [`OpenRouterPrices`] pointed at it, so a seeding path can be exercised end to end
/// without reaching the real catalog.
async fn fake_openrouter(body: serde_json::Value) -> OpenRouterPrices {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = axum::Router::new().route(
        "/models",
        axum::routing::get(move || {
            let body = body.clone();
            async move { axum::Json(body) }
        }),
    );
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    OpenRouterPrices::with_endpoint(format!("http://{addr}/models"))
}

/// A one-model OpenRouter catalog carrying every fact an observation records.
fn catalog_of(id: &str) -> serde_json::Value {
    serde_json::json!({
        "data": [{
            "id": id,
            "pricing": {
                "prompt": "0.000003",
                "completion": "0.000015",
                "input_cache_read": "0.0000003",
            },
            "created": 1_760_000_000i64,
            "context_length": 400_000,
            "architecture": { "input_modalities": ["text", "image"] },
        }],
    })
}

/// An endpoint that cannot be connected to, so a path that must not reach the network
/// fails loudly if it tries.
fn unreachable_prices() -> OpenRouterPrices {
    OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models")
}

/// A launch prices its models at enqueue: a model the catalog has never seen gets its
/// first observation right there, so the console shows the model's prices — and a run
/// page its per-class cost split — without waiting for the run to complete.
#[tokio::test]
async fn a_launch_seeds_prices_for_a_model_the_catalog_has_never_seen() {
    let db = Db::connect_in_memory().await.unwrap();
    let prices = fake_openrouter(catalog_of("newco/brand-new")).await;

    seed_launch_prices(
        &db,
        &prices,
        &[("newco/brand-new".to_string(), HarnessSlug::Gg)],
    )
    .await;

    let observed = db
        .latest_price("newco/brand-new")
        .await
        .unwrap()
        .expect("the launch recorded a first price observation");
    assert_eq!(observed.uncached_input, Some(0.000003));
    assert_eq!(observed.cached_input, Some(0.0000003));
    assert_eq!(observed.output, Some(0.000015));
    // The catalog facts that ride along on an observation are seeded with it, so the
    // launch's own window resolution finds them here instead of re-fetching.
    assert_eq!(observed.context_length, Some(400_000));
    assert_eq!(observed.input_modalities.as_deref(), Some("text,image"));
}

/// Seeding is missing-only: a model already on record keeps its history and costs no
/// fetch, leaving the price-as-it-was-at-run-time observation to completion time.
#[tokio::test]
async fn a_launch_does_not_re_price_a_model_already_on_record() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_price_observation(PriceWrite {
        model_id: "newco/known".to_string(),
        observed_at: "2026-01-01T00:00:00Z".to_string(),
        uncached_input: Some(1.0),
        cached_input: None,
        output: Some(2.0),
        context_length: Some(128_000),
        released_at: None,
        input_modalities: None,
    })
    .await
    .unwrap();

    // An unreachable endpoint: reaching for the catalog at all would fail this.
    seed_launch_prices(
        &db,
        &unreachable_prices(),
        &[("newco/known".to_string(), HarnessSlug::Gg)],
    )
    .await;

    let observed = db.latest_price("newco/known").await.unwrap().unwrap();
    assert_eq!(observed.uncached_input, Some(1.0));
    assert_eq!(observed.observed_at, "2026-01-01T00:00:00Z");
}

/// A curated model is priced under its **configured OpenRouter slug** — the key the
/// periodic refresh writes — even when the launch names it by a native alias, so the
/// observation lands where the alias histories merge at compose time.
#[tokio::test]
async fn a_launch_prices_a_curated_model_through_its_openrouter_slug() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        slug: "opus-4-8".to_string(),
        display_name: "Opus 4.8".to_string(),
        provider: "Anthropic".to_string(),
        provider_logo_url: None,
        provider_logo_svg: None,
        description_md: None,
        openrouter_slug: Some("anthropic/claude-opus-4.8".to_string()),
        aliases: vec![AliasEntry {
            alias: "claude-opus-4-8".to_string(),
            family: HarnessFamily::Claude,
        }],
        now: "2026-01-01T00:00:00Z".to_string(),
    })
    .await
    .unwrap();
    let prices = fake_openrouter(catalog_of("anthropic/claude-opus-4.8")).await;

    seed_launch_prices(
        &db,
        &prices,
        &[("claude-opus-4-8".to_string(), HarnessSlug::Claude)],
    )
    .await;

    // Asked about under the configured slug, filed under the run's canonical id — the
    // same pair the completion-time observation uses.
    let observed = db
        .latest_price("claude-opus-4-8")
        .await
        .unwrap()
        .expect("the curated model was priced through its slug");
    assert_eq!(observed.output, Some(0.000015));
}

/// Curating a model prices it immediately, so the Models page shows figures for a model
/// that has never been run rather than a dash until its first run completes.
#[tokio::test]
async fn curating_a_model_seeds_its_prices() {
    let db = Db::connect_in_memory().await.unwrap();
    let prices = fake_openrouter(catalog_of("newco/brand-new")).await;

    seed_curated_price(&db, &prices, "newco/brand-new").await;

    let observed = db
        .latest_price("newco/brand-new")
        .await
        .unwrap()
        .expect("the curated slug was priced on save");
    assert_eq!(observed.uncached_input, Some(0.000003));
    assert_eq!(observed.context_length, Some(400_000));
}

/// A model OpenRouter does not list (a provider-native id, an unlisted model) records
/// nothing and fails nothing — a launch is never blocked by an unpriced model.
#[tokio::test]
async fn an_unlisted_model_is_seeded_silently() {
    let db = Db::connect_in_memory().await.unwrap();
    let prices = fake_openrouter(catalog_of("someone/else")).await;

    seed_launch_prices(
        &db,
        &prices,
        &[("newco/unlisted".to_string(), HarnessSlug::Gg)],
    )
    .await;

    assert!(db.latest_price("newco/unlisted").await.unwrap().is_none());
}

/// Startup prices a freshly seeded curated catalog: a rebuilt deployment inserts the
/// curated configs with no price rows, and this pass records their first observations
/// before any run exists — so a live run's per-class cost split never waits on a
/// completed run.
#[tokio::test]
async fn startup_prices_a_freshly_seeded_curated_catalog() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        slug: "opus-4-8".to_string(),
        display_name: "Opus 4.8".to_string(),
        provider: "Anthropic".to_string(),
        provider_logo_url: None,
        provider_logo_svg: None,
        description_md: None,
        openrouter_slug: Some("anthropic/claude-opus-4.8".to_string()),
        aliases: vec![AliasEntry {
            alias: "claude-opus-4-8".to_string(),
            family: HarnessFamily::Claude,
        }],
        now: "2026-01-01T00:00:00Z".to_string(),
    })
    .await
    .unwrap();
    let prices = fake_openrouter(catalog_of("anthropic/claude-opus-4.8")).await;

    let seeded = seed_catalog_prices(&db, &prices).await.unwrap();

    assert_eq!(seeded, 1);
    // Filed under the configured slug — the key the periodic refresh writes — so the
    // observation merges with the model's alias histories at compose time.
    let observed = db
        .latest_price("anthropic/claude-opus-4.8")
        .await
        .unwrap()
        .expect("startup recorded the curated model's first observation");
    assert_eq!(observed.uncached_input, Some(0.000003));
    assert_eq!(observed.output, Some(0.000015));
    assert_eq!(observed.context_length, Some(400_000));
}

/// Startup seeding is missing-only: a catalog already fully priced reads the database
/// and fetches nothing, so the steady-state boot costs no network.
#[tokio::test]
async fn startup_seeding_is_missing_only_and_fetches_nothing() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        slug: "opus-4-8".to_string(),
        display_name: "Opus 4.8".to_string(),
        provider: "Anthropic".to_string(),
        provider_logo_url: None,
        provider_logo_svg: None,
        description_md: None,
        openrouter_slug: Some("anthropic/claude-opus-4.8".to_string()),
        aliases: vec![AliasEntry {
            alias: "claude-opus-4-8".to_string(),
            family: HarnessFamily::Claude,
        }],
        now: "2026-01-01T00:00:00Z".to_string(),
    })
    .await
    .unwrap();
    db.insert_price_observation(PriceWrite {
        model_id: "anthropic/claude-opus-4.8".to_string(),
        observed_at: "2026-01-01T00:00:00Z".to_string(),
        uncached_input: Some(1.0),
        cached_input: None,
        output: Some(2.0),
        context_length: Some(200_000),
        released_at: None,
        input_modalities: None,
    })
    .await
    .unwrap();

    // An unreachable endpoint: reaching for the catalog at all would fail this.
    let seeded = seed_catalog_prices(&db, &unreachable_prices())
        .await
        .unwrap();

    assert_eq!(seeded, 0);
    let observed = db
        .latest_price("anthropic/claude-opus-4.8")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(observed.observed_at, "2026-01-01T00:00:00Z");
}
