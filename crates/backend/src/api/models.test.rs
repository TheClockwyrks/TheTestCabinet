use super::*;
use test_cabinet_entities::model;

/// An [`AppState`] with an in-memory store and no network reach, for driving
/// [`write_config`] directly. The `TempDir` is returned so the store outlives the
/// test. Its price source is an unconnectable loopback port, so a price lookup
/// fails fast instead of reaching OpenRouter's live catalog.
async fn test_state() -> (tempfile::TempDir, AppState) {
    test_state_with_prices(test_cabinet_core::OpenRouterPrices::with_endpoint(
        "http://127.0.0.1:0/models",
    ))
    .await
}

/// [`test_state`] with its OpenRouter price source pointed at `prices`, for a path that
/// must reach a (fake) listing.
async fn test_state_with_prices(
    prices: test_cabinet_core::OpenRouterPrices,
) -> (tempfile::TempDir, AppState) {
    // nextest runs each test in its own process, so this environment is this
    // test's alone (the same reasoning `api.test.rs`'s harness gives).
    let dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("TCAB_BACKEND_CHECKOUT", dir.path());
        std::env::set_var("TCAB_BACKEND_STORE", dir.path().join("store"));
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
        std::sync::Arc::new(test_cabinet_core::AccountsClient::new(
            config.auth_url.clone(),
        )),
        crate::publisher::PublisherTiming {
            coalesce: config.coalesce,
            snapshot_retention: config.snapshot_retention,
        },
    );
    let state = AppState {
        db,
        store,
        ready: crate::readiness::Readiness::new(true),
        publisher,
        auth: std::sync::Arc::new(test_cabinet_core::AccountsClient::new(
            config.auth_url.clone(),
        )),
        relay: crate::relay::Relay::new(),
        publish_relay: crate::publish_relay::PublishRelay::new(),
        config,
        http: reqwest::Client::new(),
        prices,
        gg_docs: crate::gg_docs::GgDocIndex::new(),
    };
    (dir, state)
}

/// A minimal valid config input: one OpenRouter-family alias, no list price.
fn input(slug: &str) -> ModelConfigInput {
    ModelConfigInput {
        slug: slug.to_string(),
        name: slug.to_string(),
        provider: "DeepSeek".to_string(),
        aliases: vec![AliasInput {
            slug: "deepseek/deepseek-v4".to_string(),
            harness_family: HarnessFamily::Openrouter,
        }],
        openrouter_slug: None,
        provider_pin: None,
        list_price_input_per_mtok: None,
        list_price_cached_input_per_mtok: None,
        list_price_output_per_mtok: None,
        list_price_as_of: None,
        quantization_filter: None,
        native_quantization: None,
        max_input_price: None,
        max_output_price: None,
        banned_providers: None,
        unknown_quantization_providers: None,
        description: None,
        logo_svg: None,
        provider_logo_url: None,
    }
}

/// A canonical id carries the OpenRouter family when it has a `provider/`
/// segment, and its native family otherwise — enough for these composition tests.
fn test_family(alias: &str) -> HarnessFamily {
    if alias.contains('/') {
        HarnessFamily::Openrouter
    } else if alias.starts_with("gpt") {
        HarnessFamily::Codex
    } else {
        HarnessFamily::Claude
    }
}

fn config(slug: &str, name: &str, provider: &str, aliases: &[&str]) -> StoredModel {
    StoredModel {
        config: model::Model {
            slug: slug.to_string(),
            display_name: name.to_string(),
            provider: provider.to_string(),
            provider_logo_url: None,
            provider_logo_svg: None,
            description_md: None,
            openrouter_slug: aliases.first().map(|a| a.to_string()),
            provider_pin: None,
            quantization_filter: true,
            native_quantization: None,
            max_input_price: None,
            max_output_price: None,
            banned_providers: None,
            unknown_quantization_providers: None,
            list_price_input: None,
            list_price_cached_input: None,
            list_price_output: None,
            list_price_as_of: None,
            list_price_source: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        },
        aliases: aliases
            .iter()
            .map(|a| AliasEntry {
                alias: a.to_string(),
                family: test_family(a),
            })
            .collect(),
    }
}

/// One stored observation of `model_id`'s catalog facts.
fn observation(
    id: i32,
    model_id: &str,
    observed_at: &str,
    context_length: i64,
) -> model_price::Model {
    model_price::Model {
        id,
        model_id: model_id.to_string(),
        observed_at: observed_at.to_string(),
        context_length: Some(context_length),
        released_at: Some("2026-01-01T00:00:00Z".to_string()),
        input_modalities: Some("text,image".to_string()),
        provider_pin: Some("Anthropic".to_string()),
    }
}

#[test]
fn curated_model_absorbs_its_runs_and_derived_models_appear() {
    let configs = vec![config(
        "claude-opus-4-8",
        "Claude Opus 4.8",
        "Anthropic",
        &["claude-opus-4-8", "anthropic/claude-opus-4.8"],
    )];
    let prices = vec![observation(
        1,
        "anthropic/claude-opus-4.8",
        "2026-01-02T00:00:00Z",
        200_000,
    )];
    // A Kilo run of the curated model (openrouter/ + :free), and an uncurated model.
    let run_models = vec![
        (
            "openrouter/anthropic/claude-opus-4.8:free".to_string(),
            "kilo".to_string(),
        ),
        ("deepseek/deepseek-v4".to_string(), "opencode".to_string()),
    ];

    let catalog = compose_catalog(&configs, &prices, &run_models);
    assert_eq!(catalog.len(), 2, "one curated + one derived");

    let opus = catalog
        .iter()
        .find(|m| m.slug == "claude-opus-4-8")
        .expect("curated model present");
    assert!(opus.curated);
    assert_eq!(opus.name, "Claude Opus 4.8");
    // The Kilo run's raw id is absorbed via the canonical alias.
    assert_eq!(
        opus.covered_model_ids,
        vec!["openrouter/anthropic/claude-opus-4.8:free"]
    );
    // The facts observed under an alias are the entry's.
    assert_eq!(opus.context_length, Some(200_000));
    assert_eq!(opus.released_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    assert_eq!(opus.input_modalities, ["text", "image"]);
    assert_eq!(opus.provider_pin.as_deref(), Some("Anthropic"));
    assert!(!opus.provider_pin_set_by_hand);
    assert_eq!(
        opus.openrouter_url.as_deref(),
        Some("https://openrouter.ai/claude-opus-4-8")
    );
    // Each alias carries the family it is usable with: the native Claude Code id
    // under the Claude family, the OpenRouter id under the OpenRouter family.
    let family_of = |slug: &str| {
        opus.aliases
            .iter()
            .find(|a| a.slug == slug)
            .map(|a| a.harness_family)
    };
    assert_eq!(family_of("claude-opus-4-8"), Some(HarnessFamily::Claude));
    assert_eq!(
        family_of("anthropic/claude-opus-4.8"),
        Some(HarnessFamily::Openrouter)
    );

    let derived = catalog
        .iter()
        .find(|m| m.slug == "deepseek/deepseek-v4")
        .expect("derived model present");
    assert!(!derived.curated);
    assert_eq!(derived.name, "deepseek/deepseek-v4");
    assert_eq!(derived.provider, "deepseek");
    assert_eq!(derived.context_length, None);
    assert!(derived.input_modalities.is_empty());
    // A derived entry's alias family comes from the harness that reported it (an
    // OpenCode run here → the OpenRouter family).
    assert_eq!(derived.aliases.len(), 1);
    assert_eq!(derived.aliases[0].harness_family, HarnessFamily::Openrouter);
}

#[test]
fn compose_carries_the_curated_list_price() {
    let mut priced = config(
        "claude-opus-4-8",
        "Claude Opus 4.8",
        "Anthropic",
        &["anthropic/claude-opus-4.8"],
    );
    priced.config.list_price_input = Some(5e-6);
    priced.config.list_price_cached_input = Some(5e-7);
    priced.config.list_price_output = Some(25e-6);
    priced.config.list_price_as_of = Some("2026-09-01".to_string());
    priced.config.list_price_source = Some("hand".to_string());
    let catalog = compose_catalog(&[priced], &[], &[]);
    let entry = &catalog[0];
    let list_price = entry.list_price.as_ref().expect("a fully priced model");
    assert_eq!(list_price.uncached_input, Some(5e-6));
    assert_eq!(list_price.cached_input, Some(5e-7));
    assert_eq!(list_price.output, Some(25e-6));
    assert_eq!(entry.list_price_as_of.as_deref(), Some("2026-09-01"));

    // All-or-nothing: a partial price set composes as no list price at all, and a
    // derived entry never carries one.
    let mut partial = config(
        "deepseek-v4",
        "DeepSeek V4",
        "DeepSeek",
        &["deepseek/deepseek-v4"],
    );
    partial.config.list_price_input = Some(1e-6);
    let run_models = vec![("x/y".to_string(), "goose".to_string())];
    let catalog = compose_catalog(&[partial], &[], &run_models);
    let partial = catalog
        .iter()
        .find(|m| m.slug == "deepseek-v4")
        .expect("curated model present");
    assert_eq!(partial.list_price, None);
    assert_eq!(partial.list_price_as_of, None);
    let derived = catalog
        .iter()
        .find(|m| m.slug == "x/y")
        .expect("derived model present");
    assert_eq!(derived.list_price, None);
}

/// An entry serves the facts of its newest observation, across every alias it claims,
/// and an observation carries no price onto the entry: the list price is the only one.
#[test]
fn an_entry_serves_the_facts_of_its_newest_observation() {
    let observations = vec![
        observation(1, "x/y", "2026-01-01T00:00:00Z", 200_000),
        observation(2, "x/y", "2026-01-02T00:00:00Z", 400_000),
        observation(3, "x/y", "2026-01-03T00:00:00Z", 1_000_000),
    ];
    let run_models = vec![("x/y".to_string(), "goose".to_string())];
    let catalog = compose_catalog(&[], &observations, &run_models);
    let entry = &catalog[0];
    assert_eq!(entry.context_length, Some(1_000_000));
    assert_eq!(entry.list_price, None);

    // A curated entry merges the histories of its aliases, newest first.
    let observations = vec![
        observation(1, "claude-opus-4-8", "2026-01-05T00:00:00Z", 1_000_000),
        observation(
            2,
            "anthropic/claude-opus-4.8",
            "2026-01-02T00:00:00Z",
            200_000,
        ),
    ];
    let curated = config(
        "claude-opus-4-8",
        "Claude Opus 4.8",
        "Anthropic",
        &["claude-opus-4-8", "anthropic/claude-opus-4.8"],
    );
    let catalog = compose_catalog(&[curated], &observations, &[]);
    assert_eq!(catalog[0].context_length, Some(1_000_000));
    let wire = serde_json::to_value(&catalog[0]).unwrap();
    assert!(wire.get("price").is_none(), "{wire}");
    assert!(wire.get("priceHistory").is_none(), "{wire}");
}

#[test]
fn guess_provider_reads_prefix() {
    assert_eq!(guess_provider("anthropic/claude-opus-4.8"), "anthropic");
    assert_eq!(guess_provider("gpt-5.5"), "");
}

#[test]
fn normalize_aliases_strips_prefix_and_dedups() {
    let input = |slug: &str, family: HarnessFamily| AliasInput {
        slug: slug.to_string(),
        harness_family: family,
    };
    let got = normalize_aliases(&[
        input(
            "  openrouter/anthropic/claude-opus-4.8  ",
            HarnessFamily::Openrouter,
        ),
        input("anthropic/claude-opus-4.8", HarnessFamily::Openrouter),
        input("", HarnessFamily::Openrouter),
        input("claude-opus-4-8", HarnessFamily::Claude),
    ]);
    assert_eq!(
        got,
        vec![
            AliasEntry {
                alias: "anthropic/claude-opus-4.8".to_string(),
                family: HarnessFamily::Openrouter,
            },
            AliasEntry {
                alias: "claude-opus-4-8".to_string(),
                family: HarnessFamily::Claude,
            },
        ]
    );
}

/// The form's OpenRouter fill-in normalizes its slug the way an alias write does,
/// so an id pasted straight out of a run — routing prefix, stray whitespace and
/// all — resolves against OpenRouter's catalog instead of 404ing.
#[test]
fn lookup_slug_trims_and_strips_the_routing_prefix() {
    assert_eq!(
        lookup_slug("  anthropic/claude-opus-4.8  "),
        Some("anthropic/claude-opus-4.8")
    );
    assert_eq!(
        lookup_slug("openrouter/anthropic/claude-opus-4.8"),
        Some("anthropic/claude-opus-4.8")
    );
}

/// A blank slug (or one that is nothing *but* a routing prefix) is no lookup at
/// all — the handler rejects it rather than asking OpenRouter about "".
#[test]
fn lookup_slug_rejects_an_empty_slug() {
    assert_eq!(lookup_slug(""), None);
    assert_eq!(lookup_slug("   "), None);
    assert_eq!(lookup_slug("openrouter/"), None);
}

// ---------------------------------------------------------------------------
// The context-window lookup (the single store gg is told its window from)
// ---------------------------------------------------------------------------

/// An observation of `model_id` carrying `context_length`.
fn window_observation(model_id: &str, context_length: i64) -> crate::db::PriceWrite {
    crate::db::PriceWrite {
        model_id: model_id.to_string(),
        observed_at: "2026-01-01T00:00:00Z".to_string(),
        context_length: Some(context_length),
        released_at: None,
        input_modalities: None,
        provider_pin: None,
    }
}

/// The window is the latest observation's `context_length`, keyed by the run's
/// canonical model id — the `openrouter/` routing prefix and a `:free`-style variant
/// tag collapse onto the same model, exactly as pricing does.
#[tokio::test]
async fn context_window_reads_the_latest_observation_by_canonical_id() {
    let db = crate::db::Db::connect_in_memory().await.unwrap();
    db.insert_price_observation(window_observation("anthropic/claude-opus-4.8", 200_000))
        .await
        .unwrap();
    // A later observation supersedes the earlier one.
    let mut newer = window_observation("anthropic/claude-opus-4.8", 400_000);
    newer.observed_at = "2026-02-01T00:00:00Z".to_string();
    db.insert_price_observation(newer).await.unwrap();

    for id in [
        "anthropic/claude-opus-4.8",
        "openrouter/anthropic/claude-opus-4.8",
        "anthropic/claude-opus-4.8:free",
    ] {
        assert_eq!(
            launch_facts_for(&db, id, HarnessSlug::Gg)
                .await
                .unwrap()
                .context_window,
            Some(400_000),
            "{id}"
        );
    }
}

/// A curated model's observations are stored under its configured OpenRouter slug, so
/// a run launched under one of its *aliases* still resolves the same window.
#[tokio::test]
async fn context_window_follows_a_curated_model_alias() {
    let db = crate::db::Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        slug: "opus".to_string(),
        display_name: "Opus".to_string(),
        provider: "anthropic".to_string(),
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
    db.insert_price_observation(window_observation("anthropic/claude-opus-4.8", 200_000))
        .await
        .unwrap();

    assert_eq!(
        launch_facts_for(&db, "claude-opus-4-8", HarnessSlug::Claude)
            .await
            .unwrap()
            .context_window,
        Some(200_000)
    );
}

/// A model the catalog has no observation for has no facts at all — the caller (and so
/// gg) treats that as "unknown" rather than guessing.
#[tokio::test]
async fn context_window_is_none_for_an_unknown_model() {
    let db = crate::db::Db::connect_in_memory().await.unwrap();
    let facts = launch_facts_for(&db, "mock/scripted-builder", HarnessSlug::Gg)
        .await
        .unwrap();
    assert_eq!(facts.context_window, None);
    // Empty modalities means *unobserved*, which gg reads as "try an image and recover
    // if refused" — not as "text only".
    assert!(facts.input_modalities.is_empty());
    assert!(!facts.accepts_images());
}

/// The input modalities ride along on the same observation as the window and come back
/// from the same lookup, so gg learns both from one catalog read.
#[tokio::test]
async fn launch_facts_carry_the_observed_input_modalities() {
    let db = crate::db::Db::connect_in_memory().await.unwrap();
    let mut observation = window_observation("anthropic/claude-opus-4.8", 200_000);
    observation.input_modalities = Some("text,image".to_string());
    db.insert_price_observation(observation).await.unwrap();

    let facts = launch_facts_for(&db, "anthropic/claude-opus-4.8", HarnessSlug::Gg)
        .await
        .unwrap();
    assert_eq!(facts.context_window, Some(200_000));
    assert_eq!(facts.input_modalities, vec!["text", "image"]);
    assert!(facts.accepts_images());
}

/// A model observed as text-only is reported as such — the fact that keeps gg from
/// putting a reference mockup in a prompt it would be refused for.
#[tokio::test]
async fn launch_facts_report_a_text_only_model() {
    let db = crate::db::Db::connect_in_memory().await.unwrap();
    let mut observation = window_observation("z-ai/glm-5.2", 1_048_576);
    observation.input_modalities = Some("text".to_string());
    db.insert_price_observation(observation).await.unwrap();

    let facts = launch_facts_for(&db, "z-ai/glm-5.2", HarnessSlug::Gg)
        .await
        .unwrap();
    assert_eq!(facts.input_modalities, vec!["text"]);
    assert!(!facts.accepts_images());
}

/// An observation recorded before the modality column existed reads back as unknown
/// rather than as text-only, so an old row can never wrongly deny a model an image.
#[tokio::test]
async fn a_pre_existing_observation_reads_as_unknown_modalities() {
    let db = crate::db::Db::connect_in_memory().await.unwrap();
    // `window_observation` leaves `input_modalities` unset, exactly as a row written
    // before this column did.
    db.insert_price_observation(window_observation("legacy/model", 128_000))
        .await
        .unwrap();

    let facts = launch_facts_for(&db, "legacy/model", HarnessSlug::Gg)
        .await
        .unwrap();
    assert_eq!(facts.context_window, Some(128_000));
    assert!(facts.input_modalities.is_empty());
}

// --- The list-price write validation -----------------------------------------

/// A full per-Mtok list-price set lands on the stored config as per-token
/// figures, with the operator's date and a `hand` source.
#[tokio::test]
async fn write_config_stores_a_full_list_price_per_token() {
    let (_dir, state) = test_state().await;
    let mut input = input("deepseek-v4");
    input.list_price_input_per_mtok = Some(2.0);
    input.list_price_cached_input_per_mtok = Some(0.2);
    input.list_price_output_per_mtok = Some(6.0);
    input.list_price_as_of = Some("  2026-10-01  ".to_string());

    let out = write_config(&state, "deepseek-v4".to_string(), input)
        .await
        .unwrap();
    let list_price = out.list_price.as_ref().expect("a full set composes");
    let per_token = 1e-6;
    assert!((list_price.uncached_input.unwrap() - 2.0 * per_token).abs() < f64::EPSILON * 8.0);
    assert!((list_price.cached_input.unwrap() - 0.2 * per_token).abs() < f64::EPSILON * 8.0);
    assert!((list_price.output.unwrap() - 6.0 * per_token).abs() < f64::EPSILON * 8.0);
    assert_eq!(out.list_price_as_of.as_deref(), Some("2026-10-01"));

    let stored = state
        .db
        .get_model_config("deepseek-v4")
        .await
        .unwrap()
        .unwrap();
    assert!((stored.config.list_price_input.unwrap() - 2.0 * per_token).abs() < f64::EPSILON * 8.0);
    assert_eq!(stored.config.list_price_source.as_deref(), Some("hand"));
}

/// An entry priced from OpenRouter on 2026-10-09, at rates whose per-Mtok form does
/// not survive the scaling exactly (0.121 per Mtok comes back as
/// 0.12099999999999998), and the write the form sends when it is opened on that entry
/// and saved: the stored figures as it shows them, and the stored date.
async fn openrouter_priced_entry(state: &AppState) -> ModelConfigInput {
    let _created = write_config(state, "deepseek-v4".to_string(), input("deepseek-v4"))
        .await
        .unwrap();
    state
        .db
        .set_list_price(crate::db::ListPriceWrite {
            slug: "deepseek-v4".to_string(),
            uncached_input: 0.000000121,
            cached_input: 0.000000026,
            output: 0.0000044,
            as_of: "2026-10-09".to_string(),
            source: "openrouter".to_string(),
            now: "2026-10-09T00:00:00Z".to_string(),
        })
        .await
        .unwrap();
    let mut resubmitted = input("deepseek-v4");
    resubmitted.list_price_input_per_mtok = Some(0.121);
    resubmitted.list_price_cached_input_per_mtok = Some(0.026);
    resubmitted.list_price_output_per_mtok = Some(4.4);
    resubmitted.list_price_as_of = Some("2026-10-09".to_string());
    resubmitted
}

/// The stored list price of `deepseek-v4`: its rates, date and source.
async fn stored_list_price(state: &AppState) -> ([Option<f64>; 3], Option<String>, Option<String>) {
    let config = state
        .db
        .get_model_config("deepseek-v4")
        .await
        .unwrap()
        .unwrap()
        .config;
    (
        [
            config.list_price_input,
            config.list_price_cached_input,
            config.list_price_output,
        ],
        config.list_price_as_of,
        config.list_price_source,
    )
}

/// Saving another field of an entry sends its list price back as the form showed it.
/// Nobody entered that set, so it stays exactly as stored: a price read from
/// OpenRouter is still sourced `openrouter`, with its date and its figures untouched.
#[tokio::test]
async fn write_config_keeps_the_source_of_a_list_price_sent_back_unchanged() {
    let (_dir, state) = test_state().await;
    let mut resubmitted = openrouter_priced_entry(&state).await;
    let before = stored_list_price(&state).await;
    resubmitted.provider_pin = Some("DeepSeek".to_string());
    resubmitted.name = "DeepSeek V4".to_string();

    let out = write_config(&state, "deepseek-v4".to_string(), resubmitted)
        .await
        .unwrap();

    assert_eq!(out.list_price_source.as_deref(), Some("openrouter"));
    assert_eq!(out.name, "DeepSeek V4");
    assert_eq!(stored_list_price(&state).await, before);
    assert_eq!(before.2.as_deref(), Some("openrouter"));
}

/// A save that changes a figure, or only the date, is a set the operator entered: it
/// is stored as sent and sourced `hand`.
#[tokio::test]
async fn write_config_marks_a_changed_list_price_as_entered_by_hand() {
    let (_dir, state) = test_state().await;
    let mut redated = openrouter_priced_entry(&state).await;
    redated.list_price_as_of = Some("2026-10-10".to_string());
    let out = write_config(&state, "deepseek-v4".to_string(), redated)
        .await
        .unwrap();
    assert_eq!(out.list_price_source.as_deref(), Some("hand"));
    assert_eq!(out.list_price_as_of.as_deref(), Some("2026-10-10"));

    // Back to a set read from OpenRouter, then one figure changed.
    let mut repriced = openrouter_priced_entry(&state).await;
    repriced.list_price_output_per_mtok = Some(4.5);
    let out = write_config(&state, "deepseek-v4".to_string(), repriced)
        .await
        .unwrap();
    assert_eq!(out.list_price_source.as_deref(), Some("hand"));
    let (rates, as_of, source) = stored_list_price(&state).await;
    assert!((rates[2].unwrap() - 4.5e-6).abs() < 1e-18);
    assert_eq!(as_of.as_deref(), Some("2026-10-09"));
    assert_eq!(source.as_deref(), Some("hand"));
}

/// A set entered by hand and sent back unchanged is still the operator's.
#[tokio::test]
async fn write_config_keeps_a_hand_entered_list_price_sent_back_unchanged() {
    let (_dir, state) = test_state().await;
    let entered = || {
        let mut entered = input("deepseek-v4");
        entered.list_price_input_per_mtok = Some(2.0);
        entered.list_price_cached_input_per_mtok = Some(0.2);
        entered.list_price_output_per_mtok = Some(6.0);
        entered.list_price_as_of = Some("2026-10-01".to_string());
        entered
    };
    let _created = write_config(&state, "deepseek-v4".to_string(), entered())
        .await
        .unwrap();
    let before = stored_list_price(&state).await;

    let _saved = write_config(&state, "deepseek-v4".to_string(), entered())
        .await
        .unwrap();

    assert_eq!(stored_list_price(&state).await, before);
    assert_eq!(before.2.as_deref(), Some("hand"));
}

/// A partial list-price set is a 422 naming the missing side of the
/// all-or-nothing rule.
#[tokio::test]
async fn write_config_refuses_a_partial_list_price() {
    let (_dir, state) = test_state().await;
    let mut partial = input("deepseek-v4");
    partial.list_price_input_per_mtok = Some(2.0);

    let err = write_config(&state, "deepseek-v4".to_string(), partial)
        .await
        .expect_err("a partial set refuses");
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("all-or-nothing"), "{}", err.message);
    assert!(
        state
            .db
            .get_model_config("deepseek-v4")
            .await
            .unwrap()
            .is_none()
    );
}

/// A negative (or non-finite) list price is a 422 naming the field.
#[tokio::test]
async fn write_config_refuses_a_negative_list_price() {
    let (_dir, state) = test_state().await;
    let mut negative = input("deepseek-v4");
    negative.list_price_input_per_mtok = Some(-1.0);
    negative.list_price_cached_input_per_mtok = Some(0.2);
    negative.list_price_output_per_mtok = Some(6.0);

    let err = write_config(&state, "deepseek-v4".to_string(), negative)
        .await
        .expect_err("a negative price refuses");
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        err.message.contains("listPriceInputPerMtok"),
        "{}",
        err.message
    );

    let mut nan = input("deepseek-v4");
    nan.list_price_input_per_mtok = Some(f64::NAN);
    nan.list_price_cached_input_per_mtok = Some(0.2);
    nan.list_price_output_per_mtok = Some(6.0);
    let err = write_config(&state, "deepseek-v4".to_string(), nan)
        .await
        .expect_err("a NaN price refuses");
    assert!(
        err.message.contains("listPriceInputPerMtok"),
        "{}",
        err.message
    );
}

/// A list price is dated: a full set with no date is a 422 naming the field.
#[tokio::test]
async fn write_config_refuses_an_undated_list_price() {
    let (_dir, state) = test_state().await;
    let mut undated = input("deepseek-v4");
    undated.list_price_input_per_mtok = Some(2.0);
    undated.list_price_cached_input_per_mtok = Some(0.2);
    undated.list_price_output_per_mtok = Some(6.0);

    let err = write_config(&state, "deepseek-v4".to_string(), undated)
        .await
        .expect_err("an undated list price refuses");
    assert_eq!(err.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(err.message.contains("listPriceAsOf"), "{}", err.message);
}

/// An update carrying no list-price fields at all preserves the stored set
/// (source included); one carrying a new full set replaces it.
#[tokio::test]
async fn write_config_preserves_the_stored_list_price_when_absent() {
    let (_dir, state) = test_state().await;
    let mut create = input("deepseek-v4");
    create.list_price_input_per_mtok = Some(2.0);
    create.list_price_cached_input_per_mtok = Some(0.2);
    create.list_price_output_per_mtok = Some(6.0);
    create.list_price_as_of = Some("2026-10-01".to_string());
    let _created = write_config(&state, "deepseek-v4".to_string(), create)
        .await
        .unwrap();

    // Absent on update: the stored set survives untouched.
    let update = input("deepseek-v4");
    let out = write_config(&state, "deepseek-v4".to_string(), update)
        .await
        .unwrap();
    let list_price = out.list_price.as_ref().expect("the stored set survives");
    assert!((list_price.uncached_input.unwrap() - 2e-6).abs() < 1e-18);
    let stored = state
        .db
        .get_model_config("deepseek-v4")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.config.list_price_source.as_deref(), Some("hand"));
    assert_eq!(
        stored.config.list_price_as_of.as_deref(),
        Some("2026-10-01")
    );

    // A create with no list-price fields stores none.
    let mut unpriced = input("unpriced");
    unpriced.aliases = vec![AliasInput {
        slug: "unpriced/model".to_string(),
        harness_family: HarnessFamily::Openrouter,
    }];
    let _created = write_config(&state, "unpriced".to_string(), unpriced)
        .await
        .unwrap();
    let stored = state
        .db
        .get_model_config("unpriced")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.config.list_price_input, None);
    assert_eq!(stored.config.list_price_source, None);
}

/// A launch pass refuses a harness member whose model carries no list price before the
/// scheduler spends buffer on it, and names the reason; a priced member stays
/// launchable.
#[tokio::test]
async fn a_harness_member_without_a_list_price_is_unlaunchable_before_the_launch_pass() {
    let (_dir, state) = test_state().await;
    state
        .db
        .upsert_model_config(crate::db::tests::priced_model_write(
            "opus",
            "Claude Opus 4.8",
            &["claude-opus-4-8"],
        ))
        .await
        .unwrap();
    let combo = |model: &str| super::super::coverage::ReviewPlanCombo {
        harness: HarnessSlug::Claude,
        model: model.to_string(),
        provider: None,
        gg_config_id: None,
        gg_slot_models: Default::default(),
        gg_config_name: None,
    };
    let library = super::super::coverage::GgLibrary::default();
    let mut members = vec![
        super::super::coverage::resolve_member(&combo("claude-opus-4-8"), &library),
        super::super::coverage::resolve_member(&combo("claude-unpriced-1"), &library),
    ];

    super::super::coverage::resolve_launch_facts(&state, &mut members).await;

    assert_eq!(members[0].unlaunchable, None);
    let reason = members[1]
        .unlaunchable
        .as_deref()
        .expect("an unpriced member is unlaunchable");
    assert!(reason.contains("`claude-unpriced-1`"), "{reason}");
}

/// Serve `endpoints` as every model's `/models/{id}/endpoints` body on a loopback port,
/// and return a price source pointed at it.
async fn endpoints_listing(endpoints: serde_json::Value) -> test_cabinet_core::OpenRouterPrices {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let body = serde_json::json!({ "data": { "name": "Some: Model", "endpoints": endpoints } });
    let app = axum::Router::new().fallback(move || {
        let body = body.clone();
        async move { axum::Json(body) }
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    test_cabinet_core::OpenRouterPrices::with_endpoint(format!("http://{addr}/models"))
}

/// A launch pass fills a harness member's missing list price from OpenRouter when it resolves
/// the member, so the member launches and its entry carries the filled price for the
/// per-cell stamp to read.
#[tokio::test]
async fn a_harness_members_missing_list_price_is_filled_before_the_launch_pass() {
    let prices = endpoints_listing(serde_json::json!([{
        "provider_name": "Anthropic",
        "pricing": {
            "prompt": "0.000005",
            "completion": "0.000025",
            "input_cache_read": "0.0000005",
        },
    }]))
    .await;
    let (_dir, state) = test_state_with_prices(prices).await;
    state
        .db
        .upsert_model_config(crate::db::ModelConfigWrite {
            openrouter_slug: Some("anthropic/claude-opus-4.8".to_string()),
            ..crate::db::tests::model_write(
                "claude-opus-4-8",
                "Claude Opus 4.8",
                &["claude-opus-4-8", "anthropic/claude-opus-4.8"],
            )
        })
        .await
        .unwrap();
    let combo = super::super::coverage::ReviewPlanCombo {
        harness: HarnessSlug::Claude,
        model: "claude-opus-4-8".to_string(),
        provider: None,
        gg_config_id: None,
        gg_slot_models: Default::default(),
        gg_config_name: None,
    };
    let library = super::super::coverage::GgLibrary::default();
    let mut members = vec![super::super::coverage::resolve_member(&combo, &library)];

    super::super::coverage::resolve_launch_facts(&state, &mut members).await;

    assert_eq!(members[0].unlaunchable, None);
    let stored = state
        .db
        .get_model_config("claude-opus-4-8")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.config.list_price_input, Some(0.000005));
    assert_eq!(stored.config.list_price_cached_input, Some(0.0000005));
    assert_eq!(stored.config.list_price_output, Some(0.000025));
    assert_eq!(
        stored.config.list_price_source.as_deref(),
        Some("openrouter")
    );
}
