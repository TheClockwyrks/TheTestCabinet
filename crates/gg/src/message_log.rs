//! The gg **message log**: content-addressed de-duplication of the exact messages gg
//! sends the model, so a run's request/response history can be recorded in full without
//! restreaming a message once per turn.
//!
//! # Why de-duplicate
//!
//! gg's window is [append-only](https://docs.testcabinet.ai/gg/context-visibility/): a
//! turn *extends* the previous turn's prompt rather than rewriting it, so the overwhelming
//! majority of a turn's messages are byte-identical to ones sent on earlier turns. Logging
//! each turn's whole prompt verbatim would therefore record the same system prompt, build
//! prompt, and accumulated history over and over — quadratic in the run's length.
//!
//! Instead each message is fingerprinted by its content ([`fingerprint`]). The
//! [`MessagePool`] tracks which fingerprints have already been emitted on an agent's
//! stream; a message's full body is streamed **once** (as a
//! [`ContextMessage`](test_cabinet_core::gg::GgTelemetryKind::ContextMessage)) the first
//! time it appears, and every turn that includes it thereafter references it by id alone
//! (a [`GgPromptRef`](test_cabinet_core::gg::GgPromptRef) in that turn's
//! [`Prompt`](test_cabinet_core::gg::GgTelemetryKind::Prompt)).
//!
//! The pool is **per agent**: each agent scopes its own emitter (see
//! [`Emitter::for_agent`](crate::telemetry::Emitter::for_agent)) with a fresh pool, so an
//! agent's stream always carries the definitions its own prompts reference — which is what
//! keeps the console's [per-agent reduction] able to resolve a pointer from that agent's
//! partition of the stream alone.
//!
//! [per-agent reduction]: https://docs.testcabinet.ai/gg/telemetry/

use std::collections::HashSet;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

use test_cabinet_core::gg::{GgLoggedImage, GgLoggedToolCall, GgTelemetryKind};

use crate::model::{FinishReason, Message, Role};

/// The stable id of a [`Message`] for the message log: a fingerprint of exactly the
/// content that is sent to the model — its role, text, tool calls (id, name, and
/// arguments), the tool-call id it answers, and its images' descriptors (media type and
/// size, never their bytes, which are the same picture whatever the surrounding text).
///
/// Two messages share an id **iff** they would render identically on the wire, which is
/// precisely the de-duplication the log wants: a message repeated across turns fingerprints
/// the same and is streamed once. The hash is [`DefaultHasher`] (fixed-key SipHash), which
/// is deterministic within a process — all the log needs, since ids only have to be
/// consistent across one run's stream.
pub fn fingerprint(message: &Message) -> String {
    let mut hasher = DefaultHasher::new();
    role_token(message.role).hash(&mut hasher);
    message.content.hash(&mut hasher);
    for call in &message.tool_calls {
        call.id.hash(&mut hasher);
        call.name.hash(&mut hasher);
        // The arguments are structured JSON; their compact string form is a stable,
        // order-preserving rendering to hash.
        call.arguments.to_string().hash(&mut hasher);
    }
    message.tool_call_id.hash(&mut hasher);
    for image in &message.images {
        image.media_type.hash(&mut hasher);
        image.bytes.hash(&mut hasher);
    }
    format!("m{:016x}", hasher.finish())
}

/// The wire role token for a [`Role`], matching the string carried on a logged
/// [`ContextMessage`](GgTelemetryKind::ContextMessage).
pub fn role_token(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    }
}

/// The wire token for a [`FinishReason`], for a logged [`Prompt`](GgTelemetryKind::Prompt)'s
/// `finish_reason`. Matches the provider's own vocabulary where it has one, and preserves an
/// unrecognized reason verbatim.
pub fn finish_reason_token(reason: &FinishReason) -> String {
    match reason {
        FinishReason::Stop => "stop".to_string(),
        FinishReason::ToolCalls => "tool_calls".to_string(),
        FinishReason::Length => "length".to_string(),
        FinishReason::ContentFilter => "content_filter".to_string(),
        FinishReason::Other(other) => other.clone(),
    }
}

/// Build the [`ContextMessage`](GgTelemetryKind::ContextMessage) event that records
/// `message`'s full body under its [`fingerprint`] `id`, charged at `tokens` estimated
/// tokens and tagged with the window item's `label` (a file view's path, or `None` for an
/// ordinary message).
///
/// The label rides on the pooled definition rather than on each turn's
/// [reference](test_cabinet_core::gg::GgPromptRef) because it is a property of the
/// *material*, not of the turn: a file view shows the same file every turn it survives, so
/// carrying the path once with the body is both cheaper and the thing a reader wants
/// alongside the content.
///
/// Images become [descriptors](GgLoggedImage) (media type + decoded size) rather than
/// their base64 bytes — a request log shows *what was sent*, and the pixels are neither
/// readable nor cheap.
pub fn context_message_event(
    id: String,
    message: &Message,
    tokens: u64,
    label: Option<&str>,
) -> GgTelemetryKind {
    GgTelemetryKind::ContextMessage {
        id,
        role: role_token(message.role).to_string(),
        content: message.content.clone(),
        tool_calls: message
            .tool_calls
            .iter()
            .map(|call| GgLoggedToolCall {
                id: call.id.clone(),
                name: call.name.clone(),
                args: call.arguments.clone(),
            })
            .collect(),
        tool_call_id: message.tool_call_id.clone(),
        images: message
            .images
            .iter()
            .map(|image| GgLoggedImage {
                media_type: image.media_type.clone(),
                bytes: image.bytes,
            })
            .collect(),
        tokens,
        label: label.map(str::to_string),
    }
}

/// A per-agent set of message fingerprints already emitted as
/// [`ContextMessage`](GgTelemetryKind::ContextMessage) definitions on this agent's stream.
///
/// [`register`](Self::register) records a fingerprint and reports whether it was *new* — so
/// the [emitter](crate::telemetry::Emitter) streams a message's body only the first time it
/// is seen and references it by id thereafter. Interior-mutable (a [`Mutex`]) so it can sit
/// behind the shared `&Emitter` the async loop holds.
#[derive(Default)]
pub struct MessagePool {
    seen: Mutex<HashSet<String>>,
}

impl MessagePool {
    /// A fresh, empty pool.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record `id` as seen, returning `true` if it was **newly** inserted (its body has not
    /// been streamed yet and should be) and `false` if it was already present (a repeat, to
    /// reference by id alone).
    pub fn register(&self, id: &str) -> bool {
        self.seen
            .lock()
            .expect("message pool lock")
            .insert(id.to_string())
    }
}

#[cfg(test)]
#[path = "message_log.test.rs"]
mod tests;
