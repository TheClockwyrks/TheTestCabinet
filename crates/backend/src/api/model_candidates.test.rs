use super::*;

use test_cabinet_core::gg::GgProviderStat;
use test_cabinet_core::run_record::HarnessFamily;
use test_cabinet_entities::model;

/// An endpoint at `quantization`, priced per token, supporting tools and reasoning, with a
/// cache-read price.
fn offer(provider: &str, quantization: &str, input_mtok: f64, output_mtok: f64) -> EndpointOffer {
    EndpointOffer {
        provider: provider.to_string(),
        quantization: quantization.to_string(),
        input: Some(input_mtok / PER_MTOK),
        output: Some(output_mtok / PER_MTOK),
        cache_read: Some(input_mtok / 10.0 / PER_MTOK),
        supported_parameters: ["tools", "tool_choice", "reasoning"]
            .map(str::to_string)
            .to_vec(),
    }
}

/// A curated entry for `alias` with the given policy columns.
fn curated(alias: &str, configure: impl FnOnce(&mut model::Model)) -> StoredModel {
    let mut config = model::Model {
        slug: "curated".to_string(),
        display_name: "Curated".to_string(),
        provider: "Qwen".to_string(),
        provider_logo_url: None,
        provider_logo_svg: None,
        description_md: None,
        openrouter_slug: Some(alias.to_string()),
        provider_pin: None,
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
    };
    configure(&mut config);
    StoredModel {
        config,
        aliases: vec![crate::db::AliasEntry {
            alias: alias.to_string(),
            family: HarnessFamily::Openrouter,
        }],
    }
}

/// One recorded run of `model` with one provider slice.
fn run(model: &str, provider: &str, calls: u64, stalls: u64) -> Arc<GgRunFacts> {
    Arc::new(GgRunFacts {
        id: format!("{model}-{provider}"),
        model_id: model.to_string(),
        execution_mode: "tool_calling".to_string(),
        errors: Default::default(),
        tool_calls: 0,
        provider_stats: vec![GgProviderStat {
            provider: Some(provider.to_string()),
            model_id: Some(model.to_string()),
            calls,
            stalls,
            ..GgProviderStat::default()
        }],
        models: [model.to_string()].into_iter().collect(),
    })
}

/// The catalog entry's ceiling is stored per million tokens and read per token, its lists are
/// decoded, and its hand-set developer provider wins over the listing's.
#[test]
fn the_catalog_entry_becomes_the_policy() {
    let stored = curated("qwen/qwen3-coder", |config| {
        config.provider_pin = Some(" Alibaba ".to_string());
        config.native_quantization = Some("fp8".to_string());
        config.max_input_price = Some(2.0);
        config.max_output_price = Some(8.0);
        config.banned_providers = Some(r#"["Cheapo"]"#.to_string());
        config.unknown_quantization_providers = Some(r#"["Mystery", " "]"#.to_string());
    });
    let catalog = CatalogCandidates::of(Some(&stored), &["qwen/qwen3-coder"]);
    assert_eq!(catalog.developer.as_deref(), Some("Alibaba"));
    assert_eq!(catalog.policy.native_quantization.as_deref(), Some("fp8"));
    assert!((catalog.policy.max_input.unwrap() - 2e-6).abs() < 1e-15);
    assert!((catalog.policy.max_output.unwrap() - 8e-6).abs() < 1e-15);
    assert_eq!(catalog.policy.banned, vec!["Cheapo".to_string()]);
    assert_eq!(
        catalog.policy.unknown_quantization,
        vec!["Mystery".to_string()]
    );
    assert_eq!(catalog.recorded_ids, vec!["qwen/qwen3-coder".to_string()]);
}

/// An uncurated model takes the developer from the listing, puts it first, and orders the rest
/// by the fault rate its recorded runs give each provider before price.
#[test]
fn an_uncurated_model_puts_its_developer_first_then_orders_by_fault_rate() {
    let offers = vec![
        offer("Cheap", "fp8", 0.4, 1.6),
        offer("Z.AI", "fp8", 0.6, 2.2),
        offer("Steady", "fp8", 0.5, 2.0),
    ];
    let record = vec![run("z-ai/glm-5.3", "Cheap", 10, 5)];
    let catalog = CatalogCandidates::of(None, &["z-ai/glm-5.3"]);
    let list = catalog
        .build("z-ai/glm-5.3", &offers, false, &record)
        .expect("three providers pass");
    let order: Vec<&str> = list
        .candidates
        .iter()
        .map(|candidate| candidate.provider.as_str())
        .collect();
    assert_eq!(order, ["Z.AI", "Steady", "Cheap"]);
    assert!(list.candidates[0].developer);
    assert_eq!(list.candidates[2].fault_rate, Some(0.5));
    assert_eq!(list.candidates[1].fault_rate, None);
}

/// The read reports prices per million tokens, and a refusal with the native level it used.
#[test]
fn the_read_reports_per_mtok_prices_and_the_refusal() {
    let offers = vec![offer("Z.AI", "fp8", 0.6, 2.2)];
    let catalog = CatalogCandidates::of(None, &["z-ai/glm-5.3"]);
    let out = candidates_out(
        "z-ai/glm-5.3".to_string(),
        catalog.native_level(&offers),
        catalog.build("z-ai/glm-5.3", &offers, false, &[]),
    );
    assert_eq!(out.native_quantization.as_deref(), Some("fp8"));
    assert!(out.refusal.is_none());
    assert!((out.candidates[0].input_price - 0.6).abs() < 1e-9);
    assert!((out.candidates[0].output_price - 2.2).abs() < 1e-9);
    assert!((out.candidates[0].cache_read_price - 0.06).abs() < 1e-9);

    let banned = curated("z-ai/glm-5.3", |config| {
        config.banned_providers = Some(r#"["z-ai"]"#.to_string());
    });
    let catalog = CatalogCandidates::of(Some(&banned), &[]);
    let out = candidates_out(
        "z-ai/glm-5.3".to_string(),
        catalog.native_level(&offers),
        catalog.build("z-ai/glm-5.3", &offers, false, &[]),
    );
    assert!(out.candidates.is_empty());
    assert_eq!(out.native_quantization.as_deref(), Some("fp8"));
    assert_eq!(
        out.refusal.as_deref(),
        Some(CandidateRefusal::AllBanned.to_string().as_str())
    );
}
