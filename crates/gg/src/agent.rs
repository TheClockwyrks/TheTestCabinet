//! The gg **agent turn loop**.
//!
//! This is gg's core — the one coarse-grained plug point of the design (all other
//! modularity comes from [which tools](crate::tools) are offered). The real loop
//! runs one logical session: build a model request from the conversation and the
//! offered toolset, send it via the [client](crate::client), apply the assistant's
//! message and tool calls (dispatching each through [`crate::tools`]), append the
//! results, and repeat until the agent reports the build complete — emitting
//! [telemetry](crate::telemetry) throughout.
//!
//! # Phase 0 status — SKELETON
//!
//! Phase 0 ships [`run_skeleton`] in place of that loop: it emits the telemetry
//! bookends and returns without contacting a model or touching the workspace.
//!
//! TODO(gg-integration): replace [`run_skeleton`] with the real
//! (`async`) turn loop described above, driven by the run's
//! [`GgCapabilitySet`](test_cabinet_core::gg::GgCapabilitySet); honor the enabled
//! capabilities when assembling the toolset; account token usage/cost per
//! model-slot and emit it as [`GgTelemetryKind::Usage`].

use test_cabinet_core::gg::GgTelemetryKind;

use crate::config::GgInvocation;
use crate::telemetry::Emitter;

/// The Phase 0 stand-in for the turn loop.
///
/// Emits `SessionStarted`, a single `Log` line describing the received invocation,
/// then `SessionEnded { status: "skeleton" }` — the fixed sequence that proves the
/// binary is wired up and its telemetry channel flows, without doing any real work.
pub fn run_skeleton(invocation: &GgInvocation, emitter: &Emitter) {
    emitter.emit(GgTelemetryKind::SessionStarted {});

    emitter.emit(GgTelemetryKind::Log {
        level: "info".to_string(),
        message: format!(
            "gg Phase-0 skeleton: session {} received (workspace {}, {}-char prompt, \
             {} capability(ies){}); no agent loop yet — the client, turn loop, and \
             toolset arrive in the next workflow.",
            invocation.session_id,
            invocation.workspace_dir.display(),
            invocation.prompt.len(),
            invocation.capability_set.capabilities.len(),
            match invocation
                .capability_set
                .model_for_slot(test_cabinet_core::gg::PRIMARY_SLOT)
            {
                Some(model) => format!(", primary slot -> {model}"),
                None => ", no primary slot bound".to_string(),
            },
        ),
    });

    emitter.emit(GgTelemetryKind::SessionEnded {
        status: "skeleton".to_string(),
    });
}
