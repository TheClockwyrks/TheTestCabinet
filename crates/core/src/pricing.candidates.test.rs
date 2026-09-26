use super::*;

const TOOLS: &[&str] = &["tools", "tool_choice"];
const TOOLS_AND_REASONING: &[&str] = &["tools", "tool_choice", "reasoning"];

/// An endpoint priced per million tokens, which reads more easily than per-token figures.
fn offer(
    provider: &str,
    level: &str,
    input: f64,
    output: f64,
    cache_read: Option<f64>,
) -> EndpointOffer {
    EndpointOffer {
        provider: provider.to_string(),
        quantization: level.to_string(),
        input: Some(input / 1e6),
        output: Some(output / 1e6),
        cache_read: cache_read.map(|price| price / 1e6),
        supported_parameters: TOOLS_AND_REASONING.iter().map(|p| p.to_string()).collect(),
    }
}

fn names(list: &CandidateList) -> Vec<&str> {
    list.candidates
        .iter()
        .map(|c| c.provider.as_str())
        .collect()
}

fn no_faults() -> BTreeMap<String, f64> {
    BTreeMap::new()
}

/// The developer comes first; a provider above its rates, one below the native level and one
/// with no cache-read price are left out; the rest follow by price.
#[test]
fn the_list_keeps_native_priced_caching_endpoints_developer_first() {
    let offers = vec![
        offer("Azure", "fp8", 2.5, 10.0, Some(0.25)),
        offer("Baidu", "fp8", 0.9, 3.6, Some(0.09)),
        offer("OpenAI", "fp8", 1.0, 4.0, Some(0.1)),
        offer("Together", "fp4", 0.4, 1.6, Some(0.04)),
        offer("DeepInfra", "fp8", 0.8, 3.2, None),
        offer("Novita", "fp8", 0.7, 2.8, Some(0.07)),
    ];
    let list = provider_candidates(
        Some("OpenAI"),
        &offers,
        &CandidatePolicy::default(),
        TOOLS,
        &no_faults(),
    )
    .expect("three endpoints pass");
    assert_eq!(list.native_quantization, "fp8");
    assert_eq!(names(&list), ["OpenAI", "Novita", "Baidu"]);
    assert!(list.candidates[0].developer);
    assert_eq!(
        list.candidates[1].to_invocation(),
        crate::gg::GgProviderCandidate::new("Novita", "fp8")
    );
}

/// A provider's recorded fault rate orders it behind a cleaner one however cheap it is, but never
/// ahead of the developer.
#[test]
fn fault_rate_orders_before_price() {
    let offers = vec![
        offer("Z.AI", "fp8", 1.0, 4.0, Some(0.1)),
        offer("Novita", "fp8", 0.5, 2.0, Some(0.05)),
        offer("Baidu", "fp8", 0.9, 3.0, Some(0.09)),
    ];
    let faults = BTreeMap::from([(provider_key("Novita"), 0.3), (provider_key("Z.AI"), 0.9)]);
    let list = provider_candidates(
        Some("z-ai"),
        &offers,
        &CandidatePolicy::default(),
        TOOLS,
        &faults,
    )
    .expect("all pass");
    assert_eq!(names(&list), ["Z.AI", "Baidu", "Novita"]);
    assert_eq!(list.candidates[2].fault_rate, Some(0.3));
    assert_eq!(list.candidates[1].fault_rate, None);
}

/// A hand-set native level wins, an `unknown` endpoint is kept only when the entry names its
/// provider, and a banned provider is left out however cheap it is. A developer endpoint that
/// fails the level filter still sets the price ceiling.
#[test]
fn the_catalog_entry_sets_the_level_the_unknown_allowance_and_the_ban_list() {
    let offers = vec![
        offer("DeepSeek", "unknown", 0.15, 0.6, Some(0.003)),
        offer("Fireworks", "unknown", 0.1, 0.4, Some(0.01)),
        offer("DeepInfra", "fp8", 0.14, 0.5, Some(0.004)),
        offer("Together", "fp8", 0.05, 0.2, Some(0.005)),
        offer("Venice", "fp8", 0.375, 0.9, Some(0.0075)),
        offer("Relace", "fp4", 0.1, 0.4, Some(0.01)),
    ];
    let policy = CandidatePolicy {
        native_quantization: Some("FP8".to_string()),
        banned: vec!["together".to_string()],
        unknown_quantization: vec!["deepseek".to_string()],
        ..CandidatePolicy::default()
    };
    let list = provider_candidates(Some("DeepSeek"), &offers, &policy, TOOLS, &no_faults())
        .expect("the developer and one other pass");
    assert_eq!(names(&list), ["DeepSeek", "DeepInfra"]);
    assert_eq!(list.candidates[0].quantization, "unknown");
}

/// With no developer endpoint listed, the catalog ceiling bounds the prices; with neither, the
/// model has no candidate, and the refusal says so.
#[test]
fn a_model_without_a_developer_endpoint_takes_the_catalog_ceiling() {
    let offers = vec![
        offer("Novita", "bf16", 1.0, 4.0, Some(0.1)),
        offer("Parasail", "fp16", 0.4, 1.6, Some(0.04)),
    ];
    let refused = provider_candidates(
        None,
        &offers,
        &CandidatePolicy::default(),
        TOOLS,
        &no_faults(),
    )
    .expect_err("no ceiling at all");
    assert_eq!(refused, CandidateRefusal::NoPriceCeiling);

    let policy = CandidatePolicy {
        max_input: Some(0.5 / 1e6),
        max_output: Some(2.0 / 1e6),
        ..CandidatePolicy::default()
    };
    let list = provider_candidates(None, &offers, &policy, TOOLS, &no_faults())
        .expect("the cheaper one passes");
    // `bf16` and `fp16` are one width, so both are at the native level.
    assert_eq!(names(&list), ["Parasail"]);
    assert_eq!(list.candidates[0].quantization, "fp16");
}

/// A provider listing several passing endpoints is one candidate at its cheapest.
#[test]
fn a_provider_with_several_endpoints_is_one_candidate() {
    let offers = vec![
        offer("OpenAI", "fp8", 1.0, 4.0, Some(0.1)),
        offer("BaseTen", "fp8", 0.9, 3.0, Some(0.09)),
        offer("BaseTen", "fp8", 0.8, 3.0, Some(0.08)),
    ];
    let list = provider_candidates(
        Some("OpenAI"),
        &offers,
        &CandidatePolicy::default(),
        TOOLS,
        &no_faults(),
    )
    .expect("both pass");
    assert_eq!(names(&list), ["OpenAI", "BaseTen"]);
    assert_eq!(list.candidates[1].input, 0.8 / 1e6);
}

/// Each filter that empties the list is the one the refusal names.
#[test]
fn a_refusal_names_the_filter_that_emptied_the_list() {
    let policy = CandidatePolicy::default();
    let refuse =
        |offers: Vec<EndpointOffer>, parameters: &[&'static str], policy: &CandidatePolicy| {
            provider_candidates(Some("OpenAI"), &offers, policy, parameters, &no_faults())
                .expect_err("nothing passes")
        };

    assert_eq!(
        refuse(vec![], TOOLS, &policy),
        CandidateRefusal::NoEndpoints
    );
    assert_eq!(
        refuse(
            vec![offer("OpenAI", "unknown", 1.0, 4.0, Some(0.1))],
            TOOLS,
            &policy
        ),
        CandidateRefusal::NoNativeLevel
    );
    assert_eq!(
        refuse(
            vec![
                offer("OpenAI", "fp8", 1.0, 4.0, Some(0.1)),
                offer("Azure", "bf16", 2.0, 8.0, Some(0.2)),
            ],
            TOOLS,
            &policy
        ),
        CandidateRefusal::NoneWithinCeiling
    );
    assert_eq!(
        refuse(vec![offer("OpenAI", "fp8", 1.0, 4.0, None)], TOOLS, &policy),
        CandidateRefusal::NoneCaching
    );
    let mut no_reasoning = offer("OpenAI", "fp8", 1.0, 4.0, Some(0.1));
    no_reasoning.supported_parameters = TOOLS.iter().map(|p| p.to_string()).collect();
    assert_eq!(
        refuse(vec![no_reasoning], TOOLS_AND_REASONING, &policy),
        CandidateRefusal::NoneSupporting {
            parameters: TOOLS_AND_REASONING.to_vec()
        }
    );
    let banned = CandidatePolicy {
        banned: vec!["OpenAI".to_string()],
        ..CandidatePolicy::default()
    };
    assert_eq!(
        refuse(
            vec![offer("OpenAI", "fp8", 1.0, 4.0, Some(0.1))],
            TOOLS,
            &banned
        ),
        CandidateRefusal::AllBanned
    );
    let bf16 = CandidatePolicy {
        native_quantization: Some("bf16".to_string()),
        ..CandidatePolicy::default()
    };
    assert_eq!(
        refuse(
            vec![offer("OpenAI", "fp8", 1.0, 4.0, Some(0.1))],
            TOOLS,
            &bf16
        ),
        CandidateRefusal::NoneAtNativeLevel {
            native: "bf16".to_string()
        }
    );
}

/// A run sends `reasoning` only when an agent sets a reasoning setting; tools always.
#[test]
fn run_parameters_add_reasoning_only_when_set() {
    assert_eq!(run_parameters(false), TOOLS);
    assert_eq!(run_parameters(true), TOOLS_AND_REASONING);
}
