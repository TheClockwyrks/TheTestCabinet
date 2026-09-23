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

use crate::limits::TurnErrorType;
use crate::telemetry::Emitter;

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
    /// The upstream **provider** that served the call, when the gateway reported one —
    /// OpenRouter's top-level `provider` response field. One model id is served by several
    /// providers behind one name, and a provider-shaped failure (a stall, a habit of capping
    /// output) is only attributable — and a provider only blacklistable — if every reply names
    /// who served it. `None` for the scripted mock and for a gateway that named none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// What [loop detection](crate::loopguard) read and threw away before this reply arrived — how
    /// many *earlier* replies to this same call were abandoned, and how much generated output went
    /// with them.
    ///
    /// [`LoopAborts::none()`] for every response that is not the product of a
    /// [streaming transport](crate::client::StreamAccumulator) with loop detection armed, which is
    /// every response an agent that leaves the detector off produces.
    ///
    /// It rides on the *successful* response rather than being reported separately because a
    /// discarded attempt has no other carrier: the reply never enters the conversation, never
    /// runs anything, and is not an error turn — the retry worked. What it *is* is
    /// generation that was paid for and thrown away, so the figures have to reach the turn loop
    /// somehow, and the answer that finally came back is the only thing the turn loop is handed.
    /// The loop logs them and counts them (see
    /// [`GgErrorSummary::loop_aborts`](test_cabinet_core::gg::GgErrorSummary)).
    ///
    /// `#[serde(default)]` because a `ModelResponse` is `Deserialize` and nothing stores one today;
    /// a required field would be a silent trap for the first thing that does.
    #[serde(default)]
    pub loop_aborts: LoopAborts,
}

/// What one model call's abandoned attempts amounted to: the count, and the size of the generation
/// that went with it.
///
/// Three figures rather than the bare count, because the count alone answers "how often" and never
/// "how much". A discarded attempt is charged to the run's provider bill exactly like any other
/// output — the tokens were generated, and abandoning the stream mid-flight does not refund them —
/// yet it is deliberately absent from the run's [cost](test_cabinet_core::metrics::Cost) and token
/// totals, because those are read off the provider's usage payload and a stream nobody finished
/// carries none. So the size is reported in the units gg can actually vouch for, measured by the
/// [guard](crate::loopguard::LoopGuard) as the reply streamed: **words and characters of generated
/// output**, never a token count and never a price.
///
/// The three move together, through [`record`](Self::record), which is the only place gg adds to
/// one: a size that could be added without an attempt is a size no reader could say what it was a
/// size *of*.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopAborts {
    /// How many replies were read, judged to be a [generation loop](crate::loopguard), and thrown
    /// away before one arrived that was not.
    pub attempts: u32,
    /// Completed words of generated output across all of them. A reply's final partial word is
    /// never counted, which costs nothing: an abandoned reply is a reply that did not end.
    pub words: u64,
    /// Characters of generated output across all of them, counted as characters rather than bytes.
    pub chars: u64,
}

impl LoopAborts {
    /// Nothing was thrown away — the value every reply that was not abandoned carries, and the
    /// value every reply carries on an agent that left the detector disarmed.
    pub const fn none() -> Self {
        Self {
            attempts: 0,
            words: 0,
            chars: 0,
        }
    }

    /// Fold one abandoned attempt in, with what it had generated by the moment the stream was
    /// dropped.
    ///
    /// Saturating on every field: a provider that streams past `u64::MAX` characters is not a
    /// scenario worth wrapping the count for.
    pub fn record(&mut self, words: u64, chars: u64) {
        self.attempts = self.attempts.saturating_add(1);
        self.words = self.words.saturating_add(words);
        self.chars = self.chars.saturating_add(chars);
    }

    /// Whether anything was thrown away at all — the one question the turn loop asks before it
    /// bothers the operator.
    pub fn any(&self) -> bool {
        self.attempts > 0
    }
}

/// A failure running a model turn.
///
/// The retry loop itself lives inside [`OpenRouterClient`](crate::client::OpenRouterClient), so a
/// `ModelError` reaching the [turn loop](crate::agent) means every attempt within one turn already
/// failed. Three shapes the loop **answers** rather than ends on: a [`Timeout`](Self::Timeout), a
/// [`Parse`](Self::Parse) and a [`ResponseLoop`](Self::ResponseLoop) are recorded as error turns —
/// they spend the run's [error ceilings](crate::limits::RunLimits), nothing enters the context
/// between attempts, and the loop asks the same question again — so a stalled endpoint, a reply gg
/// could not read and a model that looped every attempt each cost the model a turn rather than the
/// run. The rest end the agent, and two decisions are then made from the variant, and they are the
/// only two:
///
/// * **how the run is scored** — [`is_auth_failure`](Self::is_auth_failure) says the run's
///   credential was refused, so no model ever ran and the run is a harness error rather than a
///   result;
/// * **how the failure is recorded** — [`turn_error_type`](Self::turn_error_type) maps all seven
///   shapes onto the run's error taxonomy, which is what makes "the provider was down" and "the
///   provider answered and gg threw every answer away" different rows in a study instead of one
///   `model_api` bucket.
///
/// There is deliberately no "is this retryable?" predicate left. There was one, and by the end it
/// answered a question nobody asked: the client had already exhausted its own budget, gg does not
/// re-attempt the turn, and the only thing the answer was still used for was choosing a word for a
/// log line. That word now comes from the recorded type, so the sentence in the log and the row in
/// the console cannot describe one failure two different ways.
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
    #[error("model request failed after {attempts} attempt(s): {last}")]
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
    /// A `2xx` response could not be read into a [`ModelResponse`] — an unparseable envelope, an
    /// error object in a success status, or tool call arguments that are not JSON (the shape a
    /// provider cuts off mid-arguments produces).
    ///
    /// Answered as a [`model_parse`](TurnErrorType::ModelParse) error turn: nothing entered the
    /// context, the turn spends the run's error ceilings exactly as a failed call does, and the
    /// loop asks the same question again — so a reply gg could not read costs the model a turn
    /// rather than the run. What the reply *reported* before it stopped making sense rides the
    /// `spend` field so the turn's price still reaches the run's total cost; it is never work's.
    /// Boxed so this arm does not make the whole error expensive to move — the spend is the
    /// exceptional part of the variant, not the rule.
    #[error("could not parse model response: {message}")]
    Parse {
        /// What could not be read, and where.
        message: String,
        /// What the request billed for before the reply stopped making sense, as
        /// [`parse_billed`](Self::parse_billed) recorded it; `None` when the stream had reported
        /// nothing yet.
        spend: Option<Box<ReplySpend>>,
    },
    /// Every attempt the client made was abandoned mid-stream by
    /// [loop detection](crate::loopguard): the model answered with a repetition rather than a
    /// reply, and kept doing so until the retry policy ran out.
    ///
    /// The same shape of failure as [`RetryExhausted`](Self::RetryExhausted) — the client's own
    /// retry budget ran out — and, like it, neither a host fault nor a misconfiguration: the
    /// request was well-formed and the provider answered it, the answer was just worthless. A later
    /// turn, on a shorter context, routinely succeeds — which is why the loop answers this as a
    /// [`model_response_loop`](TurnErrorType::ModelResponseLoop) error turn rather than an ending:
    /// the discarded replies never entered the context, the turn spends the error ceilings, and
    /// the same request goes out again, so a model that loops once loses a turn rather than the
    /// run. The replies' spend cannot follow them here — a stream gg dropped never delivered its
    /// usage — so the error carries their [size](LoopAborts) and nothing it cannot measure.
    ///
    /// It exists as its own variant rather than folding into `RetryExhausted` because the two say
    /// completely different things to an operator reading the run's log. `RetryExhausted` means
    /// the provider would not serve the request; this means the provider served it several times
    /// and gg threw every answer away. Only one of those is worth changing a model binding over.
    /// That distinction is now durable rather than only readable: they are recorded as
    /// [`ModelResponseLoop`](TurnErrorType::ModelResponseLoop) and
    /// [`ModelRetryExhausted`](TurnErrorType::ModelRetryExhausted) — see
    /// [`turn_error_type`](Self::turn_error_type).
    #[error(
        "model looped: {detail} ({} response(s) discarded, {} characters)",
        .discarded.attempts,
        .discarded.chars
    )]
    ResponseLoop {
        /// What was read and thrown away before the client gave up. Its
        /// [`attempts`](LoopAborts::attempts) is the [retry policy's](crate::client::RetryPolicy)
        /// full attempt count, since a loop that left any attempt unused would have returned that
        /// attempt's answer instead, and the sizes beside it are what those attempts generated —
        /// the whole of what this turn spent, since no reply was ever read to the end and so the
        /// provider reported no usage for any of them.
        discarded: LoopAborts,
        /// What tripped the detector on the final attempt, in the detector's own words (a
        /// [`LoopTrip`](crate::loopguard::LoopTrip)'s `Display`), so the failure and the `warn`
        /// line for each discarded attempt describe the same event identically.
        detail: String,
    },
    /// The gateway served the call from a provider other than the one this run pinned.
    ///
    /// A harness failure, not a model failure: the cost recorded from this reply on would be on
    /// a different price basis than the rest of the run, and scoring that against the model would
    /// blame it for a route gg asked not to be taken. The turn loop ends the session on it.
    #[error("provider mismatch: pinned to `{pinned}`, served by `{served}`")]
    ProviderMismatch {
        /// The OpenRouter provider the launch pinned this model to.
        pinned: String,
        /// The provider the response named as having served it.
        served: String,
    },
    /// The call ran into the run's
    /// [**per-attempt ceiling**](crate::limits::RunLimits::model_call_timeout) without producing a
    /// reply — a provider whose silence ran past the whole attempt's bound, not a refusal.
    ///
    /// The one `ModelError` the turn loop does **not** end the session on. The client surfaces a
    /// timeout immediately rather than spending its own retry budget on it — every internal retry
    /// of a ceiling-long silence costs the full ceiling again — and the loop records the turn as a
    /// [`ModelTimeout`](TurnErrorType::ModelTimeout) error and asks again, so the retry that bounds
    /// a silent endpoint is the turn-level one the error ceilings govern. A reply that merely goes
    /// quiet mid-stream never reaches this error: it is bounded sooner by the
    /// [stream-idle bound](crate::limits::RunLimits::model_stream_idle), cancelled and retried on
    /// the client's own schedule as a transport failure.
    #[error(
        "model call timed out after {}s{}",
        .after.as_secs(),
        .provider.as_deref().map(|provider| format!(" (provider: {provider})")).unwrap_or_default()
    )]
    Timeout {
        /// The ceiling that was hit.
        after: std::time::Duration,
        /// The upstream provider that was serving the stalled call, when the stream got far
        /// enough to name one — what makes a provider-shaped stall blacklistable. `None` when no
        /// chunk arrived that could have named one, which is most silences.
        provider: Option<String>,
    },
}

/// What one model request billed for, read even when the reply it carried was unusable: the
/// provider's usage and cost as reported, and who served it. The price of a reply
/// [gg could not read](ModelError::Parse) or [rejected whole](crate::limits::TurnErrorType::ModelLengthCapped)
/// is still the run's spend, so it rides out on the request's
/// [`Usage`](test_cabinet_core::gg::GgTelemetryKind::Usage) delta marked
/// [`total`](test_cabinet_core::gg::GgUsageFigure::Total) — into the run's
/// [total cost](test_cabinet_core::gg::GgSessionSummary::cost) and never its
/// [work cost](test_cabinet_core::gg::GgSessionSummary::work_cost), since no program and no tool
/// call came of it.
#[derive(Debug, Clone, PartialEq)]
pub struct ReplySpend {
    /// The provider's normalized token usage for the request.
    pub tokens: TokenCounts,
    /// The request's cost, when the provider reported one.
    pub cost: Option<Cost>,
    /// The upstream provider that named itself on the request.
    pub provider: Option<String>,
}

impl ReplySpend {
    /// The spend of a reply the loop holds in hand — a rejected length-capped one — where usage,
    /// cost and provider all come straight off the response.
    pub fn of(response: &ModelResponse) -> Self {
        Self {
            tokens: response.usage,
            cost: response.cost,
            provider: response.provider.clone(),
        }
    }

    /// Whether anything was reported at all — the question [`ModelError::parse_billed`] asks
    /// before it boxes, so a failure that struck before any usage did carries `None` rather than
    /// an all-empty spend nothing can tell from absence.
    pub fn reported(&self) -> bool {
        self.tokens != TokenCounts::default() || self.cost.is_some() || self.provider.is_some()
    }
}

impl ModelError {
    /// A [`Parse`](Self::Parse) that carries no spend: the shape a test builds when the price of
    /// the unreadable reply is beside its point. gg itself always builds the error through
    /// [`parse_billed`](Self::parse_billed), which records whatever the stream had reported.
    #[cfg(test)]
    pub fn parse(message: impl Into<String>) -> Self {
        ModelError::Parse {
            message: message.into(),
            spend: None,
        }
    }

    /// A [`Parse`](Self::Parse) carrying what the request billed for before the reply stopped
    /// making sense, or no spend at all when nothing was reported.
    pub fn parse_billed(message: impl Into<String>, spend: ReplySpend) -> Self {
        let spend = spend.reported().then(|| Box::new(spend));
        ModelError::Parse {
            message: message.into(),
            spend,
        }
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

    /// The [turn error type](TurnErrorType) this failure is recorded as — the one place
    /// `ModelError`'s eight shapes are mapped onto the taxonomy the run's error record publishes.
    ///
    /// Exhaustive on purpose: a variant added above has to declare how it is *recorded*, not just
    /// how it reads. Every one of these lands under
    /// [`ModelApi`](crate::limits::TurnErrorKind::ModelApi) at the base level, which is why the
    /// error ceilings and every cross-run rate are unaffected by the split — what changes is that
    /// "the provider was down" and "the provider answered and gg threw every answer away" stop being
    /// the same row in a console.
    pub fn turn_error_type(&self) -> TurnErrorType {
        match self {
            ModelError::MissingApiKey => TurnErrorType::ModelAuth,
            ModelError::Fatal { status, .. } => match status {
                401 | 403 => TurnErrorType::ModelAuth,
                _ => TurnErrorType::ModelRejected,
            },
            ModelError::RetryExhausted { .. } => TurnErrorType::ModelRetryExhausted,
            ModelError::ResponseLoop { .. } => TurnErrorType::ModelResponseLoop,
            ModelError::VisionUnsupported { .. } => TurnErrorType::ModelVisionUnsupported,
            ModelError::Parse { .. } => TurnErrorType::ModelParse,
            ModelError::ProviderMismatch { .. } => TurnErrorType::ModelProviderMismatch,
            ModelError::Timeout { .. } => TurnErrorType::ModelTimeout,
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

    /// Announce each retry this client spends on `emitter`, the stream of the agent about to
    /// call it, as a `warn` naming the attempt, its cause and the delay before the next.
    ///
    /// Called by the agent rather than set by the [factory](crate::client::ClientFactory),
    /// because the factory is handed an agent's origin and the stream is scoped to its id. A
    /// client that never retries (a scripted mock, a replayed recording) has nothing to
    /// announce, which is the default; a decorator forwards it to the client it wraps.
    fn announce_retries_on(&self, emitter: &Emitter) {
        let _ = emitter;
    }
}

#[cfg(test)]
#[path = "model.test.rs"]
mod tests;
