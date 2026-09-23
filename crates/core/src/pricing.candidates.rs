//! The provider candidate list a gg run of one model may use, built from the model's
//! endpoints listing.
//!
//! See the candidate list in `apps/docs/src/content/docs/gg/overview.md`. The backend builds a
//! list per bound model at enqueue and pushes it onto the launch as
//! [`GgInvocation::model_providers`](crate::gg::GgInvocation::model_providers); gg sends every
//! request to the one candidate in force and moves down the list on the faults it sees.

use std::collections::BTreeMap;

use super::{provider_key, same_provider};

/// The quantization levels OpenRouter declares, best first, each with its rank. Levels of one
/// width share a rank, so a model served at `bf16` by one provider and `fp16` by another is served
/// at its native level by both. `unknown` is not a level.
const QUANTIZATION_RANK: &[(&str, usize)] = &[
    ("fp32", 0),
    ("bf16", 1),
    ("fp16", 1),
    ("fp8", 2),
    ("int8", 2),
    ("fp6", 3),
    ("fp4", 4),
    ("int4", 4),
];

/// The quantization OpenRouter reports for an endpoint that does not say what it serves.
pub const QUANTIZATION_UNKNOWN: &str = "unknown";

/// One endpoint of a model as the endpoints listing declares it: what the candidate filter reads.
///
/// Prices are USD per token, the unit OpenRouter reports them in. A price that is absent or does
/// not parse is `None`.
#[derive(Debug, Clone, PartialEq)]
pub struct EndpointOffer {
    /// The provider, as the listing spells its `provider_name`.
    pub provider: String,
    /// The quantization the endpoint declares, lowercased; [`QUANTIZATION_UNKNOWN`] when it
    /// declares none.
    pub quantization: String,
    /// The input price, USD per token.
    pub input: Option<f64>,
    /// The output price, USD per token.
    pub output: Option<f64>,
    /// The cache-read price, USD per token. `None` when the endpoint publishes none.
    pub cache_read: Option<f64>,
    /// The request parameters the endpoint supports (`tools`, `tool_choice`, `reasoning`, …).
    pub supported_parameters: Vec<String>,
}

/// The rank of a declared quantization, lower being better, or `None` for `unknown`, a blank, or
/// a level this table does not name.
pub fn quantization_rank(level: &str) -> Option<usize> {
    let level = level.trim().to_ascii_lowercase();
    QUANTIZATION_RANK
        .iter()
        .find(|(known, _)| *known == level)
        .map(|(_, rank)| *rank)
}

/// The best level any of `offers` declares, or `None` when none declares a known level.
pub fn native_quantization(offers: &[EndpointOffer]) -> Option<String> {
    offers
        .iter()
        .filter_map(|offer| quantization_rank(&offer.quantization).map(|rank| (rank, offer)))
        .min_by_key(|(rank, _)| *rank)
        .map(|(_, offer)| offer.quantization.trim().to_ascii_lowercase())
}

/// The catalog entry's say over one model's candidate list. Every field is optional: a model with
/// no catalog entry takes every figure from the listing.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CandidatePolicy {
    /// The native level set by hand, winning over the one the listing implies.
    pub native_quantization: Option<String>,
    /// The input-price ceiling, USD per token, used when the listing has no developer endpoint.
    pub max_input: Option<f64>,
    /// The output-price ceiling, USD per token, used when the listing has no developer endpoint.
    pub max_output: Option<f64>,
    /// The providers a run of the model never uses.
    pub banned: Vec<String>,
    /// The providers kept despite declaring `unknown` quantization.
    pub unknown_quantization: Vec<String>,
}

/// One provider the filter kept, with the figures the order and the console read.
#[derive(Debug, Clone, PartialEq)]
pub struct ProviderCandidate {
    /// The provider, as the listing spells its `provider_name`.
    pub provider: String,
    /// The quantization its endpoint declares.
    pub quantization: String,
    /// Whether this is the model developer's own endpoint.
    pub developer: bool,
    /// The input price, USD per token.
    pub input: f64,
    /// The output price, USD per token.
    pub output: f64,
    /// The cache-read price, USD per token.
    pub cache_read: f64,
    /// The provider's recorded fault rate for the model, when any recorded run used it.
    pub fault_rate: Option<f64>,
}

impl ProviderCandidate {
    /// The candidate as the launch carries it.
    pub fn to_invocation(&self) -> crate::gg::GgProviderCandidate {
        crate::gg::GgProviderCandidate::new(&self.provider, &self.quantization)
    }
}

/// A model's candidate list with the native level it was filtered to.
#[derive(Debug, Clone, PartialEq)]
pub struct CandidateList {
    /// The native level the quantization filter kept.
    pub native_quantization: String,
    /// The candidates, in the order a run tries them. Never empty.
    pub candidates: Vec<ProviderCandidate>,
}

/// Why a model has no candidate: the filter that emptied the list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CandidateRefusal {
    /// The listing names no endpoint for the model.
    NoEndpoints,
    /// No endpoint declares a known level, and the catalog entry sets none.
    NoNativeLevel,
    /// The listing has no priced developer endpoint, and the catalog entry sets no ceiling.
    NoPriceCeiling,
    /// No endpoint serves the model at its native level.
    NoneAtNativeLevel {
        /// The native level.
        native: String,
    },
    /// Every endpoint at the native level is priced above the ceiling.
    NoneWithinCeiling,
    /// No endpoint left publishes a cache-read price.
    NoneCaching,
    /// No endpoint left supports every parameter the run sends.
    NoneSupporting {
        /// The parameters the run sends.
        parameters: Vec<&'static str>,
    },
    /// Every endpoint left is on the catalog entry's ban list.
    AllBanned,
}

impl std::fmt::Display for CandidateRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoEndpoints => write!(f, "OpenRouter lists no endpoint for it"),
            Self::NoNativeLevel => write!(
                f,
                "no endpoint declares a quantization level, and its catalog entry sets no native \
                 quantization"
            ),
            Self::NoPriceCeiling => write!(
                f,
                "OpenRouter lists no priced endpoint from its developer, and its catalog entry \
                 sets no price ceiling"
            ),
            Self::NoneAtNativeLevel { native } => write!(
                f,
                "no endpoint serves it at its native quantization `{native}` (an `unknown` \
                 endpoint counts only when its catalog entry names the provider)"
            ),
            Self::NoneWithinCeiling => write!(
                f,
                "every endpoint at its native quantization is priced above the ceiling"
            ),
            Self::NoneCaching => write!(
                f,
                "no endpoint at its native quantization within the ceiling publishes a \
                 cache-read price"
            ),
            Self::NoneSupporting { parameters } => write!(
                f,
                "no endpoint left supports every parameter the run sends ({})",
                parameters.join(", ")
            ),
            Self::AllBanned => write!(f, "every endpoint left is on its catalog entry's ban list"),
        }
    }
}

/// The request parameters a gg run of one model sends, in the listing's vocabulary. Every gg
/// request offers tools and names a `tool_choice`; `reasoning` rides only when an agent bound to
/// the model sets a reasoning setting.
pub fn run_parameters(reasoning: bool) -> Vec<&'static str> {
    let mut parameters = vec!["tools", "tool_choice"];
    if reasoning {
        parameters.push("reasoning");
    }
    parameters
}

/// Build one model's ordered candidate list, or the filter that emptied it.
///
/// `developer` is the provider name of the model developer's endpoint: the catalog entry's
/// hand-set one, or the [official provider](super::official_provider) the listing names.
/// `faults` is each provider's recorded fault rate for the model, keyed by
/// [provider key](provider_key).
///
/// The filters run in the order the documentation lists them, so a refusal names the first
/// filter that left nothing. A provider with several passing endpoints is one candidate at its
/// cheapest. The developer's endpoint comes first when it passes; the rest follow by fault rate,
/// then input price, output price and name.
pub fn provider_candidates(
    developer: Option<&str>,
    offers: &[EndpointOffer],
    policy: &CandidatePolicy,
    parameters: &[&'static str],
    faults: &BTreeMap<String, f64>,
) -> Result<CandidateList, CandidateRefusal> {
    if offers.is_empty() {
        return Err(CandidateRefusal::NoEndpoints);
    }
    let native = policy
        .native_quantization
        .as_deref()
        .map(|level| level.trim().to_ascii_lowercase())
        .filter(|level| !level.is_empty())
        .or_else(|| native_quantization(offers))
        .ok_or(CandidateRefusal::NoNativeLevel)?;
    let is_developer =
        |offer: &EndpointOffer| developer.is_some_and(|dev| same_provider(&offer.provider, dev));
    // The developer's own rates are the ceiling whenever the listing prices its endpoint, at any
    // level; the catalog's ceiling stands in only when it does not.
    let developer_rates = offers
        .iter()
        .filter(|offer| is_developer(offer))
        .find_map(|offer| offer.input.zip(offer.output));
    let (max_input, max_output) = developer_rates
        .or(policy.max_input.zip(policy.max_output))
        .ok_or(CandidateRefusal::NoPriceCeiling)?;

    let native_rank = quantization_rank(&native);
    let at_native: Vec<&EndpointOffer> = offers
        .iter()
        .filter(|offer| {
            let level = offer.quantization.trim();
            (native_rank.is_some() && quantization_rank(level) == native_rank)
                || level.eq_ignore_ascii_case(&native)
                || (level.eq_ignore_ascii_case(QUANTIZATION_UNKNOWN)
                    && policy
                        .unknown_quantization
                        .iter()
                        .any(|allowed| same_provider(allowed, &offer.provider)))
        })
        .collect();
    if at_native.is_empty() {
        return Err(CandidateRefusal::NoneAtNativeLevel { native });
    }
    let within: Vec<&EndpointOffer> = at_native
        .into_iter()
        .filter(|offer| {
            offer.input.is_some_and(|price| price <= max_input)
                && offer.output.is_some_and(|price| price <= max_output)
        })
        .collect();
    if within.is_empty() {
        return Err(CandidateRefusal::NoneWithinCeiling);
    }
    let caching: Vec<&EndpointOffer> = within
        .into_iter()
        .filter(|offer| offer.cache_read.is_some())
        .collect();
    if caching.is_empty() {
        return Err(CandidateRefusal::NoneCaching);
    }
    let supporting: Vec<&EndpointOffer> = caching
        .into_iter()
        .filter(|offer| {
            parameters.iter().all(|parameter| {
                offer
                    .supported_parameters
                    .iter()
                    .any(|supported| supported.trim().eq_ignore_ascii_case(parameter))
            })
        })
        .collect();
    if supporting.is_empty() {
        return Err(CandidateRefusal::NoneSupporting {
            parameters: parameters.to_vec(),
        });
    }
    let allowed: Vec<&EndpointOffer> = supporting
        .into_iter()
        .filter(|offer| {
            !policy
                .banned
                .iter()
                .any(|banned| same_provider(banned, &offer.provider))
        })
        .collect();
    if allowed.is_empty() {
        return Err(CandidateRefusal::AllBanned);
    }

    // One candidate per provider, at its cheapest passing endpoint: a request names a provider
    // and a level, not an endpoint.
    let mut by_provider: BTreeMap<String, ProviderCandidate> = BTreeMap::new();
    for offer in allowed {
        let candidate = ProviderCandidate {
            provider: offer.provider.trim().to_string(),
            quantization: offer.quantization.trim().to_ascii_lowercase(),
            developer: is_developer(offer),
            // Every price below was checked present by the filters above.
            input: offer.input.unwrap_or_default(),
            output: offer.output.unwrap_or_default(),
            cache_read: offer.cache_read.unwrap_or_default(),
            fault_rate: faults.get(&provider_key(&offer.provider)).copied(),
        };
        by_provider
            .entry(provider_key(&candidate.provider))
            .and_modify(|kept| {
                if price_order(&candidate, kept).is_lt() {
                    *kept = candidate.clone();
                }
            })
            .or_insert(candidate);
    }
    let mut candidates: Vec<ProviderCandidate> = by_provider.into_values().collect();
    candidates.sort_by(|left, right| {
        right
            .developer
            .cmp(&left.developer)
            .then_with(|| {
                left.fault_rate
                    .unwrap_or(0.0)
                    .total_cmp(&right.fault_rate.unwrap_or(0.0))
            })
            .then_with(|| price_order(left, right))
    });
    Ok(CandidateList {
        native_quantization: native,
        candidates,
    })
}

/// Cheaper first: input price, then output price, then name, so the order is total.
fn price_order(left: &ProviderCandidate, right: &ProviderCandidate) -> std::cmp::Ordering {
    left.input
        .total_cmp(&right.input)
        .then_with(|| left.output.total_cmp(&right.output))
        .then_with(|| left.provider.cmp(&right.provider))
}

#[cfg(test)]
#[path = "pricing.candidates.test.rs"]
mod tests;
