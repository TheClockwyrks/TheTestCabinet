//! OpenRouter price lookup for the comparable cost.
//!
//! See `docs/metrics.md`. The canonical, provider-stable cost is computed from
//! the per-token prices OpenRouter lists for a model. This module fetches those
//! prices and maps them onto [`TokenPrices`].

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::metrics::TokenPrices;

/// The OpenRouter models endpoint listing every model and its pricing.
const MODELS_URL: &str = "https://openrouter.ai/api/v1/models";

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
        let response = reqwest::get(&self.endpoint)
            .await
            .map_err(|err| Error::Validation(format!("fetching OpenRouter prices: {err}")))?;
        let catalog: ModelsResponse = response
            .json()
            .await
            .map_err(|err| Error::Validation(format!("parsing OpenRouter prices: {err}")))?;

        let model = catalog
            .data
            .into_iter()
            .find(|model| model.id == model_id)
            .ok_or_else(|| {
                Error::Validation(format!(
                    "model `{model_id}` not found in OpenRouter catalog"
                ))
            })?;

        let prompt = parse_price(&model.pricing.prompt);
        Ok(TokenPrices {
            uncached_input: prompt,
            // Fall back to the prompt price when a cache-read price is absent.
            cached_input: model
                .pricing
                .input_cache_read
                .as_deref()
                .map(parse_price)
                .unwrap_or(prompt),
            output: parse_price(&model.pricing.completion),
        })
    }
}

/// The OpenRouter `/models` response envelope.
#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<Model>,
}

/// A single model entry with its pricing block.
#[derive(Debug, Deserialize)]
struct Model {
    id: String,
    pricing: Pricing,
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
