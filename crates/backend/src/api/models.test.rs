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
