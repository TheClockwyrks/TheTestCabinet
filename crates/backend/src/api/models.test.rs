use super::*;
use test_cabinet_entities::model;

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
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        },
        aliases: aliases.iter().map(|a| a.to_string()).collect(),
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

    let derived = catalog
        .iter()
        .find(|m| m.slug == "deepseek/deepseek-v4")
        .expect("derived model present");
    assert!(!derived.curated);
    assert_eq!(derived.name, "deepseek/deepseek-v4");
    assert_eq!(derived.provider, "deepseek");
    assert!(derived.price.is_none());
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
    let got = normalize_aliases(&[
        "  openrouter/anthropic/claude-opus-4.8  ".to_string(),
        "anthropic/claude-opus-4.8".to_string(),
        "".to_string(),
        "claude-opus-4-8".to_string(),
    ]);
    assert_eq!(got, vec!["anthropic/claude-opus-4.8", "claude-opus-4-8"]);
}
