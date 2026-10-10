//! OpenRouter lookups: a model's list price and its catalog facts.
//!
//! See `docs/metrics.md`. A run's comparable cost is priced at the model's
//! **list price**, held on the model's catalog entry and computed over the run's
//! token classes. This module is where a list price sourced from OpenRouter is
//! resolved ([`ModelLaunchFacts::list_price`]): the standard endpoint of the
//! provider the catalog entry names, else of the model's own developer (see
//! [`official_provider`]), else the model's own price in OpenRouter's models
//! listing (the `pricing` field of its `/models` entry). A Flex endpoint is never
//! read. The module also reads the catalog facts
//! the backend observes about a model: its context window, release date, input
//! modalities and developer provider.

use std::collections::HashMap;
use std::time::Duration;

use serde::Deserialize;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::{Error, Result};
use crate::metrics::TokenPrices;

// The provider-spelling comparison is part of the contract: gg and the run record
// agree on it, so it lives in `test-cabinet-contracts` and is re-exported here.
pub use test_cabinet_contracts::pricing::{provider_key, same_provider};

/// The OpenRouter models endpoint listing every model and its pricing.
const MODELS_URL: &str = "https://openrouter.ai/api/v1/models";

/// How long one read of OpenRouter may take, from connecting to the end of the
/// response body, before it fails. A read that stalls is a read that failed, so a
/// caller that reads many models (the refresh of every list price, the periodic
/// catalog-fact observation) is never held by one connection that stopped answering.
pub const READ_TIMEOUT: Duration = Duration::from_secs(15);

/// The catalog facts OpenRouter's models listing reports for a model, which the
/// static site surfaces: the context window, the model's release date, and the
/// input modalities it accepts. Each is optional because OpenRouter does not always
/// report it. The listing's price for the model is not carried here: it is read
/// through [`ModelsListingPrices`], as the last step of
/// [`ModelLaunchFacts::list_price`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModelDetails {
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
    /// Each provider's standard rate, keyed by the provider as the listing spells it:
    /// the first standard endpoint per provider that publishes a complete rate, in
    /// listing order, Flex endpoints left out. Read through
    /// [`list_price`](Self::list_price).
    pub route_rates: Vec<(String, ListRate)>,
}

/// A complete per-token rate in USD: all three token classes known.
///
/// What a catalog entry's list price holds, as opposed to [`TokenPrices`], whose
/// classes are each optional.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ListRate {
    /// USD per token of uncached input.
    pub uncached_input: f64,
    /// USD per token of cached input.
    pub cached_input: f64,
    /// USD per token of output.
    pub output: f64,
}

impl ListRate {
    /// The rate when `prices` knows all three classes, else `None`.
    pub fn complete(prices: TokenPrices) -> Option<Self> {
        Some(Self {
            uncached_input: prices.uncached_input?,
            cached_input: prices.cached_input?,
            output: prices.output?,
        })
    }

    /// The rate as the [`TokenPrices`] a run's cost is computed from.
    pub fn token_prices(self) -> TokenPrices {
        TokenPrices {
            uncached_input: Some(self.uncached_input),
            cached_input: Some(self.cached_input),
            output: Some(self.output),
        }
    }
}

/// Which step of the [list-price flow](ModelLaunchFacts::list_price) answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListPriceStep {
    /// The standard endpoint of the provider set by hand on the catalog entry.
    HandSetProvider,
    /// The standard endpoint of the provider the model id's author segment names.
    AuthorProvider,
    /// The model's own price in OpenRouter's models listing (the `pricing` field of
    /// its `/models` entry).
    ListingPrice,
}

impl ListPriceStep {
    /// A short name for logs.
    pub fn as_str(self) -> &'static str {
        match self {
            ListPriceStep::HandSetProvider => "hand-set-provider",
            ListPriceStep::AuthorProvider => "author-provider",
            ListPriceStep::ListingPrice => "model-listing",
        }
    }
}

/// A list price resolved from OpenRouter by the
/// [list-price flow](ModelLaunchFacts::list_price).
#[derive(Debug, Clone, PartialEq)]
pub struct ListPriceResolution {
    /// The rate.
    pub rate: ListRate,
    /// The step that answered.
    pub step: ListPriceStep,
    /// The provider whose standard endpoint the rate was read from, as the endpoints
    /// listing spells it. `None` for a rate read from the models listing
    /// ([`ListPriceStep::ListingPrice`]), which names no provider.
    pub provider: Option<String>,
}

/// The descriptive facts OpenRouter publishes about one model — the display name,
/// the provider behind it, and the prose blurb — as the model form's
/// auto-populate reads them.
///
/// These are the *curated* fields of a catalog entry, the ones an operator would
/// otherwise retype by hand. They are deliberately separate from
/// [`ModelDetails`] (machine facts, recorded automatically) because
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

    /// The model's list price as OpenRouter publishes it: the first of these that
    /// yields a complete rate (input, cached input and output all known).
    ///
    /// 1. The standard endpoint of `hand_pin`, the developer provider set by hand on
    ///    the model's catalog entry, when one is set. It is matched as
    ///    [`same_provider`] matches.
    /// 2. The standard endpoint of the provider the model id's author segment names
    ///    (`anthropic` for `anthropic/claude-haiku-5.5`), which is the observed
    ///    [`provider_pin`](Self::provider_pin).
    /// 3. `listing_price`: the model's own price in OpenRouter's models listing (the
    ///    `pricing` field of its `/models` entry), as [`ModelsListingPrices`] reads
    ///    it. It is the figure OpenRouter's API reports for the model, a third
    ///    party's rate, and names no provider.
    ///
    /// A hand-set provider that lists no standard endpoint with a complete rate falls
    /// to the second step, and so on. A Flex endpoint is read at no step, and neither
    /// is the endpoint of a provider that neither `hand_pin` nor the model id names,
    /// wherever the endpoints listing places it. `None` when no step yields a rate:
    /// OpenRouter publishes no list price for the model.
    ///
    /// This is the one resolution every writer of a list price sourced from
    /// OpenRouter uses: the fill at enqueue, the refresh of every entry, and the
    /// model form's fill. Each reaches it through
    /// [`OpenRouterPrices::list_price`] or
    /// [`OpenRouterPrices::list_price_sharing`], which read the models listing only
    /// when [the first two steps](Self::provider_list_price) yield nothing.
    pub fn list_price(
        &self,
        hand_pin: Option<&str>,
        listing_price: Option<TokenPrices>,
    ) -> Option<ListPriceResolution> {
        self.provider_list_price(hand_pin).or_else(|| {
            listing_price
                .and_then(ListRate::complete)
                .map(|rate| ListPriceResolution {
                    rate,
                    step: ListPriceStep::ListingPrice,
                    provider: None,
                })
        })
    }

    /// The first two steps of the [list-price flow](Self::list_price), which the
    /// model's endpoints listing answers alone: the standard rate of `hand_pin`, else
    /// of the provider the model id's author segment names. `None` when neither
    /// yields a complete rate, which is when the flow needs the models listing.
    pub fn provider_list_price(&self, hand_pin: Option<&str>) -> Option<ListPriceResolution> {
        let of_provider = |provider: &str, step: ListPriceStep| {
            self.route_rates
                .iter()
                .find(|(name, _)| same_provider(name, provider))
                .map(|(name, rate)| ListPriceResolution {
                    rate: *rate,
                    step,
                    provider: Some(name.clone()),
                })
        };
        hand_pin
            .and_then(|pin| of_provider(pin, ListPriceStep::HandSetProvider))
            .or_else(|| {
                self.provider_pin
                    .as_deref()
                    .and_then(|pin| of_provider(pin, ListPriceStep::AuthorProvider))
            })
    }
}

/// One read of the model-level prices in OpenRouter's models listing (the `pricing`
/// field of each `/models` entry), made the first time a price is asked for and
/// answered from memory after that.
///
/// The listing is large (most of a megabyte), so a caller resolving many list prices
/// shares one of these across them through
/// [`OpenRouterPrices::list_price_sharing`]: the listing is read at most once however
/// many models reach the [flow](ModelLaunchFacts::list_price)'s last step, at once or
/// in turn, and is not read at all when none does. A read that failed is kept as the
/// failure, so it is not tried again.
#[derive(Debug, Default)]
pub struct ModelsListingPrices {
    read: tokio::sync::OnceCell<std::result::Result<HashMap<String, TokenPrices>, String>>,
}

impl ModelsListingPrices {
    /// A listing not yet read.
    pub fn new() -> Self {
        Self::default()
    }

    /// The price the models listing publishes for `model_id`, matched exactly, reading
    /// the listing from `prices` if this is the first ask. `Ok(None)` for a model the
    /// listing has no entry for; `Err` when the listing could not be read, now or on
    /// the earlier ask that tried.
    pub async fn price_of(
        &self,
        prices: &OpenRouterPrices,
        model_id: &str,
    ) -> Result<Option<TokenPrices>> {
        let read = self
            .read
            .get_or_init(|| async {
                prices
                    .fetch_catalog()
                    .await
                    .map(|models| {
                        models
                            .into_iter()
                            .filter_map(|model| {
                                let price = token_prices_of(model.pricing.as_ref()?);
                                Some((model.id, price))
                            })
                            .collect()
                    })
                    .map_err(|err| err.to_string())
            })
            .await;
        match read {
            Ok(listed) => Ok(listed.get(model_id).copied()),
            Err(why) => Err(Error::Validation(format!(
                "OpenRouter's models listing could not be read: {why}"
            ))),
        }
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
///
/// Every read is bounded by a timeout ([`READ_TIMEOUT`] unless
/// [`with_read_timeout`](Self::with_read_timeout) sets another): a read that has not
/// finished by then is an `Err`, like any other read that failed.
#[derive(Debug, Clone)]
pub struct OpenRouterPrices {
    endpoint: String,
    client: reqwest::Client,
    read_timeout: Duration,
}

impl Default for OpenRouterPrices {
    fn default() -> Self {
        Self::with_endpoint(MODELS_URL)
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
            client: reqwest::Client::new(),
            read_timeout: READ_TIMEOUT,
        }
    }

    /// Bound every read by `read_timeout` instead of [`READ_TIMEOUT`].
    ///
    /// A test seam: it lets a test of a stalled OpenRouter finish in milliseconds.
    pub fn with_read_timeout(mut self, read_timeout: Duration) -> Self {
        self.read_timeout = read_timeout;
        self
    }

    /// Start a `GET` of `url`, bounded by the read timeout from connecting to the end
    /// of the response body.
    fn get(&self, url: &str) -> reqwest::RequestBuilder {
        self.client.get(url).timeout(self.read_timeout)
    }

    /// Look up **one** model's list price by the
    /// [list-price flow](ModelLaunchFacts::list_price). `hand_pin` is the developer
    /// provider set by hand on the model's catalog entry, if any.
    ///
    /// The model's endpoints listing is read once. The models listing is read only
    /// when the flow's first two steps yield nothing. A caller resolving several
    /// models uses [`list_price_sharing`](Self::list_price_sharing), so the models
    /// listing is read once between them.
    ///
    /// `Ok(None)` for a model OpenRouter lists without a complete rate; an unlisted
    /// model, or a listing the flow needed and could not read, is an `Err`.
    pub async fn list_price(
        &self,
        model_id: &str,
        hand_pin: Option<&str>,
    ) -> Result<Option<ListPriceResolution>> {
        self.list_price_sharing(model_id, hand_pin, &ModelsListingPrices::new())
            .await
    }

    /// [`list_price`](Self::list_price), taking the flow's last step from `listing`:
    /// the one read of the models listing the caller shares across every model it
    /// resolves. `listing` is read only when the first two steps yield nothing for
    /// this model, and at most once however many models share it.
    ///
    /// When the models listing cannot be read, a model that needed it is an `Err`
    /// and a model the first two steps answer still resolves.
    pub async fn list_price_sharing(
        &self,
        model_id: &str,
        hand_pin: Option<&str>,
        listing: &ModelsListingPrices,
    ) -> Result<Option<ListPriceResolution>> {
        let facts = self.model_launch_facts(model_id).await?;
        // The models listing is the last step's alone, so it is read only when the
        // endpoints listing answered neither of the first two.
        let listing_price = match facts.provider_list_price(hand_pin) {
            Some(_) => None,
            None => listing.price_of(self, model_id).await?,
        };
        Ok(facts.list_price(hand_pin, listing_price))
    }

    /// Look up the catalog facts the site surfaces (the context window, release date
    /// and input modalities) for `model_id`.
    ///
    /// The model ID is matched exactly against OpenRouter's catalog.
    pub async fn model_details(&self, model_id: &str) -> Result<ModelDetails> {
        Ok(details_of(self.fetch_model(model_id).await?))
    }

    /// Look up the catalog facts for **every** model OpenRouter lists, keyed by
    /// OpenRouter id, in one fetch.
    ///
    /// The periodic refresher reads the catalog facts of every known model from this
    /// single download, then each model's developer provider from its per-model
    /// [launch facts](Self::model_launch_facts).
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
    /// observation and reads the whole catalog — this hits OpenRouter's per-model
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
    /// (a few KB) shared by the launch-facts, listing, and list-price lookups. A read
    /// that outlasts the read timeout is an `Err`.
    async fn fetch_endpoints(&self, model_id: &str) -> Result<ModelEndpoints> {
        let url = format!("{}/{model_id}/endpoints", self.endpoint);
        let response = self.get(&url).send().await.map_err(|err| {
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

    /// Fetch OpenRouter's full model catalog. A read that outlasts the read timeout is
    /// an `Err`.
    async fn fetch_catalog(&self) -> Result<Vec<Model>> {
        let response =
            self.get(&self.endpoint).send().await.map_err(|err| {
                Error::Validation(format!("fetching the OpenRouter catalog: {err}"))
            })?;
        let catalog: ModelsResponse = response
            .json()
            .await
            .map_err(|err| Error::Validation(format!("parsing the OpenRouter catalog: {err}")))?;
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

/// Reduce one model's endpoints body to every named standard endpoint as the candidate filter
/// reads it, in listing order. A provider listing several endpoints appears once per endpoint,
/// and a [Flex](ModelEndpoint::is_flex) endpoint is left out: it is never a candidate and
/// never sets the price ceiling.
fn offers_of(data: &ModelEndpoints) -> Vec<EndpointOffer> {
    data.endpoints
        .iter()
        .filter(|endpoint| !endpoint.is_flex())
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
/// each provider's standard rate.
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
        route_rates: route_rates_of(&data.endpoints),
    }
}

/// Map one catalog entry onto the [`ModelDetails`] the catalog stores.
fn details_of(model: Model) -> ModelDetails {
    ModelDetails {
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

/// Each provider's standard rate, in listing order, keeping the first standard endpoint
/// with a complete rate of a provider that lists several (quantizations, say). A
/// [Flex](ModelEndpoint::is_flex) endpoint is skipped, so a provider that lists its
/// discounted Flex tier ahead of its standard endpoint is priced at the standard one,
/// and a provider that lists only Flex endpoints has no rate. So is an endpoint missing
/// any of the three rates, which is no list price.
fn route_rates_of(endpoints: &[ModelEndpoint]) -> Vec<(String, ListRate)> {
    let mut out: Vec<(String, ListRate)> = Vec::new();
    for endpoint in endpoints {
        if endpoint.is_flex() {
            continue;
        }
        let (Some(name), Some(pricing)) = (endpoint.provider_name.as_deref(), &endpoint.pricing)
        else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() || out.iter().any(|(seen, _)| seen == name) {
            continue;
        }
        let Some(rate) = ListRate::complete(token_prices_of(pricing)) else {
            continue;
        };
        out.push((name.to_string(), rate));
    }
    out
}

/// Map an OpenRouter pricing block onto [`TokenPrices`]: one endpoint's block or a
/// models-listing entry's model-level one, the same shape either way.
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

/// A single model entry with the catalog metadata the site surfaces. `created` is a
/// unix timestamp in seconds; `context_length` is the model's maximum context window
/// in tokens.
#[derive(Debug, Deserialize)]
struct Model {
    id: String,
    /// The model-level price OpenRouter publishes for the model, which names no
    /// provider: the last step of the [list-price flow](ModelLaunchFacts::list_price).
    #[serde(default)]
    pricing: Option<Pricing>,
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
/// block, which a [list price](ModelLaunchFacts::list_price) is resolved from.
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
    /// The route's own per-token prices: what this provider publishes for the model.
    #[serde(default)]
    pricing: Option<Pricing>,
    #[serde(default)]
    supported_parameters: Vec<String>,
    /// The route tag: the provider's slug, then any region and service tier, separated by
    /// `/` (`openai`, `openai/flex`, `google-vertex/global/flex`). It is the only field that
    /// tells a provider's Flex endpoint from its standard one, since both carry the same
    /// `provider_name`.
    #[serde(default)]
    tag: Option<String>,
}

impl ModelEndpoint {
    /// Whether this is a provider's Flex endpoint: one whose [`tag`](Self::tag) has a
    /// segment equal to `flex`, in any ASCII case. Flex is a discounted, slower service
    /// tier a request has to ask for, so its rates are not the model's list price, and no
    /// price is read from it. An endpoint with no tag is a standard one.
    fn is_flex(&self) -> bool {
        self.tag.as_deref().is_some_and(|tag| {
            tag.split('/')
                .any(|segment| segment.trim().eq_ignore_ascii_case("flex"))
        })
    }
}

/// OpenRouter prices, reported as per-token USD strings: the shape of an endpoint's
/// pricing block and of a models-listing entry's alike.
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
