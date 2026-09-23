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

/// The official price is the developer's own route's pricing block, never another
/// provider's, however it is priced. The mapping is the listing block's, cache-read
/// fallback included.
#[test]
fn the_official_prices_are_the_developers_routes_prices() {
    let facts = facts_with_routes(
        "openai/gpt-5.6-sol",
        serde_json::json!([
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
        ]),
    );

    assert_eq!(
        facts.official_prices(None),
        Some(TokenPrices {
            uncached_input: Some(0.000_002),
            cached_input: Some(0.000_000_2),
            output: Some(0.000_008),
        })
    );
}

/// A hand-set pin names the official route where the listing spells the developer
/// differently from the model id (`qwen/…` served by `Alibaba`).
#[test]
fn a_hand_set_pin_selects_the_official_route() {
    let facts = facts_with_routes(
        "qwen/qwen3-coder",
        serde_json::json!([
            {
                "provider_name": "Novita",
                "pricing": { "prompt": "0.000001", "completion": "0.000002" },
            },
            {
                "provider_name": "Alibaba",
                "pricing": { "prompt": "0.000003", "completion": "0.000006" },
            },
        ]),
    );

    assert_eq!(facts.official_prices(None), None);
    assert_eq!(
        facts.official_prices(Some("alibaba")),
        Some(TokenPrices {
            uncached_input: Some(0.000_003),
            cached_input: Some(0.000_003),
            output: Some(0.000_006),
        })
    );
}

/// An official route whose pricing block omits the cache-read rate falls back to its
/// own prompt price, exactly as the listing's headline block does.
#[test]
fn an_official_route_without_a_cache_read_price_falls_back_to_its_prompt_price() {
    let facts = facts_with_routes(
        "anthropic/claude-sonnet-4.5",
        serde_json::json!([
            {
                "provider_name": "Anthropic",
                "pricing": { "prompt": "0.000003", "completion": "0.000015" },
            },
        ]),
    );

    assert_eq!(
        facts.official_prices(None),
        Some(TokenPrices {
            uncached_input: Some(0.000_003),
            cached_input: Some(0.000_003),
            output: Some(0.000_015),
        })
    );
}

/// A model its developer does not serve has no official rate, whatever the other
/// routes charge.
#[test]
fn a_model_the_developer_does_not_serve_has_no_official_price() {
    let facts = facts_with_routes(
        "moonshotai/kimi-k2",
        serde_json::json!([
            {
                "provider_name": "Novita",
                "pricing": { "prompt": "0.000001", "completion": "0.000002" },
            },
        ]),
    );

    assert_eq!(facts.official_prices(None), None);
}

/// A route that reports no pricing block yields no official price rather than an
/// invented one.
#[test]
fn an_official_route_without_a_pricing_block_yields_none() {
    let facts = facts_with_routes(
        "openai/gpt-5.6-sol",
        serde_json::json!([{ "provider_name": "OpenAI" }]),
    );

    assert_eq!(facts.provider_pin.as_deref(), Some("OpenAI"));
    assert_eq!(facts.official_prices(None), None);
}

/// An unparseable or negative price on the official route reads as unknown, exactly
/// as it does on the listing path, and a genuine `"0"` stays a real zero.
#[test]
fn an_unparseable_official_price_is_unknown_like_the_listings() {
    let facts = facts_with_routes(
        "openai/gpt-5.6-sol",
        serde_json::json!([
            {
                "provider_name": "OpenAI",
                "pricing": {
                    "prompt": "-1",
                    "completion": "not-a-price",
                    "input_cache_read": "0",
                },
            },
        ]),
    );

    assert_eq!(
        facts.official_prices(None),
        Some(TokenPrices {
            uncached_input: None,
            // An explicit free cache-read rate wins over the prompt-price fallback.
            cached_input: Some(0.0),
            output: None,
        })
    );
}

/// A model whose developer serves no endpoint fails the official-price lookup with a
/// validation error naming the model.
#[tokio::test]
async fn official_prices_errs_when_no_endpoint_belongs_to_the_developer() {
    let server = spawn_endpoints_stub(serde_json::json!({
        "data": {
            "name": "Moonshot AI: Kimi K2",
            "endpoints": [
                { "provider_name": "Novita", "pricing": { "prompt": "0.000001", "completion": "0.000002" } },
            ],
        },
    }))
    .await;

    let prices = OpenRouterPrices::with_endpoint(server.url());
    let err = prices
        .official_prices("moonshotai/kimi-k2")
        .await
        .expect_err("a model with no official endpoint has no official price");
    match err {
        Error::Validation(message) => {
            assert!(message.contains("moonshotai/kimi-k2"), "{message}");
        }
        other => panic!("expected a validation error, got {other:?}"),
    }
}

/// The official-price lookup resolves the developer's route out of a multi-provider
/// endpoints payload, through the same per-model fetch the launch facts use.
#[tokio::test]
async fn official_prices_reads_the_developers_route_from_the_endpoints_payload() {
    let server = spawn_endpoints_stub(serde_json::json!({
        "data": {
            "name": "OpenAI: GPT-5.6 Sol",
            "endpoints": [
                { "provider_name": "Azure", "pricing": { "prompt": "0.00001", "completion": "0.00004" } },
                { "provider_name": "OpenAI", "pricing": { "prompt": "0.000002", "completion": "0.000008" } },
            ],
        },
    }))
    .await;

    let prices = OpenRouterPrices::with_endpoint(server.url());
    assert_eq!(
        prices
            .official_prices("openai/gpt-5.6-sol")
            .await
            .expect("the developer's route is priced"),
        TokenPrices {
            uncached_input: Some(0.000_002),
            cached_input: Some(0.000_002),
            output: Some(0.000_008),
        }
    );
}

/// Serve one canned `/models/{id}/endpoints` response from a loopback HTTP server, so
/// the async lookups can be exercised against the real fetch path.
async fn spawn_endpoints_stub(body: serde_json::Value) -> StubServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let body = body.to_string();
            tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                // Drain the request head; the stub answers every path the same way.
                let mut buffer = [0u8; 4096];
                let _ = socket.read(&mut buffer).await;
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    });
    StubServer { url }
}

/// A running loopback stub; dropping it stops nothing, but the process is the test.
struct StubServer {
    url: String,
}

impl StubServer {
    fn url(&self) -> &str {
        &self.url
    }
}
