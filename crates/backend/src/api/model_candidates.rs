//! A model's provider candidate list: the catalog half of building it, shared by the gg enqueue
//! and the `GET /models/{slug}/candidates` read the console shows on the model's page.
//!
//! The filter and the order are [`test_cabinet_core::pricing::provider_candidates`]; this module
//! supplies what it reads from the backend's own stores: the catalog entry's
//! [policy](CandidatePolicy) and hand-set developer provider, and each provider's recorded fault
//! rate across the stored gg runs of the model. See the candidate list in
//! `apps/docs/src/content/docs/gg/overview.md`.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use serde::Serialize;

use test_cabinet_core::pricing::{
    CandidateList, CandidatePolicy, CandidateRefusal, EndpointOffer, native_quantization,
    official_provider, provider_candidates, run_parameters,
};

use crate::auth::AuthUser;
use crate::db::StoredModel;
use crate::error::ApiError;
use crate::stats::{GgRunFacts, provider_fault_rates};

use super::AppState;

/// USD per token to USD per million tokens, the unit the catalog entry and the console use.
const PER_MTOK: f64 = 1_000_000.0;

/// The `GET /models/{slug}/candidates` response: the candidate list the next gg enqueue of the
/// model would build, for an agent that sets no reasoning.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ModelCandidatesOut {
    /// The OpenRouter id the endpoints listing was read under.
    pub model_id: String,
    /// The native quantization the filter kept: the catalog entry's, else the highest level any
    /// endpoint declares. Null when neither names one.
    pub native_quantization: Option<String>,
    /// The candidates, in the order a run tries them. Empty exactly when
    /// [`refusal`](Self::refusal) is set.
    pub candidates: Vec<CandidateOut>,
    /// Why the list is empty, naming the filter that emptied it, or null when it is not.
    pub refusal: Option<String>,
}

/// One candidate of a model's list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct CandidateOut {
    /// The provider, spelled as OpenRouter's endpoints listing spells its `provider_name`.
    pub provider: String,
    /// The quantization its endpoint declares.
    pub quantization: String,
    /// Whether this is the model developer's own endpoint.
    pub developer: bool,
    /// The input price, USD per million tokens.
    pub input_price: f64,
    /// The output price, USD per million tokens.
    pub output_price: f64,
    /// The cache-read price, USD per million tokens.
    pub cache_read_price: f64,
    /// The provider's recorded fault rate for the model: stalls, unexpected cache misses and
    /// turns that ended on its failed model calls, over its calls. Null when no recorded run of
    /// the model used the provider, which the order reads as zero.
    pub fault_rate: Option<f64>,
}

/// What the catalog says about one model's candidate list: the hand-set developer provider, the
/// [policy](CandidatePolicy), and every id the model's runs are recorded under.
#[derive(Debug, Clone, Default)]
pub(crate) struct CatalogCandidates {
    /// The developer provider set by hand, or `None` to take the
    /// [official provider](official_provider) the listing names.
    developer: Option<String>,
    /// The catalog entry's policy, prices per token. The default for an uncurated model.
    policy: CandidatePolicy,
    /// The model ids the fault rates are read over.
    recorded_ids: Vec<String>,
}

impl CatalogCandidates {
    /// The catalog's say for a model: `stored` is its curated entry, if it has one, and
    /// `model_ids` the ids its runs are recorded under beyond the entry's aliases.
    pub(crate) fn of(stored: Option<&StoredModel>, model_ids: &[&str]) -> Self {
        let mut recorded_ids: Vec<String> = Vec::new();
        let mut push = |id: &str| {
            let id = id.trim();
            if !id.is_empty() && !recorded_ids.iter().any(|known| known == id) {
                recorded_ids.push(id.to_string());
            }
        };
        for id in model_ids {
            push(id);
        }
        let Some(stored) = stored else {
            return Self {
                recorded_ids,
                ..Self::default()
            };
        };
        for alias in &stored.aliases {
            push(&alias.alias);
        }
        let config = &stored.config;
        Self {
            developer: config
                .provider_pin
                .as_deref()
                .map(str::trim)
                .filter(|provider| !provider.is_empty())
                .map(str::to_string),
            policy: CandidatePolicy {
                native_quantization: config
                    .native_quantization
                    .as_deref()
                    .map(str::trim)
                    .filter(|level| !level.is_empty())
                    .map(str::to_string),
                max_input: config.max_input_price.map(|price| price / PER_MTOK),
                max_output: config.max_output_price.map(|price| price / PER_MTOK),
                banned: crate::db::provider_list(config.banned_providers.as_deref()),
                unknown_quantization: crate::db::provider_list(
                    config.unknown_quantization_providers.as_deref(),
                ),
            },
            recorded_ids,
        }
    }

    /// Build the model's candidate list from its endpoints listing, `lookup` being the OpenRouter
    /// id it was read under. `reasoning` is whether an agent bound to the model sets a reasoning
    /// setting; `record` is the stored gg runs the fault rates are read from.
    pub(crate) fn build(
        &self,
        lookup: &str,
        offers: &[EndpointOffer],
        reasoning: bool,
        record: &[Arc<GgRunFacts>],
    ) -> Result<CandidateList, CandidateRefusal> {
        let developer = self.developer.clone().or_else(|| {
            official_provider(lookup, offers.iter().map(|offer| offer.provider.as_str()))
        });
        let ids: Vec<&str> = self.recorded_ids.iter().map(String::as_str).collect();
        let faults: BTreeMap<String, f64> = provider_fault_rates(record, &ids);
        provider_candidates(
            developer.as_deref(),
            offers,
            &self.policy,
            &run_parameters(reasoning),
            &faults,
        )
    }

    /// The native level the filter would use: the catalog entry's, else the listing's.
    fn native_level(&self, offers: &[EndpointOffer]) -> Option<String> {
        self.policy
            .native_quantization
            .clone()
            .or_else(|| native_quantization(offers))
    }
}

/// `GET /models/{slug}/candidates` — the candidate list the next gg enqueue of the model would
/// build, from the endpoints listing read now, for an agent that sets no reasoning. Requires a
/// bearer token, because it reaches OpenRouter on the caller's behalf.
///
/// A model OpenRouter does not list is a `404`, as it is for the provider enumeration; a listed
/// model with no candidate answers with the [refusal](ModelCandidatesOut::refusal).
#[tracing::instrument(name = "models.candidates", skip(state, _user), fields(model.slug = %slug), err(Debug))]
pub async fn candidates(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    _user: AuthUser,
) -> Result<Json<ModelCandidatesOut>, ApiError> {
    let lookup = super::model_probes::resolve_openrouter_slug(&state, &slug).await?;
    let stored = state
        .db
        .get_model_config(&slug)
        .await
        .map_err(ApiError::from)?;
    let catalog = CatalogCandidates::of(stored.as_ref(), &[&lookup, &slug]);
    let offers = state.prices.endpoint_offers(&lookup).await.map_err(|err| {
        ApiError::not_found(format!("looking up `{lookup}` on OpenRouter: {err}"))
    })?;
    let record = super::stats::recorded_run_facts(&state).await;
    let native = catalog.native_level(&offers);
    let built = catalog.build(&lookup, &offers, false, &record);
    Ok(Json(candidates_out(lookup, native, built)))
}

/// The wire shape of a built list, prices converted to USD per million tokens.
///
/// `native` is the level reported beside a refusal; a built list reports the level it kept.
fn candidates_out(
    model_id: String,
    native: Option<String>,
    built: Result<CandidateList, CandidateRefusal>,
) -> ModelCandidatesOut {
    match built {
        Ok(list) => ModelCandidatesOut {
            model_id,
            native_quantization: Some(list.native_quantization),
            candidates: list
                .candidates
                .into_iter()
                .map(|candidate| CandidateOut {
                    provider: candidate.provider,
                    quantization: candidate.quantization,
                    developer: candidate.developer,
                    input_price: candidate.input * PER_MTOK,
                    output_price: candidate.output * PER_MTOK,
                    cache_read_price: candidate.cache_read * PER_MTOK,
                    fault_rate: candidate.fault_rate,
                })
                .collect(),
            refusal: None,
        },
        Err(refusal) => ModelCandidatesOut {
            model_id,
            native_quantization: native,
            candidates: Vec::new(),
            refusal: Some(refusal.to_string()),
        },
    }
}

#[cfg(test)]
#[path = "model_candidates.test.rs"]
mod tests;
