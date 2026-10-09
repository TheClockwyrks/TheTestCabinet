use std::collections::HashMap;

use super::*;
use crate::db::ModelConfigWrite;

const FLEX: [f64; 3] = [0.000_000_625, 0.000_000_062_5, 0.000_005];
const STANDARD: [f64; 3] = [0.000_001_25, 0.000_000_125, 0.000_01];

/// Serve an OpenRouter catalog listing `listed`, and the endpoints body `endpoints`
/// holds for a model id. A model with no body answers 500, as a listing that cannot
/// be read.
async fn fake_openrouter(
    listed: &[&str],
    endpoints: HashMap<&'static str, serde_json::Value>,
) -> OpenRouterPrices {
    let catalog = serde_json::json!({
        "data": listed
            .iter()
            .map(|id| serde_json::json!({
                "id": id,
                "pricing": { "prompt": "0.000003", "completion": "0.000015" },
            }))
            .collect::<Vec<_>>(),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = axum::Router::new()
        .route(
            "/models",
            axum::routing::get(move || {
                let body = catalog.clone();
                async move { axum::Json(body) }
            }),
        )
        .route(
            "/models/{*rest}",
            axum::routing::get(
                move |axum::extract::Path(rest): axum::extract::Path<String>| {
                    let body = rest
                        .strip_suffix("/endpoints")
                        .and_then(|id| endpoints.get(id).cloned());
                    async move {
                        body.map(axum::Json)
                            .ok_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
                    }
                },
            ),
        );
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    OpenRouterPrices::with_endpoint(format!("http://{addr}/models"))
}

/// One endpoint of a listing, at `rate`, under `provider` and `tag`.
fn endpoint(provider: &str, tag: &str, rate: [f64; 3]) -> serde_json::Value {
    serde_json::json!({
        "provider_name": provider,
        "tag": tag,
        "pricing": {
            "prompt": rate[0].to_string(),
            "input_cache_read": rate[1].to_string(),
            "completion": rate[2].to_string(),
        },
    })
}

/// A listing whose developer serves the model at a Flex tier, listed first, and a
/// standard one.
fn flex_then_standard(provider: &str, tag: &str) -> serde_json::Value {
    serde_json::json!({
        "data": {
            "endpoints": [
                endpoint(provider, &format!("{tag}/flex"), FLEX),
                endpoint(provider, tag, STANDARD),
            ],
        },
    })
}

/// A curated entry under `slug`, listed on OpenRouter as `openrouter`, holding the
/// list price `rate` (none when `None`) entered on 2026-01-01 under `source`.
async fn entry(
    db: &Db,
    slug: &str,
    openrouter: Option<&str>,
    rate: Option<[f64; 3]>,
    source: &str,
) {
    let alias = openrouter.unwrap_or(slug);
    db.upsert_model_config(ModelConfigWrite {
        openrouter_slug: openrouter.map(str::to_string),
        ..crate::db::tests::model_write(slug, slug, &[alias])
    })
    .await
    .unwrap();
    if let Some([uncached_input, cached_input, output]) = rate {
        db.set_list_price(ListPriceWrite {
            slug: slug.to_string(),
            uncached_input,
            cached_input,
            output,
            as_of: "2026-01-01".to_string(),
            source: source.to_string(),
            now: "2026-01-01T00:00:00Z".to_string(),
        })
        .await
        .unwrap();
    }
}

/// The list price, its date and its source as stored on `slug`.
async fn held(db: &Db, slug: &str) -> (Option<[f64; 3]>, Option<String>, Option<String>) {
    let config = db.get_model_config(slug).await.unwrap().unwrap().config;
    let rate = match (
        config.list_price_input,
        config.list_price_cached_input,
        config.list_price_output,
    ) {
        (Some(input), Some(cached), Some(output)) => Some([input, cached, output]),
        _ => None,
    };
    (rate, config.list_price_as_of, config.list_price_source)
}

fn unreachable_prices() -> OpenRouterPrices {
    OpenRouterPrices::with_endpoint("http://127.0.0.1:0/models")
}

/// Every stored list price becomes its standard endpoint's rate, a hand-entered one
/// included; a blank one stays blank and one already at the standard rate keeps its date.
#[tokio::test]
async fn the_rewrite_puts_the_standard_rate_over_every_stored_list_price() {
    let db = Db::connect_in_memory().await.unwrap();
    entry(
        &db,
        "filled",
        Some("openai/filled"),
        Some(FLEX),
        "openrouter",
    )
    .await;
    entry(&db, "by-hand", Some("google/by-hand"), Some(FLEX), "hand").await;
    entry(&db, "right", Some("openai/right"), Some(STANDARD), "hand").await;
    entry(&db, "blank", Some("openai/blank"), None, "").await;
    let prices = fake_openrouter(
        &[
            "openai/filled",
            "google/by-hand",
            "openai/right",
            "openai/blank",
        ],
        HashMap::from([
            ("openai/filled", flex_then_standard("OpenAI", "openai")),
            (
                "google/by-hand",
                flex_then_standard("Google", "google-vertex/global"),
            ),
            ("openai/right", flex_then_standard("OpenAI", "openai")),
            // `openai/blank` has no body: it must never be asked about.
        ]),
    )
    .await;

    assert_eq!(
        rewrite_list_prices(&db, &prices).await.unwrap(),
        ListPriceRewrite::Complete { rewritten: 2 }
    );

    for slug in ["filled", "by-hand"] {
        let (rate, as_of, source) = held(&db, slug).await;
        assert_eq!(rate, Some(STANDARD), "{slug}");
        assert_ne!(as_of.as_deref(), Some("2026-01-01"), "{slug}");
        assert_eq!(
            source.as_deref(),
            Some(LIST_PRICE_SOURCE_OPENROUTER),
            "{slug}"
        );
    }
    assert_eq!(
        held(&db, "right").await,
        (
            Some(STANDARD),
            Some("2026-01-01".to_string()),
            Some("hand".to_string())
        )
    );
    assert_eq!(held(&db, "blank").await.0, None);
}

/// Once complete, the rewrite never runs again: a later call reaches nothing and leaves
/// a list price entered since as it is.
#[tokio::test]
async fn a_completed_rewrite_never_runs_again() {
    let db = Db::connect_in_memory().await.unwrap();
    entry(
        &db,
        "filled",
        Some("openai/filled"),
        Some(FLEX),
        "openrouter",
    )
    .await;
    let prices = fake_openrouter(
        &["openai/filled"],
        HashMap::from([("openai/filled", flex_then_standard("OpenAI", "openai"))]),
    )
    .await;
    assert_eq!(
        rewrite_list_prices(&db, &prices).await.unwrap(),
        ListPriceRewrite::Complete { rewritten: 1 }
    );

    entry(
        &db,
        "filled",
        Some("openai/filled"),
        Some([1.0, 2.0, 3.0]),
        "hand",
    )
    .await;
    for prices in [&prices, &unreachable_prices()] {
        assert_eq!(
            rewrite_list_prices(&db, prices).await.unwrap(),
            ListPriceRewrite::AlreadyComplete
        );
    }
    assert_eq!(held(&db, "filled").await.0, Some([1.0, 2.0, 3.0]));
}

/// One listing that cannot be read defers the whole rewrite: nothing is written, not
/// even for the entries that were read, and the next call does all of it.
#[tokio::test]
async fn an_unread_listing_defers_every_write() {
    let db = Db::connect_in_memory().await.unwrap();
    entry(&db, "read", Some("openai/read"), Some(FLEX), "openrouter").await;
    entry(
        &db,
        "unread",
        Some("openai/unread"),
        Some(FLEX),
        "openrouter",
    )
    .await;
    let listed = ["openai/read", "openai/unread"];
    let broken = fake_openrouter(
        &listed,
        HashMap::from([("openai/read", flex_then_standard("OpenAI", "openai"))]),
    )
    .await;

    assert_eq!(
        rewrite_list_prices(&db, &broken).await.unwrap(),
        ListPriceRewrite::Deferred { unread: 1 }
    );
    assert_eq!(held(&db, "read").await.0, Some(FLEX));
    assert_eq!(held(&db, "unread").await.0, Some(FLEX));
    assert!(!db.list_price_rewrite_completed().await.unwrap());

    // An unreachable catalog defers too.
    assert_eq!(
        rewrite_list_prices(&db, &unreachable_prices())
            .await
            .unwrap(),
        ListPriceRewrite::Deferred { unread: 0 }
    );
    assert_eq!(held(&db, "read").await.0, Some(FLEX));

    let working = fake_openrouter(
        &listed,
        HashMap::from([
            ("openai/read", flex_then_standard("OpenAI", "openai")),
            ("openai/unread", flex_then_standard("OpenAI", "openai")),
        ]),
    )
    .await;
    assert_eq!(
        rewrite_list_prices(&db, &working).await.unwrap(),
        ListPriceRewrite::Complete { rewritten: 2 }
    );
    assert_eq!(held(&db, "read").await.0, Some(STANDARD));
    assert_eq!(held(&db, "unread").await.0, Some(STANDARD));
}

/// An entry OpenRouter has no standard rate for keeps the list price it holds, and does
/// not hold the rewrite back: no slug, not listed, a developer listing only Flex, and a
/// model no listed provider is the developer of.
#[tokio::test]
async fn an_entry_with_no_standard_rate_keeps_its_list_price() {
    let db = Db::connect_in_memory().await.unwrap();
    entry(&db, "no-slug", None, Some(FLEX), "hand").await;
    entry(&db, "unlisted", Some("openai/unlisted"), Some(FLEX), "hand").await;
    entry(
        &db,
        "flex-only",
        Some("openai/flex-only"),
        Some(FLEX),
        "openrouter",
    )
    .await;
    entry(
        &db,
        "third-party",
        Some("openai/third-party"),
        Some(FLEX),
        "openrouter",
    )
    .await;
    let prices = fake_openrouter(
        &["openai/flex-only", "openai/third-party"],
        HashMap::from([
            (
                "openai/flex-only",
                serde_json::json!({
                    "data": { "endpoints": [endpoint("OpenAI", "openai/flex", FLEX)] },
                }),
            ),
            (
                "openai/third-party",
                serde_json::json!({
                    "data": { "endpoints": [endpoint("Cheapo", "cheapo", [1.0, 1.0, 1.0])] },
                }),
            ),
        ]),
    )
    .await;

    assert_eq!(
        rewrite_list_prices(&db, &prices).await.unwrap(),
        ListPriceRewrite::Complete { rewritten: 0 }
    );
    for slug in ["no-slug", "unlisted", "flex-only", "third-party"] {
        assert_eq!(held(&db, slug).await.0, Some(FLEX), "{slug}");
    }
}

/// A database with no list price to rewrite completes without reaching OpenRouter.
#[tokio::test]
async fn a_catalog_with_no_list_price_completes_without_a_fetch() {
    let db = Db::connect_in_memory().await.unwrap();
    entry(&db, "blank", Some("openai/blank"), None, "").await;

    assert_eq!(
        rewrite_list_prices(&db, &unreachable_prices())
            .await
            .unwrap(),
        ListPriceRewrite::Complete { rewritten: 0 }
    );
    assert!(db.list_price_rewrite_completed().await.unwrap());
}
