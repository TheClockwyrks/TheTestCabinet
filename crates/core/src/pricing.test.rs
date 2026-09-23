use super::*;

/// Deserialize an OpenRouter `/models/{id}/endpoints` payload the way the real
/// fetch does, so these exercise the wire shape rather than a hand-built struct.
fn endpoints(body: serde_json::Value) -> ModelEndpoints {
    serde_json::from_value::<ModelEndpointsResponse>(body)
        .expect("the fixture is a well-formed endpoints response")
        .data
}

/// The common case: OpenRouter writes `Provider: Model`, and the form wants those
/// as two fields — the provider's presentational spelling (`Anthropic`, not the
/// slug's lowercase `anthropic`) and the bare model name.
#[test]
fn a_listing_splits_the_provider_off_the_display_name() {
    let listing = listing_of(
        "anthropic/claude-sonnet-4.5",
        endpoints(serde_json::json!({
            "data": {
                "name": "Anthropic: Claude Sonnet 4.5",
                "description": "A model for agents and coding workflows.",
                "endpoints": [],
            },
        })),
    );

    assert_eq!(listing.name, "Claude Sonnet 4.5");
    assert_eq!(listing.provider, "Anthropic");
    assert_eq!(
        listing.description.as_deref(),
        Some("A model for agents and coding workflows.")
    );
}

/// A name with no `Provider: ` prefix keeps the whole name, and the provider falls
/// back to the slug's author segment — a lowercase spelling the operator can fix
/// up, which still beats leaving the field blank.
#[test]
fn an_unprefixed_name_falls_back_to_the_slug_author() {
    let listing = listing_of(
        "newco/brand-new",
        endpoints(serde_json::json!({
            "data": { "name": "Brand New", "endpoints": [] },
        })),
    );

    assert_eq!(listing.name, "Brand New");
    assert_eq!(listing.provider, "newco");
}

/// A model with no `/` in its id has no author segment to fall back on, so the
/// provider is simply left empty rather than repeating the whole id as a provider.
#[test]
fn a_slug_without_an_author_segment_leaves_the_provider_empty() {
    let listing = listing_of(
        "brand-new",
        endpoints(serde_json::json!({
            "data": { "name": "Brand New", "endpoints": [] },
        })),
    );

    assert_eq!(listing.name, "Brand New");
    assert_eq!(listing.provider, "");
}

/// A model OpenRouter publishes no blurb for — or publishes a blank one for —
/// reports `None`, so the form leaves the description alone instead of writing
/// whitespace into the catalog.
#[test]
fn a_missing_or_blank_description_is_none() {
    let absent = listing_of(
        "newco/brand-new",
        endpoints(serde_json::json!({
            "data": { "name": "Newco: Brand New", "endpoints": [] },
        })),
    );
    assert_eq!(absent.description, None);

    let blank = listing_of(
        "newco/brand-new",
        endpoints(serde_json::json!({
            "data": { "name": "Newco: Brand New", "description": "   ", "endpoints": [] },
        })),
    );
    assert_eq!(blank.description, None);
}

/// The listing read and the launch-facts read share one response, so a payload
/// carrying both sets of fields yields both — the reason the form's fill-in costs
/// the cheap per-model fetch rather than the half-megabyte catalog listing.
#[test]
fn one_endpoints_payload_carries_both_the_listing_and_the_launch_facts() {
    let data = endpoints(serde_json::json!({
        "data": {
            "name": "Anthropic: Claude Sonnet 4.5",
            "description": "A model for agents and coding workflows.",
            "architecture": { "input_modalities": ["text", "image"] },
            "endpoints": [
                { "context_length": 200_000 },
                { "context_length": 1_000_000 },
            ],
        },
    }));

    // The launch facts as `model_launch_facts` derives them: the largest window any
    // route offers, and the model-level modalities.
    assert_eq!(
        data.endpoints
            .iter()
            .filter_map(|endpoint| endpoint.context_length)
            .max(),
        Some(1_000_000)
    );
    assert_eq!(modalities_of(data.architecture.as_ref()), ["text", "image"]);

    let listing = listing_of("anthropic/claude-sonnet-4.5", data);
    assert_eq!(listing.name, "Claude Sonnet 4.5");
    assert_eq!(listing.provider, "Anthropic");
}

/// One provider's spellings agree however OpenRouter wrote them: the listing's
/// `provider_name`, the model id's author segment, and the route tag.
#[test]
fn a_provider_agrees_with_every_spelling_of_itself() {
    assert!(same_provider("OpenAI", "openai"));
    assert!(same_provider("Z.AI", "z-ai"));
    assert!(same_provider("xAI", "x-ai"));
    assert!(same_provider("Moonshot AI", "moonshotai"));
    assert!(same_provider("Google AI Studio", "google-ai-studio"));
    assert!(!same_provider("Azure", "openai"));
    assert!(!same_provider("Google AI Studio", "Google"));
    assert!(!same_provider("", ""));
}

/// The official provider is the listed one that is the id's author, spelled as the listing
/// spells it; a model its developer does not serve has none.
#[test]
fn the_official_provider_is_the_one_named_for_the_models_author() {
    assert_eq!(
        official_provider("openai/gpt-5.6-sol", ["Azure", "OpenAI"]),
        Some("OpenAI".to_string())
    );
    assert_eq!(
        official_provider("z-ai/glm-4.6", ["Venice", "DeepInfra", " Z.AI "]),
        Some("Z.AI".to_string())
    );
    assert_eq!(
        official_provider("google/gemini-2.5-pro", ["Google AI Studio", "Google"]),
        Some("Google".to_string())
    );
    assert_eq!(official_provider("moonshotai/kimi-k2", ["Novita"]), None);
    assert_eq!(official_provider("qwen/qwen3-coder", ["Alibaba"]), None);
}

fn offer(
    provider: &str,
    quantization: &str,
    input: f64,
    output: f64,
    cache_read: Option<f64>,
    parameters: &[&str],
) -> EndpointOffer {
    EndpointOffer {
        provider: provider.to_string(),
        quantization: quantization.to_string(),
        input: Some(input),
        output: Some(output),
        cache_read,
        supported_parameters: parameters.iter().map(|parameter| parameter.to_string()).collect(),
    }
}

/// The developer endpoint comes first, an endpoint above its rates is left out, and one with no
/// cache-read price is left out. The rest follow by fault rate, then by price.
#[test]
fn the_candidate_list_keeps_native_priced_cacheable_endpoints() {
    let endpoints = vec![
        offer("Azure", "fp8", 2.5, 10.0, Some(0.25), &["tools", "tool_choice"]),
        offer("OpenAI", "fp8", 1.0, 4.0, Some(0.1), &["tools", "tool_choice", "reasoning"]),
        offer("Together", "fp4", 0.4, 1.6, Some(0.04), &["tools", "tool_choice"]),
        offer("DeepInfra", "fp8", 0.8, 3.2, None, &["tools", "tool_choice"]),
        offer("Fireworks", "fp8", 0.9, 3.6, Some(0.09), &["tools"]),
        offer("Novita", "fp8", 0.7, 2.8, Some(0.07), &["tools", "tool_choice"]),
    ];
    let mut faults = std::collections::BTreeMap::new();
    faults.insert(provider_key("Novita"), 0.4);
    let candidates = provider_candidates(
        "openai/gpt-5.6-sol",
        &endpoints,
        &CandidatePolicy::default(),
        RunRequirements { tools: true, reasoning: false },
        &faults,
    )
    .expect("two endpoints pass");
    let names: Vec<&str> = candidates.iter().map(|candidate| candidate.provider.as_str()).collect();
    assert_eq!(names, ["OpenAI", "Azure"]);
}

/// A hand-set native level wins, an `unknown` endpoint is kept only when the catalog names that
/// provider, and a banned provider is left out however cheap it is.
#[test]
fn the_catalog_entry_sets_the_level_and_the_ban_list() {
    let endpoints = vec![
        offer("DeepSeek", "fp8", 0.1, 0.4, Some(0.01), &[]),
        offer("Novita", "unknown", 0.1, 0.4, Some(0.01), &[]),
        offer("Together", "fp8", 0.05, 0.2, Some(0.005), &[]),
    ];
    let policy = CandidatePolicy {
        native_quantization: Some("fp8".to_string()),
        banned: vec!["Together".to_string()],
        allow_unknown: vec!["Novita".to_string()],
        ..CandidatePolicy::default()
    };
    let candidates = provider_candidates(
        "deepseek/deepseek-v4.1-flash",
        &endpoints,
        &policy,
        RunRequirements { tools: false, reasoning: false },
        &std::collections::BTreeMap::new(),
    )
    .expect("the developer and the named unknown both pass");
    let names: Vec<&str> = candidates.iter().map(|candidate| candidate.provider.as_str()).collect();
    assert_eq!(names, ["DeepSeek", "Novita"]);
}

/// A model whose developer endpoint is absent takes the catalog ceiling, and one with no
/// passing endpoint is refused with the reason.
#[test]
fn a_model_with_no_candidate_is_refused() {
    let endpoints = vec![offer("Novita", "fp4", 1.0, 4.0, Some(0.1), &[])];
    let err = provider_candidates(
        "deepseek/deepseek-v4.1-flash",
        &endpoints,
        &CandidatePolicy {
            max_input: Some(0.2),
            max_output: Some(0.8),
            ..CandidatePolicy::default()
        },
        RunRequirements { tools: false, reasoning: false },
        &std::collections::BTreeMap::new(),
    )
    .expect_err("above the ceiling");
    assert_eq!(err, CandidateRefusal::NonePassed);
}
