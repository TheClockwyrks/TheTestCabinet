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

/// A one-model OpenRouter catalog carrying every fact an observation records, and the
/// model's own price, which a list price falls to when no endpoint of the hand-set
/// provider or of the model's developer yields one.
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

/// A launch observes its models at enqueue: a model the catalog has never seen gets its
/// first observation right there, so the console shows the model's catalog facts
/// without waiting for the run to complete.
#[tokio::test]
async fn a_launch_seeds_the_facts_of_a_model_the_catalog_has_never_seen() {
    let db = Db::connect_in_memory().await.unwrap();
    let prices = fake_openrouter(catalog_of("newco/brand-new")).await;

    seed_launch_facts(
        &db,
        &prices,
        &[("newco/brand-new".to_string(), HarnessSlug::Gg)],
    )
    .await;

    let observed = db
        .latest_price("newco/brand-new")
        .await
        .unwrap()
        .expect("the launch recorded a first observation");
    // The launch's own window resolution finds the facts here instead of re-fetching.
    assert_eq!(observed.context_length, Some(400_000));
    assert_eq!(observed.input_modalities.as_deref(), Some("text,image"));
    assert!(observed.released_at.is_some());
}

/// Seeding is missing-only: a model already on record keeps its history and costs no
/// fetch, leaving its next observation to completion time.
#[tokio::test]
async fn a_launch_does_not_re_observe_a_model_already_on_record() {
    let db = Db::connect_in_memory().await.unwrap();
    db.insert_price_observation(PriceWrite {
        model_id: "newco/known".to_string(),
        observed_at: "2026-01-01T00:00:00Z".to_string(),
        context_length: Some(128_000),
        released_at: None,
        input_modalities: None,
        provider_pin: Some("NewCo".to_string()),
    })
    .await
    .unwrap();

    // An unreachable endpoint: reaching for the catalog at all would fail this.
    seed_launch_facts(
        &db,
        &unreachable_prices(),
        &[("newco/known".to_string(), HarnessSlug::Gg)],
    )
    .await;

    let observed = db.latest_price("newco/known").await.unwrap().unwrap();
    assert_eq!(observed.context_length, Some(128_000));
    assert_eq!(observed.observed_at, "2026-01-01T00:00:00Z");
    assert_eq!(db.all_model_prices().await.unwrap().len(), 1);
}

/// A curated model is looked up under its **configured OpenRouter slug** even when the
/// launch names it by a native alias, so a model OpenRouter lists under another
/// spelling is still observed.
#[tokio::test]
async fn a_launch_observes_a_curated_model_through_its_openrouter_slug() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        slug: "opus-4-8".to_string(),
        display_name: "Opus 4.8".to_string(),
        provider: "Anthropic".to_string(),
        provider_logo_url: None,
        provider_logo_svg: None,
        description_md: None,
        openrouter_slug: Some("anthropic/claude-opus-4.8".to_string()),
        provider_pin: None,
        list_price_input: None,
        list_price_cached_input: None,
        list_price_output: None,
        list_price_as_of: None,
        list_price_source: None,
        aliases: vec![AliasEntry {
            alias: "claude-opus-4-8".to_string(),
            family: HarnessFamily::Claude,
        }],
        now: "2026-01-01T00:00:00Z".to_string(),
        ..Default::default()
    })
    .await
    .unwrap();
    let prices = fake_openrouter(catalog_of("anthropic/claude-opus-4.8")).await;

    seed_launch_facts(
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
        .expect("the curated model was observed through its slug");
    assert_eq!(observed.context_length, Some(400_000));
}

/// Curating a model observes it immediately, so the Models page shows the facts of a
/// model that has never been run rather than a dash until its first run completes.
#[tokio::test]
async fn curating_a_model_seeds_its_facts() {
    let db = Db::connect_in_memory().await.unwrap();
    let prices = fake_openrouter(catalog_of("newco/brand-new")).await;

    seed_curated_facts(&db, &prices, "newco/brand-new").await;

    let observed = db
        .latest_price("newco/brand-new")
        .await
        .unwrap()
        .expect("the curated slug was observed on save");
    assert_eq!(observed.context_length, Some(400_000));
}

/// A model OpenRouter does not list (a provider-native id, an unlisted model) records
/// nothing and fails nothing — a launch is never blocked by an unobserved model.
#[tokio::test]
async fn an_unlisted_model_is_seeded_silently() {
    let db = Db::connect_in_memory().await.unwrap();
    let prices = fake_openrouter(catalog_of("someone/else")).await;

    seed_launch_facts(
        &db,
        &prices,
        &[("newco/unlisted".to_string(), HarnessSlug::Gg)],
    )
    .await;

    assert!(db.latest_price("newco/unlisted").await.unwrap().is_none());
}

/// Startup observes a freshly seeded curated catalog: a rebuilt deployment inserts the
/// curated configs with no observations, and this pass records their first before any
/// run exists.
#[tokio::test]
async fn startup_observes_a_freshly_seeded_curated_catalog() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        slug: "opus-4-8".to_string(),
        display_name: "Opus 4.8".to_string(),
        provider: "Anthropic".to_string(),
        provider_logo_url: None,
        provider_logo_svg: None,
        description_md: None,
        openrouter_slug: Some("anthropic/claude-opus-4.8".to_string()),
        provider_pin: None,
        list_price_input: None,
        list_price_cached_input: None,
        list_price_output: None,
        list_price_as_of: None,
        list_price_source: None,
        aliases: vec![AliasEntry {
            alias: "claude-opus-4-8".to_string(),
            family: HarnessFamily::Claude,
        }],
        now: "2026-01-01T00:00:00Z".to_string(),
        ..Default::default()
    })
    .await
    .unwrap();
    let prices = fake_openrouter(catalog_of("anthropic/claude-opus-4.8")).await;

    let seeded = seed_catalog_facts(&db, &prices).await.unwrap();

    assert_eq!(seeded, 1);
    // Filed under the configured slug — the key the periodic refresh writes — so the
    // observation merges with the model's alias histories at compose time.
    let observed = db
        .latest_price("anthropic/claude-opus-4.8")
        .await
        .unwrap()
        .expect("startup recorded the curated model's first observation");
    assert_eq!(observed.context_length, Some(400_000));
}

/// Startup seeding is missing-only: a catalog already fully observed reads the database
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
        provider_pin: None,
        list_price_input: None,
        list_price_cached_input: None,
        list_price_output: None,
        list_price_as_of: None,
        list_price_source: None,
        aliases: vec![AliasEntry {
            alias: "claude-opus-4-8".to_string(),
            family: HarnessFamily::Claude,
        }],
        now: "2026-01-01T00:00:00Z".to_string(),
        ..Default::default()
    })
    .await
    .unwrap();
    db.insert_price_observation(PriceWrite {
        model_id: "anthropic/claude-opus-4.8".to_string(),
        observed_at: "2026-01-01T00:00:00Z".to_string(),
        context_length: Some(200_000),
        released_at: None,
        input_modalities: None,
        provider_pin: Some("Anthropic".to_string()),
    })
    .await
    .unwrap();

    // An unreachable endpoint: reaching for the catalog at all would fail this.
    let seeded = seed_catalog_facts(&db, &unreachable_prices())
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

/// Serve a fixed `/models` catalog plus a fixed `/models/{id}/endpoints` body for every
/// model, so a path that reads a model's endpoints can be exercised end to end.
async fn fake_openrouter_with_endpoints(
    catalog: serde_json::Value,
    endpoints: serde_json::Value,
) -> OpenRouterPrices {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = axum::Router::new()
        .route(
            "/models",
            axum::routing::get(move || {
                let body = catalog.clone();
                async move { axum::Json(body) }
            }),
        )
        .route(
            "/models/{*rest}",
            axum::routing::get(move || {
                let body = endpoints.clone();
                async move { axum::Json(body) }
            }),
        );
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    OpenRouterPrices::with_endpoint(format!("http://{addr}/models"))
}

/// An endpoints listing whose developer (Z.AI, for a `z-ai/…` id) charges the list rate
/// while a third-party route listed ahead of it undercuts it.
fn endpoints_with_official_route() -> serde_json::Value {
    serde_json::json!({
        "data": {
            "name": "Z.AI: GLM 5.3",
            "endpoints": [
                {
                    "provider_name": "Cheapo",
                    "pricing": { "prompt": "0.000001", "completion": "0.000002" },
                },
                {
                    "provider_name": "Z.AI",
                    "pricing": {
                        "prompt": "0.0000014",
                        "completion": "0.0000044",
                        "input_cache_read": "0.00000026",
                    },
                },
            ],
        },
    })
}

/// The fact refresh records the developer provider the endpoints listing names beside
/// the facts the models listing carries, and no rate.
#[tokio::test]
async fn the_fact_refresh_records_the_developer_provider() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("z-ai/glm-5.3".to_string()),
        ..crate::db::tests::model_write("glm-5-3", "GLM 5.3", &["z-ai/glm-5.3"])
    })
    .await
    .unwrap();
    let prices =
        fake_openrouter_with_endpoints(catalog_of("z-ai/glm-5.3"), endpoints_with_official_route())
            .await;

    assert_eq!(refresh_all_facts(&db, &prices).await.unwrap(), 1);

    let observed = db
        .latest_price("z-ai/glm-5.3")
        .await
        .unwrap()
        .expect("the refresh recorded an observation");
    assert_eq!(observed.provider_pin.as_deref(), Some("Z.AI"));
    assert_eq!(observed.context_length, Some(400_000));
    assert_eq!(observed.input_modalities.as_deref(), Some("text,image"));
    assert!(observed.released_at.is_some());
    // The fact refresh writes no list price: that is the list price refresh's.
    let stored = db.get_model_config("glm-5-3").await.unwrap().unwrap();
    assert_eq!(stored.config.list_price_input, None);

    // Nothing changed, so a second refresh appends nothing.
    assert_eq!(refresh_all_facts(&db, &prices).await.unwrap(), 0);
    assert_eq!(db.all_model_prices().await.unwrap().len(), 1);
}

/// A fact that changes while the others hold still is a new observation.
#[tokio::test]
async fn the_fact_refresh_appends_an_observation_when_a_fact_changes() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("z-ai/glm-5.3".to_string()),
        ..crate::db::tests::model_write("glm-5-3", "GLM 5.3", &["z-ai/glm-5.3"])
    })
    .await
    .unwrap();
    let prices =
        fake_openrouter_with_endpoints(catalog_of("z-ai/glm-5.3"), endpoints_with_official_route())
            .await;
    refresh_all_facts(&db, &prices).await.unwrap();

    let mut longer = catalog_of("z-ai/glm-5.3");
    longer["data"][0]["context_length"] = serde_json::json!(1_000_000);
    let prices = fake_openrouter_with_endpoints(longer, endpoints_with_official_route()).await;

    assert_eq!(refresh_all_facts(&db, &prices).await.unwrap(), 1);
    assert_eq!(db.all_model_prices().await.unwrap().len(), 2);
    let observed = db.latest_price("z-ai/glm-5.3").await.unwrap().unwrap();
    assert_eq!(observed.context_length, Some(1_000_000));
    assert_eq!(observed.provider_pin.as_deref(), Some("Z.AI"));
}

/// An endpoints listing that cannot be read keeps the developer provider last recorded,
/// so an unreachable endpoint never records a model as having lost it.
#[tokio::test]
async fn an_unreadable_endpoints_listing_keeps_the_recorded_developer_provider() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("z-ai/glm-5.3".to_string()),
        ..crate::db::tests::model_write("glm-5-3", "GLM 5.3", &["z-ai/glm-5.3"])
    })
    .await
    .unwrap();
    let prices =
        fake_openrouter_with_endpoints(catalog_of("z-ai/glm-5.3"), endpoints_with_official_route())
            .await;
    refresh_all_facts(&db, &prices).await.unwrap();

    // The models listing answers, with a longer window; the endpoints listing does not.
    let mut longer = catalog_of("z-ai/glm-5.3");
    longer["data"][0]["context_length"] = serde_json::json!(1_000_000);
    let prices = fake_openrouter(longer).await;

    assert_eq!(refresh_all_facts(&db, &prices).await.unwrap(), 1);
    let observed = db.latest_price("z-ai/glm-5.3").await.unwrap().unwrap();
    assert_eq!(observed.context_length, Some(1_000_000));
    assert_eq!(observed.provider_pin.as_deref(), Some("Z.AI"));
}

/// An endpoints listing as OpenRouter writes one for a model its developer serves at two
/// tiers: the Flex endpoint first at half price, then the standard one, both under the one
/// `provider_name` and told apart only by `tag`.
fn endpoints_with_flex_listed_first() -> serde_json::Value {
    serde_json::json!({
        "data": {
            "name": "OpenAI: GPT-5.6 Sol",
            "endpoints": [
                {
                    "name": "OpenAI | openai/gpt-5.6-sol",
                    "provider_name": "OpenAI",
                    "tag": "openai/flex",
                    "context_length": 400_000,
                    "pricing": {
                        "prompt": "0.000000625",
                        "completion": "0.000005",
                        "input_cache_read": "0.0000000625",
                    },
                    "supported_parameters": ["tools", "tool_choice", "reasoning"],
                },
                {
                    "name": "OpenAI | openai/gpt-5.6-sol",
                    "provider_name": "OpenAI",
                    "tag": "openai",
                    "context_length": 400_000,
                    "pricing": {
                        "prompt": "0.00000125",
                        "completion": "0.00001",
                        "input_cache_read": "0.000000125",
                    },
                    "supported_parameters": ["tools", "tool_choice", "reasoning"],
                },
            ],
        },
    })
}

/// The same model with its standard endpoint gone: the developer lists a Flex endpoint
/// and nothing else.
fn endpoints_with_only_flex() -> serde_json::Value {
    let mut listing = endpoints_with_flex_listed_first();
    listing["data"]["endpoints"]
        .as_array_mut()
        .expect("the fixture lists endpoints")
        .truncate(1);
    listing
}

/// A curated `openai/gpt-5.6-sol` entry with no list price.
async fn db_with_sol() -> Db {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("openai/gpt-5.6-sol".to_string()),
        ..crate::db::tests::model_write("gpt-5-6-sol", "GPT-5.6 Sol", &["openai/gpt-5.6-sol"])
    })
    .await
    .unwrap();
    db
}

/// A run's completion observes the model's catalog facts, the developer provider among
/// them, and records no rate.
#[tokio::test]
async fn a_completion_observes_the_models_facts() {
    let db = db_with_sol().await;
    let prices = fake_openrouter_with_endpoints(
        catalog_of("openai/gpt-5.6-sol"),
        endpoints_with_flex_listed_first(),
    )
    .await;

    observe_completion(&db, &prices, "openai/gpt-5.6-sol", HarnessSlug::Kilo).await;

    let observed = db
        .latest_price("openai/gpt-5.6-sol")
        .await
        .unwrap()
        .expect("the completion recorded an observation");
    assert_eq!(observed.context_length, Some(400_000));
    assert_eq!(observed.input_modalities.as_deref(), Some("text,image"));
    assert_eq!(observed.provider_pin.as_deref(), Some("OpenAI"));
    let stored = db.get_model_config("gpt-5-6-sol").await.unwrap().unwrap();
    assert_eq!(stored.config.list_price_input, None);

    // A second completion with nothing changed appends nothing.
    observe_completion(&db, &prices, "openai/gpt-5.6-sol", HarnessSlug::Kilo).await;
    assert_eq!(db.all_model_prices().await.unwrap().len(), 1);
}

/// The enqueue-time fill writes the standard rate onto the entry when the developer's
/// Flex endpoint is listed first. When Flex is all the developer lists, its Flex rate is
/// not read: the fill falls to the model's own price in the models listing, and where
/// that publishes none either there is no list price to fill and the launch is refused.
#[tokio::test]
async fn the_fill_takes_the_standard_rate_when_flex_is_listed_first() {
    let db = db_with_sol().await;
    let prices = fake_openrouter_with_endpoints(
        catalog_of("openai/gpt-5.6-sol"),
        endpoints_with_flex_listed_first(),
    )
    .await;

    let resolved = list_price_for_launch(
        &db,
        &prices,
        "openai/gpt-5.6-sol",
        HarnessSlug::Kilo,
        &|| {},
    )
    .await
    .unwrap()
    .expect("the fill prices the launch");
    assert_eq!(resolved.uncached_input, Some(0.00000125));
    assert_eq!(resolved.cached_input, Some(0.000000125));
    assert_eq!(resolved.output, Some(0.00001));
    let stored = db.get_model_config("gpt-5-6-sol").await.unwrap().unwrap();
    assert_eq!(stored.config.list_price_input, Some(0.00000125));
    assert_eq!(stored.config.list_price_cached_input, Some(0.000000125));
    assert_eq!(stored.config.list_price_output, Some(0.00001));

    let db = db_with_sol().await;
    let prices = fake_openrouter_with_endpoints(
        catalog_of("openai/gpt-5.6-sol"),
        endpoints_with_only_flex(),
    )
    .await;
    let resolved = list_price_for_launch(
        &db,
        &prices,
        "openai/gpt-5.6-sol",
        HarnessSlug::Kilo,
        &|| {},
    )
    .await
    .unwrap()
    .expect("the models listing prices the launch");
    assert_eq!(resolved.uncached_input, Some(0.000003));
    assert_eq!(resolved.cached_input, Some(0.0000003));
    assert_eq!(resolved.output, Some(0.000015));

    let db = db_with_sol().await;
    let mut unpriced = catalog_of("openai/gpt-5.6-sol");
    unpriced["data"][0]["pricing"] = serde_json::json!({ "prompt": "-1", "completion": "-1" });
    let prices = fake_openrouter_with_endpoints(unpriced, endpoints_with_only_flex()).await;
    let reason = list_price_for_launch(
        &db,
        &prices,
        "openai/gpt-5.6-sol",
        HarnessSlug::Kilo,
        &|| {},
    )
    .await
    .unwrap()
    .expect_err("a model listing only Flex endpoints has no list price to fill");
    assert!(reason.contains("no complete rate"), "{reason}");
    let stored = db.get_model_config("gpt-5-6-sol").await.unwrap().unwrap();
    assert_eq!(stored.config.list_price_input, None);
}

// --- The enqueue-time list-price fill ------------------------------------------

/// Today's date as the fill stamps it, `YYYY-MM-DD`.
fn today() -> String {
    OffsetDateTime::now_utc()
        .date()
        .format(&time::macros::format_description!("[year]-[month]-[day]"))
        .unwrap()
}

/// A curated entry with no list price has one filled from its developer's standard rate
/// at enqueue: the launch is stamped with it, and the entry carries it from then on,
/// dated today and sourced `openrouter`, so the next launch reads it from the catalog
/// without reaching OpenRouter.
#[tokio::test]
async fn a_launch_fills_a_curated_models_missing_list_price_from_its_developers_endpoint() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("z-ai/glm-5.3".to_string()),
        ..crate::db::tests::model_write("glm-5-3", "GLM 5.3", &["z-ai/glm-5.3"])
    })
    .await
    .unwrap();
    let prices =
        fake_openrouter_with_endpoints(catalog_of("z-ai/glm-5.3"), endpoints_with_official_route())
            .await;

    let fills = std::sync::atomic::AtomicUsize::new(0);
    let on_fill = || {
        fills.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    };
    let resolved = list_price_for_launch(&db, &prices, "z-ai/glm-5.3", HarnessSlug::Kilo, &on_fill)
        .await
        .unwrap()
        .expect("the fill prices the launch");
    assert_eq!(
        fills.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "the fill reports the catalog change once"
    );
    assert_eq!(resolved.uncached_input, Some(0.0000014));
    assert_eq!(resolved.cached_input, Some(0.00000026));
    assert_eq!(resolved.output, Some(0.0000044));

    let stored = db.get_model_config("glm-5-3").await.unwrap().unwrap();
    assert_eq!(stored.config.list_price_input, Some(0.0000014));
    assert_eq!(stored.config.list_price_cached_input, Some(0.00000026));
    assert_eq!(stored.config.list_price_output, Some(0.0000044));
    assert_eq!(
        stored.config.list_price_as_of.as_deref(),
        Some(today().as_str())
    );
    assert_eq!(
        stored.config.list_price_source.as_deref(),
        Some(LIST_PRICE_SOURCE_OPENROUTER)
    );

    // Filled once: the next launch is priced from the catalog and reaches nothing.
    let again = list_price_for_launch(
        &db,
        &unreachable_prices(),
        "z-ai/glm-5.3:free",
        HarnessSlug::Kilo,
        &on_fill,
    )
    .await
    .unwrap()
    .expect("a filled entry prices the next launch from the catalog");
    assert_eq!(
        fills.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "a catalog read is not a fill"
    );
    assert_eq!(again, resolved);
}

/// A provider-native launch id fills through the entry's configured OpenRouter slug, so a
/// Claude Code run of a freshly seeded Opus entry is priced rather than refused.
#[tokio::test]
async fn the_fill_looks_a_native_id_up_by_the_entrys_openrouter_slug() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("anthropic/claude-opus-4.8".to_string()),
        ..crate::db::tests::model_write(
            "claude-opus-4-8",
            "Claude Opus 4.8",
            &["claude-opus-4-8", "anthropic/claude-opus-4.8"],
        )
    })
    .await
    .unwrap();
    let endpoints = serde_json::json!({
        "data": {
            "name": "Anthropic: Claude Opus 4.8",
            "endpoints": [{
                "provider_name": "Anthropic",
                "pricing": {
                    "prompt": "0.000005",
                    "completion": "0.000025",
                    "input_cache_read": "0.0000005",
                },
            }],
        },
    });
    let prices =
        fake_openrouter_with_endpoints(catalog_of("anthropic/claude-opus-4.8"), endpoints).await;

    let resolved =
        list_price_for_launch(&db, &prices, "claude-opus-4-8", HarnessSlug::Claude, &|| {})
            .await
            .unwrap()
            .expect("the native id fills through the slug");
    assert_eq!(resolved.uncached_input, Some(0.000005));
    assert_eq!(resolved.cached_input, Some(0.0000005));
    assert_eq!(resolved.output, Some(0.000025));
    let stored = db
        .get_model_config("claude-opus-4-8")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.config.list_price_output, Some(0.000025));
}

/// The fill follows a hand-set developer provider, although another provider is listed
/// first, and takes the prompt rate for cached input when the route lists no cache-read
/// rate.
#[tokio::test]
async fn the_fill_follows_a_hand_set_pin() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("qwen/qwen3-coder".to_string()),
        provider_pin: Some("Alibaba".to_string()),
        ..crate::db::tests::model_write("qwen3-coder", "Qwen3 Coder", &["qwen/qwen3-coder"])
    })
    .await
    .unwrap();
    let endpoints = serde_json::json!({
        "data": {
            "name": "Qwen: Qwen3 Coder",
            "endpoints": [
                {
                    "provider_name": "Cheapo",
                    "pricing": { "prompt": "0.000001", "completion": "0.000002" },
                },
                {
                    "provider_name": "Alibaba",
                    "pricing": { "prompt": "0.000005", "completion": "0.00001" },
                },
            ],
        },
    });
    let prices = fake_openrouter_with_endpoints(catalog_of("qwen/qwen3-coder"), endpoints).await;

    let resolved =
        list_price_for_launch(&db, &prices, "qwen/qwen3-coder", HarnessSlug::Kilo, &|| {})
            .await
            .unwrap()
            .expect("the pinned route prices the launch");
    assert_eq!(resolved.uncached_input, Some(0.000005));
    assert_eq!(resolved.cached_input, Some(0.000005));
    assert_eq!(resolved.output, Some(0.00001));
}

/// A model whose developer lists no endpoint, with no provider set by hand, fills from
/// the model's own price in the models listing. No third party's endpoint is read: the
/// rate filled is none of theirs, the first listed one's included.
#[tokio::test]
async fn the_fill_takes_the_models_listing_price_for_a_model_with_no_developer_endpoint() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("newco/brand-new".to_string()),
        ..crate::db::tests::model_write("brand-new", "Brand New", &["newco/brand-new"])
    })
    .await
    .unwrap();
    let prices = fake_openrouter_with_endpoints(
        catalog_of("newco/brand-new"),
        endpoints_with_official_route(),
    )
    .await;

    let resolved =
        list_price_for_launch(&db, &prices, "newco/brand-new", HarnessSlug::Kilo, &|| {})
            .await
            .unwrap()
            .expect("the models listing prices the launch");
    assert_eq!(resolved.uncached_input, Some(0.000003));
    assert_eq!(resolved.cached_input, Some(0.0000003));
    assert_eq!(resolved.output, Some(0.000015));
    let stored = db.get_model_config("brand-new").await.unwrap().unwrap();
    assert_eq!(stored.config.list_price_input, Some(0.000003));
    assert_eq!(stored.config.list_price_cached_input, Some(0.0000003));
    assert_eq!(stored.config.list_price_output, Some(0.000015));
    assert_eq!(
        stored.config.list_price_source.as_deref(),
        Some(LIST_PRICE_SOURCE_OPENROUTER)
    );
}

/// A model that needs the models listing's price is refused when that listing cannot be
/// read, with the failure named, and is left unpriced: no endpoint's rate stands in.
#[tokio::test]
async fn the_fill_is_refused_when_the_models_listing_it_needs_cannot_be_read() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("newco/brand-new".to_string()),
        ..crate::db::tests::model_write("brand-new", "Brand New", &["newco/brand-new"])
    })
    .await
    .unwrap();
    // A models listing that is not one: the read of it fails.
    let prices = fake_openrouter_with_endpoints(
        serde_json::json!("unavailable"),
        endpoints_with_official_route(),
    )
    .await;

    let reason = list_price_for_launch(&db, &prices, "newco/brand-new", HarnessSlug::Kilo, &|| {})
        .await
        .unwrap()
        .expect_err("an unreadable models listing refuses the launch");
    assert!(reason.contains("models listing"), "{reason}");
    let stored = db.get_model_config("brand-new").await.unwrap().unwrap();
    assert_eq!(stored.config.list_price_input, None);
}

/// A hand-set provider that lists no endpoint for the model does not stop the fill: it
/// falls to the provider the model id's author segment names.
#[tokio::test]
async fn the_fill_falls_to_the_author_segment_when_the_hand_set_provider_lists_nothing() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("z-ai/glm-5.3".to_string()),
        provider_pin: Some("Nobody".to_string()),
        ..crate::db::tests::model_write("glm-5-3", "GLM 5.3", &["z-ai/glm-5.3"])
    })
    .await
    .unwrap();
    let prices =
        fake_openrouter_with_endpoints(catalog_of("z-ai/glm-5.3"), endpoints_with_official_route())
            .await;

    let resolved = list_price_for_launch(&db, &prices, "z-ai/glm-5.3", HarnessSlug::Kilo, &|| {})
        .await
        .unwrap()
        .expect("the author segment's provider prices the launch");
    assert_eq!(resolved.uncached_input, Some(0.0000014));
    assert_eq!(resolved.cached_input, Some(0.00000026));
    assert_eq!(resolved.output, Some(0.0000044));
}

/// When OpenRouter cannot be reached the launch is refused, naming the model, the missing
/// list price and why the fill failed, and the entry is left unpriced rather than half
/// written.
#[tokio::test]
async fn a_launch_is_refused_when_the_fill_cannot_reach_openrouter() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("z-ai/glm-5.3".to_string()),
        ..crate::db::tests::model_write("glm-5-3", "GLM 5.3", &["z-ai/glm-5.3"])
    })
    .await
    .unwrap();

    let fills = std::sync::atomic::AtomicUsize::new(0);
    let reason = list_price_for_launch(
        &db,
        &unreachable_prices(),
        "z-ai/glm-5.3",
        HarnessSlug::Kilo,
        &|| {
            fills.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        },
    )
    .await
    .unwrap()
    .expect_err("an unreachable OpenRouter refuses the launch");
    assert_eq!(
        fills.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "a failed fill reports no catalog change"
    );
    assert!(reason.contains("`z-ai/glm-5.3`"), "{reason}");
    assert!(reason.contains("GLM 5.3"), "{reason}");
    assert!(reason.contains("no list price"), "{reason}");
    assert!(
        reason.contains("none could be filled from OpenRouter"),
        "{reason}"
    );
    assert!(reason.contains("Models section"), "{reason}");

    let stored = db.get_model_config("glm-5-3").await.unwrap().unwrap();
    assert_eq!(stored.config.list_price_input, None);
    assert_eq!(stored.config.list_price_source, None);
}

/// A model the catalog has no entry for is refused outright: there is no entry to fill,
/// so OpenRouter is never asked.
#[tokio::test]
async fn an_uncurated_model_is_refused_without_reaching_openrouter() {
    let db = Db::connect_in_memory().await.unwrap();

    let reason = list_price_for_launch(
        &db,
        &unreachable_prices(),
        "unlisted/model",
        HarnessSlug::Kilo,
        &|| {},
    )
    .await
    .unwrap()
    .expect_err("an uncurated model refuses the launch");
    assert!(reason.contains("`unlisted/model`"), "{reason}");
    assert!(reason.contains("not in the model catalog"), "{reason}");
}

/// A curated entry that already carries a list price is priced from it and reaches
/// nothing: the fill is for the entry that has none.
#[tokio::test]
async fn a_priced_entry_is_read_from_the_catalog_without_reaching_openrouter() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(crate::db::tests::priced_model_write(
        "deepseek-v4",
        "DeepSeek V4",
        &["deepseek/deepseek-v4"],
    ))
    .await
    .unwrap();

    let fills = std::sync::atomic::AtomicUsize::new(0);
    let resolved = list_price_for_launch(
        &db,
        &unreachable_prices(),
        "deepseek/deepseek-v4",
        HarnessSlug::Kilo,
        &|| {
            fills.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        },
    )
    .await
    .unwrap()
    .expect("a priced entry resolves");
    assert_eq!(fills.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert_eq!(resolved.uncached_input, Some(3e-6));
    assert_eq!(resolved.output, Some(15e-6));
}
