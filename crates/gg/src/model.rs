//! The gg **model abstraction**: the provider-agnostic message/tool types and the
//! [`ModelClient`] trait the [agent loop](crate::agent) is written against.
//!
//! This module is deliberately free of any HTTP or provider detail. It defines the
//! shapes a turn is expressed in — [`Message`]s (with roles, assistant
//! [`ToolCall`]s, and `tool` results keyed by `tool_call_id`), the
//! [`ToolDefinition`]s offered to the model, and the [`ModelResponse`] a turn
//! yields — plus the [`ModelClient`] trait and its [`ModelError`]. The concrete
//! providers (OpenRouter and the scripted mock) live in [`crate::client`], which
//! maps these types to and from each provider's wire format.
//!
//! Keeping the abstraction here means the loop, the telemetry, and the tools never
//! see a `reqwest` type or an OpenAI JSON shape — only these domain types — so a
//! second provider is an addition in [`crate::client`], not a change here.

use serde::{Deserialize, Serialize};
use test_cabinet_core::metrics::{Cost, TokenCounts};

/// The role a [`Message`] plays in the conversation sent to a model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// System / developer instructions that steer the whole session.
    System,
    /// Input from the user (or, in gg's case, the build harness).
    User,
    /// A model turn's own output; may carry [`tool_calls`](Message::tool_calls).
    Assistant,
    /// The result of a tool the model called, keyed back to the call by
    /// [`tool_call_id`](Message::tool_call_id).
    Tool,
}

/// An image attached to a [`Message`] — how a picture in the workspace reaches a
/// model that can see one.
///
/// Held as raw base64 plus its media type rather than as a formatted `data:` URL, so
/// the domain type stays free of any provider's encoding; [`crate::client`] renders it
/// into whatever shape the wire wants. `bytes` is the **estimated** decoded size,
/// carried so context accounting can charge the image without decoding it again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageContent {
    /// The IANA media type (`image/png`, `image/jpeg`, …).
    pub media_type: String,
    /// The image's bytes, base64-encoded (no `data:` prefix).
    pub data_base64: String,
    /// The decoded size in bytes — what the file on disk measured.
    pub bytes: u64,
}

impl ImageContent {
    /// An image of `media_type` from already-encoded `data_base64` covering `bytes`
    /// decoded bytes.
    pub fn new(media_type: impl Into<String>, data_base64: impl Into<String>, bytes: u64) -> Self {
        Self {
            media_type: media_type.into(),
            data_base64: data_base64.into(),
            bytes,
        }
    }

    /// The `data:` URL form providers accept: `data:<media type>;base64,<data>`.
    pub fn data_url(&self) -> String {
        format!("data:{};base64,{}", self.media_type, self.data_base64)
    }
}

/// A single conversation message.
///
/// The shape is uniform across roles; which fields are populated depends on the
/// [`role`](Self::role):
///
/// - `system` / `user`: [`content`](Self::content) only.
/// - `assistant`: [`content`](Self::content) (the natural-language part, if any)
///   and/or [`tool_calls`](Self::tool_calls).
/// - `tool`: [`content`](Self::content) (the tool's result text) plus the
///   [`tool_call_id`](Self::tool_call_id) it answers.
///
/// A `user` or `tool` message may additionally carry [`images`](Self::images), which
/// turn its content into a multi-part message on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    /// Who authored this message.
    pub role: Role,
    /// The textual content, when present. Absent for an assistant turn that only
    /// called tools.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// The tool calls the assistant requested this turn. Empty for every other
    /// role.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    /// For a `tool` message, the id of the [`ToolCall`] this result answers.
    /// `None` for every other role.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Images carried alongside the text — a `read_file` of a PNG the model can
    /// actually look at. Empty for every message that carries only text, which is the
    /// overwhelming majority, so the wire shape is unchanged for them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageContent>,
}

impl Message {
    /// A `system` message carrying `content`.
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            content: Some(content.into()),
            tool_calls: Vec::new(),
            tool_call_id: None,
            images: Vec::new(),
        }
    }

    /// A `user` message carrying `content`.
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: Some(content.into()),
            tool_calls: Vec::new(),
            tool_call_id: None,
            images: Vec::new(),
        }
    }

    /// An `assistant` message — the natural-language `content` (if any) and the
    /// `tool_calls` it requested (possibly empty). This is how the loop records a
    /// model turn back into the conversation before appending the tool results.
    pub fn assistant(content: Option<String>, tool_calls: Vec<ToolCall>) -> Self {
        Self {
            role: Role::Assistant,
            content,
            tool_calls,
            tool_call_id: None,
            images: Vec::new(),
        }
    }

    /// A `tool` result answering the call `tool_call_id` with `content`. This is how
    /// the loop feeds a tool's output back to the model on the next turn.
    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: Role::Tool,
            content: Some(content.into()),
            tool_calls: Vec::new(),
            tool_call_id: Some(tool_call_id.into()),
            images: Vec::new(),
        }
    }

    /// This message with `images` attached — the builder a `read_file` of a picture
    /// goes through. Attaching none leaves the message exactly as it was.
    pub fn with_images(mut self, images: Vec<ImageContent>) -> Self {
        self.images = images;
        self
    }

    /// Drop every attached image, returning whether any were removed.
    ///
    /// This is the recovery step when a provider turns out not to accept images after
    /// all: the message keeps its text and — crucially — its
    /// [`tool_call_id`](Self::tool_call_id), so the assistant tool-call it answers
    /// still has its matching result and the conversation stays well-formed. Only the
    /// picture the model cannot see goes away.
    pub fn strip_images(&mut self) -> bool {
        if self.images.is_empty() {
            return false;
        }
        self.images.clear();
        true
    }
}

/// A single tool call the model requested.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    /// Provider-assigned id, used to key the [`tool` result](Message::tool_result)
    /// back to this call.
    pub id: String,
    /// The name of the tool to invoke.
    pub name: String,
    /// The arguments to invoke it with, as a parsed JSON value. (Providers transmit
    /// these as a JSON *string*; [`crate::client`] parses that at the wire boundary
    /// so the rest of gg works with structured data.)
    pub arguments: serde_json::Value,
}

/// The declaration of a tool offered to the model — its name, a description shown to
/// the model, and a JSON Schema for its parameters.
///
/// The offered set is assembled from the run's enabled capabilities (see
/// [`crate::tools`]); this type is the transport-neutral form the client maps into
/// each provider's tool schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// The tool's name, matched against [`ToolCall::name`].
    pub name: String,
    /// A natural-language description shown to the model.
    pub description: String,
    /// A JSON Schema describing the tool's parameters.
    pub parameters: serde_json::Value,
}

impl ToolDefinition {
    /// Declare a tool from its `name`, `description`, and JSON-Schema `parameters`.
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: serde_json::Value,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            parameters,
        }
    }
}

/// Why a model turn stopped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    /// The model finished its message normally.
    Stop,
    /// The model stopped to call one or more tools.
    ToolCalls,
    /// The model hit the maximum output length.
    Length,
    /// The provider's content filter stopped the turn.
    ContentFilter,
    /// Any other/unknown reason, preserving the provider's raw string.
    Other(String),
}

/// The result of one model turn.
///
/// Usage is mapped onto the shared [`TokenCounts`] contract so gg accounts tokens in
/// the same units as every other run; [`cost`](Self::cost) is populated only when the
/// provider reports one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelResponse {
    /// The assistant's natural-language text, when the turn produced any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// The tool calls the turn requested, in order (empty when it produced none).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    /// Why the turn stopped.
    pub finish_reason: FinishReason,
    /// Normalized token usage for the turn.
    #[serde(default)]
    pub usage: TokenCounts,
    /// The turn's cost, when the provider reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<Cost>,
    /// How many *earlier* replies to this same call the client read, judged to be a
    /// [generation loop](crate::loopguard), and threw away before this one arrived.
    ///
    /// Zero for every response that is not the product of a
    /// [streaming transport](crate::client::StreamAccumulator) with loop detection armed, which is
    /// every response gg produced before the detector existed and every response an agent that
    /// leaves the detector off produces now.
    ///
    /// It rides on the *successful* response rather than being reported separately because a
    /// discarded attempt has no other carrier: the reply never enters the conversation, never
    /// reaches the healing pipeline, and is not an error turn — the retry worked. What it *is* is
    /// money spent on nothing, so the number has to reach the turn loop somehow, and the answer
    /// that finally came back is the only thing the turn loop is handed. The loop logs it and
    /// counts it (see [`GgErrorSummary::loop_aborts`](test_cabinet_core::gg::GgErrorSummary)).
    ///
    /// `#[serde(default)]` so a response captured before this field existed still reads; nothing
    /// stores a `ModelResponse` today, but the type is `Deserialize` and a required field would be
    /// a silent trap for the first thing that does.
    #[serde(default)]
    pub loop_aborts: u32,
}

/// A failure running a model turn.
///
/// The variants let the [turn loop](crate::agent) decide what to do: a
/// [`RetryExhausted`](Self::RetryExhausted) means the client already retried a
/// transient condition (a `429`, a `5xx`, or a transport error) up to its policy and
/// gave up — a later turn might still succeed. Everything else is **fatal**: a
/// [`Fatal`](Self::Fatal) HTTP status (auth or another non-retryable `4xx`), a
/// [`MissingApiKey`](Self::MissingApiKey), or a [`Parse`](Self::Parse) failure of an
/// otherwise-successful response. The retry loop itself lives inside
/// [`OpenRouterClient`](crate::client::OpenRouterClient), so by the time the loop
/// sees a `ModelError` the decision is only "retry the whole turn later?" (retryable)
/// versus "this configuration/response cannot work" (fatal).
#[derive(Debug, thiserror::Error)]
pub enum ModelError {
    /// The OpenRouter credential is not present in the environment. Fatal — no request
    /// was attempted.
    #[error("OPENROUTER_API_KEY is not set in the environment")]
    MissingApiKey,
    /// The provider returned a non-retryable status (authentication or another `4xx`).
    /// Fatal.
    #[error("model request rejected (HTTP {status}): {message}")]
    Fatal {
        /// The HTTP status returned.
        status: u16,
        /// A (truncated) copy of the provider's error body.
        message: String,
    },
    /// The client retried a transient failure (`429`, `5xx`, or transport error) up to
    /// its policy and exhausted every attempt. Retryable at the turn level.
    #[error("model request failed after {attempts} attempt(s); last error: {last}")]
    RetryExhausted {
        /// How many attempts were made before giving up.
        attempts: u32,
        /// The last error observed.
        last: String,
    },
    /// The request carried an image and the provider has no route for this model that
    /// accepts image input.
    ///
    /// Recoverable in a way no other error is: the *conversation* is at fault, not the
    /// configuration, and dropping the image fixes it. The loop responds by recording
    /// that this model cannot see images, [stripping](Message::strip_images) them from
    /// the context, and re-running the same turn — so a run against a text-only model
    /// survives having read a reference mockup instead of dying on it.
    #[error("the model `{model_id}` does not accept image input: {message}")]
    VisionUnsupported {
        /// The model that refused the image.
        model_id: String,
        /// A (truncated) copy of the provider's error body.
        message: String,
    },
    /// A `2xx` response could not be parsed into a [`ModelResponse`]. Fatal — retrying
    /// an already-successful-but-malformed response would not help.
    #[error("could not parse model response: {0}")]
    Parse(String),
    /// Every attempt the client made was abandoned mid-stream by
    /// [loop detection](crate::loopguard): the model answered with a repetition rather than a
    /// reply, and kept doing so until the retry policy ran out.
    ///
    /// **Retryable at the turn level**, exactly like
    /// [`RetryExhausted`](Self::RetryExhausted) — see
    /// [`is_retryable_exhausted`](Self::is_retryable_exhausted). It is not a host fault and not a
    /// misconfiguration: the request was well-formed and the provider answered it, the answer was
    /// just worthless. A later turn, on a shorter context, routinely succeeds.
    ///
    /// It exists as its own variant rather than folding into `RetryExhausted` because the two say
    /// completely different things to an operator reading the run's log. `RetryExhausted` means
    /// the provider would not serve the request; this means the provider served it several times
    /// and gg threw every answer away. Only one of those is worth changing a model binding over.
    #[error("model looped: {detail}; discarded {attempts} response(s)")]
    ResponseLoop {
        /// How many streamed replies were read and discarded before the client gave up — the
        /// [retry policy's](crate::client::RetryPolicy) full attempt count, since a loop that left
        /// any attempt unused would have returned that attempt's answer instead.
        attempts: u32,
        /// What tripped the detector on the final attempt, in the detector's own words (a
        /// [`LoopTrip`](crate::loopguard::LoopTrip)'s `Display`), so the failure and the `warn`
        /// line for each discarded attempt describe the same event identically.
        detail: String,
    },
    /// A [playback](crate::playback) could not answer this call from the record: its
    /// agent's recorded turns are exhausted, the live request is no longer the recorded
    /// question, or the client was never bound to a recorded agent at all.
    ///
    /// Fatal by construction, and that is the point. A reconstruction ends the agent here
    /// rather than inventing an answer, so the run stops at the divergence and the report
    /// says what stopped it. It is also the only shape in which a playback can express
    /// "the recorded run ended on its wall clock and this one did not": the turns simply
    /// run out, the agent ends on this error, and the terminal comparison reports
    /// `max_runtime → model_error` rather than faking a clock gg has no seam for.
    ///
    /// No live client can produce it, which is why it does **not** widen the recorded
    /// [error kind](test_cabinet_core::gg_replay::GgReplayModelErrorKind) contract — a
    /// playback's own capture is never served, and the class a consumer branches on is
    /// still `fatal`.
    #[error("playback: {0}")]
    Playback(String),
}

impl ModelError {
    /// Whether this error is a transient failure the client already retried to its policy (as
    /// opposed to a fatal one). The loop uses this to decide whether re-attempting the turn later
    /// is worthwhile.
    ///
    /// Two variants qualify, and they are the two where the *request* was fine:
    /// [`RetryExhausted`](Self::RetryExhausted), where the provider never served it, and
    /// [`ResponseLoop`](Self::ResponseLoop), where the provider served it and every answer was a
    /// [generation loop](crate::loopguard). Both end the run as `model_error` if they survive the
    /// turn loop's own patience, and neither says anything is wrong with the configuration. Every
    /// other variant is fatal.
    pub fn is_retryable_exhausted(&self) -> bool {
        matches!(
            self,
            ModelError::RetryExhausted { .. } | ModelError::ResponseLoop { .. }
        )
    }

    /// Whether this error means the run's **credential** was refused: a
    /// [`MissingApiKey`](Self::MissingApiKey), or a [`Fatal`](Self::Fatal) `401`/`403`
    /// from the provider.
    ///
    /// The distinction matters for how a run is scored. Every other failure is
    /// something that happened while the model was working; an auth failure means no
    /// model ever ran, because the key The Test Cabinet supplied was absent or
    /// rejected. That is an operator/infrastructure fault, so a run that hits it must
    /// be recorded as a harness error rather than scored against the model — see the
    /// [session outcome](crate::agent::SessionOutcome).
    pub fn is_auth_failure(&self) -> bool {
        match self {
            ModelError::MissingApiKey => true,
            ModelError::Fatal { status, .. } => matches!(status, 401 | 403),
            _ => false,
        }
    }

    /// The model id a [`VisionUnsupported`](Self::VisionUnsupported) names, or `None`
    /// for every other error. The loop's one check for "can I recover from this by
    /// dropping the pictures and trying again?".
    pub fn vision_unsupported_model(&self) -> Option<&str> {
        match self {
            ModelError::VisionUnsupported { model_id, .. } => Some(model_id),
            _ => None,
        }
    }
}

/// The slot-bound interface the [agent loop](crate::agent) calls to run a model turn.
///
/// Implementations resolve a [slot binding](test_cabinet_core::gg::GgSlotBinding) to a
/// concrete provider/model; the loop only ever holds a `dyn ModelClient` and asks it
/// to [`complete`](Self::complete) a conversation. `Send + Sync` so a boxed client can
/// be shared across the async loop and passed to spawned subagents in later phases.
#[async_trait::async_trait]
pub trait ModelClient: Send + Sync {
    /// Run one turn: send `messages` and the offered `tools`, and return the
    /// assistant's reply (text and/or tool calls) with its token usage.
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError>;

    /// Run one turn that must be answered with a call to **`tool`** — the only tool offered, and
    /// not optional.
    ///
    /// It exists for the one caller whose whole request is a structured answer rather than a step
    /// in a conversation: [handoff compaction](crate::compaction::HandoffCompactor), which asks a
    /// separate model for a summary *and* a file list in one shot and has no next turn in which to
    /// ask again. Every other call site wants the model to decide whether to use a tool, which is
    /// what [`complete`](Self::complete) offers.
    ///
    /// The default implementation simply offers the tool, so an implementation that cannot express
    /// "required" (a scripted mock, a recording wrapper that delegates) is correct without doing
    /// anything — and a caller must not *assume* the reply carries the call. A provider client that
    /// can express it overrides this to say so on the wire.
    async fn complete_requiring(
        &self,
        messages: &[Message],
        tool: &ToolDefinition,
    ) -> Result<ModelResponse, ModelError> {
        self.complete(messages, std::slice::from_ref(tool)).await
    }

    /// The concrete model id this client is bound to (for telemetry and per-slot
    /// accounting).
    fn model_id(&self) -> &str;
}

#[cfg(test)]
#[path = "model.test.rs"]
mod tests;
