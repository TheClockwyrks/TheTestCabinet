//! OpenRouter price lookup for the comparable cost.
//!
//! See `docs/metrics.md`. The canonical, provider-stable cost is computed from
//! the per-token prices OpenRouter lists for a model. This module fetches those
//! prices and maps them onto [`TokenPrices`].

use serde::Deserialize;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::{Error, Result};
use crate::metrics::TokenPrices;

/// The OpenRouter models endpoint listing every model and its pricing.
const MODELS_URL: &str = "https://openrouter.ai/api/v1/models";

/// Selected OpenRouter metadata for a model: its comparable per-token prices
/// plus the catalog facts the static site surfaces — the context window and the
/// model's release date. Each field beyond the prices is optional because
/// OpenRouter does not always report it.
#[derive(Debug, Clone)]
pub struct ModelDetails {
    /// Comparable per-token prices, mapped onto [`TokenPrices`].
    pub prices: TokenPrices,
    /// The maximum context length in tokens, when OpenRouter reports one.
    pub context_length: Option<u64>,
    /// The model's release date as an RFC 3339 UTC timestamp, derived from
    /// OpenRouter's `created` unix timestamp, when present.
    pub released_at: Option<String>,
}

/// Fetches model prices from OpenRouter.
#[derive(Debug, Clone)]
pub struct OpenRouterPrices {
    endpoint: String,
}

impl Default for OpenRouterPrices {
    fn default() -> Self {
        Self {
            endpoint: MODELS_URL.to_string(),
        }
    }
}

impl OpenRouterPrices {
    /// Use the default OpenRouter models endpoint.
    pub fn new() -> Self {
        Self::default()
    }

    /// Look up the per-token prices OpenRouter lists for `model_id`.
    ///
    /// The model ID is matched exactly against OpenRouter's catalog. Prices are
    /// reported per token in USD.
    pub async fn token_prices(&self, model_id: &str) -> Result<TokenPrices> {
        Ok(prices_of(&self.fetch_model(model_id).await?))
    }

    /// Look up the comparable prices plus the catalog facts the site surfaces —
    /// the context window and release date — for `model_id`.
    ///
    /// Like [`token_prices`](Self::token_prices) this matches the model ID
    /// exactly against OpenRouter's catalog; it simply carries the extra
    /// metadata alongside the prices.
    pub async fn model_details(&self, model_id: &str) -> Result<ModelDetails> {
        let model = self.fetch_model(model_id).await?;
        Ok(ModelDetails {
            prices: prices_of(&model),
            context_length: model.context_length,
            released_at: model.created.and_then(release_date),
        })
    }

    /// Fetch OpenRouter's catalog and return the entry whose ID matches
    /// `model_id` exactly, erroring when the model is absent.
    async fn fetch_model(&self, model_id: &str) -> Result<Model> {
        let response = reqwest::get(&self.endpoint)
            .await
            .map_err(|err| Error::Validation(format!("fetching OpenRouter prices: {err}")))?;
        let catalog: ModelsResponse = response
            .json()
            .await
            .map_err(|err| Error::Validation(format!("parsing OpenRouter prices: {err}")))?;

        catalog
            .data
            .into_iter()
            .find(|model| model.id == model_id)
            .ok_or_else(|| {
                Error::Validation(format!(
                    "model `{model_id}` not found in OpenRouter catalog"
                ))
            })
    }
}

/// Map an OpenRouter model's pricing block onto [`TokenPrices`].
fn prices_of(model: &Model) -> TokenPrices {
    let prompt = parse_price(&model.pricing.prompt);
    TokenPrices {
        uncached_input: prompt,
        // Fall back to the prompt price when a cache-read price is absent.
        cached_input: model
            .pricing
            .input_cache_read
            .as_deref()
            .map(parse_price)
            .unwrap_or(prompt),
        output: parse_price(&model.pricing.completion),
    }
}

/// Convert OpenRouter's `created` unix timestamp (seconds) into an RFC 3339 UTC
/// string, returning `None` when the timestamp is out of range or cannot be
/// formatted. This matches the timestamp convention used elsewhere in run
/// records.
fn release_date(created: i64) -> Option<String> {
    OffsetDateTime::from_unix_timestamp(created)
        .ok()
        .and_then(|moment| moment.format(&Rfc3339).ok())
}

/// The OpenRouter `/models` response envelope.
#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<Model>,
}

/// A single model entry with its pricing block and the catalog metadata the
/// site surfaces. `created` is a unix timestamp in seconds; `context_length` is
/// the model's maximum context window in tokens.
#[derive(Debug, Deserialize)]
struct Model {
    id: String,
    pricing: Pricing,
    #[serde(default)]
    created: Option<i64>,
    #[serde(default)]
    context_length: Option<u64>,
}

/// OpenRouter prices, reported as per-token USD strings.
#[derive(Debug, Deserialize)]
struct Pricing {
    prompt: String,
    completion: String,
    #[serde(default)]
    input_cache_read: Option<String>,
}

/// Parse an OpenRouter price string into a number, treating bad values as free.
fn parse_price(value: &str) -> f64 {
    value.parse().unwrap_or(0.0)
}
