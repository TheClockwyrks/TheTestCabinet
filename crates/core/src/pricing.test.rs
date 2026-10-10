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

/// The candidate filter reads each endpoint's provider, level, three prices and parameters off
/// the wire; a missing level reads as `unknown`, a missing cache-read price as none, and an
/// unnamed endpoint is dropped.
#[test]
fn endpoint_offers_read_the_listing_as_the_candidate_filter_needs_it() {
    let offers = offers_of(&endpoints(serde_json::json!({
        "data": {
            "name": "Z.AI: GLM 5.3",
            "endpoints": [
                {
                    "provider_name": "Z.AI",
                    "quantization": "FP8",
                    "pricing": {
                        "prompt": "0.0000006",
                        "completion": "0.0000022",
                        "input_cache_read": "0.00000011",
                    },
                    "supported_parameters": ["tools", "tool_choice", "reasoning"],
                },
                {
                    "provider_name": "Baidu",
                    "pricing": { "prompt": "0.0000005", "completion": "0.000002" },
                },
                { "quantization": "fp8" },
            ],
        },
    })));

    assert_eq!(offers.len(), 2);
    assert_eq!(offers[0].provider, "Z.AI");
    assert_eq!(offers[0].quantization, "fp8");
    assert_eq!(offers[0].input, Some(0.0000006));
    assert_eq!(offers[0].output, Some(0.0000022));
    assert_eq!(offers[0].cache_read, Some(0.00000011));
    assert_eq!(
        offers[0].supported_parameters,
        ["tools", "tool_choice", "reasoning"]
    );
    assert_eq!(offers[1].provider, "Baidu");
    assert_eq!(offers[1].quantization, QUANTIZATION_UNKNOWN);
    assert_eq!(offers[1].cache_read, None);
    assert!(offers[1].supported_parameters.is_empty());
}

/// The launch facts of an endpoints payload listing `routes`, as `model_launch_facts`
/// derives them. A bare `ModelEndpoints` can only be built through deserialization,
/// which is also what makes the test exercise the wire shape.
fn facts_with_routes(model_id: &str, routes: serde_json::Value) -> ModelLaunchFacts {
    launch_facts_of(
        model_id,
        endpoints(serde_json::json!({
            "data": { "name": "Provider: Model", "endpoints": routes },
        })),
    )
}

/// One endpoint as the live listing writes it, carrying the route `tag` and nothing the
/// Flex rule does not read.
fn tagged(tag: Option<&str>) -> ModelEndpoint {
    let mut endpoint = serde_json::json!({ "provider_name": "OpenAI" });
    if let Some(tag) = tag {
        endpoint["tag"] = serde_json::json!(tag);
    }
    serde_json::from_value(endpoint).expect("the fixture is a well-formed endpoint")
}

/// A Flex endpoint is one whose tag has a `flex` segment, wherever the segment sits and
/// however it is cased. A tag that merely contains the letters, another service tier, and
/// an endpoint with no tag are all standard.
#[test]
fn a_flex_endpoint_is_one_whose_tag_has_a_flex_segment() {
    for tag in [
        "openai/flex",
        "google-ai-studio/flex",
        "google-vertex/global/flex",
        "openai/FLEX",
        "OpenAI/Flex",
        "flex",
    ] {
        assert!(tagged(Some(tag)).is_flex(), "`{tag}` is a Flex endpoint");
    }
    for tag in [
        "openai",
        "google-vertex/global",
        "flexible-co/standard",
        "flexible-co",
        "openai/flexible",
        "novita/reflex",
        "openai/priority",
        "groq/fast",
        "",
    ] {
        assert!(
            !tagged(Some(tag)).is_flex(),
            "`{tag}` is a standard endpoint"
        );
    }
    assert!(!tagged(None).is_flex());
    let null_tag: ModelEndpoint =
        serde_json::from_value(serde_json::json!({ "provider_name": "OpenAI", "tag": null }))
            .expect("a null tag deserializes");
    assert!(!null_tag.is_flex());
}

/// The developer's routes of a model OpenAI serves at two tiers, as the live listing
/// orders them: the Flex endpoint first at half price, then the standard one, both under
/// the one `provider_name`.
fn flex_listed_first() -> serde_json::Value {
    serde_json::json!([
        {
            "name": "OpenAI | openai/gpt-5.6-sol",
            "provider_name": "OpenAI",
            "tag": "openai/flex",
            "context_length": 400_000,
            "quantization": "unknown",
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
            "quantization": "unknown",
            "pricing": {
                "prompt": "0.00000125",
                "completion": "0.00001",
                "input_cache_read": "0.000000125",
            },
            "supported_parameters": ["tools", "tool_choice", "reasoning"],
        },
        {
            "name": "Azure | openai/gpt-5.6-sol",
            "provider_name": "Azure",
            "tag": "azure",
            "context_length": 400_000,
            "quantization": "unknown",
            "pricing": {
                "prompt": "0.00000125",
                "completion": "0.00001",
                "input_cache_read": "0.000000125",
            },
            "supported_parameters": ["tools", "tool_choice", "reasoning"],
        },
    ])
}

/// The candidate filter is handed the standard endpoints only: a Flex endpoint is not an
/// offer, so it cannot be a candidate or the developer's ceiling.
#[test]
fn endpoint_offers_leave_out_flex_endpoints() {
    let offers = offers_of(&endpoints(serde_json::json!({
        "data": { "name": "OpenAI: GPT-5.6 Sol", "endpoints": flex_listed_first() },
    })));

    assert_eq!(
        offers
            .iter()
            .map(|offer| offer.provider.as_str())
            .collect::<Vec<_>>(),
        ["OpenAI", "Azure"]
    );
    assert_eq!(offers[0].input, Some(0.000_001_25));
    assert_eq!(offers[0].output, Some(0.000_01));
    assert_eq!(offers[0].cache_read, Some(0.000_000_125));

    let list = provider_candidates(
        Some("OpenAI"),
        &offers,
        &CandidatePolicy {
            quantization_filter: false,
            ..CandidatePolicy::default()
        },
        &run_parameters(true),
        &std::collections::BTreeMap::new(),
    )
    .expect("the standard endpoints pass");
    // The ceiling is the standard rate, so Azure at that rate is kept beside the developer.
    assert_eq!(list.candidates.len(), 2);
    assert_eq!(list.candidates[0].provider, "OpenAI");
    assert_eq!(list.candidates[0].input, 0.000_001_25);
    assert_eq!(list.candidates[1].provider, "Azure");
}

/// A model served through Flex endpoints alone has no offer, and the candidate list
/// refuses it as one the listing names no endpoint for.
#[test]
fn a_model_listing_only_flex_endpoints_has_no_offer() {
    let offers = offers_of(&endpoints(serde_json::json!({
        "data": {
            "name": "OpenAI: GPT-5.6 Sol",
            "endpoints": [
                {
                    "provider_name": "OpenAI",
                    "tag": "openai/flex",
                    "pricing": {
                        "prompt": "0.000000625",
                        "completion": "0.000005",
                        "input_cache_read": "0.0000000625",
                    },
                    "supported_parameters": ["tools", "tool_choice"],
                },
            ],
        },
    })));

    assert!(offers.is_empty());
    assert_eq!(
        provider_candidates(
            Some("OpenAI"),
            &offers,
            &CandidatePolicy::default(),
            &run_parameters(false),
            &std::collections::BTreeMap::new(),
        ),
        Err(CandidateRefusal::NoEndpoints)
    );
}

/// Serve one canned `/models/{id}/endpoints` response from a loopback HTTP server, so
/// the async lookups can be exercised against the real fetch path. Its models listing
/// has no entries.
async fn spawn_endpoints_stub(body: serde_json::Value) -> StubServer {
    spawn_openrouter_stub(body, Some(serde_json::json!({ "data": [] }))).await
}

/// Serve `endpoints` for every `/models/{id}/endpoints` path and `listing` for the
/// models listing itself, counting the reads of the listing. A `listing` of `None` is a
/// models listing that cannot be read: it answers `500` with no JSON.
async fn spawn_openrouter_stub(
    endpoints: serde_json::Value,
    listing: Option<serde_json::Value>,
) -> StubServer {
    use std::sync::atomic::Ordering;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let listing_reads = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = listing_reads.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let endpoints = endpoints.to_string();
            let listing = listing.as_ref().map(|listing| listing.to_string());
            let counter = counter.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buffer = [0u8; 4096];
                let read = socket.read(&mut buffer).await.unwrap_or(0);
                let head = String::from_utf8_lossy(&buffer[..read]);
                let path = head.split_whitespace().nth(1).unwrap_or("");
                let (status, body) = if path.ends_with("/endpoints") {
                    ("200 OK", endpoints)
                } else {
                    counter.fetch_add(1, Ordering::SeqCst);
                    match listing {
                        Some(listing) => ("200 OK", listing),
                        None => ("500 Internal Server Error", "unavailable".to_string()),
                    }
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    });
    StubServer { url, listing_reads }
}

/// A running loopback stub; dropping it stops nothing, but the process is the test.
struct StubServer {
    url: String,
    /// How many times the models listing was read.
    listing_reads: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl StubServer {
    fn url(&self) -> &str {
        &self.url
    }

    fn listing_reads(&self) -> usize {
        self.listing_reads.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// A models-listing price as [`ModelsListingPrices`] hands it to the flow.
fn listing_price(prompt: &str, completion: &str, cache_read: Option<&str>) -> TokenPrices {
    token_prices_of(&Pricing {
        prompt: prompt.to_string(),
        completion: completion.to_string(),
        input_cache_read: cache_read.map(str::to_string),
    })
}

/// The complete rate of a per-token triple, for the assertions below.
fn rate(uncached_input: f64, cached_input: f64, output: f64) -> ListRate {
    ListRate {
        uncached_input,
        cached_input,
        output,
    }
}

/// A model three providers serve: its developer, the provider a catalog entry may name
/// by hand, and one listed ahead of both.
fn three_providers() -> serde_json::Value {
    serde_json::json!([
        {
            "provider_name": "Novita",
            "pricing": { "prompt": "0.000001", "completion": "0.000002" },
        },
        {
            "provider_name": "Azure",
            "pricing": { "prompt": "0.00001", "completion": "0.00004" },
        },
        {
            "provider_name": "OpenAI",
            "pricing": {
                "prompt": "0.000002",
                "completion": "0.000008",
                "input_cache_read": "0.0000002",
            },
        },
    ])
}

/// The first step: a provider set by hand is the one priced, ahead of the developer's
/// own endpoint and of the endpoint listed first.
#[test]
fn the_list_price_is_the_hand_set_providers_standard_rate() {
    let facts = facts_with_routes("openai/gpt-5.6-sol", three_providers());

    assert_eq!(
        facts.list_price(Some("azure"), None),
        Some(ListPriceResolution {
            rate: rate(0.000_01, 0.000_01, 0.000_04),
            step: ListPriceStep::HandSetProvider,
            provider: Some("Azure".to_string()),
        })
    );
}

/// The second step: with no provider set by hand, the provider the model id's author
/// segment names is priced, although another is listed first and cheaper.
#[test]
fn the_list_price_is_the_author_segments_providers_rate_when_none_is_set() {
    let facts = facts_with_routes("openai/gpt-5.6-sol", three_providers());

    // A models-listing price is not read while an earlier step answers.
    for listed in [None, Some(listing_price("0.5", "0.5", None))] {
        assert_eq!(
            facts.list_price(None, listed),
            Some(ListPriceResolution {
                rate: rate(0.000_002, 0.000_000_2, 0.000_008),
                step: ListPriceStep::AuthorProvider,
                provider: Some("OpenAI".to_string()),
            })
        );
    }
}

/// A hand-set provider that lists no endpoint for the model does not end the flow: the
/// author segment's provider answers. A blank one is no provider at all.
#[test]
fn a_hand_set_provider_with_no_route_falls_to_the_author_segment() {
    let facts = facts_with_routes("openai/gpt-5.6-sol", three_providers());

    for pin in ["Together", "", "  "] {
        let resolved = facts
            .list_price(Some(pin), None)
            .expect("the developer's endpoint is priced");
        assert_eq!(resolved.step, ListPriceStep::AuthorProvider, "pin `{pin}`");
        assert_eq!(resolved.provider.as_deref(), Some("OpenAI"));
        assert_eq!(resolved.rate, rate(0.000_002, 0.000_000_2, 0.000_008));
    }
}

/// A model only third parties serve: neither a hand-set provider nor the model id's
/// author segment names any of them.
fn third_parties_only() -> ModelLaunchFacts {
    facts_with_routes(
        "moonshotai/kimi-k2",
        serde_json::json!([
            { "provider_name": "Unpriced" },
            {
                "provider_name": "Novita",
                "pricing": { "prompt": "0.000001", "completion": "0.000002" },
            },
            {
                "provider_name": "Together",
                "pricing": { "prompt": "0.000003", "completion": "0.000004" },
            },
        ]),
    )
}

/// The third step: a model neither a hand-set provider nor its developer serves takes
/// the model's own price in the models listing, which names no provider.
#[test]
fn the_list_price_falls_to_the_models_listing_price() {
    let facts = third_parties_only();
    let listed = listing_price("0.0000006", "0.0000025", Some("0.00000015"));

    assert_eq!(facts.provider_pin, None);
    for pin in [None, Some("Fireworks")] {
        assert_eq!(facts.provider_list_price(pin), None);
        assert_eq!(
            facts.list_price(pin, Some(listed)),
            Some(ListPriceResolution {
                rate: rate(0.000_000_6, 0.000_000_15, 0.000_002_5),
                step: ListPriceStep::ListingPrice,
                provider: None,
            })
        );
    }
}

/// The third step is the models listing's price and never an endpoint's: the rate
/// resolved differs from every endpoint the model lists, the first one included, and
/// with no models-listing price there is no list price although endpoints are priced.
#[test]
fn the_third_step_does_not_take_the_first_listed_endpoint() {
    let facts = third_parties_only();
    let listed = listing_price("0.000007", "0.000009", None);

    let resolved = facts
        .list_price(None, Some(listed))
        .expect("the models listing prices the model");
    assert_eq!(resolved.step, ListPriceStep::ListingPrice);
    assert_eq!(resolved.rate, rate(0.000_007, 0.000_007, 0.000_009));
    assert_eq!(facts.route_rates.len(), 2);
    assert!(
        facts
            .route_rates
            .iter()
            .all(|(_, held)| *held != resolved.rate)
    );

    for pin in [None, Some("Fireworks")] {
        assert_eq!(facts.list_price(pin, None), None);
    }
}

/// A models-listing price missing a rate is no list price: an unparseable or negative
/// input or output rate leaves the model unpriced, since only a cached-input rate has a
/// fallback.
#[test]
fn an_incomplete_models_listing_price_is_no_list_price() {
    let facts = third_parties_only();

    for incomplete in [
        listing_price("", "0.000002", None),
        listing_price("-1", "-1", None),
        listing_price("0.000001", "", Some("0.0000001")),
        listing_price("0.000001", "not-a-price", None),
        listing_price("0.000001", "0.000002", Some("-1")),
    ] {
        assert_eq!(facts.list_price(None, Some(incomplete)), None);
    }
    // A free model's listing price is complete: every class is a real zero.
    assert_eq!(
        facts
            .list_price(None, Some(listing_price("0", "0", None)))
            .map(|found| found.rate),
        Some(rate(0.0, 0.0, 0.0))
    );
}

/// A hand-set provider names the developer where the listing spells it differently from
/// the model id (`qwen/…` served by `Alibaba`), and is matched whatever its spelling.
#[test]
fn a_hand_set_provider_is_matched_as_one_provider_spelling_matches_another() {
    let facts = facts_with_routes(
        "z-ai/glm-5.3",
        serde_json::json!([
            {
                "provider_name": "Novita",
                "pricing": { "prompt": "0.000001", "completion": "0.000002" },
            },
            {
                "provider_name": "Z.AI",
                "pricing": { "prompt": "0.000003", "completion": "0.000006" },
            },
        ]),
    );

    let by_hand = facts
        .list_price(Some("z-ai"), None)
        .expect("Z.AI is priced");
    assert_eq!(by_hand.step, ListPriceStep::HandSetProvider);
    assert_eq!(by_hand.provider.as_deref(), Some("Z.AI"));
    // The author segment `z-ai` names the same provider with no hand-set one.
    let by_author = facts.list_price(None, None).expect("Z.AI is priced");
    assert_eq!(by_author.step, ListPriceStep::AuthorProvider);
    assert_eq!(by_author.rate, rate(0.000_003, 0.000_003, 0.000_006));
}

/// The rate read is a provider's standard endpoint's, although the listing shows the same
/// provider's Flex endpoint first and cheaper, and no Flex rate is kept under any name.
#[test]
fn the_list_price_skips_a_flex_endpoint_listed_first() {
    let facts = facts_with_routes("openai/gpt-5.6-sol", flex_listed_first());

    assert_eq!(facts.provider_pin.as_deref(), Some("OpenAI"));
    let standard = rate(0.000_001_25, 0.000_000_125, 0.000_01);
    assert_eq!(
        facts.list_price(None, None).map(|found| found.rate),
        Some(standard)
    );
    assert_eq!(
        facts
            .list_price(Some("openai"), None)
            .map(|found| found.rate),
        Some(standard)
    );
    assert_eq!(facts.route_rates.len(), 2);
    assert!(facts.route_rates.iter().all(|(_, held)| *held == standard));
}

/// A Flex endpoint is skipped for a provider whose tag carries a region ahead of the tier.
#[test]
fn a_hand_set_provider_skips_a_flex_endpoint() {
    let facts = facts_with_routes(
        "google/gemini-3.5-pro",
        serde_json::json!([
            {
                "provider_name": "Google",
                "tag": "google-vertex/global/flex",
                "pricing": { "prompt": "0.000001", "completion": "0.000006" },
            },
            {
                "provider_name": "Google",
                "tag": "google-vertex/global",
                "pricing": { "prompt": "0.000002", "completion": "0.000012" },
            },
        ]),
    );

    let resolved = facts
        .list_price(Some("google"), None)
        .expect("Google is priced");
    assert_eq!(resolved.step, ListPriceStep::HandSetProvider);
    assert_eq!(resolved.rate, rate(0.000_002, 0.000_002, 0.000_012));
}

/// A provider that lists only Flex endpoints yields nothing at its step: named by hand
/// or by the author segment its Flex rate is not read, and the flow falls through to
/// the models listing's price. Another provider's standard endpoint is not read either.
#[test]
fn a_provider_listing_only_flex_endpoints_yields_nothing_and_falls_through() {
    let facts = facts_with_routes(
        "openai/gpt-5.6-sol",
        serde_json::json!([
            {
                "provider_name": "OpenAI",
                "tag": "openai/flex",
                "pricing": { "prompt": "0.000000625", "completion": "0.000005" },
            },
            {
                "provider_name": "Azure",
                "tag": "azure",
                "pricing": { "prompt": "0.00000125", "completion": "0.00001" },
            },
        ]),
    );
    let listed = listing_price("0.000002", "0.000016", None);

    assert_eq!(facts.provider_pin.as_deref(), Some("OpenAI"));
    for pin in [None, Some("openai")] {
        assert_eq!(facts.provider_list_price(pin), None);
        assert_eq!(facts.list_price(pin, None), None);
        assert_eq!(
            facts.list_price(pin, Some(listed)),
            Some(ListPriceResolution {
                rate: rate(0.000_002, 0.000_002, 0.000_016),
                step: ListPriceStep::ListingPrice,
                provider: None,
            })
        );
    }
    // A hand-set provider that lists only Flex endpoints falls to the author segment's
    // standard endpoint before it falls to the models listing.
    let hand_set_flex_only = facts_with_routes(
        "openai/gpt-5.6-sol",
        serde_json::json!([
            {
                "provider_name": "Azure",
                "tag": "azure/flex",
                "pricing": { "prompt": "0.0000005", "completion": "0.000004" },
            },
            {
                "provider_name": "OpenAI",
                "tag": "openai",
                "pricing": { "prompt": "0.00000125", "completion": "0.00001" },
            },
        ]),
    );
    let resolved = hand_set_flex_only
        .list_price(Some("Azure"), Some(listed))
        .expect("the developer's standard endpoint is priced");
    assert_eq!(resolved.step, ListPriceStep::AuthorProvider);
    assert_eq!(resolved.rate, rate(0.000_001_25, 0.000_001_25, 0.000_01));
}

/// Nothing resolvable: a model with no endpoints, one whose only endpoints are Flex, and
/// one whose endpoints publish no complete rate each have no list price from OpenRouter
/// when the models listing prices none either.
#[test]
fn a_model_with_no_complete_rate_has_no_list_price() {
    let none = facts_with_routes("openai/gpt-5.6-sol", serde_json::json!([]));
    let flex_only = facts_with_routes(
        "openai/gpt-5.6-sol",
        serde_json::json!([
            {
                "provider_name": "OpenAI",
                "tag": "openai/flex",
                "pricing": { "prompt": "0.000000625", "completion": "0.000005" },
            },
        ]),
    );
    let incomplete = facts_with_routes(
        "openai/gpt-5.6-sol",
        serde_json::json!([
            { "provider_name": "OpenAI" },
            {
                "provider_name": "Azure",
                "pricing": { "prompt": "-1", "completion": "not-a-price", "input_cache_read": "0" },
            },
        ]),
    );

    for facts in [none, flex_only, incomplete] {
        assert_eq!(facts.list_price(None, None), None);
        assert_eq!(facts.list_price(Some("openai"), None), None);
        assert!(facts.route_rates.is_empty());
    }
}

/// An endpoint missing one of the three rates is not a list price, so the provider's next
/// standard endpoint is the one read, and failing that the flow moves a step on.
#[test]
fn an_incomplete_rate_is_passed_over_for_the_next_complete_one() {
    let facts = facts_with_routes(
        "openai/gpt-5.6-sol",
        serde_json::json!([
            {
                "provider_name": "OpenAI",
                "pricing": { "prompt": "0.000002", "completion": "not-a-price" },
            },
            {
                "provider_name": "OpenAI",
                "pricing": { "prompt": "0.000002", "completion": "0.000008" },
            },
        ]),
    );
    assert_eq!(
        facts.list_price(None, None),
        Some(ListPriceResolution {
            rate: rate(0.000_002, 0.000_002, 0.000_008),
            step: ListPriceStep::AuthorProvider,
            provider: Some("OpenAI".to_string()),
        })
    );

    let developer_unpriced = facts_with_routes(
        "openai/gpt-5.6-sol",
        serde_json::json!([
            { "provider_name": "OpenAI", "pricing": { "prompt": "0.000002" } },
            {
                "provider_name": "Azure",
                "pricing": { "prompt": "0.00001", "completion": "0.00004" },
            },
        ]),
    );
    // Azure's complete rate is a third party's endpoint and is not read.
    assert_eq!(developer_unpriced.list_price(None, None), None);
    let resolved = developer_unpriced
        .list_price(None, Some(listing_price("0.000002", "0.000008", None)))
        .expect("the models listing prices the model");
    assert_eq!(resolved.step, ListPriceStep::ListingPrice);
    assert_eq!(resolved.provider, None);
}

/// A cached-input rate the endpoint omits falls back to its input rate, and an explicit
/// free one is a real zero rather than a missing rate.
#[test]
fn the_cached_input_rate_falls_back_to_the_input_rate() {
    let omitted = facts_with_routes(
        "anthropic/claude-sonnet-4.5",
        serde_json::json!([
            {
                "provider_name": "Anthropic",
                "pricing": { "prompt": "0.000003", "completion": "0.000015" },
            },
        ]),
    );
    assert_eq!(
        omitted.list_price(None, None).map(|found| found.rate),
        Some(rate(0.000_003, 0.000_003, 0.000_015))
    );

    let free = facts_with_routes(
        "anthropic/claude-sonnet-4.5",
        serde_json::json!([
            {
                "provider_name": "Anthropic",
                "pricing": {
                    "prompt": "0.000003",
                    "completion": "0.000015",
                    "input_cache_read": "0",
                },
            },
        ]),
    );
    assert_eq!(
        free.list_price(None, None).map(|found| found.rate),
        Some(rate(0.000_003, 0.0, 0.000_015))
    );
}

/// The lookup reads the model's endpoints listing through the real fetch path and resolves
/// by the same flow, the hand-set provider first. The models listing is not read while
/// the endpoints listing answers.
#[tokio::test]
async fn list_price_resolves_from_the_endpoints_payload() {
    let server = spawn_openrouter_stub(
        serde_json::json!({
            "data": { "name": "OpenAI: GPT-5.6 Sol", "endpoints": three_providers() },
        }),
        Some(serde_json::json!({
            "data": [{
                "id": "openai/gpt-5.6-sol",
                "pricing": { "prompt": "0.5", "completion": "0.5" },
            }],
        })),
    )
    .await;
    let prices = OpenRouterPrices::with_endpoint(server.url());

    let by_author = prices
        .list_price("openai/gpt-5.6-sol", None)
        .await
        .expect("the model is listed")
        .expect("the developer's endpoint is priced");
    assert_eq!(by_author.step, ListPriceStep::AuthorProvider);
    assert_eq!(by_author.rate, rate(0.000_002, 0.000_000_2, 0.000_008));

    let by_hand = prices
        .list_price("openai/gpt-5.6-sol", Some("Azure"))
        .await
        .expect("the model is listed")
        .expect("Azure is priced");
    assert_eq!(by_hand.step, ListPriceStep::HandSetProvider);
    assert_eq!(by_hand.rate, rate(0.000_01, 0.000_01, 0.000_04));
    assert_eq!(server.listing_reads(), 0);
}

/// A models listing with entries for the stub: the model the endpoints stub serves
/// under `id`, beside another model the lookup must not read.
fn models_listing(id: &str, pricing: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "data": [
            {
                "id": "other/model",
                "pricing": { "prompt": "0.9", "completion": "0.9" },
            },
            { "id": id, "context_length": 262_144, "pricing": pricing },
        ],
    })
}

/// Through the real fetch path, a model only third parties serve is priced at its own
/// entry's `pricing` in the models listing, which is read once for it, and not at any
/// endpoint's rate.
#[tokio::test]
async fn list_price_takes_the_models_listing_price_at_the_last_step() {
    let server = spawn_openrouter_stub(
        serde_json::json!({
            "data": { "name": "MoonshotAI: Kimi K2", "endpoints": three_providers() },
        }),
        Some(models_listing(
            "moonshotai/kimi-k2",
            serde_json::json!({
                "prompt": "0.0000006",
                "completion": "0.0000025",
                "input_cache_read": "0.00000015",
            }),
        )),
    )
    .await;
    let prices = OpenRouterPrices::with_endpoint(server.url());

    for pin in [None, Some("Fireworks")] {
        assert_eq!(
            prices
                .list_price("moonshotai/kimi-k2", pin)
                .await
                .expect("both listings are read"),
            Some(ListPriceResolution {
                rate: rate(0.000_000_6, 0.000_000_15, 0.000_002_5),
                step: ListPriceStep::ListingPrice,
                provider: None,
            })
        );
    }
    assert_eq!(server.listing_reads(), 2);
    // A model the models listing has no entry for has no list price there.
    assert_eq!(
        prices
            .list_price("moonshotai/unlisted", None)
            .await
            .expect("both listings are read"),
        None
    );
}

/// A models-listing price missing a rate is no list price through the fetch path too,
/// and a cached-input rate the entry omits takes its input rate.
#[tokio::test]
async fn list_price_needs_a_complete_models_listing_price() {
    let endpoints = serde_json::json!({
        "data": { "name": "MoonshotAI: Kimi K2", "endpoints": [] },
    });
    let incomplete = spawn_openrouter_stub(
        endpoints.clone(),
        Some(models_listing(
            "moonshotai/kimi-k2",
            serde_json::json!({ "prompt": "0.0000006", "completion": "-1" }),
        )),
    )
    .await;
    assert_eq!(
        OpenRouterPrices::with_endpoint(incomplete.url())
            .list_price("moonshotai/kimi-k2", None)
            .await
            .expect("both listings are read"),
        None
    );

    let no_cache_rate = spawn_openrouter_stub(
        endpoints,
        Some(models_listing(
            "moonshotai/kimi-k2",
            serde_json::json!({ "prompt": "0.0000006", "completion": "0.0000025" }),
        )),
    )
    .await;
    assert_eq!(
        OpenRouterPrices::with_endpoint(no_cache_rate.url())
            .list_price("moonshotai/kimi-k2", None)
            .await
            .expect("both listings are read")
            .map(|found| found.rate),
        Some(rate(0.000_000_6, 0.000_000_6, 0.000_002_5))
    );
}

/// One shared read of the models listing serves every model that reaches the last step,
/// asked at once or in turn, and a model an earlier step answers never causes it.
#[tokio::test]
async fn a_shared_models_listing_is_read_at_most_once() {
    let server = spawn_openrouter_stub(
        serde_json::json!({
            "data": { "name": "Provider: Model", "endpoints": three_providers() },
        }),
        Some(models_listing(
            "moonshotai/kimi-k2",
            serde_json::json!({ "prompt": "0.0000006", "completion": "0.0000025" }),
        )),
    )
    .await;
    let prices = OpenRouterPrices::with_endpoint(server.url());
    let listing = ModelsListingPrices::new();

    let by_author = prices
        .list_price_sharing("openai/gpt-5.6-sol", None, &listing)
        .await
        .expect("the model is listed")
        .expect("the developer's endpoint is priced");
    assert_eq!(by_author.step, ListPriceStep::AuthorProvider);
    assert_eq!(server.listing_reads(), 0);

    let ask = || prices.list_price_sharing("moonshotai/kimi-k2", None, &listing);
    let together = tokio::join!(ask(), ask(), ask(), ask());
    for resolved in [together.0, together.1, together.2, together.3] {
        let resolved = resolved
            .expect("both listings are read")
            .expect("the models listing prices the model");
        assert_eq!(resolved.step, ListPriceStep::ListingPrice);
    }
    prices
        .list_price_sharing("moonshotai/kimi-k2", None, &listing)
        .await
        .expect("both listings are read");
    assert_eq!(server.listing_reads(), 1);
}

/// A models listing that cannot be read fails the models that needed it and no others,
/// and a shared read that failed is not tried again.
#[tokio::test]
async fn an_unreadable_models_listing_fails_only_the_last_step() {
    let server = spawn_openrouter_stub(
        serde_json::json!({
            "data": { "name": "Provider: Model", "endpoints": three_providers() },
        }),
        None,
    )
    .await;
    let prices = OpenRouterPrices::with_endpoint(server.url());
    let listing = ModelsListingPrices::new();

    for _ in 0..2 {
        assert!(matches!(
            prices
                .list_price_sharing("moonshotai/kimi-k2", None, &listing)
                .await,
            Err(Error::Validation(_))
        ));
    }
    assert_eq!(server.listing_reads(), 1);
    assert_eq!(
        prices
            .list_price_sharing("openai/gpt-5.6-sol", None, &listing)
            .await
            .expect("the endpoints listing answers alone")
            .map(|found| found.step),
        Some(ListPriceStep::AuthorProvider)
    );
    assert_eq!(server.listing_reads(), 1);
}

/// Through the real fetch path, a developer's Flex endpoint listed first is not the rate
/// read, and a model listing only Flex endpoints is listed but has no list price while
/// the models listing prices none for it.
#[tokio::test]
async fn list_price_ignores_flex_endpoints_in_the_endpoints_payload() {
    let server = spawn_endpoints_stub(serde_json::json!({
        "data": { "name": "OpenAI: GPT-5.6 Sol", "endpoints": flex_listed_first() },
    }))
    .await;
    assert_eq!(
        OpenRouterPrices::with_endpoint(server.url())
            .list_price("openai/gpt-5.6-sol", None)
            .await
            .expect("the model is listed")
            .map(|found| found.rate),
        Some(rate(0.000_001_25, 0.000_000_125, 0.000_01))
    );

    let flex_only = spawn_endpoints_stub(serde_json::json!({
        "data": {
            "name": "OpenAI: GPT-5.6 Sol",
            "endpoints": [
                {
                    "provider_name": "OpenAI",
                    "tag": "openai/flex",
                    "pricing": { "prompt": "0.000000625", "completion": "0.000005" },
                },
            ],
        },
    }))
    .await;
    let prices = OpenRouterPrices::with_endpoint(flex_only.url());
    assert_eq!(
        prices
            .list_price("openai/gpt-5.6-sol", None)
            .await
            .expect("the model is listed"),
        None
    );
    assert!(
        prices
            .endpoint_offers("openai/gpt-5.6-sol")
            .await
            .expect("the model is listed")
            .is_empty()
    );
}

/// A model OpenRouter does not list is an error rather than "no list price", so a caller
/// can tell a model it cannot read from one with no rate.
#[tokio::test]
async fn list_price_errs_for_a_listing_that_cannot_be_read() {
    let prices = OpenRouterPrices::with_endpoint("http://127.0.0.1:1");
    assert!(matches!(
        prices.list_price("openai/gpt-5.6-sol", None).await,
        Err(Error::Validation(_))
    ));
}

/// Accept every connection and never answer it, holding each socket open: an
/// OpenRouter whose connection stalled.
async fn spawn_stalled_stub() -> StubServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let mut held = Vec::new();
        loop {
            let Ok((socket, _)) = listener.accept().await else {
                return;
            };
            held.push(socket);
        }
    });
    StubServer {
        url,
        listing_reads: Default::default(),
    }
}

/// A read OpenRouter never answers fails once the read timeout has passed, for the
/// per-model listing, the whole catalog and the models listing's prices alike, so no
/// caller waits on a stalled connection for ever.
#[tokio::test]
async fn a_read_that_stalls_fails_at_the_read_timeout() {
    let stalled = spawn_stalled_stub().await;
    let prices =
        OpenRouterPrices::with_endpoint(stalled.url()).with_read_timeout(Duration::from_millis(50));

    assert!(matches!(
        prices.list_price("openai/gpt-5.6-sol", None).await,
        Err(Error::Validation(_))
    ));
    assert!(matches!(
        prices.model_launch_facts("openai/gpt-5.6-sol").await,
        Err(Error::Validation(_))
    ));
    assert!(matches!(
        prices.all_model_details().await,
        Err(Error::Validation(_))
    ));
    assert!(matches!(
        ModelsListingPrices::new()
            .price_of(&prices, "openai/gpt-5.6-sol")
            .await,
        Err(Error::Validation(_))
    ));
}

/// Reads are bounded by [`READ_TIMEOUT`] unless a test sets another bound.
#[test]
fn reads_are_bounded_by_the_read_timeout_by_default() {
    assert_eq!(OpenRouterPrices::new().read_timeout, READ_TIMEOUT);
    assert_eq!(
        OpenRouterPrices::with_endpoint("http://127.0.0.1:1").read_timeout,
        READ_TIMEOUT
    );
}
