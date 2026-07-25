//! **Vision support**: which of a run's models may be shown an image, and how gg
//! recovers when one turns out not to be.
//!
//! A test case's specs ship reference mockups, so `read_file` on a `.png` has to mean
//! something. But the models a study sweeps are not uniform: some accept image input
//! and some are text-only, and a text-only model answers an image-bearing request with
//! a hard error that would otherwise discard the whole run. Reading a reference image
//! must never be what kills a run.
//!
//! Two mechanisms, in that order:
//!
//! 1. **Declared, up front.** The model catalog records the input modalities OpenRouter
//!    reports per model, and the launch pushes them into the invocation as
//!    [`model_modalities`](test_cabinet_core::gg::GgInvocation::model_modalities). A
//!    model declared without `image` is simply never sent one — `read_file` describes
//!    the file instead of attaching it, and no request is wasted.
//! 2. **Learned, at runtime.** A model the catalog has no modality list for is treated
//!    **optimistically** — unknown is not the same as text-only, and refusing to show a
//!    picture to an unannotated model would be the wrong default for a harness whose
//!    whole point is running new models. If the provider then refuses the request
//!    ([`ModelError::VisionUnsupported`](crate::model::ModelError::VisionUnsupported)),
//!    the loop [denies](VisionSupport::deny) the model here, strips the images from the
//!    context, and re-runs the turn. The denial is **per model id**, not per agent, so
//!    every other agent and subagent bound to that same model stops attaching images
//!    too — one wasted request per model per run, not one per agent.
//!
//! The registry is shared (`Arc`) by the orchestrator across every agent in the run,
//! which is what makes point 2's "any agent using the same model" scope real.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex};

use test_cabinet_core::MODALITY_IMAGE;

/// What a run knows about its models' image support: the modalities the catalog
/// declared at launch, plus the models a live request has since proved cannot take an
/// image.
///
/// Cheap to consult (a map lookup and an uncontended lock) because every `read_file`
/// of a binary file asks.
#[derive(Debug, Default)]
pub struct VisionSupport {
    /// The catalog's input modalities per model id, as pushed in with the invocation.
    /// A model absent here is **unknown**, not text-only.
    declared: BTreeMap<String, Vec<String>>,
    /// Model ids a provider refused an image for. Guarded rather than atomic because
    /// the set is keyed by model id and written at most once per model per run.
    denied: Mutex<HashSet<String>>,
}

impl VisionSupport {
    /// A registry over the catalog's `declared` modalities, with nothing denied yet.
    pub fn new(declared: BTreeMap<String, Vec<String>>) -> Self {
        Self {
            declared,
            denied: Mutex::new(HashSet::new()),
        }
    }

    /// An empty registry: nothing declared, nothing denied — so every model is treated
    /// optimistically. The offline/test default, and what a run launched without
    /// catalog modalities gets.
    pub fn unknown() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Whether gg may attach an image to a request for `model_id`.
    ///
    /// `false` once the model has been [denied](Self::deny), or when the catalog
    /// declared modalities for it that do not include `image`. Otherwise `true` —
    /// including for a model the catalog says nothing about, which is the optimistic
    /// case the runtime fallback exists to cover.
    pub fn allows_images(&self, model_id: &str) -> bool {
        if self.is_denied(model_id) {
            return false;
        }
        match self.declared.get(model_id) {
            // Declared: believe it. An empty list is not a declaration (the catalog
            // stores no entry rather than an empty one), so this branch always has
            // something to say.
            Some(modalities) => modalities.iter().any(|m| m == MODALITY_IMAGE),
            // Undeclared: try it. A provider refusal is recoverable; refusing to show a
            // just-released vision model its reference mockups is not recoverable at all.
            None => true,
        }
    }

    /// Whether the catalog **positively declared** that `model_id` is text-only — it
    /// listed modalities and `image` was not among them.
    ///
    /// Distinct from `!allows_images`, which is also true for a model denied at
    /// runtime. Used only to word the explanation the agent is given.
    pub fn declared_text_only(&self, model_id: &str) -> bool {
        self.declared
            .get(model_id)
            .is_some_and(|modalities| !modalities.iter().any(|m| m == MODALITY_IMAGE))
    }

    /// Record that `model_id` refused an image, returning whether this was the
    /// **first** such record (so the loop logs the discovery once rather than on every
    /// agent that trips over it).
    pub fn deny(&self, model_id: &str) -> bool {
        let mut denied = match self.denied.lock() {
            Ok(denied) => denied,
            // A poisoned lock means another thread panicked mid-update; the set is a
            // plain `HashSet` with no invariant to corrupt, so recovering it is safe
            // and strictly better than panicking a second time and losing the run.
            Err(poisoned) => poisoned.into_inner(),
        };
        denied.insert(model_id.to_string())
    }

    /// Whether `model_id` has been denied at runtime.
    fn is_denied(&self, model_id: &str) -> bool {
        match self.denied.lock() {
            Ok(denied) => denied.contains(model_id),
            Err(poisoned) => poisoned.into_inner().contains(model_id),
        }
    }
}

#[cfg(test)]
#[path = "vision.test.rs"]
mod tests;
