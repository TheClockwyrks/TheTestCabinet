//! The gg **model client** — the multi-provider, slot-bound interface the
//! [agent loop](crate::agent) calls to run a model turn.
//!
//! Model selection in gg is [slot-bound](test_cabinet_core::gg::GgSlotBinding):
//! the loop asks for a completion "on the `primary` slot" (later: `reviewer`,
//! `subagent`, …), and the client resolves that slot's
//! [binding](test_cabinet_core::gg::GgCapabilitySet::model_for_slot) to a concrete
//! provider/model. Phase 0 routes everything through OpenRouter, reading
//! `OPENROUTER_API_KEY` from the environment; the design allows cross-provider
//! bindings, so this seam is where provider resolution and per-slot usage/cost
//! accounting live.
//!
//! # Phase 0 status — STUB
//!
//! This module is a placeholder so the layout and the intended shape are visible;
//! it holds no behavior yet.
//!
//! TODO(gg-integration): implement the async OpenRouter client (chat completions
//! with tool calling, streaming, and retry/backoff — note the known third-party
//! failure mode where a single provider error discards a whole run), returning the
//! assistant message, any tool calls, and the token usage the loop accounts per
//! slot.

// The type below is scaffolding for the integration workflow and is intentionally
// unused in the Phase 0 skeleton.
#![allow(dead_code)]

use test_cabinet_core::gg::GgSlotBinding;

/// A model client that resolves a [slot binding](GgSlotBinding) to a concrete
/// provider/model and runs turns against it.
///
/// A placeholder in Phase 0 — the fields and methods (the OpenRouter endpoint, the
/// `reqwest` client, the API key, per-slot accounting) arrive with the real
/// implementation.
pub struct ModelClient {
    /// The slot binding this client serves.
    binding: GgSlotBinding,
}

impl ModelClient {
    /// Bind a client to `binding`. Phase 0 stub: records the binding and nothing
    /// more.
    pub fn new(binding: GgSlotBinding) -> Self {
        Self { binding }
    }
}
