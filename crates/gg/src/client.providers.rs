//! The run's provider candidates: which one each model's requests name, when the run moves to
//! the next, and what counts as an unexpected cache miss.
//!
//! See "Moving to the next candidate" in `apps/docs/src/content/docs/gg/overview.md`. The
//! [roster](ProviderRoster) is run-wide, shared by every client the run's
//! [factory](super::DefaultClientFactory) builds, because a move is the whole run's: every later
//! request of every agent of that model names the candidate now in force. The
//! [cache trace](CacheTrace) is per client, because the prefix a reply is measured against is the
//! one the same agent's previous request sent.

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde_json::Value;
use test_cabinet_core::gg::GgProviderCandidate;

use crate::model::Message;

/// How many unexpected cache misses a provider may produce before the run leaves it, when the
/// run's [limits](test_cabinet_core::gg::GgRunLimits) write no `providerCacheMissLimit`.
pub const DEFAULT_PROVIDER_CACHE_MISS_LIMIT: u64 = 2;

/// How long after an agent's previous request a reply can still be an unexpected miss: the
/// shortest cache lifetime gg asks for, which every entry the previous request wrote outlives.
pub const CACHE_MISS_WINDOW: Duration = Duration::from_secs(5 * 60);

/// The smallest shared prefix a reply can miss, in tokens: above every provider's minimum
/// cacheable size, so a provider that was never going to cache the prefix is never blamed.
pub const MIN_MISSABLE_PREFIX: u64 = 4096;

/// A reply is a miss when its cached tokens fall below this fraction of the shared prefix, which
/// leaves room for a provider that caches in blocks.
const MISS_FRACTION_DIVISOR: u64 = 2;

/// Where one model stands on its candidate list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InForce {
    /// The candidate's position on the list, which a later move is made from.
    pub index: usize,
    /// The candidate every request of the model names.
    pub candidate: GgProviderCandidate,
    /// Whether a later candidate exists to move to.
    pub has_next: bool,
}

/// What a request that decided to leave its candidate found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Move {
    /// This request moved the run: `from` is the provider left, `to` the one taken.
    Moved {
        /// The provider left.
        from: String,
        /// The provider taken.
        to: String,
    },
    /// Another request of the run had already moved it off that candidate; this request just asks
    /// the candidate now in force, and nothing new is recorded.
    AlreadyMoved,
    /// The candidate is the model's last; there is nowhere to move.
    Last,
}

/// The run's record of which candidate each model is on and the misses held against it.
#[derive(Debug, Clone)]
pub struct ProviderRoster {
    inner: Arc<Mutex<BTreeMap<String, ModelRoster>>>,
    /// How many unexpected misses the candidate in force may produce before the run leaves it.
    miss_limit: u64,
}

impl Default for ProviderRoster {
    fn default() -> Self {
        Self::new(BTreeMap::new())
    }
}

/// One model's candidates and where the run is among them.
#[derive(Debug, Clone)]
struct ModelRoster {
    candidates: Vec<GgProviderCandidate>,
    index: usize,
    /// Unexpected misses held against the candidate in force.
    misses: u64,
}

impl ProviderRoster {
    /// A roster holding each model's list from the launch, every model starting on its first
    /// candidate, under the [default miss limit](DEFAULT_PROVIDER_CACHE_MISS_LIMIT). A model with
    /// an empty list is left out, and its requests name no provider.
    pub fn new(model_providers: BTreeMap<String, Vec<GgProviderCandidate>>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(
                model_providers
                    .into_iter()
                    .filter(|(_, candidates)| !candidates.is_empty())
                    .map(|(model, candidates)| {
                        (
                            model,
                            ModelRoster {
                                candidates,
                                index: 0,
                                misses: 0,
                            },
                        )
                    })
                    .collect(),
            )),
            miss_limit: DEFAULT_PROVIDER_CACHE_MISS_LIMIT,
        }
    }

    /// This roster leaving a candidate after `miss_limit` unexpected misses: the run's resolved
    /// `providerCacheMissLimit`, run-wide like the roster itself.
    pub fn with_miss_limit(mut self, miss_limit: u64) -> Self {
        self.miss_limit = miss_limit;
        self
    }

    /// How many unexpected misses the candidate in force may produce before the run leaves it.
    pub fn miss_limit(&self) -> u64 {
        self.miss_limit
    }

    /// A roster pinning one model to one provider: the one-entry list a launch would carry.
    #[cfg(test)]
    pub fn pinned(model_id: &str, candidate: GgProviderCandidate) -> Self {
        Self::new(BTreeMap::from([(model_id.to_string(), vec![candidate])]))
    }

    /// The candidate `model_id`'s requests name now, or `None` for a model the launch gave no list.
    pub fn in_force(&self, model_id: &str) -> Option<InForce> {
        self.locked().get(model_id).map(|roster| InForce {
            index: roster.index,
            candidate: roster.candidates[roster.index].clone(),
            has_next: roster.index + 1 < roster.candidates.len(),
        })
    }

    /// Leave the candidate at `index` for the next one, if it is still the one in force.
    ///
    /// Compare-and-move, because two agents of one model can spend their schedules on one provider
    /// at once: the first moves the run, and the second finds it [already
    /// moved](Move::AlreadyMoved) rather than skipping a candidate nobody tried.
    pub fn leave(&self, model_id: &str, index: usize) -> Move {
        let mut rosters = self.locked();
        let Some(roster) = rosters.get_mut(model_id) else {
            return Move::Last;
        };
        if roster.index != index {
            return Move::AlreadyMoved;
        }
        let Some(to) = roster.candidates.get(index + 1) else {
            return Move::Last;
        };
        let to = to.provider.clone();
        let from = roster.candidates[index].provider.clone();
        roster.index = index + 1;
        roster.misses = 0;
        Move::Moved { from, to }
    }

    /// Hold one unexpected miss against the candidate at `index`, returning the misses now held
    /// against it, or `None` when the run has already left it.
    pub fn record_miss(&self, model_id: &str, index: usize) -> Option<u64> {
        let mut rosters = self.locked();
        let roster = rosters.get_mut(model_id)?;
        if roster.index != index {
            return None;
        }
        roster.misses += 1;
        Some(roster.misses)
    }

    fn locked(&self) -> MutexGuard<'_, BTreeMap<String, ModelRoster>> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Write the candidate onto a request body as OpenRouter's `provider` object: `only` names its
/// provider, `quantizations` its level, and fallbacks are refused.
pub fn stamp_candidate(body: &mut Value, candidate: &GgProviderCandidate) {
    body["provider"] = serde_json::json!({
        "only": [candidate.provider],
        "quantizations": [candidate.quantization],
        "allow_fallbacks": false,
    });
}

/// The one request of an agent a later reply's cache read is measured against.
#[derive(Debug, Clone)]
struct TracedRequest {
    provider: String,
    sent: tokio::time::Instant,
    shape: RequestShape,
    input_tokens: u64,
}

/// One piece of a request's prefix: a fingerprint to tell whether a later request repeats it, and
/// its size in bytes to apportion the request's input tokens by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Piece {
    fingerprint: u64,
    bytes: u64,
}

impl Piece {
    fn of(text: &str) -> Self {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        text.hash(&mut hasher);
        Self {
            fingerprint: hasher.finish(),
            bytes: text.len() as u64,
        }
    }
}

/// The shape of one request's prefix: the tools it offers, then its messages in order.
#[derive(Debug, Clone)]
pub struct RequestShape {
    tools: Piece,
    messages: Vec<Piece>,
}

impl RequestShape {
    /// Fingerprint the tools a body offers and the messages it sends. The messages are
    /// fingerprinted as gg holds them rather than as the wire carries them, since cache markers
    /// move between turns without changing the prefix.
    pub fn of(body: &Value, messages: &[Message]) -> Self {
        Self {
            tools: Piece::of(&body.get("tools").map(Value::to_string).unwrap_or_default()),
            messages: messages
                .iter()
                .map(|message| Piece::of(&serde_json::to_string(message).unwrap_or_default()))
                .collect(),
        }
    }

    fn bytes(&self) -> u64 {
        self.tools.bytes + self.messages.iter().map(|piece| piece.bytes).sum::<u64>()
    }

    /// How many of `earlier`'s bytes this request repeats unchanged from the start: nothing when
    /// the tools differ, else the tools and the messages up to the first that differs.
    fn repeated_bytes(&self, earlier: &RequestShape) -> u64 {
        if self.tools != earlier.tools {
            return 0;
        }
        self.tools.bytes
            + earlier
                .messages
                .iter()
                .zip(&self.messages)
                .take_while(|(then, now)| then == now)
                .map(|(then, _)| then.bytes)
                .sum::<u64>()
    }
}

/// One agent's previous request, which its next reply's cache read is measured against.
#[derive(Debug, Default)]
pub struct CacheTrace {
    previous: Mutex<Option<TracedRequest>>,
}

impl CacheTrace {
    /// Fold one served reply in and say whether it was an unexpected miss.
    ///
    /// The shared prefix is the part of the agent's previous request this request repeats
    /// unchanged: its tools and its leading messages, in tokens estimated from that request's
    /// input tokens in proportion to the bytes repeated. The reply is a miss when the previous
    /// request went to the same provider less than [`CACHE_MISS_WINDOW`] before this one, the
    /// shared prefix is at least [`MIN_MISSABLE_PREFIX`] tokens, and the reply read under half of
    /// it from the cache. A reply that does not report its cached tokens is never a miss:
    /// unreported is not zero. Either way the request becomes the one the next reply is measured
    /// against.
    pub fn observe(
        &self,
        provider: &str,
        sent: tokio::time::Instant,
        shape: RequestShape,
        cached_tokens: Option<u64>,
        input_tokens: u64,
    ) -> bool {
        let mut previous = self.previous.lock().unwrap_or_else(PoisonError::into_inner);
        let miss = match (previous.as_ref(), cached_tokens) {
            (Some(prior), Some(cached)) => {
                let recent = test_cabinet_core::pricing::same_provider(&prior.provider, provider)
                    && sent.saturating_duration_since(prior.sent) < CACHE_MISS_WINDOW;
                let total = prior.shape.bytes();
                let shared = if recent && total > 0 {
                    // u128 so a long prefix times a large token count cannot overflow.
                    (u128::from(prior.input_tokens)
                        * u128::from(shape.repeated_bytes(&prior.shape))
                        / u128::from(total)) as u64
                } else {
                    0
                };
                shared >= MIN_MISSABLE_PREFIX && cached < shared / MISS_FRACTION_DIVISOR
            }
            _ => false,
        };
        *previous = Some(TracedRequest {
            provider: provider.to_string(),
            sent,
            shape,
            input_tokens,
        });
        miss
    }
}

#[cfg(test)]
#[path = "client.providers.test.rs"]
mod tests;
