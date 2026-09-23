//! OpenRouter price lookup: the billed rate, read from the official endpoint.
//!
//! See `docs/metrics.md`. A run's comparable cost is priced at the model
//! developer's published list price, curated on the model's catalog entry and
//! computed over the run's token classes — it never comes from this module. What
//! this module fetches is the rate a run is **billed** at: the per-token price
//! of the model's official endpoint, the provider route belonging to the model's
//! own developer (see [`official_provider`]), mapped onto [`TokenPrices`].

use serde::Deserialize;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::{Error, Result};
use crate::metrics::TokenPrices;

/// The OpenRouter models endpoint listing every model and its pricing.
const MODELS_URL: &str = "https://openrouter.ai/api/v1/models";

/// Selected OpenRouter metadata for a model: its billed per-token prices plus
/// the catalog facts the static site surfaces — the context window, the model's
/// release date, and the input modalities it accepts. Each field beyond the
/// prices is optional because OpenRouter does not always report it.
#[derive(Debug, Clone)]
pub struct ModelDetails {
    /// The listing's headline per-token prices, mapped onto [`TokenPrices`]. The
    /// catalog records the [official endpoint's](ModelLaunchFacts::official_prices)
    /// prices in their place wherever the model has one, since those are the billed
    /// rate of a run pinned to the developer's own route.
    pub prices: TokenPrices,
    /// The maximum context length in tokens, when OpenRouter reports one.
    pub context_length: Option<u64>,
    /// The model's release date as an RFC 3339 UTC timestamp, derived from
    /// OpenRouter's `created` unix timestamp, when present.
    pub released_at: Option<String>,
    /// The input modalities OpenRouter says the model accepts (`text`, `image`,
    /// `file`, `audio`, …), normalized to lowercase. Empty when OpenRouter
    /// reports none, which is "unknown" rather than "text only".
    pub input_modalities: Vec<String>,
    /// The [official provider](official_provider) a run of the model is pinned to, or
    /// `None` when none is known. The models listing names no providers, so this is
    /// `None` as read from it and filled from the model's endpoints listing
    /// ([`ModelLaunchFacts::provider_pin`]) by the catalog before it records the
    /// observation.
    pub provider_pin: Option<String>,
}

/// The modality token OpenRouter uses for image input — the one gg checks before
/// putting a picture in a prompt.
pub const MODALITY_IMAGE: &str = "image";

/// The launch-time facts a [gg](crate::gg) run needs about one model, resolved in a
/// single per-model fetch: the context window its accounting is measured against and
/// the input modalities that decide whether it can be shown an image.
///
/// These travel together because they come from the same `/models/{id}/endpoints`
/// read and are pushed into the run container together — a run is *told* what it needs
/// about its models at launch rather than querying for it from inside the container.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ModelLaunchFacts {
    /// The largest context length any provider route reports, or `None` when
    /// OpenRouter lists the model but reports no window for any route.
    pub context_window: Option<u64>,
    /// The input modalities the model accepts, normalized to lowercase. Empty means
    /// OpenRouter reported none — unknown, not "text only".
    pub input_modalities: Vec<String>,
    /// The [official provider](official_provider) among the model's endpoints, as the
    /// listing spells its `provider_name`, or `None` when no endpoint belongs to the
    /// model's developer.
    pub provider_pin: Option<String>,
    /// Each provider route's per-token prices, keyed by the provider as the listing
    /// spells it: the first priced route per provider, in listing order. Read through
    /// [`official_prices`](Self::official_prices).
    pub route_prices: Vec<(String, TokenPrices)>,
}

/// The descriptive facts OpenRouter publishes about one model — the display name,
/// the provider behind it, and the prose blurb — as the model form's
/// auto-populate reads them.
///
/// These are the *curated* fields of a catalog entry, the ones an operator would
/// otherwise retype by hand. They are deliberately separate from
/// [`ModelDetails`] (prices and machine facts, recorded automatically) because
/// nothing but the form wants them: the catalog stores a curator's wording, and
/// this is only ever a starting point for it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModelListing {
    /// The display name with the provider prefix stripped — `Claude Sonnet 4.5`
    /// from OpenRouter's `Anthropic: Claude Sonnet 4.5`. The whole name when it
    /// carries no prefix.
    pub name: String,
    /// The provider, read from that same prefix (`Anthropic`), falling back to the
    /// slug's author segment (`anthropic/claude-...` → `anthropic`) when the name
    /// is unprefixed.
    pub provider: String,
    /// OpenRouter's prose description, or `None` when it publishes none. Note that
    /// OpenRouter truncates long descriptions itself (with a trailing `...`); this
    /// reports exactly what it serves.
    pub description: Option<String>,
}

impl ModelLaunchFacts {
    /// Whether the model is known to accept image input.
    ///
    /// `false` for an **empty** modality list too: this asks what OpenRouter
    /// *declared*, and callers that must decide something under uncertainty
    /// distinguish "declared text-only" from "nothing declared" themselves.
    pub fn accepts_images(&self) -> bool {
        self.input_modalities.iter().any(|m| m == MODALITY_IMAGE)
    }

    /// The billed rate of the model's official endpoint: the prices of the route
    /// `pin` names, or of the observed [`provider_pin`](Self::provider_pin) when
    /// `pin` is `None`. A hand-set pin is passed as `pin`, since it names the
    /// developer where the listing spells it differently from the model id.
    ///
    /// `None` when there is no pin or the pinned provider lists no priced route.
    pub fn official_prices(&self, pin: Option<&str>) -> Option<TokenPrices> {
        let provider = pin.or(self.provider_pin.as_deref())?;
        self.route_prices
            .iter()
            .find(|(name, _)| same_provider(name, provider))
            .map(|(_, prices)| *prices)
    }
}

#[path = "pricing.candidates.rs"]
mod candidates;
pub use candidates::{
    CandidateList, CandidatePolicy, CandidateRefusal, EndpointOffer, ProviderCandidate,
    QUANTIZATION_UNKNOWN, native_quantization, provider_candidates, quantization_rank,
    run_parameters,
};

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

    /// Use a specific models endpoint instead of the default OpenRouter URL.
    ///
    /// A test seam: it lets a unit test point the price source at a local stub
    /// serving a canned `/models` catalog, so the price-lookup and cost logic can
    /// be exercised without reaching the real OpenRouter API.
    pub fn with_endpoint(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
        }
    }

    /// Look up **one** model's official endpoint price: the prices of the route
    /// belonging to the model's own developer (see [`official_provider`]).
    ///
    /// This is the billed rate of a run pinned to the developer's own route, read
    /// from the same cheap per-model fetch as
    /// [`model_launch_facts`](Self::model_launch_facts). An unlisted model is an
    /// `Err`, as is a listed model with no priced route of its developer's.
    pub async fn official_prices(&self, model_id: &str) -> Result<TokenPrices> {
        self.model_launch_facts(model_id)
            .await?
            .official_prices(None)
            .ok_or_else(|| {
                Error::Validation(format!(
                    "model `{model_id}` has no official endpoint in OpenRouter's catalog"
                ))
            })
    }

    /// Look up the listing's headline prices plus the catalog facts the site
    /// surfaces (the context window and release date) for `model_id`.
    ///
    /// The model ID is matched exactly against OpenRouter's catalog.
    pub async fn model_details(&self, model_id: &str) -> Result<ModelDetails> {
        Ok(details_of(self.fetch_model(model_id).await?))
    }

    /// Look up the headline prices plus catalog facts for **every** model
    /// OpenRouter lists, keyed by OpenRouter id, in one fetch.
    ///
    /// The periodic price refresher reads the catalog facts of every known model
    /// from this single download, then each model's official endpoint price from its
    /// per-model [launch facts](Self::model_launch_facts).
    pub async fn all_model_details(
        &self,
    ) -> Result<std::collections::HashMap<String, ModelDetails>> {
        Ok(self
            .fetch_catalog()
            .await?
            .into_iter()
            .map(|model| (model.id.clone(), details_of(model)))
            .collect())
    }

    /// Look up **one** model's [launch facts](ModelLaunchFacts) — its context window and
    /// the input modalities it accepts — fetching only that model.
    ///
    /// Unlike [`model_details`](Self::model_details) — which serves the completion-time
    /// price lookup and reads the whole catalog — this hits OpenRouter's per-model
    /// endpoint (`/models/{id}/endpoints`, a few KB rather than the ~half-megabyte
    /// listing). It exists for the launch path, which needs these facts for the one or
    /// two models a run binds and must not pay for the entire catalog to get them. Both
    /// facts come out of the **same** response, so a run learns them in one request.
    ///
    /// That endpoint reports a context length **per provider route** rather than one
    /// headline figure, and the routes can differ (a model may be served at 1M tokens by
    /// most providers and 200k by one). The **maximum** is taken because that is exactly
    /// what the listing's top-level `context_length` reports, so a window resolved here
    /// agrees with the one the periodic refresh records rather than fighting it. The
    /// modalities, by contrast, are a property of the model rather than a route, and are
    /// read from the response's single `architecture` block.
    ///
    /// A [`context_window`](ModelLaunchFacts::context_window) of `None` means OpenRouter
    /// lists the model but reports no context length for any route; an unlisted model is
    /// an `Err`.
    pub async fn model_launch_facts(&self, model_id: &str) -> Result<ModelLaunchFacts> {
        Ok(launch_facts_of(
            model_id,
            self.fetch_endpoints(model_id).await?,
        ))
    }

    /// Look up **one** model's [descriptive facts](ModelListing) — its display name,
    /// provider, and prose description — fetching only that model.
    ///
    /// This backs the model form's "fill from OpenRouter" control, so it reads the
    /// same cheap per-model endpoint
    /// [`model_launch_facts`](Self::model_launch_facts) does rather than the
    /// half-megabyte listing: the two facts a curator wants are on the response
    /// already, and a form control must not pay for the whole catalog to get them.
    /// The listing's description is identical to this one — OpenRouter truncates it
    /// at the source — so nothing is lost by taking the smaller read.
    ///
    /// An unlisted model is an `Err`; a listed model missing a description is
    /// simply a `None` description, since a model with no blurb is ordinary.
    pub async fn model_listing(&self, model_id: &str) -> Result<ModelListing> {
        Ok(listing_of(model_id, self.fetch_endpoints(model_id).await?))
    }

    /// The provider routes OpenRouter lists for one model — the names a request
    /// can pin with `provider.order` — deduplicated by provider (a provider
    /// listing several quantizations appears once, first route wins), in
    /// OpenRouter's listing order. An unlisted model is an `Err`; a listed model
    /// with no routes is an empty list.
    pub async fn provider_routes(&self, model_id: &str) -> Result<Vec<ProviderRoute>> {
        Ok(routes_of(self.fetch_endpoints(model_id).await?))
    }

    /// Every endpoint OpenRouter lists for one model, as the
    /// [candidate filter](provider_candidates) reads it, in listing order. An unlisted model is an
    /// `Err`; a listed model with no endpoints is an empty list.
    pub async fn endpoint_offers(&self, model_id: &str) -> Result<Vec<EndpointOffer>> {
        Ok(offers_of(&self.fetch_endpoints(model_id).await?))
    }

    /// Fetch one model's `/models/{id}/endpoints` body — the cheap per-model read
    /// (a few KB) shared by the launch-facts, listing, and official-price lookups.
    async fn fetch_endpoints(&self, model_id: &str) -> Result<ModelEndpoints> {
        let url = format!("{}/{model_id}/endpoints", self.endpoint);
        let response = reqwest::get(&url).await.map_err(|err| {
            Error::Validation(format!(
                "fetching the OpenRouter catalog facts for `{model_id}`: {err}"
            ))
        })?;
        if !response.status().is_success() {
            return Err(Error::Validation(format!(
                "model `{model_id}` not found in OpenRouter catalog (HTTP {})",
                response.status().as_u16()
            )));
        }
        let body: ModelEndpointsResponse = response.json().await.map_err(|err| {
            Error::Validation(format!(
                "parsing the OpenRouter catalog facts for `{model_id}`: {err}"
            ))
        })?;
        Ok(body.data)
    }

    /// Fetch OpenRouter's full model catalog.
    async fn fetch_catalog(&self) -> Result<Vec<Model>> {
        let response = reqwest::get(&self.endpoint)
            .await
            .map_err(|err| Error::Validation(format!("fetching OpenRouter prices: {err}")))?;
        let catalog: ModelsResponse = response
            .json()
            .await
            .map_err(|err| Error::Validation(format!("parsing OpenRouter prices: {err}")))?;
        Ok(catalog.data)
    }

    /// Fetch OpenRouter's catalog and return the entry whose ID matches
    /// `model_id` exactly, erroring when the model is absent.
    async fn fetch_model(&self, model_id: &str) -> Result<Model> {
        self.fetch_catalog()
            .await?
            .into_iter()
            .find(|model| model.id == model_id)
            .ok_or_else(|| {
                Error::Validation(format!(
                    "model `{model_id}` not found in OpenRouter catalog"
                ))
            })
    }
}

/// One provider route of a model, as [`OpenRouterPrices::provider_routes`]
/// reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderRoute {
    /// The provider's display name — the value `provider.only` names.
    pub name: String,
    /// The route's context window in tokens, when reported.
    pub context_length: Option<u64>,
}

/// Whether `a` and `b` name the same OpenRouter provider.
///
/// OpenRouter spells one provider several ways: `Z.AI` in the endpoints listing and on a
/// response, `z-ai` in the model id and the route tag, and it accepts either in a request's
/// `provider` object. Two spellings agree when they are equal after lowercasing and dropping
/// everything but letters and digits. A blank spelling agrees with nothing.
pub fn same_provider(a: &str, b: &str) -> bool {
    let a = provider_key(a);
    !a.is_empty() && a == provider_key(b)
}

/// A provider spelling reduced to the characters [`same_provider`] compares.
pub fn provider_key(name: &str) -> String {
    name.chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// The provider, of those named in `providers`, that is the developer of `model_id`: the first
/// one that is the [same provider](same_provider) as the id's author segment
/// (`openai/gpt-5.6-sol` → `openai`), returned as the listing spells it.
///
/// `None` when no listed provider is the developer. That model is not testable unless its
/// catalog entry names the pin by hand, which covers a developer the listing names differently
/// from the id (`qwen/…` served by `Alibaba`).
pub fn official_provider<'a>(
    model_id: &str,
    providers: impl IntoIterator<Item = &'a str>,
) -> Option<String> {
    let author = model_id.split(['/', ':']).next().unwrap_or(model_id);
    providers
        .into_iter()
        .map(str::trim)
        .find(|name| same_provider(name, author))
        .map(str::to_string)
}

/// Reduce one model's endpoints body to its deduplicated provider routes.
fn routes_of(data: ModelEndpoints) -> Vec<ProviderRoute> {
    let mut routes: Vec<ProviderRoute> = Vec::new();
    for endpoint in data.endpoints {
        let Some(name) = endpoint
            .provider_name
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
        else {
            continue;
        };
        if routes.iter().any(|route| route.name == name) {
            continue;
        }
        routes.push(ProviderRoute {
            name,
            context_length: endpoint.context_length,
        });
    }
    routes
}

/// Reduce one model's endpoints body to every named endpoint as the candidate filter reads it,
/// in listing order. A provider listing several endpoints appears once per endpoint.
fn offers_of(data: &ModelEndpoints) -> Vec<EndpointOffer> {
    data.endpoints
        .iter()
        .filter_map(|endpoint| {
            let provider = endpoint
                .provider_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())?;
            let pricing = endpoint.pricing.as_ref();
            Some(EndpointOffer {
                provider: provider.to_string(),
                quantization: endpoint
                    .quantization
                    .as_deref()
                    .map(|level| level.trim().to_ascii_lowercase())
                    .filter(|level| !level.is_empty())
                    .unwrap_or_else(|| QUANTIZATION_UNKNOWN.to_string()),
                input: pricing.and_then(|pricing| parse_price(&pricing.prompt)),
                output: pricing.and_then(|pricing| parse_price(&pricing.completion)),
                cache_read: pricing
                    .and_then(|pricing| pricing.input_cache_read.as_deref())
                    .and_then(parse_price),
                supported_parameters: endpoint.supported_parameters.clone(),
            })
        })
        .collect()
}

/// Map one model's endpoints response onto the [`ModelListing`] the config form
/// fills itself in from.
///
/// OpenRouter writes the display name as `Provider: Model`, which is the only
/// place a provider's *presentational* spelling appears (`Anthropic`, not the
/// slug's `anthropic`), so that prefix is preferred as the provider. A name with
/// no prefix falls back to the slug's author segment (`anthropic/claude-...` →
/// `anthropic`, empty when the slug has no segment) and keeps the whole name as
/// the display name. A blank description is normalized to `None` so the form sees
/// "nothing published" rather than an empty field it must trim itself.
fn listing_of(model_id: &str, data: ModelEndpoints) -> ModelListing {
    let (provider, name) = match data.name.split_once(": ") {
        Some((provider, name)) => (provider.trim().to_string(), name.trim().to_string()),
        None => (
            match model_id.split_once('/') {
                Some((author, _)) => author.to_string(),
                None => String::new(),
            },
            data.name.trim().to_string(),
        ),
    };
    ModelListing {
        name,
        provider,
        description: data
            .description
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty()),
    }
}

/// Map one model's endpoints response onto its [`ModelLaunchFacts`]: the largest
/// window any route offers, the model-level modalities, the official provider, and
/// each provider's route prices.
fn launch_facts_of(model_id: &str, data: ModelEndpoints) -> ModelLaunchFacts {
    ModelLaunchFacts {
        context_window: data
            .endpoints
            .iter()
            .filter_map(|endpoint| endpoint.context_length)
            .max(),
        input_modalities: modalities_of(data.architecture.as_ref()),
        provider_pin: official_provider(
            model_id,
            data.endpoints
                .iter()
                .filter_map(|endpoint| endpoint.provider_name.as_deref()),
        ),
        route_prices: route_prices_of(&data.endpoints),
    }
}

/// Map one catalog entry onto the [`ModelDetails`] the catalog stores.
fn details_of(model: Model) -> ModelDetails {
    ModelDetails {
        prices: token_prices_of(&model.pricing),
        context_length: model.context_length,
        released_at: model.created.and_then(release_date),
        input_modalities: modalities_of(model.architecture.as_ref()),
        // The listing names no providers; the catalog fills the pin from the endpoints read.
        provider_pin: None,
    }
}

/// The normalized input modalities an `architecture` block declares: trimmed,
/// lowercased, blanks dropped, first occurrence kept.
///
/// A missing block (or one with no `input_modalities`) yields an **empty** list,
/// which every caller reads as "OpenRouter said nothing" rather than "text only" —
/// the distinction that keeps an unannotated model from being wrongly denied an
/// image.
fn modalities_of(architecture: Option<&Architecture>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in architecture
        .map(|a| a.input_modalities.as_slice())
        .unwrap_or(&[])
    {
        let normalized = raw.trim().to_lowercase();
        if !normalized.is_empty() && !out.contains(&normalized) {
            out.push(normalized);
        }
    }
    out
}

/// Each provider's route prices, in listing order, keeping the first priced route
/// of a provider that lists several (quantizations, say) — the same route
/// [`official_provider`] settles on when it scans the names in that order.
fn route_prices_of(endpoints: &[ModelEndpoint]) -> Vec<(String, TokenPrices)> {
    let mut out: Vec<(String, TokenPrices)> = Vec::new();
    for endpoint in endpoints {
        let (Some(name), Some(pricing)) = (endpoint.provider_name.as_deref(), &endpoint.pricing)
        else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() || out.iter().any(|(seen, _)| seen == name) {
            continue;
        }
        out.push((name.to_string(), token_prices_of(pricing)));
    }
    out
}

/// Map an OpenRouter pricing block — a listing entry's headline block or one
/// endpoint's per-route block, the same shape either way — onto [`TokenPrices`].
fn token_prices_of(pricing: &Pricing) -> TokenPrices {
    let prompt = parse_price(&pricing.prompt);
    TokenPrices {
        uncached_input: prompt,
        // Fall back to the prompt price when a cache-read price is absent.
        cached_input: pricing
            .input_cache_read
            .as_deref()
            .map(parse_price)
            .unwrap_or(prompt),
        output: parse_price(&pricing.completion),
    }
}

/// Parse an OpenRouter per-token price string into a known price, or `None` when
/// the price is unknown.
///
/// OpenRouter reports prices as USD strings. A value that does not parse, or one
/// that parses to a negative number — a nonsensical price some catalog entries
/// use as an "unpublished" sentinel — is treated as unknown rather than free.
/// A genuine `"0"` (a free class) parses to `Some(0.0)`.
fn parse_price(value: &str) -> Option<f64> {
    match value.parse::<f64>() {
        Ok(price) if price >= 0.0 => Some(price),
        _ => None,
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
    #[serde(default)]
    architecture: Option<Architecture>,
}

/// A model's `architecture` block. Only the input modalities are read: they are
/// what decides whether a prompt may carry an image. The block also names the
/// tokenizer and the output modalities, which nothing here needs.
#[derive(Debug, Deserialize)]
struct Architecture {
    #[serde(default)]
    input_modalities: Vec<String>,
}

/// The OpenRouter `/models/{id}/endpoints` response envelope — the single-model read
/// [`model_launch_facts`](OpenRouterPrices::model_launch_facts) uses.
#[derive(Debug, Deserialize)]
struct ModelEndpointsResponse {
    data: ModelEndpoints,
}

/// One model's descriptive block, its `architecture` block, and its provider routes.
/// The context lengths and the input modalities are read here, as are the name and
/// description the model form offers a curator and each route's per-endpoint pricing
/// block — the billed rate the [official endpoint](official_provider) charges at.
#[derive(Debug, Deserialize)]
struct ModelEndpoints {
    /// The display name, written `Provider: Model`.
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    architecture: Option<Architecture>,
    #[serde(default)]
    endpoints: Vec<ModelEndpoint>,
}

/// One provider route for a model. A route may report no context length and no pricing block,
/// and the fields beyond the name are what the [candidate filter](provider_candidates) reads.
#[derive(Debug, Deserialize)]
struct ModelEndpoint {
    #[serde(default)]
    provider_name: Option<String>,
    #[serde(default)]
    context_length: Option<u64>,
    /// The quantization the route declares. Absent reads as `unknown`.
    #[serde(default)]
    quantization: Option<String>,
    /// The route's own per-token prices, the same shape as the listing's pricing
    /// block: what a request routed to this provider is billed at.
    #[serde(default)]
    pricing: Option<Pricing>,
    #[serde(default)]
    supported_parameters: Vec<String>,
}

/// OpenRouter prices, reported as per-token USD strings.
#[derive(Debug, Deserialize)]
struct Pricing {
    #[serde(default)]
    prompt: String,
    #[serde(default)]
    completion: String,
    #[serde(default)]
    input_cache_read: Option<String>,
}

#[cfg(test)]
#[path = "pricing.test.rs"]
mod tests;
