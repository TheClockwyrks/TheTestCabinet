use super::*;
use test_cabinet_entities::model;

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
            provider_slug: None,
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

fn price(
    id: i32,
    model_id: &str,
    observed_at: &str,
    input: f64,
    output: f64,
) -> model_price::Model {
    model_price::Model {
        id,
        model_id: model_id.to_string(),
        observed_at: observed_at.to_string(),
        uncached_input: Some(input),
        cached_input: None,
        output: Some(output),
        context_length: Some(200_000),
        released_at: Some("2026-01-01T00:00:00Z".to_string()),
        input_modalities: Some("text,image".to_string()),
        provider_slug: None,
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
    let prices = vec![price(
        1,
        "anthropic/claude-opus-4.8",
        "2026-01-02T00:00:00Z",
        5.0,
        15.0,
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
    assert_eq!(opus.price.as_ref().unwrap().output, Some(15.0));
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
    assert!(derived.price.is_none());
    // A derived entry's alias family comes from the harness that reported it (an
    // OpenCode run here → the OpenRouter family).
    assert_eq!(derived.aliases.len(), 1);
    assert_eq!(derived.aliases[0].harness_family, HarnessFamily::Openrouter);
}

#[test]
fn price_history_dedups_consecutive_equal() {
    let prices = vec![
        price(1, "x/y", "2026-01-01T00:00:00Z", 1.0, 2.0),
        price(2, "x/y", "2026-01-02T00:00:00Z", 1.0, 2.0), // unchanged
        price(3, "x/y", "2026-01-03T00:00:00Z", 1.5, 2.0), // changed
    ];
    let run_models = vec![("x/y".to_string(), "goose".to_string())];
    let catalog = compose_catalog(&[], &prices, &run_models);
    let entry = &catalog[0];
    assert_eq!(entry.price_history.len(), 2, "consecutive equal collapsed");
    assert_eq!(entry.price_history[0].observed_at, "2026-01-01T00:00:00Z");
    assert_eq!(entry.price_history[1].observed_at, "2026-01-03T00:00:00Z");
    assert_eq!(entry.price.as_ref().unwrap().uncached_input, Some(1.5));
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

/// A price observation for `model_id` carrying `context_length`.
fn window_observation(model_id: &str, context_length: i64) -> crate::db::PriceWrite {
    crate::db::PriceWrite {
        model_id: model_id.to_string(),
        observed_at: "2026-01-01T00:00:00Z".to_string(),
        uncached_input: Some(1.0),
        cached_input: None,
        output: Some(2.0),
        context_length: Some(context_length),
        released_at: None,
        input_modalities: None,
        provider_slug: None,
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
        provider_slug: None,
        aliases: vec![AliasEntry {
            alias: "claude-opus-4-8".to_string(),
            family: HarnessFamily::Claude,
        }],
        now: "2026-01-01T00:00:00Z".to_string(),
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
