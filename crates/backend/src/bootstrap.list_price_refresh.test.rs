use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::response::IntoResponse;

use super::*;
use crate::db::{AliasEntry, ModelConfigWrite};

/// A fake OpenRouter that lists exactly the models in `listings`, each with the
/// endpoints given for it, and answers `404` for every other id, as OpenRouter does
/// for a model it does not list. A model whose endpoints are given as `null` is one
/// whose read stalls: the request is accepted and never answered.
struct FakeOpenRouter {
    prices: OpenRouterPrices,
    /// The most requests that were being answered at one moment.
    peak_in_flight: Arc<AtomicUsize>,
    /// Every model id whose endpoints listing was asked for, in arrival order.
    asked: Arc<std::sync::Mutex<Vec<String>>>,
    /// How many times the models listing was read.
    listing_reads: Arc<AtomicUsize>,
}

/// A fake OpenRouter whose models listing prices no model.
async fn fake_openrouter(listings: &[(&str, serde_json::Value)]) -> FakeOpenRouter {
    fake_openrouter_listing(listings, Some(&[])).await
}

/// A model's own price in the models listing, at the given per-token rates.
fn listed_price(input: &str, cached: &str, output: &str) -> serde_json::Value {
    serde_json::json!({ "prompt": input, "completion": output, "input_cache_read": cached })
}

/// A fake OpenRouter whose models listing carries the `pricing` given for each id in
/// `models`, or cannot be read (it answers `500`) when `models` is `None`.
async fn fake_openrouter_listing(
    listings: &[(&str, serde_json::Value)],
    models: Option<&[(&str, serde_json::Value)]>,
) -> FakeOpenRouter {
    let models: Option<serde_json::Value> = models.map(|models| {
        let entries: Vec<serde_json::Value> = models
            .iter()
            .map(|(id, pricing)| serde_json::json!({ "id": id, "pricing": pricing }))
            .collect();
        serde_json::json!({ "data": entries })
    });
    let listing_reads = Arc::new(AtomicUsize::new(0));
    let listings: Arc<HashMap<String, serde_json::Value>> = Arc::new(
        listings
            .iter()
            .map(|(id, endpoints)| (id.to_string(), endpoints.clone()))
            .collect(),
    );
    let in_flight = Arc::new(AtomicUsize::new(0));
    let peak_in_flight = Arc::new(AtomicUsize::new(0));
    let asked = Arc::new(std::sync::Mutex::new(Vec::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = {
        let peak_in_flight = Arc::clone(&peak_in_flight);
        let asked = Arc::clone(&asked);
        let listing_reads = Arc::clone(&listing_reads);
        axum::Router::new()
            .route(
                "/models",
                axum::routing::get(move || {
                    let models = models.clone();
                    let listing_reads = Arc::clone(&listing_reads);
                    async move {
                        listing_reads.fetch_add(1, Ordering::SeqCst);
                        match models {
                            Some(models) => axum::Json(models).into_response(),
                            None => axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                        }
                    }
                }),
            )
            .route(
                "/models/{*rest}",
                axum::routing::get(
                    move |axum::extract::Path(rest): axum::extract::Path<String>| {
                        let listings = Arc::clone(&listings);
                        let in_flight = Arc::clone(&in_flight);
                        let peak_in_flight = Arc::clone(&peak_in_flight);
                        let asked = Arc::clone(&asked);
                        async move {
                            let now = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                            peak_in_flight.fetch_max(now, Ordering::SeqCst);
                            // Let the other requests the caller has open arrive before this
                            // one is answered, so the peak is the caller's concurrency.
                            for _ in 0..32 {
                                tokio::task::yield_now().await;
                            }
                            let id = rest.trim_end_matches("/endpoints").to_string();
                            asked.lock().unwrap().push(id.clone());
                            let response = match listings.get(&id) {
                                // A listing given as `null` is never answered.
                                Some(serde_json::Value::Null) => {
                                    std::future::pending::<axum::response::Response>().await
                                }
                                Some(endpoints) => axum::Json(serde_json::json!({
                                    "data": { "name": "Some: Model", "endpoints": endpoints },
                                }))
                                .into_response(),
                                None => axum::http::StatusCode::NOT_FOUND.into_response(),
                            };
                            in_flight.fetch_sub(1, Ordering::SeqCst);
                            response
                        }
                    },
                ),
            )
    };
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    FakeOpenRouter {
        prices: OpenRouterPrices::with_endpoint(format!("http://{addr}/models")),
        peak_in_flight,
        asked,
        listing_reads,
    }
}

/// One standard endpoint of `provider` at the given per-token rates.
fn endpoint(provider: &str, input: &str, cached: &str, output: &str) -> serde_json::Value {
    serde_json::json!({
        "provider_name": provider,
        "pricing": { "prompt": input, "completion": output, "input_cache_read": cached },
    })
}

/// `provider`'s Flex endpoint at the given per-token rates.
fn flex_endpoint(provider: &str, input: &str, cached: &str, output: &str) -> serde_json::Value {
    let mut endpoint = endpoint(provider, input, cached, output);
    endpoint["tag"] = serde_json::json!(format!("{}/flex", provider.to_lowercase()));
    endpoint
}

/// A curated entry under `slug` looked up on OpenRouter as `openrouter_slug`, with no
/// list price.
fn entry(slug: &str, openrouter_slug: &str) -> ModelConfigWrite {
    ModelConfigWrite {
        openrouter_slug: Some(openrouter_slug.to_string()),
        ..crate::db::tests::model_write(slug, slug, &[openrouter_slug])
    }
}

/// `write` carrying a list price an operator entered on 2026-09-01.
fn hand_priced(write: ModelConfigWrite, rate: [f64; 3]) -> ModelConfigWrite {
    ModelConfigWrite {
        list_price_input: Some(rate[0]),
        list_price_cached_input: Some(rate[1]),
        list_price_output: Some(rate[2]),
        list_price_as_of: Some("2026-09-01".to_string()),
        list_price_source: Some("hand".to_string()),
        ..write
    }
}

/// The list price an entry holds, with its date and source.
async fn held(db: &Db, slug: &str) -> ([Option<f64>; 3], Option<String>, Option<String>) {
    let config = db.get_model_config(slug).await.unwrap().unwrap().config;
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

/// Today's date as a refresh stamps it, `YYYY-MM-DD`.
fn today() -> String {
    OffsetDateTime::now_utc()
        .date()
        .format(&time::macros::format_description!("[year]-[month]-[day]"))
        .unwrap()
}

/// The stamp of a list price read from OpenRouter today.
fn from_openrouter_today() -> (Option<String>, Option<String>) {
    (
        Some(today()),
        Some(LIST_PRICE_SOURCE_OPENROUTER.to_string()),
    )
}

/// An entry with no list price gets one, dated today and sourced `openrouter`.
#[tokio::test]
async fn an_entry_without_a_list_price_gets_one() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(entry("glm", "z-ai/glm-5.3"))
        .await
        .unwrap();
    let openrouter = fake_openrouter(&[(
        "z-ai/glm-5.3",
        serde_json::json!([endpoint("Z.AI", "0.0000014", "0.00000026", "0.0000044")]),
    )])
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(
        refresh,
        ListPriceRefresh {
            total: 1,
            updated: 1,
            unchanged: 0,
            unresolved: 0,
        }
    );
    assert!(refresh.changed());
    let (rate, as_of, source) = held(&db, "glm").await;
    assert_eq!(rate, [Some(0.0000014), Some(0.00000026), Some(0.0000044)]);
    assert_eq!((as_of, source), from_openrouter_today());
}

/// A list price an operator entered is overwritten by the rate OpenRouter publishes,
/// and is from then on sourced `openrouter`.
#[tokio::test]
async fn a_hand_entered_list_price_is_overwritten() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(hand_priced(
        entry("glm", "z-ai/glm-5.3"),
        [9e-6, 9e-7, 99e-6],
    ))
    .await
    .unwrap();
    let openrouter = fake_openrouter(&[(
        "z-ai/glm-5.3",
        serde_json::json!([endpoint("Z.AI", "0.0000014", "0.00000026", "0.0000044")]),
    )])
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!((refresh.updated, refresh.unchanged), (1, 0));
    let (rate, as_of, source) = held(&db, "glm").await;
    assert_eq!(rate, [Some(0.0000014), Some(0.00000026), Some(0.0000044)]);
    assert_eq!((as_of, source), from_openrouter_today());
}

/// An entry whose stored rate OpenRouter confirms still has its date and source
/// rewritten, so the date says how fresh the figure is. Nothing changed, so the
/// refresh reports no change.
#[tokio::test]
async fn a_confirmed_rate_has_its_date_and_source_rewritten() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(hand_priced(
        entry("glm", "z-ai/glm-5.3"),
        [0.0000014, 0.00000026, 0.0000044],
    ))
    .await
    .unwrap();
    let openrouter = fake_openrouter(&[(
        "z-ai/glm-5.3",
        serde_json::json!([endpoint("Z.AI", "0.0000014", "0.00000026", "0.0000044")]),
    )])
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(
        refresh,
        ListPriceRefresh {
            total: 1,
            updated: 0,
            unchanged: 1,
            unresolved: 0,
        }
    );
    assert!(!refresh.changed());
    let (rate, as_of, source) = held(&db, "glm").await;
    assert_eq!(rate, [Some(0.0000014), Some(0.00000026), Some(0.0000044)]);
    assert_eq!((as_of, source), from_openrouter_today());
}

/// An entry OpenRouter does not list keeps what it holds: a price entered by hand for
/// a model that is not on OpenRouter survives the refresh, date and source included,
/// and an unpriced one stays unpriced.
#[tokio::test]
async fn an_unlisted_entry_keeps_what_it_holds() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(hand_priced(
        entry("in-house", "in-house/model-1"),
        [1e-6, 1e-7, 2e-6],
    ))
    .await
    .unwrap();
    db.upsert_model_config(entry("unpriced", "in-house/model-2"))
        .await
        .unwrap();
    let openrouter = fake_openrouter(&[]).await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(
        refresh,
        ListPriceRefresh {
            total: 2,
            updated: 0,
            unchanged: 0,
            unresolved: 2,
        }
    );
    assert!(!refresh.changed());
    assert_eq!(
        held(&db, "in-house").await,
        (
            [Some(1e-6), Some(1e-7), Some(2e-6)],
            Some("2026-09-01".to_string()),
            Some("hand".to_string()),
        )
    );
    assert_eq!(held(&db, "unpriced").await, ([None; 3], None, None));
}

/// An OpenRouter that cannot be reached leaves every entry as it is, and the refresh
/// still answers with its counts.
#[tokio::test]
async fn an_unreadable_listing_keeps_what_the_entry_holds() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(hand_priced(
        entry("glm", "z-ai/glm-5.3"),
        [1e-6, 1e-7, 2e-6],
    ))
    .await
    .unwrap();
    let unreachable = OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models");

    let refresh = refresh_list_prices(&db, &unreachable, &|| {})
        .await
        .unwrap();

    assert_eq!(
        refresh,
        ListPriceRefresh {
            total: 1,
            updated: 0,
            unchanged: 0,
            unresolved: 1,
        }
    );
    assert_eq!(
        held(&db, "glm").await,
        (
            [Some(1e-6), Some(1e-7), Some(2e-6)],
            Some("2026-09-01".to_string()),
            Some("hand".to_string()),
        )
    );
}

/// An entry OpenRouter lists with no complete rate keeps what it holds: a Flex endpoint
/// is never read, and neither is an endpoint missing a rate.
#[tokio::test]
async fn an_entry_with_no_complete_rate_keeps_what_it_holds() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(hand_priced(
        entry("sol", "openai/gpt-5.6-sol"),
        [1.25e-6, 1.25e-7, 1e-5],
    ))
    .await
    .unwrap();
    db.upsert_model_config(entry("half", "newco/half-priced"))
        .await
        .unwrap();
    let openrouter = fake_openrouter(&[
        (
            "openai/gpt-5.6-sol",
            serde_json::json!([flex_endpoint(
                "OpenAI",
                "0.000000625",
                "0.0000000625",
                "0.000005"
            )]),
        ),
        (
            "newco/half-priced",
            serde_json::json!([{
                "provider_name": "NewCo",
                "pricing": { "prompt": "0.000001", "completion": "-1" },
            }]),
        ),
    ])
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!((refresh.total, refresh.unresolved), (2, 2));
    assert_eq!(
        held(&db, "sol").await,
        (
            [Some(1.25e-6), Some(1.25e-7), Some(1e-5)],
            Some("2026-09-01".to_string()),
            Some("hand".to_string()),
        )
    );
    assert_eq!(held(&db, "half").await, ([None; 3], None, None));
}

/// One refresh over a mixed catalog counts every entry once, and the counts add up.
#[tokio::test]
async fn the_counts_cover_every_entry() {
    let db = Db::connect_in_memory().await.unwrap();
    // No list price, listed: updated.
    db.upsert_model_config(entry("fresh", "newco/fresh"))
        .await
        .unwrap();
    // A different rate entered by hand, listed: updated.
    db.upsert_model_config(hand_priced(
        entry("stale", "newco/stale"),
        [9e-6, 9e-7, 9e-5],
    ))
    .await
    .unwrap();
    // The same rate, listed: unchanged.
    db.upsert_model_config(hand_priced(entry("same", "newco/same"), [1e-6, 1e-7, 2e-6]))
        .await
        .unwrap();
    // Not listed: unresolved.
    db.upsert_model_config(hand_priced(entry("gone", "newco/gone"), [5e-6, 5e-7, 5e-5]))
        .await
        .unwrap();
    let listed = serde_json::json!([endpoint("NewCo", "0.000001", "0.0000001", "0.000002")]);
    let openrouter = fake_openrouter(&[
        ("newco/fresh", listed.clone()),
        ("newco/stale", listed.clone()),
        ("newco/same", listed),
    ])
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(
        refresh,
        ListPriceRefresh {
            total: 4,
            updated: 2,
            unchanged: 1,
            unresolved: 1,
        }
    );
    assert_eq!(
        refresh.total,
        refresh.updated + refresh.unchanged + refresh.unresolved
    );
    assert!(refresh.changed());
    for slug in ["fresh", "stale", "same"] {
        let (rate, as_of, source) = held(&db, slug).await;
        assert_eq!(rate, [Some(1e-6), Some(1e-7), Some(2e-6)], "{slug}");
        assert_eq!((as_of, source), from_openrouter_today(), "{slug}");
    }
    assert_eq!(
        held(&db, "gone").await.2.as_deref(),
        Some("hand"),
        "an unlisted entry keeps its source"
    );
}

/// A listing with a cheaper provider first, then the model's developer, then the
/// provider an operator might set by hand.
fn three_providers() -> serde_json::Value {
    serde_json::json!([
        endpoint("Cheapo", "0.000001", "0.0000001", "0.000002"),
        endpoint("Qwen", "0.000003", "0.0000003", "0.000006"),
        endpoint("Alibaba", "0.000005", "0.0000005", "0.00001"),
    ])
}

/// The provider set by hand on an entry decides its price on every refresh while that
/// provider publishes a complete standard rate: neither the developer the model id
/// names nor any other provider is substituted for it, however often the refresh runs.
#[tokio::test]
async fn a_hand_set_provider_decides_the_price_on_every_refresh() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        provider_pin: Some("alibaba".to_string()),
        ..entry("qwen", "qwen/qwen3-coder")
    })
    .await
    .unwrap();
    let openrouter = fake_openrouter(&[("qwen/qwen3-coder", three_providers())]).await;

    let first = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();
    assert_eq!(first.updated, 1);
    assert_eq!(
        held(&db, "qwen").await.0,
        [Some(0.000005), Some(0.0000005), Some(0.00001)]
    );

    let second = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();
    assert_eq!((second.updated, second.unchanged), (0, 1));
    assert_eq!(
        held(&db, "qwen").await.0,
        [Some(0.000005), Some(0.0000005), Some(0.00001)]
    );
    // The hand-set provider itself is the operator's, and the refresh leaves it alone.
    let config = db.get_model_config("qwen").await.unwrap().unwrap().config;
    assert_eq!(config.provider_pin.as_deref(), Some("alibaba"));
}

/// A hand-set provider whose only endpoint is a Flex one publishes no standard rate, so
/// the refresh falls to the developer the model id names, and then to the model's own
/// price in the models listing when the developer lists nothing either. Another
/// provider's endpoint is never the price, wherever it is listed.
#[tokio::test]
async fn a_hand_set_provider_with_no_standard_rate_falls_through() {
    let db = Db::connect_in_memory().await.unwrap();
    for (slug, openrouter_slug) in [
        ("to-author", "qwen/to-author"),
        ("to-listing", "qwen/to-listing"),
    ] {
        db.upsert_model_config(ModelConfigWrite {
            provider_pin: Some("Alibaba".to_string()),
            ..entry(slug, openrouter_slug)
        })
        .await
        .unwrap();
    }
    let openrouter = fake_openrouter_listing(
        &[
            (
                "qwen/to-author",
                serde_json::json!([
                    flex_endpoint("Alibaba", "0.0000025", "0.00000025", "0.000005"),
                    endpoint("Cheapo", "0.000001", "0.0000001", "0.000002"),
                    endpoint("Qwen", "0.000003", "0.0000003", "0.000006"),
                ]),
            ),
            (
                "qwen/to-listing",
                serde_json::json!([
                    endpoint("Cheapo", "0.000001", "0.0000001", "0.000002"),
                    flex_endpoint("Alibaba", "0.0000025", "0.00000025", "0.000005"),
                    flex_endpoint("Qwen", "0.0000015", "0.00000015", "0.000003"),
                    endpoint("Pricey", "0.000007", "0.0000007", "0.000014"),
                ]),
            ),
        ],
        Some(&[
            (
                "qwen/to-author",
                listed_price("0.00009", "0.000009", "0.0009"),
            ),
            (
                "qwen/to-listing",
                listed_price("0.000004", "0.0000004", "0.000008"),
            ),
        ]),
    )
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(refresh.updated, 2);
    assert_eq!(
        held(&db, "to-author").await.0,
        [Some(0.000003), Some(0.0000003), Some(0.000006)]
    );
    assert_eq!(
        held(&db, "to-listing").await.0,
        [Some(0.000004), Some(0.0000004), Some(0.000008)]
    );
    assert_eq!(openrouter.listing_reads.load(Ordering::SeqCst), 1);
}

/// A provider that lists its Flex endpoint first is priced at its standard endpoint,
/// set by hand or named by the model id alike, and the models listing is not read for
/// an entry its endpoints answer.
#[tokio::test]
async fn a_provider_listing_flex_first_is_priced_at_its_standard_endpoint() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        provider_pin: Some("Alibaba".to_string()),
        ..entry("by-hand", "qwen/by-hand")
    })
    .await
    .unwrap();
    db.upsert_model_config(entry("by-author", "qwen/by-author"))
        .await
        .unwrap();
    let flex_first = |provider: &str| {
        serde_json::json!([
            flex_endpoint(provider, "0.0000025", "0.00000025", "0.000005"),
            endpoint(provider, "0.000005", "0.0000005", "0.00001"),
        ])
    };
    let openrouter = fake_openrouter_listing(
        &[
            ("qwen/by-hand", flex_first("Alibaba")),
            ("qwen/by-author", flex_first("Qwen")),
        ],
        Some(&[
            (
                "qwen/by-hand",
                listed_price("0.00009", "0.000009", "0.0009"),
            ),
            (
                "qwen/by-author",
                listed_price("0.00009", "0.000009", "0.0009"),
            ),
        ]),
    )
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(refresh.updated, 2);
    for slug in ["by-hand", "by-author"] {
        assert_eq!(
            held(&db, slug).await.0,
            [Some(0.000005), Some(0.0000005), Some(0.00001)],
            "{slug}"
        );
    }
    assert_eq!(openrouter.listing_reads.load(Ordering::SeqCst), 0);
}

/// An entry only third parties serve is priced at the model's own price in the models
/// listing, which differs from every endpoint's rate, the first listed one included. An
/// entry whose models-listing price is incomplete, or that the models listing has no
/// entry for, keeps what it holds.
#[tokio::test]
async fn a_third_party_served_entry_takes_the_models_listing_price() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(entry("kimi", "moonshotai/kimi-k2"))
        .await
        .unwrap();
    db.upsert_model_config(hand_priced(
        entry("partial", "moonshotai/partial"),
        [5e-6, 5e-7, 5e-5],
    ))
    .await
    .unwrap();
    db.upsert_model_config(entry("absent", "moonshotai/absent"))
        .await
        .unwrap();
    let third_parties = serde_json::json!([
        endpoint("Cheapo", "0.000001", "0.0000001", "0.000002"),
        endpoint("Pricey", "0.000007", "0.0000007", "0.000014"),
    ]);
    let openrouter = fake_openrouter_listing(
        &[
            ("moonshotai/kimi-k2", third_parties.clone()),
            ("moonshotai/partial", third_parties.clone()),
            ("moonshotai/absent", third_parties),
        ],
        Some(&[
            (
                "moonshotai/kimi-k2",
                listed_price("0.0000006", "0.00000015", "0.0000025"),
            ),
            (
                "moonshotai/partial",
                serde_json::json!({ "prompt": "0.0000006", "completion": "-1" }),
            ),
        ]),
    )
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(
        refresh,
        ListPriceRefresh {
            total: 3,
            updated: 1,
            unchanged: 0,
            unresolved: 2,
        }
    );
    let (rate, as_of, source) = held(&db, "kimi").await;
    assert_eq!(rate, [Some(0.0000006), Some(0.00000015), Some(0.0000025)]);
    assert_eq!((as_of, source), from_openrouter_today());
    assert_eq!(
        held(&db, "partial").await,
        (
            [Some(5e-6), Some(5e-7), Some(5e-5)],
            Some("2026-09-01".to_string()),
            Some("hand".to_string()),
        )
    );
    assert_eq!(held(&db, "absent").await, ([None; 3], None, None));
}

/// The models listing is read once in a refresh, however many entries reach the last
/// step, and not at all when the endpoints listings answer every entry.
#[tokio::test]
async fn the_models_listing_is_read_at_most_once_in_a_refresh() {
    let db = Db::connect_in_memory().await.unwrap();
    let ids: Vec<String> = (0..24).map(|n| format!("moonshotai/model-{n}")).collect();
    let mut listings = Vec::new();
    let mut models = Vec::new();
    for (n, id) in ids.iter().enumerate() {
        db.upsert_model_config(entry(&format!("model-{n}"), id))
            .await
            .unwrap();
        listings.push((
            id.as_str(),
            serde_json::json!([endpoint("Cheapo", "0.000001", "0.0000001", "0.000002")]),
        ));
        models.push((
            id.as_str(),
            listed_price("0.000004", "0.0000004", "0.000008"),
        ));
    }
    let openrouter = fake_openrouter_listing(&listings, Some(&models)).await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!((refresh.total, refresh.updated), (24, 24));
    for n in 0..24 {
        assert_eq!(
            held(&db, &format!("model-{n}")).await.0,
            [Some(0.000004), Some(0.0000004), Some(0.000008)]
        );
    }
    assert_eq!(openrouter.asked.lock().unwrap().len(), 24);
    assert_eq!(openrouter.listing_reads.load(Ordering::SeqCst), 1);
    let peak = openrouter.peak_in_flight.load(Ordering::SeqCst);
    assert!(
        peak <= READ_CONCURRENCY,
        "{peak} listings were being read at once"
    );

    // Each refresh makes its own read, so the next one sees the listing as it is then.
    refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();
    assert_eq!(openrouter.listing_reads.load(Ordering::SeqCst), 2);

    // Entries their own developers price never cause the read.
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(entry("glm", "z-ai/glm-5.3"))
        .await
        .unwrap();
    let answered = fake_openrouter_listing(
        &[(
            "z-ai/glm-5.3",
            serde_json::json!([endpoint("Z.AI", "0.0000014", "0.00000026", "0.0000044")]),
        )],
        Some(&[(
            "z-ai/glm-5.3",
            listed_price("0.00009", "0.000009", "0.0009"),
        )]),
    )
    .await;
    let refresh = refresh_list_prices(&db, &answered.prices, &|| {})
        .await
        .unwrap();
    assert_eq!(refresh.updated, 1);
    assert_eq!(answered.listing_reads.load(Ordering::SeqCst), 0);
}

/// When the models listing cannot be read, the entries that reached the last step are
/// unresolved and keep what they hold, the entries a hand-set provider or the model id's
/// developer prices are written as usual, and the read is tried once.
#[tokio::test]
async fn an_unreadable_models_listing_leaves_only_the_last_step_unresolved() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        provider_pin: Some("Alibaba".to_string()),
        ..entry("by-hand", "qwen/qwen3-coder")
    })
    .await
    .unwrap();
    db.upsert_model_config(entry("by-author", "z-ai/glm-5.3"))
        .await
        .unwrap();
    db.upsert_model_config(hand_priced(
        entry("third-party", "moonshotai/kimi-k2"),
        [5e-6, 5e-7, 5e-5],
    ))
    .await
    .unwrap();
    db.upsert_model_config(entry("third-party-unpriced", "moonshotai/kimi-k3"))
        .await
        .unwrap();
    let third_parties =
        serde_json::json!([endpoint("Cheapo", "0.000001", "0.0000001", "0.000002")]);
    let openrouter = fake_openrouter_listing(
        &[
            ("qwen/qwen3-coder", three_providers()),
            (
                "z-ai/glm-5.3",
                serde_json::json!([endpoint("Z.AI", "0.0000014", "0.00000026", "0.0000044")]),
            ),
            ("moonshotai/kimi-k2", third_parties.clone()),
            ("moonshotai/kimi-k3", third_parties),
        ],
        None,
    )
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(
        refresh,
        ListPriceRefresh {
            total: 4,
            updated: 2,
            unchanged: 0,
            unresolved: 2,
        }
    );
    assert_eq!(
        held(&db, "by-hand").await.0,
        [Some(0.000005), Some(0.0000005), Some(0.00001)]
    );
    assert_eq!(
        held(&db, "by-author").await.0,
        [Some(0.0000014), Some(0.00000026), Some(0.0000044)]
    );
    assert_eq!(
        held(&db, "third-party").await,
        (
            [Some(5e-6), Some(5e-7), Some(5e-5)],
            Some("2026-09-01".to_string()),
            Some("hand".to_string()),
        )
    );
    assert_eq!(
        held(&db, "third-party-unpriced").await,
        ([None; 3], None, None)
    );
    assert_eq!(openrouter.listing_reads.load(Ordering::SeqCst), 1);
}

/// An entry with no OpenRouter slug is looked up by its aliases, each mapped onto
/// OpenRouter's spelling for its harness family, and the first one OpenRouter lists
/// decides.
#[tokio::test]
async fn an_entry_without_a_slug_is_looked_up_by_its_aliases() {
    let db = Db::connect_in_memory().await.unwrap();
    let alias = |alias: &str, family| AliasEntry {
        alias: alias.to_string(),
        family,
    };
    // A Codex id, which OpenRouter lists under `openai/`.
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: None,
        aliases: vec![alias("gpt-5.5", HarnessFamily::Codex)],
        ..crate::db::tests::model_write("gpt", "GPT-5.5", &[])
    })
    .await
    .unwrap();
    // A native Claude id OpenRouter does not list, beside the OpenRouter id it does.
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: None,
        aliases: vec![
            alias("claude-opus-4-8", HarnessFamily::Claude),
            alias("anthropic/claude-opus-4.8", HarnessFamily::Openrouter),
        ],
        ..crate::db::tests::model_write("opus", "Claude Opus 4.8", &[])
    })
    .await
    .unwrap();
    // Aliases OpenRouter lists none of.
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: None,
        aliases: vec![alias("gemini-9", HarnessFamily::Antigravity)],
        ..crate::db::tests::model_write("gemini", "Gemini 9", &[])
    })
    .await
    .unwrap();
    let openrouter = fake_openrouter(&[
        (
            "openai/gpt-5.5",
            serde_json::json!([endpoint("OpenAI", "0.00000125", "0.000000125", "0.00001")]),
        ),
        (
            "anthropic/claude-opus-4.8",
            serde_json::json!([endpoint("Anthropic", "0.000005", "0.0000005", "0.000025")]),
        ),
    ])
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(
        refresh,
        ListPriceRefresh {
            total: 3,
            updated: 2,
            unchanged: 0,
            unresolved: 1,
        }
    );
    assert_eq!(
        held(&db, "gpt").await.0,
        [Some(0.00000125), Some(0.000000125), Some(0.00001)]
    );
    assert_eq!(
        held(&db, "opus").await.0,
        [Some(0.000005), Some(0.0000005), Some(0.000025)]
    );
    assert_eq!(held(&db, "gemini").await.0, [None; 3]);
}

/// An entry with an OpenRouter slug is looked up by it alone: its aliases are not
/// tried when OpenRouter does not list the slug.
#[tokio::test]
async fn an_entry_with_a_slug_is_looked_up_by_it_alone() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: Some("anthropic/claude-opus-4.8-typo".to_string()),
        ..crate::db::tests::model_write("opus", "Claude Opus 4.8", &["anthropic/claude-opus-4.8"])
    })
    .await
    .unwrap();
    let openrouter = fake_openrouter(&[(
        "anthropic/claude-opus-4.8",
        serde_json::json!([endpoint("Anthropic", "0.000005", "0.0000005", "0.000025")]),
    )])
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(refresh.unresolved, 1);
    assert_eq!(
        *openrouter.asked.lock().unwrap(),
        ["anthropic/claude-opus-4.8-typo"]
    );
}

/// A refresh changes catalog entries only: a stored run keeps the cost it was scored
/// at.
#[tokio::test]
async fn a_refresh_leaves_stored_runs_as_they_were_scored() {
    let db = Db::connect_in_memory().await.unwrap();
    let record = crate::db::tests::record("r1");
    db.push(&record, &crate::db::tests::links(), None, None)
        .await
        .unwrap();
    let before = db.get_run("r1").await.unwrap().unwrap().record;
    let canonical = canonical_model_id(&record.subject.model_id, record.subject.harness_slug);
    db.upsert_model_config(ModelConfigWrite {
        provider_pin: Some("NewCo".to_string()),
        ..hand_priced(entry("run-model", &canonical), [9e-6, 9e-7, 9e-5])
    })
    .await
    .unwrap();
    let openrouter = fake_openrouter(&[(
        canonical.as_str(),
        serde_json::json!([endpoint("NewCo", "0.000001", "0.0000001", "0.000002")]),
    )])
    .await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!(refresh.updated, 1);
    let after = db.get_run("r1").await.unwrap().unwrap().record;
    assert_eq!(after.metrics.cost, before.metrics.cost);
    assert_eq!(
        serde_json::to_value(&after).unwrap(),
        serde_json::to_value(&before).unwrap()
    );
}

/// The listings are read a bounded number at a time, however many entries there are.
#[tokio::test]
async fn the_listings_are_read_with_bounded_concurrency() {
    let db = Db::connect_in_memory().await.unwrap();
    let mut listings = Vec::new();
    let ids: Vec<String> = (0..40).map(|n| format!("newco/model-{n}")).collect();
    for (n, id) in ids.iter().enumerate() {
        db.upsert_model_config(entry(&format!("model-{n}"), id))
            .await
            .unwrap();
        listings.push((
            id.as_str(),
            serde_json::json!([endpoint("NewCo", "0.000001", "0.0000001", "0.000002")]),
        ));
    }
    let openrouter = fake_openrouter(&listings).await;

    let refresh = refresh_list_prices(&db, &openrouter.prices, &|| {})
        .await
        .unwrap();

    assert_eq!((refresh.total, refresh.updated), (40, 40));
    assert_eq!(openrouter.asked.lock().unwrap().len(), 40);
    let peak = openrouter.peak_in_flight.load(Ordering::SeqCst);
    assert!(
        peak <= READ_CONCURRENCY,
        "{peak} listings were being read at once"
    );
}

/// With no curated entry there is nothing to read.
#[tokio::test]
async fn an_empty_catalog_refreshes_nothing() {
    let db = Db::connect_in_memory().await.unwrap();
    let unreachable = OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models");

    let refresh = refresh_list_prices(&db, &unreachable, &|| {})
        .await
        .unwrap();

    assert_eq!(refresh, ListPriceRefresh::default());
    assert!(!refresh.changed());
}

/// A counter and the `on_change` that bumps it.
fn change_counter() -> (Arc<AtomicUsize>, impl Fn() + Sync) {
    let count = Arc::new(AtomicUsize::new(0));
    let bump = {
        let count = Arc::clone(&count);
        move || {
            count.fetch_add(1, Ordering::SeqCst);
        }
    };
    (count, bump)
}

/// A refresh that changed a rate reports the change once, however many entries
/// changed, and one that only confirmed the stored rates reports none.
#[tokio::test]
async fn a_refresh_reports_a_changed_rate_once() {
    let db = Db::connect_in_memory().await.unwrap();
    for slug in ["one", "two", "three"] {
        db.upsert_model_config(entry(slug, &format!("newco/{slug}")))
            .await
            .unwrap();
    }
    let listed = serde_json::json!([endpoint("NewCo", "0.000001", "0.0000001", "0.000002")]);
    let openrouter = fake_openrouter(&[
        ("newco/one", listed.clone()),
        ("newco/two", listed.clone()),
        ("newco/three", listed),
    ])
    .await;
    let (changes, on_change) = change_counter();

    let first = refresh_list_prices(&db, &openrouter.prices, &on_change)
        .await
        .unwrap();
    assert_eq!(first.updated, 3);
    assert_eq!(changes.load(Ordering::SeqCst), 1);

    let second = refresh_list_prices(&db, &openrouter.prices, &on_change)
        .await
        .unwrap();
    assert_eq!((second.updated, second.unchanged), (0, 3));
    assert_eq!(
        changes.load(Ordering::SeqCst),
        1,
        "a refresh that changed no rate reports no change"
    );
}

/// A refresh with nothing to resolve reports no change.
#[tokio::test]
async fn a_refresh_that_resolves_nothing_reports_no_change() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(hand_priced(
        entry("in-house", "in-house/model-1"),
        [1e-6, 1e-7, 2e-6],
    ))
    .await
    .unwrap();
    let openrouter = fake_openrouter(&[]).await;
    let (changes, on_change) = change_counter();

    let refresh = refresh_list_prices(&db, &openrouter.prices, &on_change)
        .await
        .unwrap();

    assert_eq!(refresh.unresolved, 1);
    assert_eq!(changes.load(Ordering::SeqCst), 0);
}

/// A refresh that is dropped after it wrote an entry (the request awaiting it went
/// away) still reports the change. The entry stays written, so the next refresh finds
/// its rate already stored and would report nothing.
#[tokio::test]
async fn a_refresh_dropped_part_way_reports_the_rates_it_changed() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(entry("answered", "newco/answered"))
        .await
        .unwrap();
    db.upsert_model_config(entry("stalled", "newco/stalled"))
        .await
        .unwrap();
    let listed = serde_json::json!([endpoint("NewCo", "0.000001", "0.0000001", "0.000002")]);
    let openrouter = fake_openrouter(&[
        ("newco/answered", listed.clone()),
        ("newco/stalled", serde_json::Value::Null),
    ])
    .await;
    let (changes, on_change) = change_counter();

    // The stalled read keeps the refresh from finishing; it is dropped as soon as the
    // answered entry has been written.
    tokio::select! {
        finished = refresh_list_prices(&db, &openrouter.prices, &on_change) => {
            panic!("the refresh finished with a read still stalled: {finished:?}");
        }
        () = async {
            while held(&db, "answered").await.0 == [None; 3] {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        } => {}
    }

    assert_eq!(
        changes.load(Ordering::SeqCst),
        1,
        "the dropped refresh reported the rate it wrote"
    );
    assert_eq!(held(&db, "stalled").await.0, [None; 3]);

    // The next refresh confirms the written rate, which is why the first had to report.
    let openrouter = fake_openrouter(&[("newco/answered", listed)]).await;
    let next = refresh_list_prices(&db, &openrouter.prices, &on_change)
        .await
        .unwrap();
    assert_eq!((next.updated, next.unchanged, next.unresolved), (0, 1, 1));
    assert_eq!(changes.load(Ordering::SeqCst), 1);
}

/// A listing that never answers is given up on at the read timeout: its entry keeps
/// what it holds and is counted unresolved, and every other entry is refreshed.
#[tokio::test]
async fn a_stalled_listing_does_not_hold_the_refresh() {
    let db = Db::connect_in_memory().await.unwrap();
    db.upsert_model_config(entry("answered", "newco/answered"))
        .await
        .unwrap();
    db.upsert_model_config(hand_priced(
        entry("stalled", "newco/stalled"),
        [5e-6, 5e-7, 5e-5],
    ))
    .await
    .unwrap();
    let openrouter = fake_openrouter(&[
        (
            "newco/answered",
            serde_json::json!([endpoint("NewCo", "0.000001", "0.0000001", "0.000002")]),
        ),
        ("newco/stalled", serde_json::Value::Null),
    ])
    .await;
    let prices = openrouter
        .prices
        .clone()
        .with_read_timeout(Duration::from_millis(50));

    let refresh = refresh_list_prices(&db, &prices, &|| {}).await.unwrap();

    assert_eq!(
        refresh,
        ListPriceRefresh {
            total: 2,
            updated: 1,
            unchanged: 0,
            unresolved: 1,
        }
    );
    assert_eq!(
        held(&db, "answered").await.0,
        [Some(1e-6), Some(1e-7), Some(2e-6)]
    );
    assert_eq!(
        held(&db, "stalled").await,
        (
            [Some(5e-6), Some(5e-7), Some(5e-5)],
            Some("2026-09-01".to_string()),
            Some("hand".to_string()),
        )
    );
}
