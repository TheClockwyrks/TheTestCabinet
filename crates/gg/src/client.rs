//! The gg **model clients**: the concrete providers behind the
//! [`ModelClient`] trait, plus the slot → client
//! resolution the loop uses.
//!
//! Two providers ship in Phase 0:
//!
//! - [`OpenRouterClient`] — talks to OpenRouter's OpenAI-compatible chat-completions
//!   endpoint. It reads `OPENROUTER_API_KEY` from the environment, sends the
//!   recommended identity headers, and maps the run's [`Message`]s and
//!   [`ToolDefinition`]s to the OpenAI wire shape and the response back to a
//!   [`ModelResponse`]. Request building, response parsing, status classification,
//!   and backoff timing are factored into **pure functions** ([`build_request_body`],
//!   [`parse_response`], [`classify_status`], [`backoff_delay`]) so they are unit
//!   tested against recorded JSON with **no network**.
//! - [`MockClient`] — a scripted, offline client that replays a fixed list of
//!   [`ModelResponse`]s one per [`complete`](ModelClient::complete) call, ignoring its
//!   inputs. Its [default script](MockClient::with_default_script) writes a minimal
//!   playable `index.html` then finishes, so the whole loop + tools + telemetry runs
//!   deterministically with no key.
//!
//! # Resilience
//!
//! A known failure of an existing harness is discarding a whole run on a single
//! transient API error. [`OpenRouterClient`] guards against that with **bounded
//! exponential backoff** ([`RetryPolicy`]): it retries `429`, `5xx`, and transport
//! errors up to a small cap, and only then returns
//! [`ModelError::RetryExhausted`]. A `4xx`
//! (auth or otherwise) returns [`ModelError::Fatal`]
//! immediately — retrying will not help. The retry loop lives **inside the client**,
//! so a caller only ever decides "retry this whole turn later?" for a retryable
//! error versus "give up" for a fatal one.
//!
//! # Provider selection
//!
//! [`client_for_slot`] turns a [`GgSlotBinding`] into a boxed client. It selects the
//! [`MockClient`] when **either** of these holds (checked in this order):
//!
//! 1. the `TCAB_GG_FAKE_MODEL` environment variable is set to a non-empty value — a
//!    global offline override for CI and local iteration;
//! 2. the binding's `model_id` names the `mock` provider by prefix (`mock/…` or
//!    `mock:…`).
//!
//! Otherwise it builds an [`OpenRouterClient`], which requires `OPENROUTER_API_KEY`
//! and returns [`ModelError::MissingApiKey`]
//! when it is absent — a real binding with no key fails loudly rather than silently
//! falling back to the mock.
//!
//! # The mock is test infrastructure, not a launchable model
//!
//! [`MockClient`] exists so gg's own suite can drive the **real** binary offline —
//! the whole spawn → wait → return path and its workflow, issue-review, FSM,
//! and speculative variants are exercised through [`mock_client_for`], not around it.
//! It is **not** a model anyone can run a real test case on: the launch path resolves
//! every bound model's [context window](test_cabinet_core::gg::GgInvocation::model_windows)
//! from the model catalog and refuses a run it cannot resolve one for, and no catalog
//! or provider lists a `mock/…` id. A mock binding therefore reaches gg only from a
//! test that constructs the invocation itself (supplying the windows a launch would
//! have), which is exactly the intended blast radius.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};
use test_cabinet_core::gg::{GgSlotBinding, ROOT_AGENT};
use test_cabinet_core::metrics::{Cost, TokenCounts};

use crate::model::{
    FinishReason, Message, ModelClient, ModelError, ModelResponse, Role, ToolCall, ToolDefinition,
};

/// OpenRouter's OpenAI-compatible API root.
const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
/// The environment variable holding the OpenRouter credential.
const API_KEY_ENV: &str = "OPENROUTER_API_KEY";
/// The environment variable that forces the offline [`MockClient`] for any binding.
const FAKE_MODEL_ENV: &str = "TCAB_GG_FAKE_MODEL";
/// The provider token that selects the mock (as `provider` or a `model_id` prefix).
const MOCK_PROVIDER: &str = "mock";
/// `X-Title` sent to OpenRouter to identify the app on its dashboards.
const GG_X_TITLE: &str = "The Test Cabinet gg";
/// `HTTP-Referer` sent to OpenRouter — an app-identity hint used for its rankings,
/// not a navigational URL.
const GG_HTTP_REFERER: &str = "https://github.com/the-test-cabinet/gg";
/// Maximum length of a provider error body copied into a [`ModelError`].
const ERROR_BODY_CAP: usize = 2000;

/// The skill name the [default mock script](MockClient::with_default_script) reads, so an
/// offline run can seed `.gg/skills/<name>.md` and demonstrate the skills capability.
pub const DEFAULT_MOCK_SKILL: &str = "getting-started";

/// The memory name the [default mock script](MockClient::with_default_script) writes, so an
/// offline run demonstrates the memories capability (a curated, pinned memory + its
/// `MemoryState` telemetry).
pub const DEFAULT_MOCK_MEMORY: &str = "game-plan";

/// The id of the first task the [default mock script](MockClient::with_default_script) adds,
/// which the second task is blocked by (and which the script later completes to unblock it).
pub const DEFAULT_MOCK_TASK_SCAFFOLD: &str = "scaffold";

/// The id of the second task the [default mock script](MockClient::with_default_script) adds,
/// blocked by [`DEFAULT_MOCK_TASK_SCAFFOLD`] — the demonstrated blocked-by edge.
pub const DEFAULT_MOCK_TASK_MOVEMENT: &str = "movement";

/// The prefix — and so the id — of the epic the [default mock script](MockClient::with_default_script)
/// creates, so an offline run with the project-management capability demonstrates the board.
pub const DEFAULT_MOCK_EPIC: &str = "CORE";

/// The id of the first issue the [default mock script](MockClient::with_default_script) creates
/// (grouped under [`DEFAULT_MOCK_EPIC`]), which the second issue is blocked by (and which a
/// later attempt tries to cyclically block on the second). Numbered by the board, not chosen by the
/// script.
pub const DEFAULT_MOCK_ISSUE_RENDER: &str = "CORE-1";

/// The id of the second issue the [default mock script](MockClient::with_default_script) creates,
/// blocked by [`DEFAULT_MOCK_ISSUE_RENDER`] — the demonstrated board blocked-by edge.
pub const DEFAULT_MOCK_ISSUE_INPUT: &str = "CORE-2";

/// The deterministic summary the [`MockClient`] returns for a
/// [compaction](crate::compaction) summary request, so an offline run crosses a real
/// compaction boundary without network. Recognizable in tests as proof the summarizer's
/// model call was answered by the mock's marker path.
pub const MOCK_COMPACTION_SUMMARY: &str = "Building a minimal HTML5 canvas game in index.html; scaffolding and player movement \
     were the plan. Continue implementing and refining the game.";

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/// Bounded exponential-backoff policy for [`OpenRouterClient`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    /// Total attempts (the first try plus retries) before giving up.
    pub max_attempts: u32,
    /// Delay before the first retry; doubled each subsequent retry.
    pub base_delay: Duration,
    /// Ceiling on any single backoff delay.
    pub max_delay: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 4,
            base_delay: Duration::from_millis(500),
            max_delay: Duration::from_secs(8),
        }
    }
}

/// The backoff delay before the retry that follows attempt `attempt` (1-based):
/// `base_delay * 2^(attempt-1)`, capped at `max_delay`. Pure, so the schedule is unit
/// tested without waiting.
pub fn backoff_delay(attempt: u32, policy: &RetryPolicy) -> Duration {
    // Cap the shift so the doubling can never overflow; `saturating_mul` and `min`
    // keep the result within `max_delay` regardless.
    let shift = attempt.saturating_sub(1).min(16);
    policy
        .base_delay
        .saturating_mul(1u32 << shift)
        .min(policy.max_delay)
}

/// How an HTTP status should be treated by the retry loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusClass {
    /// A `2xx`: parse the body as a completion.
    Success,
    /// A `429` or `5xx`: transient, worth retrying.
    Retryable,
    /// Any other status (notably `4xx` auth/validation): fatal, do not retry.
    Fatal,
}

/// Classify an HTTP status for the retry loop: `2xx` success, `429`/`5xx` retryable,
/// everything else fatal. Pure, so the classification is unit tested directly.
pub fn classify_status(status: u16) -> StatusClass {
    match status {
        200..=299 => StatusClass::Success,
        429 => StatusClass::Retryable,
        500..=599 => StatusClass::Retryable,
        _ => StatusClass::Fatal,
    }
}

// ---------------------------------------------------------------------------
// OpenRouter client
// ---------------------------------------------------------------------------

/// A [`ModelClient`] over OpenRouter's OpenAI-compatible chat-completions endpoint.
///
/// The [`reqwest::Client`] and `base_url` are injected via [`new`](Self::new) so tests
/// can construct one without touching the network; the request/response mapping is in
/// the pure [`build_request_body`]/[`parse_response`] functions. Non-streaming in
/// Phase 0 (robust); the seam for streaming is a future `complete` variant that reuses
/// the same request builder.
pub struct OpenRouterClient {
    http: reqwest::Client,
    base_url: String,
    model_id: String,
    api_key: String,
    retry: RetryPolicy,
    /// The session-wide [prompt-cache key](build_request_body) sent as `prompt_cache_key` — the
    /// run's session id, the same value on every agent's client. It steers the whole run's
    /// requests to one provider backend, so an agent's successive turns reuse the prefix the last
    /// turn cached and sibling agents that open on the same prefix reuse each other's. `None`
    /// leaves the key off the wire (the field is simply absent).
    cache_key: Option<String>,
}

impl OpenRouterClient {
    /// Construct a client from its parts. `base_url` is the API root (no trailing
    /// `/chat/completions`); pass an injected `http` and a test `base_url` to exercise
    /// it offline. `cache_key` is the stable [`prompt_cache_key`](build_request_body) this
    /// client stamps on every request; `None` sends none.
    pub fn new(
        base_url: impl Into<String>,
        http: reqwest::Client,
        model_id: impl Into<String>,
        api_key: impl Into<String>,
        retry: RetryPolicy,
        cache_key: Option<String>,
    ) -> Self {
        Self {
            http,
            base_url: base_url.into(),
            model_id: model_id.into(),
            api_key: api_key.into(),
            retry,
            cache_key,
        }
    }

    /// Build a live client for `binding`, reading `OPENROUTER_API_KEY` from the
    /// environment. Returns [`ModelError::MissingApiKey`] when the credential is
    /// absent or empty.
    ///
    /// `cache_key` is the session-wide [`prompt_cache_key`](build_request_body) stamped on every
    /// request — the whole run's session id, shared by the root and every subagent. Sharing it is
    /// deliberate: agents that open on the same prefix (same calling convention, the same
    /// autoloaded specs) then route to the same provider backend and reuse one another's cached
    /// prefix, and an agent's own successive turns stay on that backend so each turn reads the
    /// prefix the last one cached. `None` sends no key.
    pub fn from_binding(
        binding: &GgSlotBinding,
        cache_key: Option<&str>,
    ) -> Result<Self, ModelError> {
        let api_key = std::env::var(API_KEY_ENV)
            .ok()
            .filter(|k| !k.trim().is_empty())
            .ok_or(ModelError::MissingApiKey)?;
        Ok(Self::new(
            OPENROUTER_BASE_URL,
            reqwest::Client::new(),
            binding.model_id.clone(),
            api_key,
            RetryPolicy::default(),
            cache_key.map(str::to_string),
        ))
    }

    /// The chat-completions URL for this client's base.
    fn endpoint(&self) -> String {
        format!("{}/chat/completions", self.base_url.trim_end_matches('/'))
    }
}

#[async_trait::async_trait]
impl ModelClient for OpenRouterClient {
    async fn complete(
        &self,
        messages: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        let body = build_request_body(&self.model_id, messages, tools, self.cache_key.as_deref());
        self.send(body, messages).await
    }

    /// Offer `tool` and pin `tool_choice` to it, so the reply is the call rather than the model's
    /// judgement about whether to make one — the wire form of the default's intent, which cannot
    /// express the requirement.
    async fn complete_requiring(
        &self,
        messages: &[Message],
        tool: &ToolDefinition,
    ) -> Result<ModelResponse, ModelError> {
        let body = build_required_tool_request_body(
            &self.model_id,
            messages,
            tool,
            self.cache_key.as_deref(),
        );
        self.send(body, messages).await
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

impl OpenRouterClient {
    /// POST one already-built request body, with this client's retry/backoff policy and its
    /// classification of what came back — the shared transport behind both
    /// [`complete`](ModelClient::complete) and
    /// [`complete_requiring`](ModelClient::complete_requiring), which differ only in the body they
    /// build. `messages` is passed for the one thing the transport reads off it: whether the
    /// request carried pictures, which decides whether a fatal refusal is the recoverable
    /// [vision](ModelError::VisionUnsupported) one.
    async fn send(&self, body: Value, messages: &[Message]) -> Result<ModelResponse, ModelError> {
        let url = self.endpoint();
        let mut last_err = String::new();
        // Whether this request carries a picture at all. A provider's "no image route"
        // refusal is only recoverable-by-dropping-images if there were images to drop;
        // without that check a coincidentally-similar error body would be misread as one.
        let carries_images = messages.iter().any(|message| !message.images.is_empty());

        for attempt in 1..=self.retry.max_attempts {
            let sent = self
                .http
                .post(&url)
                .header(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {}", self.api_key),
                )
                .header("HTTP-Referer", GG_HTTP_REFERER)
                .header("X-Title", GG_X_TITLE)
                .json(&body)
                .send()
                .await;

            match sent {
                // Transport-level failure (connect/timeout/etc.): always retryable.
                Err(err) => last_err = format!("transport error: {err}"),
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    match classify_status(status) {
                        StatusClass::Success => {
                            let text = resp.text().await.map_err(|err| {
                                ModelError::Parse(format!("reading response body: {err}"))
                            })?;
                            return parse_response(&text);
                        }
                        StatusClass::Fatal => {
                            let body = resp.text().await.unwrap_or_default();
                            // A refusal of the *images* rather than of the request: the
                            // loop can recover from this one by dropping them and
                            // retrying, so it is reported as its own error rather than
                            // ending the run as an ordinary fatal 4xx.
                            if carries_images && is_image_unsupported(status, &body) {
                                return Err(ModelError::VisionUnsupported {
                                    model_id: self.model_id.clone(),
                                    message: truncate(&body),
                                });
                            }
                            return Err(ModelError::Fatal {
                                status,
                                message: truncate(&body),
                            });
                        }
                        StatusClass::Retryable => {
                            let body = resp.text().await.unwrap_or_default();
                            last_err = format!("HTTP {status}: {}", truncate(&body));
                        }
                    }
                }
            }

            if attempt < self.retry.max_attempts {
                tokio::time::sleep(backoff_delay(attempt, &self.retry)).await;
            }
        }

        Err(ModelError::RetryExhausted {
            attempts: self.retry.max_attempts,
            last: last_err,
        })
    }
}

/// Whether a fatal response says the request's **images** were the problem — the model
/// has no provider route that accepts image input.
///
/// OpenRouter answers such a request with `404 {"error":{"message":"No endpoints found
/// that support image input"}}`, and upstream providers word it their own way. The
/// match is therefore on the error body's wording rather than the status alone: a `404`
/// on its own means an unknown or deprecated model, which is not recoverable by
/// dropping a picture. Pure, so the recognized wordings are unit tested against recorded
/// bodies with no network.
pub fn is_image_unsupported(status: u16, body: &str) -> bool {
    // `400` covers providers that reject the multi-part content shape outright rather
    // than routing on it; `404` is OpenRouter's own "no endpoint supports this" answer.
    if !matches!(status, 400 | 404 | 422) {
        return false;
    }
    let body = body.to_lowercase();
    // Every recognized phrasing pairs an image/vision/multimodal noun with a
    // refusal, so an unrelated 404 that merely mentions an image cannot match.
    const PHRASES: &[&str] = &[
        "support image input",
        "support image_url",
        "support images",
        "image input is not supported",
        "does not support image",
        "do not support image",
        "not support vision",
        "does not support vision",
        "no vision support",
        "image input not supported",
        "multimodal input is not supported",
        "invalid content type",
    ];
    PHRASES.iter().any(|phrase| body.contains(phrase))
}

/// Truncate a provider error body to [`ERROR_BODY_CAP`] so a huge HTML error page
/// never floods a [`ModelError`].
fn truncate(body: &str) -> String {
    let body = body.trim();
    if body.len() <= ERROR_BODY_CAP {
        body.to_string()
    } else {
        let mut cut = ERROR_BODY_CAP;
        while !body.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…", &body[..cut])
    }
}

// ---------------------------------------------------------------------------
// Request building (pure)
// ---------------------------------------------------------------------------

/// Build the OpenAI-compatible request body for a turn. Pure and injectable — the
/// client serializes exactly this. `tool_choice` is set to `"auto"` only when tools
/// are offered; `usage: { include: true }` asks OpenRouter to return cost.
///
/// When `cache_key` is `Some` (and non-empty) it is sent as `prompt_cache_key`, the
/// caller-supplied hint a provider uses to keep a conversation's requests on one backend so
/// each turn reuses the prefix the previous turn cached. A run's turns share one key (see
/// [`OpenRouterClient::from_binding`]); dropping it lets two prefix-identical requests land on
/// different backends, and the second is billed fully uncached even though nothing changed.
/// `None` (or an empty key) omits the field entirely.
pub fn build_request_body(
    model_id: &str,
    messages: &[Message],
    tools: &[ToolDefinition],
    cache_key: Option<&str>,
) -> Value {
    let messages: Vec<Value> = messages.iter().map(wire_message).collect();
    let mut body = json!({
        "model": model_id,
        "messages": messages,
        "usage": { "include": true },
    });

    if let Some(key) = cache_key.filter(|key| !key.is_empty()) {
        body["prompt_cache_key"] = json!(key);
    }

    if !tools.is_empty() {
        let tools: Vec<Value> = tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters,
                    }
                })
            })
            .collect();
        body["tools"] = Value::Array(tools);
        body["tool_choice"] = json!("auto");
    }

    body
}

/// Build the request body for a turn that **must** be answered with a call to `tool`: the one tool
/// offered, and `tool_choice` naming it rather than `"auto"`.
///
/// Its one caller is [handoff compaction](crate::compaction::HandoffCompactor), which has a single
/// shot at a structured answer and no next turn in which to ask again. Pure, like
/// [`build_request_body`], so the wire shape is unit tested without network.
pub fn build_required_tool_request_body(
    model_id: &str,
    messages: &[Message],
    tool: &ToolDefinition,
    cache_key: Option<&str>,
) -> Value {
    let mut body = build_request_body(model_id, messages, std::slice::from_ref(tool), cache_key);
    body["tool_choice"] = json!({
        "type": "function",
        "function": { "name": tool.name },
    });
    body
}

/// Serialize one [`Message`] into the OpenAI wire shape. Assistant tool-call arguments
/// are re-encoded as a JSON **string**, as the API expects.
///
/// A message carrying [images](Message::images) becomes a **multi-part** content array
/// (`{type: "text"}` then one `{type: "image_url"}` per image, each a `data:` URL)
/// instead of a bare string; a text-only message is serialized exactly as before, so
/// the shape only changes where a picture is actually attached. Images ride on the
/// `tool` message answering the `read_file` that produced them — OpenRouter accepts
/// image parts there across providers, and keeping the picture attached to its own tool
/// result means the read and what it returned stay one item the context model can
/// account for, evict, and (if the provider turns out to refuse images) strip.
fn wire_message(message: &Message) -> Value {
    let mut obj = json!({ "role": role_str(message.role) });
    if !message.images.is_empty() {
        let mut parts: Vec<Value> = Vec::with_capacity(message.images.len() + 1);
        if let Some(content) = &message.content {
            parts.push(json!({ "type": "text", "text": content }));
        }
        for image in &message.images {
            parts.push(json!({
                "type": "image_url",
                "image_url": { "url": image.data_url() },
            }));
        }
        obj["content"] = Value::Array(parts);
    } else if let Some(content) = &message.content {
        obj["content"] = json!(content);
    }
    if !message.tool_calls.is_empty() {
        let calls: Vec<Value> = message
            .tool_calls
            .iter()
            .map(|call| {
                json!({
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": serde_json::to_string(&call.arguments)
                            .unwrap_or_else(|_| "{}".to_string()),
                    }
                })
            })
            .collect();
        obj["tool_calls"] = Value::Array(calls);
    }
    if let Some(id) = &message.tool_call_id {
        obj["tool_call_id"] = json!(id);
    }
    obj
}

/// The wire role token for a [`Role`].
fn role_str(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    }
}

// ---------------------------------------------------------------------------
// Response parsing (pure)
// ---------------------------------------------------------------------------

/// Parse an OpenRouter chat-completions response body into a [`ModelResponse`]. Pure,
/// so it is unit tested against recorded JSON. Tool-call arguments (a JSON string on
/// the wire) are parsed into structured [`Value`]s; usage is mapped onto
/// [`TokenCounts`] (cached input subtracted from input, reasoning subtracted from
/// output, per the metrics contract) and any reported cost onto [`Cost`].
pub fn parse_response(body: &str) -> Result<ModelResponse, ModelError> {
    let parsed: WireResponse = serde_json::from_str(body)
        .map_err(|err| ModelError::Parse(format!("{err}; body: {}", truncate(body))))?;

    // OpenRouter surfaces provider errors in a `2xx` envelope too; treat that as fatal
    // rather than silently returning an empty turn.
    if let Some(err) = parsed.error {
        return Err(ModelError::Parse(format!(
            "provider returned an error object: {}",
            err.message
        )));
    }

    let choice = parsed
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| ModelError::Parse("response had no choices".to_string()))?;

    let text = choice.message.content.filter(|content| !content.is_empty());

    let mut tool_calls = Vec::with_capacity(choice.message.tool_calls.len());
    for (index, call) in choice.message.tool_calls.into_iter().enumerate() {
        let arguments = parse_arguments(&call.function.arguments).map_err(|err| {
            ModelError::Parse(format!(
                "tool call #{index} ({}) had unparseable arguments: {err}",
                call.function.name
            ))
        })?;
        tool_calls.push(ToolCall {
            id: call.id,
            name: call.function.name,
            arguments,
        });
    }

    let mut finish_reason = map_finish_reason(choice.finish_reason.as_deref());
    // A provider that omits `finish_reason` but returned tool calls still stopped to
    // call tools; normalize that so the loop's dispatch decision is reliable.
    if finish_reason == FinishReason::Stop && !tool_calls.is_empty() {
        finish_reason = FinishReason::ToolCalls;
    }

    let (usage, cost) = map_usage(parsed.usage.as_ref());

    Ok(ModelResponse {
        text,
        tool_calls,
        finish_reason,
        usage,
        cost,
    })
}

/// Parse a tool call's `arguments` string. An empty string means "no arguments" and
/// maps to an empty object; anything else must be valid JSON.
fn parse_arguments(raw: &str) -> Result<Value, serde_json::Error> {
    if raw.trim().is_empty() {
        Ok(json!({}))
    } else {
        serde_json::from_str(raw)
    }
}

/// Map an OpenAI `finish_reason` string to a [`FinishReason`]. A missing reason maps to
/// [`FinishReason::Stop`] (callers normalize the tool-call case).
fn map_finish_reason(reason: Option<&str>) -> FinishReason {
    match reason {
        None | Some("stop") | Some("end_turn") => FinishReason::Stop,
        Some("tool_calls") | Some("function_call") => FinishReason::ToolCalls,
        Some("length") | Some("max_tokens") => FinishReason::Length,
        Some("content_filter") => FinishReason::ContentFilter,
        Some(other) => FinishReason::Other(other.to_string()),
    }
}

/// Map wire usage onto the shared [`TokenCounts`]/[`Cost`] contract. Cached input is
/// subtracted from the input total and reasoning from the output total (per the
/// metrics contract), using saturating subtraction so a provider's slightly
/// inconsistent details can never underflow.
fn map_usage(usage: Option<&WireUsage>) -> (TokenCounts, Option<Cost>) {
    let Some(usage) = usage else {
        return (TokenCounts::default(), None);
    };

    let cached_input = usage
        .prompt_tokens_details
        .as_ref()
        .and_then(|details| details.cached_tokens);
    let reasoning = usage
        .completion_tokens_details
        .as_ref()
        .and_then(|details| details.reasoning_tokens);

    let uncached_input = usage
        .prompt_tokens
        .map(|prompt| prompt.saturating_sub(cached_input.unwrap_or(0)));
    let output = usage
        .completion_tokens
        .map(|completion| completion.saturating_sub(reasoning.unwrap_or(0)));

    let counts = TokenCounts {
        uncached_input,
        cached_input,
        output,
        reasoning,
    };

    let cost = usage.cost.map(|cost| Cost {
        comparable: Some(cost),
        actual: Some(cost),
    });

    (counts, cost)
}

// ---------------------------------------------------------------------------
// Wire response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct WireResponse {
    #[serde(default)]
    choices: Vec<WireChoice>,
    #[serde(default)]
    usage: Option<WireUsage>,
    #[serde(default)]
    error: Option<WireError>,
}

#[derive(Debug, Deserialize)]
struct WireError {
    #[serde(default)]
    message: String,
}

#[derive(Debug, Deserialize)]
struct WireChoice {
    message: WireRespMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WireRespMessage {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<WireRespToolCall>,
}

#[derive(Debug, Deserialize)]
struct WireRespToolCall {
    #[serde(default)]
    id: String,
    function: WireRespFunction,
}

#[derive(Debug, Deserialize)]
struct WireRespFunction {
    name: String,
    #[serde(default)]
    arguments: String,
}

#[derive(Debug, Deserialize)]
struct WireUsage {
    #[serde(default)]
    prompt_tokens: Option<u64>,
    #[serde(default)]
    completion_tokens: Option<u64>,
    #[serde(default)]
    cost: Option<f64>,
    #[serde(default)]
    prompt_tokens_details: Option<WirePromptDetails>,
    #[serde(default)]
    completion_tokens_details: Option<WireCompletionDetails>,
}

#[derive(Debug, Deserialize)]
struct WirePromptDetails {
    #[serde(default)]
    cached_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct WireCompletionDetails {
    #[serde(default)]
    reasoning_tokens: Option<u64>,
}

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

/// A scripted, offline [`ModelClient`] for CI and local iteration.
///
/// It replays a fixed list of [`ModelResponse`]s, advancing one per
/// [`complete`](ModelClient::complete) call and **ignoring its inputs**. Once the
/// script is exhausted it returns a terminal [`FinishReason::Stop`] message so any
/// loop driving it always terminates.
pub struct MockClient {
    model_id: String,
    script: Vec<ModelResponse>,
    cursor: AtomicUsize,
    /// Whether this mock replays the [default script](Self::with_default_script), whose board turns
    /// must not run again inside an agent the board itself dispatched. See
    /// [`complete`](ModelClient::complete).
    default_script: bool,
}

impl MockClient {
    /// A mock bound to `model_id` that replays `script` in order.
    pub fn new(model_id: impl Into<String>, script: Vec<ModelResponse>) -> Self {
        Self {
            model_id: model_id.into(),
            script,
            cursor: AtomicUsize::new(0),
            default_script: false,
        }
    }

    /// How many turns this mock has actually been asked for — the script cursor, read live.
    ///
    /// Test-only, like [`component_bound_tools`](crate::sandbox) and for the same reason: no part of
    /// a run asks a client how many times it has been called, and a production affordance nothing
    /// produces is a claim about the design that is not true.
    ///
    /// It exists so a test can prove a loop **stopped** rather than merely recorded that it should
    /// have. A run that ends on an execution ceiling is otherwise indistinguishable, from telemetry
    /// alone, from one that carried on and reported the ceiling afterwards: both emit the breach.
    /// The number of times the model was called is the direct evidence, and this is the only place
    /// it exists.
    ///
    /// It counts scripted turns only. The off-script answers the message-driven mocks give (a
    /// reviewer's verdict, a speculation attempt) deliberately never touch the cursor, so those
    /// clients report zero — which is correct: they took no turn *of the script* they were built
    /// from.
    #[cfg(test)]
    pub fn turns_taken(&self) -> usize {
        self.cursor.load(Ordering::SeqCst)
    }

    /// The default script exercising every Phase 1 capability offline:
    ///
    /// 1. `read_skill` loads the [`DEFAULT_MOCK_SKILL`] guide (the skills capability's
    ///    pinned, compaction-retained read + its `SkillsState`);
    /// 2. `write_memory` records a [`DEFAULT_MOCK_MEMORY`] note (the memories capability's
    ///    bounded, model-curated, pinned memory + its `MemoryState`);
    /// 3. `add_task` adds the [`DEFAULT_MOCK_TASK_SCAFFOLD`] task;
    /// 4. `add_task` adds the [`DEFAULT_MOCK_TASK_MOVEMENT`] task **blocked by** the scaffold
    ///    task (the demonstrated blocked-by edge);
    /// 5. `set_blocked_by` tries to *also* block the scaffold task on the movement task — a
    ///    **cycle**, which gg refuses (the tool result comes back `ok: false`), demonstrating
    ///    the DAG's acyclicity guard;
    /// 6. `complete_task` marks the scaffold task done (so the movement task becomes ready);
    /// 7. `create_epic` opens the epic prefixed [`DEFAULT_MOCK_EPIC`] (the project-management
    ///    capability's grouping);
    /// 8. `create_issue` adds the [`DEFAULT_MOCK_ISSUE_RENDER`] issue (structured scope +
    ///    completion criteria), grouped under the epic;
    /// 9. `create_issue` adds the [`DEFAULT_MOCK_ISSUE_INPUT`] issue **blocked by** the render
    ///    issue (the demonstrated board blocked-by edge);
    /// 10. `set_issue_blocked_by` tries to *also* block the render issue on the input issue — a
    ///     **cycle**, which gg refuses (the tool result comes back `ok: false`), demonstrating the
    ///     board DAG's acyclicity guard;
    /// 11. `write_file` creates a minimal playable `index.html` (a tiny HTML5 canvas game);
    /// 12. a final tool-free turn reports completion and stops.
    ///
    /// This drives the whole loop + tools + telemetry deterministically with no key.
    ///
    /// The `read_skill`, `write_memory`, task, and board calls are harmless when the run offers
    /// the matching capability off — each simply comes back as an unknown/unavailable tool error
    /// and the script proceeds — so a workspace without a seeded `.gg/skills/`, or a run with
    /// memories, tasks, or the board ablated, still runs the remaining turns unchanged.
    pub fn with_default_script(model_id: impl Into<String>) -> Self {
        let read_skill_call = ModelResponse {
            text: Some("Reading the getting-started skill before building.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_read_skill".to_string(),
                name: "read_skill".to_string(),
                arguments: json!({ "name": DEFAULT_MOCK_SKILL }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(900),
                cached_input: None,
                output: Some(40),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0011),
                actual: Some(0.0011),
            }),
        };
        let write_memory_call = ModelResponse {
            text: Some("Noting the game plan as a memory before building.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_write_memory".to_string(),
                name: "write_memory".to_string(),
                arguments: json!({
                    "name": DEFAULT_MOCK_MEMORY,
                    "description": "The plan for the game I am building.",
                    "body": "Build a single-file HTML5 canvas game in index.html: an arrow-key \
                             player that must reach a goal. Keep it minimal and playable.",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1000),
                cached_input: None,
                output: Some(50),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0015),
                actual: Some(0.0015),
            }),
        };
        let add_scaffold_task = ModelResponse {
            text: Some("Planning the work: first, scaffold the page.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_add_scaffold".to_string(),
                name: "add_task".to_string(),
                arguments: json!({
                    "id": DEFAULT_MOCK_TASK_SCAFFOLD,
                    "title": "Scaffold index.html with a canvas and game loop",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1050),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0012),
                actual: Some(0.0012),
            }),
        };
        let add_movement_task = ModelResponse {
            text: Some("Then player movement, which is blocked by the scaffold.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_add_movement".to_string(),
                name: "add_task".to_string(),
                arguments: json!({
                    "id": DEFAULT_MOCK_TASK_MOVEMENT,
                    "title": "Add arrow-key player movement",
                    "blockedBy": [DEFAULT_MOCK_TASK_SCAFFOLD],
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1080),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0012),
                actual: Some(0.0012),
            }),
        };
        // An intentionally cyclic edge: the movement task is already blocked by the scaffold
        // task, so also blocking the scaffold task on the movement task closes a loop. gg
        // refuses it (the result comes back `ok: false`), demonstrating the cycle guard.
        let cyclic_edge = ModelResponse {
            text: Some("Attempting to also block the scaffold on movement.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_cyclic_edge".to_string(),
                name: "set_blocked_by".to_string(),
                arguments: json!({
                    "id": DEFAULT_MOCK_TASK_SCAFFOLD,
                    "blockedBy": [DEFAULT_MOCK_TASK_MOVEMENT],
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1100),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0012),
                actual: Some(0.0012),
            }),
        };
        let complete_scaffold_task = ModelResponse {
            text: Some("Scaffolding done — marking it complete to unblock movement.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_complete_scaffold".to_string(),
                name: "complete_task".to_string(),
                arguments: json!({ "id": DEFAULT_MOCK_TASK_SCAFFOLD }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1120),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0012),
                actual: Some(0.0012),
            }),
        };
        let create_epic = ModelResponse {
            text: Some("Decomposing the build: opening an epic for the core loop.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_create_epic".to_string(),
                name: "create_epic".to_string(),
                arguments: json!({
                    "prefix": DEFAULT_MOCK_EPIC,
                    "title": "Core game loop",
                    "description": "Everything needed to render and drive the playable loop.",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1140),
                cached_input: None,
                output: Some(35),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0013),
                actual: Some(0.0013),
            }),
        };
        let create_render_issue = ModelResponse {
            text: Some("First issue: the render loop, with an explicit scope.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_create_render".to_string(),
                name: "create_issue".to_string(),
                arguments: json!({
                    "title": "Render loop on the canvas",
                    "inScope": "Clear the canvas each frame and draw the player and goal.",
                    "outOfScope": "Input handling and win detection (separate issues).",
                    "completionCriteria": "The player and goal are visible and redraw at ~60fps.",
                    "epicId": DEFAULT_MOCK_EPIC,
                    "agent": ROOT_AGENT,
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1160),
                cached_input: None,
                output: Some(45),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0016),
                actual: Some(0.0016),
            }),
        };
        let create_input_issue = ModelResponse {
            text: Some("Second issue: input handling, blocked by the render loop.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_create_input".to_string(),
                name: "create_issue".to_string(),
                arguments: json!({
                    "title": "Arrow-key input handling",
                    "inScope": "Read arrow keys and move the player within the canvas bounds.",
                    "outOfScope": "Rendering (the render-loop issue owns drawing).",
                    "completionCriteria": "Arrow keys move the player smoothly without leaving the canvas.",
                    "blockedBy": [DEFAULT_MOCK_ISSUE_RENDER],
                    "epicId": DEFAULT_MOCK_EPIC,
                    "agent": ROOT_AGENT,
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1180),
                cached_input: None,
                output: Some(45),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0016),
                actual: Some(0.0016),
            }),
        };
        // An intentionally cyclic edge: the input issue is already blocked by the render issue,
        // so also blocking the render issue on the input issue closes a loop. gg refuses it (the
        // result comes back `ok: false`), demonstrating the board's cycle guard.
        let cyclic_issue_edge = ModelResponse {
            text: Some("Attempting to also block the render issue on input.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_cyclic_issue".to_string(),
                name: "set_issue_blocked_by".to_string(),
                arguments: json!({
                    "id": DEFAULT_MOCK_ISSUE_RENDER,
                    "blockedBy": [DEFAULT_MOCK_ISSUE_INPUT],
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1200),
                cached_input: None,
                output: Some(30),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0013),
                actual: Some(0.0013),
            }),
        };
        let write_call = ModelResponse {
            text: Some("Creating a minimal playable game in index.html.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_write_index".to_string(),
                name: "write_file".to_string(),
                arguments: json!({
                    "path": "index.html",
                    "contents": DEFAULT_GAME_HTML,
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: TokenCounts {
                uncached_input: Some(1200),
                cached_input: None,
                output: Some(180),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0042),
                actual: Some(0.0042),
            }),
        };
        let finish = ModelResponse {
            text: Some(
                "Done — index.html holds a minimal HTML5 canvas game; open it to play.".to_string(),
            ),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: TokenCounts {
                uncached_input: Some(1400),
                cached_input: None,
                output: Some(60),
                reasoning: None,
            },
            cost: Some(Cost {
                comparable: Some(0.0021),
                actual: Some(0.0021),
            }),
        };
        Self {
            default_script: true,
            ..Self::new(
                model_id,
                vec![
                    read_skill_call,
                    write_memory_call,
                    add_scaffold_task,
                    add_movement_task,
                    cyclic_edge,
                    complete_scaffold_task,
                    create_epic,
                    create_render_issue,
                    create_input_issue,
                    cyclic_issue_edge,
                    write_call,
                    finish,
                ],
            )
        }
    }

    /// A script exercising [agent-managed context](crate::tools) offline end to end:
    ///
    /// 1. `write_file` creates a chunky `level.json` (working material to reclaim);
    /// 2. `read_file` reads it back — a [`FileView`](test_cabinet_core::gg::GgContextSource::FileView)
    ///    enters the window;
    /// 3. `evict_file_view { path: "level.json" }` drops that file view, reclaiming its tokens
    ///    (the next context breakdown shows the file-view band fall to zero);
    /// 4. `archive_thread` moves the older turns out of the live window into the searchable
    ///    archive (reclaiming more), keeping the current turn;
    /// 5. `search_archive { query: "level.json" }` recovers the archived reference on demand,
    ///    proving the archived history is still reachable though out of the window;
    /// 6. a final tool-free turn stops.
    ///
    /// Used by the offline agent-managed-context e2e; requires a run with the
    /// [`agent-managed-context`](test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT) and
    /// filesystem capabilities enabled so every call resolves to a real tool.
    #[cfg(test)]
    pub fn with_agent_managed_context_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let write_level = ModelResponse {
            text: Some("Writing a level file I will inspect.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_write_level".to_string(),
                name: "write_file".to_string(),
                arguments: json!({ "path": "level.json", "contents": AMC_LEVEL_JSON }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 120),
            cost: None,
        };
        let read_level = ModelResponse {
            text: Some("Reading level.json to check the layout.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_read_level".to_string(),
                name: "read_file".to_string(),
                arguments: json!({ "path": "level.json" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(950, 40),
            cost: None,
        };
        let evict_level = ModelResponse {
            text: Some(
                "I have what I need from level.json; evicting it to reclaim context.".to_string(),
            ),
            tool_calls: vec![ToolCall {
                id: "call_evict_level".to_string(),
                name: "evict_file_view".to_string(),
                arguments: json!({ "path": "level.json" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(1200, 40),
            cost: None,
        };
        let archive = ModelResponse {
            text: Some("Archiving the earlier thread to keep my window lean.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_archive".to_string(),
                name: "archive_thread".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(700, 30),
            cost: None,
        };
        let search = ModelResponse {
            text: Some("Recovering the archived level reference.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_search".to_string(),
                name: "search_archive".to_string(),
                arguments: json!({ "query": "level.json" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(400, 30),
            cost: None,
        };
        let finish = ModelResponse {
            text: Some("Done — managed my context along the way.".to_string()),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(500, 40),
            cost: None,
        };
        Self::new(
            model_id,
            vec![
                write_level,
                read_level,
                evict_level,
                archive,
                search,
                finish,
            ],
        )
    }

    /// A script exercising the [planning](crate::planning) capability offline end to end —
    /// the full read-only-plan-then-implement cycle including the context reset:
    ///
    /// 1. `enter_plan_mode` puts the loop into read-only mode (the loop emits
    ///    [`Planning`](test_cabinet_core::gg::GgTelemetryKind::Planning)`{phase: entered}` and
    ///    injects the plan-mode guidance);
    /// 2. `list_dir` — a read-only exploration call that **is** allowed in plan mode;
    /// 3. `write_file { path: "premature.txt" }` — a **mutating** call that is **refused** in plan
    ///    mode (the tool result comes back `ok: false`; the file is never written), demonstrating
    ///    the read-only restriction;
    /// 4. `submit_plan { plan }` — the loop emits `Planning{phase: submitted}`, clears the
    ///    exploration history (keeping the pinned prefix), seeds the fresh implementation context
    ///    with the plan (pinned), restores the full toolset, and emits
    ///    `Planning{phase: implementing}`;
    /// 5. `write_file { path: "index.html" }` — now allowed, the model implements from the clean
    ///    window;
    /// 6. a final tool-free turn stops.
    ///
    /// Used by the offline planning e2e; requires a run with the
    /// [`planning`](test_cabinet_core::gg::CAPABILITY_PLANNING) and filesystem capabilities
    /// enabled so every call resolves to a real tool (or is refused by the plan-mode guard).
    #[cfg(test)]
    pub fn with_planning_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let enter = ModelResponse {
            text: Some(
                "This needs some thought — entering plan mode to explore first.".to_string(),
            ),
            tool_calls: vec![ToolCall {
                id: "call_enter_plan".to_string(),
                name: "enter_plan_mode".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 30),
            cost: None,
        };
        let explore = ModelResponse {
            text: Some("Looking at the workspace layout.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_explore".to_string(),
                name: "list_dir".to_string(),
                arguments: json!({ "path": "." }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(950, 30),
            cost: None,
        };
        // A mutating call while in plan mode — refused by the read-only guard; `premature.txt`
        // must never be written.
        let premature_write = ModelResponse {
            text: Some("Trying to write a file (should be blocked in plan mode).".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_premature".to_string(),
                name: "write_file".to_string(),
                arguments: json!({ "path": "premature.txt", "contents": "too soon" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(1000, 30),
            cost: None,
        };
        let submit = ModelResponse {
            text: Some("Plan ready — submitting it.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_submit_plan".to_string(),
                name: "submit_plan".to_string(),
                arguments: json!({
                    "plan": "1. Create index.html with a canvas. 2. Add an arrow-key player and a \
                             goal. 3. Draw and update each frame.",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(1050, 60),
            cost: None,
        };
        let implement = ModelResponse {
            text: Some("Implementing the plan: writing index.html.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_impl_index".to_string(),
                name: "write_file".to_string(),
                arguments: json!({ "path": "index.html", "contents": DEFAULT_GAME_HTML }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(1100, 180),
            cost: None,
        };
        let finish = ModelResponse {
            text: Some("Done — implemented the plan in index.html.".to_string()),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(1200, 50),
            cost: None,
        };
        Self::new(
            model_id,
            vec![enter, explore, premature_write, submit, implement, finish],
        )
    }

    /// The **parent** side of the offline [subagents](crate::subagents) e2e: a script that
    /// delegates a piece of work, waits for the result, then finishes.
    ///
    /// 1. `spawn_subagent { prompt, slot: "subagent" }` schedules a child on the `subagent` slot;
    /// 2. `wait_for_subagents {}` blocks (freeing the parent's slot) until every outstanding child
    ///    returns, and receives their return values;
    /// 3. a final tool-free turn stops.
    ///
    /// Pairs with [`with_subagent_child_script`](Self::with_subagent_child_script) (bound to the
    /// `subagent` slot) so an offline run exercises spawn → schedule → run → return under the cap.
    /// Selected in production by a mock `model_id` naming `subagent-parent` (see
    /// [`mock_client_for`]), so the delegation path is drivable offline through the real binary and
    /// not only the in-crate tests.
    pub fn with_subagent_parent_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let spawn = ModelResponse {
            text: Some("Delegating the greeting file to a subagent.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_spawn".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({
                    "prompt": "Create a file with a greeting in it.",
                    "agent": "subagent",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 40),
            cost: None,
        };
        let wait = ModelResponse {
            text: Some("Waiting for the subagent to finish.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_wait".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(950, 30),
            cost: None,
        };
        let finish = ModelResponse {
            text: Some("The subagent finished; the game is assembled.".to_string()),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(1000, 50),
            cost: None,
        };
        Self::new(model_id, vec![spawn, wait, finish])
    }

    /// The **workflow** parent side of the offline [workflows](crate::agent) e2e: a script that
    /// runs a small **two-stage** declared workflow, then finishes.
    ///
    /// 1. `run_workflow` declares two stages on the `worker` slot: stage **generate** fans out over
    ///    two items (`player`, `world`) — two subagents — and stage **assemble** has a single item
    ///    whose brief references `{{prior}}`, so one subagent consolidates the first stage's two
    ///    results (fan-out then sequencing). gg drives the whole thing over the subagent scheduler
    ///    and returns the final result;
    /// 2. a final tool-free turn stops.
    ///
    /// Pairs with worker-slot child scripts (each stage's subagents run on `worker`). Selected in
    /// production by a mock `model_id` naming `workflow-parent` (see [`mock_client_for`]), so the
    /// declared fan-out + sequencing path is drivable **offline through the real binary** (bind the
    /// primary slot to a `mock/…-workflow-parent` model and a `worker` slot to a
    /// `mock/…-subagent-child` model, with the `subagents` and `workflows` capabilities enabled).
    pub fn with_workflow_parent_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let run = ModelResponse {
            text: Some(
                "Running a two-stage workflow: generate the parts, then assemble them.".to_string(),
            ),
            tool_calls: vec![ToolCall {
                id: "call_workflow".to_string(),
                name: "run_workflow".to_string(),
                arguments: json!({
                    "stages": [
                        {
                            "name": "generate",
                            "prompt": "Create the {{item}} component of the game.",
                            "items": ["player", "world"],
                            "agent": "worker"
                        },
                        {
                            "name": "assemble",
                            "prompt": "Assemble the finished components into the game. Prior \
                                       results:\n{{prior}}",
                            "items": ["assemble"],
                            "agent": "worker"
                        }
                    ]
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 60),
            cost: None,
        };
        let finish = ModelResponse {
            text: Some("The workflow finished; the game is assembled.".to_string()),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(1000, 40),
            cost: None,
        };
        Self::new(model_id, vec![run, finish])
    }

    /// The **parent** side of the offline
    /// [issue reviews](https://docs.testcabinet.ai/gg/project-management/)
    /// e2e: a **message-driven** mock (its behavior lives in [`complete`](ModelClient::complete),
    /// keyed on an `issue-review-parent` model id) so one model can play all three roles the
    /// [auto-dispatch](https://docs.testcabinet.ai/gg/project-management/) model puts the primary
    /// slot in — since the root, the agent gg auto-dispatches to implement the issue, and each fix
    /// agent the review loop dispatches all resolve the primary slot:
    ///
    /// - **the root**: `create_epic` (prefix [`MOCK_ISSUE_REVIEW_PREFIX`]) + `create_issue`, which gg
    ///   numbers `RVIEW-1` (the call carries the scope
    ///   and completion criteria), then finish — submitting the issue auto-dispatches an agent to
    ///   implement it;
    /// - **the dispatched issue agent** (its brief is the issue's structured fields): do the initial
    ///   work ([`MOCK_REVIEW_WORKER_FILE`]) then finish, which sends the issue to its
    ///   [reviewer](Self::with_review_reviewer_script) — which requests one change;
    /// - **the same agent, re-dispatched** (its brief now carries the requested changes): write the
    ///   review fix marker ([`MOCK_REVIEW_FIX_FILE`]) and finish again, and the re-review
    ///   approves.
    ///
    /// Constructed with an empty script because it never consults one; the role is read from the
    /// brief in the messages (stable across the instance's turns) and the turn from the instance's
    /// own cursor. Selected in production by a mock `model_id` naming `issue-review-parent` (see
    /// [`mock_client_for`]), so the review → fix → approve cycle is drivable **offline through the
    /// real binary**: bind the primary slot to a `mock/…-issue-review-parent` model and a `reviewer`
    /// slot to a `mock/…-review-reviewer` model, with `project-management` enabled and the Root's
    /// roster naming an implementer and a reviewer.
    pub fn with_issue_review_parent_script(model_id: impl Into<String>) -> Self {
        Self::new(model_id, Vec::new())
    }

    /// The **reviewer** side of the offline issue-review e2e: a message-driven verdict (its behavior
    /// lives in [`complete`](ModelClient::complete), keyed on a `review-reviewer` model id, so a
    /// fresh instance per review round reads the diff it is given). Constructed with an empty script
    /// because it never consults one. Documented as a constructor for symmetry with the parent and
    /// worker; production selects it via [`mock_client_for`].
    pub fn with_review_reviewer_script(model_id: impl Into<String>) -> Self {
        Self::new(model_id, Vec::new())
    }

    /// The **worker** side of the offline issue-review e2e: a message-driven two-turn worker (its
    /// behavior lives in [`complete`](ModelClient::complete), keyed on a `review-worker` model id) —
    /// it writes its initial work, or the review fix marker on a fix pass, then finishes. Empty
    /// script for the same reason as the reviewer; production selects it via [`mock_client_for`].
    pub fn with_review_worker_script(model_id: impl Into<String>) -> Self {
        Self::new(model_id, Vec::new())
    }

    /// The offline driver for a [`tdd`](crate::fsm) [FSM-driven](crate::fsm) run: a script that is
    /// **kept in order** by the engine — it *tries* to advance before writing any test (which the
    /// engine refuses), then writes the tests, advances to `implement`, implements, advances to
    /// `verify`, and stops.
    ///
    /// 1. `advance_state` — attempted with **no test written yet**; gg refuses it (the
    ///    [`write_tests` → `implement`](crate::fsm) guard is unmet), so the run stays in `write_tests`;
    /// 2. `write_file` [`MOCK_FSM_TEST_FILE`] — the tests;
    /// 3. `advance_state` — now a test exists, so gg allows it → `implement`;
    /// 4. `write_file` [`MOCK_FSM_IMPL_FILE`] — the implementation;
    /// 5. `advance_state` → `verify`;
    /// 6. a final tool-free turn stops.
    ///
    /// The mock replays this fixed script regardless of the refusal (it ignores tool results), so the
    /// refused first advance is a genuine, engine-enforced no-op — proof the order holds. Selected in
    /// production by a mock `model_id` naming `fsm-tdd` (see [`mock_client_for`]), so the enforced
    /// order is drivable **offline through the real binary** (bind the primary slot to a
    /// `mock/…-fsm-tdd` model with the `fsm` capability's `machine` set to `tdd`).
    pub fn with_fsm_tdd_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let advance = |id: &str, text: &str| ModelResponse {
            text: Some(text.to_string()),
            tool_calls: vec![ToolCall {
                id: id.to_string(),
                name: "advance_state".to_string(),
                arguments: json!({}),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 20),
            cost: None,
        };
        let write = |id: &str, path: &str, contents: &str, text: &str| ModelResponse {
            text: Some(text.to_string()),
            tool_calls: vec![ToolCall {
                id: id.to_string(),
                name: "write_file".to_string(),
                arguments: json!({ "path": path, "contents": contents }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(950, 60),
            cost: None,
        };
        Self::new(
            model_id,
            vec![
                advance(
                    "adv_early",
                    "Trying to implement first (should be refused).",
                ),
                write(
                    "wt",
                    MOCK_FSM_TEST_FILE,
                    "// tests for the game\n",
                    "Writing the tests first.",
                ),
                advance("adv_impl", "Tests are written — advancing to implement."),
                write(
                    "impl",
                    MOCK_FSM_IMPL_FILE,
                    "// the implementation\n",
                    "Implementing to satisfy the tests.",
                ),
                advance("adv_verify", "Implementation done — advancing to verify."),
                ModelResponse {
                    text: Some("Verified: the tests pass. Done.".to_string()),
                    tool_calls: Vec::new(),
                    finish_reason: FinishReason::Stop,
                    usage: usage(1000, 40),
                    cost: None,
                },
            ],
        )
    }

    /// The **parent** side of the offline [speculative execution](https://docs.testcabinet.ai/gg/speculative-execution/)
    /// e2e: a script that makes a best-of-K attempt at a task, then finishes.
    ///
    /// 1. `speculate { prompt, attempts: 3, slots: ["attempt", …] }` — gg fans out three
    ///    [attempts](Self::with_speculate_attempt_script) (each in its own worktree, on the `attempt`
    ///    slot), a [judge](Self::with_speculate_judge_script) picks the winner, and gg merges the
    ///    winner back while discarding the losers;
    /// 2. a final tool-free turn stops.
    ///
    /// Selected in production by a mock `model_id` naming `speculate-parent` (see [`mock_client_for`]),
    /// so the whole best-of-K fan-out → judge → merge path is drivable **offline through the real
    /// binary**: bind the primary slot to a `mock/…-speculate-parent` model, an `attempt` slot to a
    /// `mock/…-speculate-attempt` model, and a `judge` slot to a `mock/…-speculate-judge` model, with
    /// `subagents` and `speculative-execution` enabled (and git available for the isolation).
    pub fn with_speculate_parent_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let speculate = ModelResponse {
            text: Some(
                "This is hard — speculating with three parallel attempts and keeping the best."
                    .to_string(),
            ),
            tool_calls: vec![ToolCall {
                id: "call_speculate".to_string(),
                name: "speculate".to_string(),
                arguments: json!({
                    "prompt": "Implement the feature as well as you can.",
                    "attempts": 3,
                    "agent": "attempt",
                }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(900, 50),
            cost: None,
        };
        let finish = ModelResponse {
            text: Some(
                "The best attempt was merged into the workspace; the game is assembled."
                    .to_string(),
            ),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(1000, 40),
            cost: None,
        };
        Self::new(model_id, vec![speculate, finish])
    }

    /// The **attempt** side of the offline [speculative execution](crate::agent) e2e: a message-driven
    /// worker (its behavior lives in [`complete`](ModelClient::complete), keyed on a `speculate-attempt`
    /// model id) that reads its **attempt number** from its brief and writes a distinctly-named file
    /// (`speculate-attempt-<n>.txt`) so each attempt's isolated work is countable and the winner's
    /// merge is provable, then finishes. Empty script because it never consults one; production selects
    /// it via [`mock_client_for`].
    pub fn with_speculate_attempt_script(model_id: impl Into<String>) -> Self {
        Self::new(model_id, Vec::new())
    }

    /// The **judge** side of the offline [speculative execution](crate::agent) e2e: a message-driven
    /// judge (keyed on a `speculate-judge` model id) that picks the **first** attempt as the winner
    /// (`SPECULATION JUDGE: WINNER 1`). Empty script for the same reason as the attempt mock;
    /// production selects it via [`mock_client_for`].
    pub fn with_speculate_judge_script(model_id: impl Into<String>) -> Self {
        Self::new(model_id, Vec::new())
    }

    /// The **child** side of the offline [subagents](crate::subagents) e2e: a script that does a
    /// bit of work then returns a distinctive value.
    ///
    /// 1. `write_file` creates [`MOCK_SUBAGENT_FILE`] in the shared workspace (its "work");
    /// 2. a final tool-free turn stops with [`MOCK_SUBAGENT_RETURN`] as its message — the return
    ///    value its spawner collects.
    ///
    /// Pairs with [`with_subagent_parent_script`](Self::with_subagent_parent_script). Selected in
    /// production by a mock `model_id` naming `subagent-child` (see [`mock_client_for`]).
    pub fn with_subagent_child_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let write = ModelResponse {
            text: Some("Writing the greeting file.".to_string()),
            tool_calls: vec![ToolCall {
                id: "call_child_write".to_string(),
                name: "write_file".to_string(),
                arguments: json!({ "path": MOCK_SUBAGENT_FILE, "contents": "hello from the subagent\n" }),
            }],
            finish_reason: FinishReason::ToolCalls,
            usage: usage(500, 30),
            cost: None,
        };
        let finish = ModelResponse {
            text: Some(MOCK_SUBAGENT_RETURN.to_string()),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(550, 40),
            cost: None,
        };
        Self::new(model_id, vec![write, finish])
    }

    /// The **responses-as-code** script: a run driven by emitting a TypeScript program instead of
    /// discrete tool calls, exercising the code path end to end offline.
    ///
    /// 1. a first turn whose **whole reply** is a program — it calls `listDir`, then **loops** over
    ///    a list of names and, for each that ends in `.txt` (a **conditional**), calls `writeFile` —
    ///    so gg heals it (there is nothing to heal), type-strips it, runs it in the wasmtime
    ///    sandbox, and bridges its composed `list_dir`/`write_file` calls to the real toolset (the
    ///    [`MOCK_CODE_LEVEL_FILES`] appear in the workspace, the `.md` name is skipped); the program
    ///    returns the list of files it wrote;
    /// 2. a second program that calls `finish`, which is the only thing that ends a code-mode
    ///    session — there is no prose turn gg would read as "done", because under this capability
    ///    every reply is a program.
    ///
    /// Selected in production by a mock `model_id` naming `responses-as-code` (see
    /// [`mock_client_for`]), so the code path is drivable offline through the real binary with the
    /// `responses-as-code` capability enabled.
    pub fn with_responses_as_code_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        // A program with a loop, a conditional, a typed annotation (which only runs because the
        // types are stripped), and several composed tool calls: list the directory, then write a
        // file per `.txt` name, skipping the `.md` one.
        let program = ModelResponse {
            text: Some(format!(
                "const entries = fs.listDir(\".\");\n\
                 const names: string[] = [\"{}\", \"{}\", \"notes.md\", \"{}\"];\n\
                 const written: string[] = [];\n\
                 for (const name of names) {{\n\
                 \x20 if (name.endsWith(\".txt\")) {{\n\
                 \x20   fs.writeFile(name, \"level data\");\n\
                 \x20   written.push(name);\n\
                 \x20 }}\n\
                 }}\n\
                 console.log(`the workspace held ${{entries.length}} entr(ies) to begin with`);\n\
                 return written;",
                MOCK_CODE_LEVEL_FILES[0], MOCK_CODE_LEVEL_FILES[1], MOCK_CODE_LEVEL_FILES[2],
            )),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(1200, 90),
            cost: Some(Cost {
                comparable: Some(0.002),
                actual: Some(0.002),
            }),
        };
        let finish = ModelResponse {
            text: Some(
                "harness.finish(\"The level files are written; the game scaffold is complete.\");"
                    .to_string(),
            ),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(900, 30),
            cost: None,
        };
        Self::new(model_id, vec![program, finish])
    }

    /// A **responses-as-code** script whose program is a **runaway loop** (`while (true) {}`), so
    /// the execution timeout stops it — proving a sandbox failure surfaces as the turn's outcome
    /// (a `CodeExecution { ok: false }`) and the run continues cleanly rather than crashing.
    ///
    /// 1. a first turn emitting the runaway program (the sandbox times it out);
    /// 2. a second program that calls `finish`, ending the session.
    ///
    /// Pair with a `responses-as-code` capability whose `timeoutSecs` param is set short enough to
    /// trip quickly, so the test costs a fraction of a second rather than the default thirty.
    pub fn with_responses_as_code_runaway_script(model_id: impl Into<String>) -> Self {
        let usage = TokenCounts {
            uncached_input: Some(800),
            cached_input: None,
            output: Some(40),
            reasoning: None,
        };
        let runaway = ModelResponse {
            text: Some("let x = 0;\nwhile (true) {\n  x += 1;\n}\nreturn x;".to_string()),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage,
            cost: None,
        };
        let finish = ModelResponse {
            text: Some(
                "harness.finish(\"I kept the scaffold simple; the game is ready.\");".to_string(),
            ),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage,
            cost: None,
        };
        Self::new(model_id, vec![runaway, finish])
    }

    /// The **responses-as-code parent** side of the code-mode delegation e2e: a program that spawns a
    /// subagent and waits for it, proving a program's delegation tool still goes through the
    /// scheduler.
    ///
    /// 1. a first turn emitting a TypeScript program that calls `agents.spawnSubagent({ prompt, slot })`
    ///    then `agents.waitForSubagents()` (composed in one program) and returns the collected summaries;
    /// 2. a second program that calls `finish`, ending the session.
    ///
    /// Pairs with [`with_responses_as_code_child_script`](Self::with_responses_as_code_child_script)
    /// on the `subagent` slot.
    pub fn with_responses_as_code_parent_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let program = ModelResponse {
            text: Some(
                "const child = agents.spawnSubagent({ agent: \"subagent\", prompt: \"Write the greeting file.\" });\n\
                 const results = agents.waitForSubagents([child.id]);\n\
                 return results.map((r) => r.summary);"
                    .to_string(),
            ),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(1000, 60),
            cost: None,
        };
        let finish = ModelResponse {
            text: Some(
                "harness.finish(\"The subagent finished; the greeting is in place.\");".to_string(),
            ),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(1000, 40),
            cost: None,
        };
        Self::new(model_id, vec![program, finish])
    }

    /// The **responses-as-code child** side of the code-mode delegation e2e: a program that writes
    /// [`MOCK_SUBAGENT_FILE`] (its observable work) then returns a distinctive value.
    ///
    /// 1. a first turn emitting a TypeScript program that calls `fs.writeFile(..)` and returns;
    /// 2. a second program that calls `finish` with [`MOCK_SUBAGENT_RETURN`] — the summary that ends
    ///    its session and is the value its spawner collects.
    pub fn with_responses_as_code_child_script(model_id: impl Into<String>) -> Self {
        let usage = |input: u64, output: u64| TokenCounts {
            uncached_input: Some(input),
            cached_input: None,
            output: Some(output),
            reasoning: None,
        };
        let program = ModelResponse {
            text: Some(format!(
                "fs.writeFile(\"{MOCK_SUBAGENT_FILE}\", \"hello from the subagent\\n\");\n\
                 return \"wrote the greeting\";"
            )),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(500, 40),
            cost: None,
        };
        let finish = ModelResponse {
            text: Some(format!(
                "harness.finish({});",
                serde_json::json!(MOCK_SUBAGENT_RETURN)
            )),
            tool_calls: Vec::new(),
            finish_reason: FinishReason::Stop,
            usage: usage(520, 30),
            cost: None,
        };
        Self::new(model_id, vec![program, finish])
    }
}

/// The level files the [responses-as-code script](MockClient::with_responses_as_code_script)'s
/// program writes (one per `.txt` name in its loop) — its observable work in the workspace.
pub const MOCK_CODE_LEVEL_FILES: &[&str] = &["level-1.txt", "level-2.txt", "level-3.txt"];

/// The file the [subagent child script](MockClient::with_subagent_child_script) writes — its
/// observable "work" in the shared workspace.
pub const MOCK_SUBAGENT_FILE: &str = "subagent-greeting.txt";

/// The distinctive final message the [subagent child script](MockClient::with_subagent_child_script)
/// returns, so a test can assert the return value reached the parent (via `AgentReturned`).
pub const MOCK_SUBAGENT_RETURN: &str = "Subagent done: wrote the greeting file.";

/// The agent-profile name the offline issue-review parent names as its issue's reviewer — the
/// `reviewer` roster entry a run driving this mock must declare (bound to a `mock/…-review-reviewer`
/// model).
pub const MOCK_REVIEWER_AGENT: &str = "reviewer";

/// The prefix of the epic the [issue-review parent script](MockClient::with_issue_review_parent_script)
/// creates — and so the stem of the one issue it files, which the board numbers `RVIEW-1`. The id
/// itself is not a constant here because it is **gg's** to assign, not the script's to declare.
pub const MOCK_ISSUE_REVIEW_PREFIX: &str = "RVIEW";

/// The test file the [`tdd` FSM script](MockClient::with_fsm_tdd_script) writes in its `write_tests`
/// state — the evidence that lets the machine advance to `implement`.
pub const MOCK_FSM_TEST_FILE: &str = "game.test.js";

/// The implementation file the [`tdd` FSM script](MockClient::with_fsm_tdd_script) writes in its
/// `implement` state.
pub const MOCK_FSM_IMPL_FILE: &str = "game.js";

/// The file the issue-review offline **worker** writes on its initial pass (its ordinary "work").
pub const MOCK_REVIEW_WORKER_FILE: &str = "review-work.txt";

/// The file the issue-review offline **fixer** writes to record that the reviewer's requested change
/// was applied — the fixer is the issue's own agent on a re-dispatch. Its presence in the diff flips
/// the reviewer from CHANGES REQUESTED to APPROVED.
pub const MOCK_REVIEW_FIX_FILE: &str = "review-fix.txt";

/// The sentinel content the issue-review offline fixer writes into [`MOCK_REVIEW_FIX_FILE`]; the
/// reviewer approves once it appears in the diff it is given.
pub const MOCK_REVIEW_FIX_SENTINEL: &str = "REVIEW-FIX-APPLIED";

/// The stable marker a re-dispatched issue's brief carries (`build_fix_brief`'s heading), by which
/// the issue-review offline worker tells a fix pass from its initial pass.
const MOCK_REVIEW_FIX_BRIEF_MARKER: &str = "## Requested changes";

/// The heading every auto-dispatched issue agent's brief opens with (`BoardStore::issue_brief`'s
/// `# Issue \`<id>\`: …`), by which the offline issue-review parent mock tells a dispatched issue
/// agent (or a fix agent, which carries this too) from the root that files the issue.
const MOCK_ISSUE_BRIEF_HEADING: &str = "# Issue `";

/// The filename prefix each offline [speculation attempt](MockClient::with_speculate_attempt_script)
/// writes its work to (suffixed with its attempt number), so each attempt's isolated work is distinct
/// and a test can prove the winner (and only the winner) was merged.
pub const MOCK_SPECULATE_ATTEMPT_PREFIX: &str = "speculate-attempt-";

/// The marker the offline [speculation attempt brief](crate::agent) carries (`build_attempt_brief`),
/// by which the attempt mock reads its own attempt number.
const MOCK_SPECULATE_ATTEMPT_MARKER: &str = "Speculative attempt ";

#[async_trait::async_trait]
impl ModelClient for MockClient {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        // A compaction summary request (recognized by the marker the summarizer embeds in
        // its system prompt) is answered with a deterministic canned summary and does
        // **not** advance the scripted cursor, so the mock's main script stays in step
        // across a compaction boundary.
        if is_summarization_request(messages) {
            return Ok(ModelResponse {
                text: Some(MOCK_COMPACTION_SUMMARY.to_string()),
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
            });
        }

        // The one compaction request whose answer is a **tool call** rather than prose (a
        // [handoff compaction](crate::compaction::HandoffCompactor)). Answered with the same canned
        // summary in the shape that strategy reads, and — like the prose one — off-script, so a
        // handoff arm of a sweep crosses its boundaries offline without desyncing.
        if is_compact_call_request(messages) {
            return Ok(ModelResponse {
                text: None,
                tool_calls: vec![ToolCall {
                    id: "call_compact".to_string(),
                    name: crate::tools::COMPACT_TOOL.to_string(),
                    arguments: json!({ "summary": MOCK_COMPACTION_SUMMARY, "files": [] }),
                }],
                finish_reason: FinishReason::ToolCalls,
                usage: TokenCounts::default(),
                cost: None,
            });
        }

        // An agent the **board dispatched**, built from the default script: it reports the issue's
        // work done and stops, instead of replaying the script's board-authoring turns.
        //
        // This is not a convenience. Issue ids are gg's to assign, so re-running `create_epic` /
        // `create_issue` inside a dispatched agent no longer collides with what the root filed — it
        // files a *fresh* epic and two fresh issues, each of which dispatches another agent that
        // files another copy. A script whose whole point is to demonstrate the board offline must not
        // be the thing that recurses through it.
        if self.default_script && messages_contain(messages, MOCK_ISSUE_BRIEF_HEADING) {
            return Ok(ModelResponse {
                text: Some("The work described in the issue's brief is complete.".to_string()),
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
            });
        }

        // An issue-review **parent** (offline e2e): message-driven so one `issue-review-parent` model
        // plays all three roles the auto-dispatch model routes to the primary slot — the root that
        // files the issue, the agent gg auto-dispatches to implement it, and that same agent when a
        // review sends it back. The role is read from the brief in the messages (stable across the
        // instance's turns); the turn is the instance's own cursor. A fresh instance per agent means
        // each starts from turn zero. Checked before the scripted cursor, like the reviewer/worker.
        if self.model_id.contains("issue-review-parent") {
            // A re-dispatched agent's brief carries the requested-changes marker *and* the issue
            // heading, so test it first; a first dispatch carries only the issue heading; the root's
            // brief carries neither.
            let turn = self.cursor.fetch_add(1, Ordering::SeqCst);
            let response = if messages_contain(messages, MOCK_REVIEW_FIX_BRIEF_MARKER) {
                match turn {
                    0 => issue_review_tool_turn(
                        "call_fix",
                        "Applying the requested change.",
                        "write_file",
                        json!({
                            "path": MOCK_REVIEW_FIX_FILE,
                            "contents": format!("{MOCK_REVIEW_FIX_SENTINEL}\n"),
                        }),
                    ),
                    _ => issue_review_stop_turn("The requested fix is applied."),
                }
            } else if messages_contain(messages, MOCK_ISSUE_BRIEF_HEADING) {
                match turn {
                    0 => issue_review_tool_turn(
                        "call_work",
                        "Doing the initial work for the issue.",
                        "write_file",
                        json!({
                            "path": MOCK_REVIEW_WORKER_FILE,
                            "contents": "initial work by the dispatched issue agent\n",
                        }),
                    ),
                    _ => issue_review_stop_turn(
                        "The issue's work is finished and handed back for review.",
                    ),
                }
            } else {
                match turn {
                    0 => issue_review_tool_turn(
                        "call_epic",
                        "Setting up the board.",
                        "create_epic",
                        json!({
                            "prefix": MOCK_ISSUE_REVIEW_PREFIX,
                            "title": "The build",
                            "description": "The work for this session.",
                        }),
                    ),
                    1 => issue_review_tool_turn(
                        "call_issue",
                        "Filing the issue; gg will dispatch an agent to implement it.",
                        "create_issue",
                        json!({
                            "title": "Implement the feature",
                            "inScope": "Write the feature files.",
                            "outOfScope": "Anything unrelated to the feature.",
                            "completionCriteria": "The feature is implemented and the review fix marker is present.",
                            "epicId": MOCK_ISSUE_REVIEW_PREFIX,
                            "agent": ROOT_AGENT,
                            "reviewers": [MOCK_REVIEWER_AGENT],
                        }),
                    ),
                    _ => issue_review_stop_turn("The board is set up and the issue is enqueued."),
                }
            };
            return Ok(response);
        }

        // An issue-review **reviewer** (offline e2e): its verdict is driven by whether the diff in its
        // brief already shows the fix marker. First review (no marker yet) → CHANGES REQUESTED (ask
        // for the marker); re-review after the fixer wrote it → APPROVED. Stateless: the workspace
        // (via the diff embedded in the messages) carries the state, so a fresh reviewer instance per
        // dispatch behaves correctly. Answered off-script (the script cursor is never touched).
        if self.model_id.contains("review-reviewer") {
            let approved = messages_contain(messages, MOCK_REVIEW_FIX_SENTINEL);
            let text = if approved {
                "The requested change is present; the work meets the criteria.\n\nREVIEW: APPROVED"
                    .to_string()
            } else {
                format!(
                    "The work is missing the required marker.\n\nREVIEW: CHANGES REQUESTED\n\
                     1. Write `{MOCK_REVIEW_FIX_FILE}` containing `{MOCK_REVIEW_FIX_SENTINEL}` to \
                     record that the review fix was applied."
                )
            };
            return Ok(ModelResponse {
                text: Some(text),
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
            });
        }

        // An issue-review **worker** (offline e2e): on its first turn it writes a file, then finishes.
        // Which file depends on whether this is a fix pass — detected by the fix-brief marker in its
        // messages: an initial dispatch writes ordinary work; a fix dispatch writes the review fix
        // marker the reviewer approves on. It manages its own turn cursor so a fresh instance per
        // dispatch (initial vs fix) starts from turn zero.
        if self.model_id.contains("review-worker") {
            let turn = self.cursor.fetch_add(1, Ordering::SeqCst);
            if turn == 0 {
                let is_fix = messages_contain(messages, MOCK_REVIEW_FIX_BRIEF_MARKER);
                let (path, contents, text) = if is_fix {
                    (
                        MOCK_REVIEW_FIX_FILE,
                        format!("{MOCK_REVIEW_FIX_SENTINEL}\n"),
                        "Applying the requested change.",
                    )
                } else {
                    (
                        MOCK_REVIEW_WORKER_FILE,
                        "initial work by the review worker\n".to_string(),
                        "Doing the initial work for the issue.",
                    )
                };
                return Ok(ModelResponse {
                    text: Some(text.to_string()),
                    tool_calls: vec![ToolCall {
                        id: "call_review_worker".to_string(),
                        name: "write_file".to_string(),
                        arguments: json!({ "path": path, "contents": contents }),
                    }],
                    finish_reason: FinishReason::ToolCalls,
                    usage: TokenCounts::default(),
                    cost: None,
                });
            }
            return Ok(ModelResponse {
                text: Some("Done with this pass.".to_string()),
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
            });
        }

        // A speculative-execution **attempt** (offline e2e): it reads its attempt number from its
        // brief and writes a distinctly-named file so each parallel attempt's isolated work is
        // countable, then finishes. Manages its own turn cursor (a fresh instance per attempt).
        if self.model_id.contains("speculate-attempt") {
            let turn = self.cursor.fetch_add(1, Ordering::SeqCst);
            if turn == 0 {
                let n = speculate_attempt_number(messages).unwrap_or(0);
                return Ok(ModelResponse {
                    text: Some(format!("Attempt {n}: writing my solution.")),
                    tool_calls: vec![ToolCall {
                        id: "call_speculate_attempt".to_string(),
                        name: "write_file".to_string(),
                        arguments: json!({
                            "path": format!("{MOCK_SPECULATE_ATTEMPT_PREFIX}{n}.txt"),
                            "contents": format!("solution from speculative attempt {n}\n"),
                        }),
                    }],
                    finish_reason: FinishReason::ToolCalls,
                    usage: TokenCounts::default(),
                    cost: None,
                });
            }
            return Ok(ModelResponse {
                text: Some("My attempt is complete.".to_string()),
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
            });
        }

        // A speculative-execution **judge** (offline e2e): picks the first attempt as the winner in a
        // single turn. Answered off-script (the cursor is never touched).
        if self.model_id.contains("speculate-judge") {
            return Ok(ModelResponse {
                text: Some(
                    "Attempt 1 is the strongest solution.\n\nSPECULATION JUDGE: WINNER 1"
                        .to_string(),
                ),
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
            });
        }

        let index = self.cursor.fetch_add(1, Ordering::SeqCst);
        Ok(self
            .script
            .get(index)
            .cloned()
            .unwrap_or_else(|| ModelResponse {
                text: Some("(mock script exhausted)".to_string()),
                tool_calls: Vec::new(),
                finish_reason: FinishReason::Stop,
                usage: TokenCounts::default(),
                cost: None,
            }))
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

/// Whether `messages` is a [compaction](crate::compaction) summary request — detected by
/// the [`SUMMARIZATION_MARKER`](crate::compaction::SUMMARIZATION_MARKER) the summarizer
/// embeds in its system prompt. The mock answers these off-script so its scripted turns are
/// never consumed by a summarization call.
fn is_summarization_request(messages: &[Message]) -> bool {
    carries_marker(messages, crate::compaction::SUMMARIZATION_MARKER)
}

/// Whether `messages` is the one [compaction](crate::compaction) request answered with a
/// [`compact`](crate::tools::COMPACT_TOOL) **call** — detected by the
/// [`COMPACT_CALL_MARKER`](crate::compaction::COMPACT_CALL_MARKER) the handoff compactor embeds in
/// its system prompt. Answered off-script for the same reason a prose summary request is.
fn is_compact_call_request(messages: &[Message]) -> bool {
    carries_marker(messages, crate::compaction::COMPACT_CALL_MARKER)
}

/// Whether any of `messages` carries `marker` in its content — the shared test behind the two
/// off-script compaction requests, so a third would be one line rather than a fourth copy.
fn carries_marker(messages: &[Message], marker: &str) -> bool {
    messages.iter().any(|message| {
        message
            .content
            .as_deref()
            .is_some_and(|content| content.contains(marker))
    })
}

/// One tool-calling turn for the message-driven
/// [issue-review parent](MockClient::with_issue_review_parent_script)
/// mock: an assistant message plus a single tool call.
fn issue_review_tool_turn(
    call_id: &str,
    text: &str,
    tool: &str,
    arguments: serde_json::Value,
) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: vec![ToolCall {
            id: call_id.to_string(),
            name: tool.to_string(),
            arguments,
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// A tool-free stop turn for the message-driven issue-review parent mock.
fn issue_review_stop_turn(text: &str) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
    }
}

/// Whether any message's content contains `needle` — how the issue-review offline mocks read the
/// state carried in their brief (the diff, for the reviewer; the fix-brief marker, for the worker)
/// so a fresh mock instance per dispatch still behaves correctly.
fn messages_contain(messages: &[Message], needle: &str) -> bool {
    messages.iter().any(|message| {
        message
            .content
            .as_deref()
            .is_some_and(|c| c.contains(needle))
    })
}

/// The attempt number an offline [speculation attempt](MockClient::with_speculate_attempt_script)
/// reads from its brief (the `Speculative attempt <n> of <k>` line `build_attempt_brief` writes), so
/// each parallel attempt writes a distinctly-named file. `None` when no such marker is present.
fn speculate_attempt_number(messages: &[Message]) -> Option<u64> {
    for message in messages {
        if let Some(content) = message.content.as_deref()
            && let Some(pos) = content.find(MOCK_SPECULATE_ATTEMPT_MARKER)
        {
            let rest = &content[pos + MOCK_SPECULATE_ATTEMPT_MARKER.len()..];
            let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
            if let Ok(n) = digits.parse() {
                return Some(n);
            }
        }
    }
    None
}

/// The chunky level file the [agent-managed-context script](MockClient::with_agent_managed_context_script)
/// writes then reads, so its file view is worth evicting. Deliberately verbose so the reclaim
/// is visible in the token accounting.
#[cfg(test)]
const AMC_LEVEL_JSON: &str = r#"{
  "name": "level.json",
  "tiles": [
    "XXXXXXXXXXXXXXXXXXXXXXXX", "X....................g.X", "X..XXX...XXXX...XXX....X",
    "X..X..................X", "X..X..p....XXXX...XXX..X", "X..XXX...........XXX...X",
    "X..............XXXX....X", "XXXXXXXXXXXXXXXXXXXXXXXX"
  ],
  "spawns": [ { "x": 4, "y": 4, "kind": "player" }, { "x": 21, "y": 1, "kind": "goal" } ],
  "notes": "Reachable layout; player p spawns bottom-left and must reach the goal g top-right."
}
"#;

/// The minimal playable game the [default mock script](MockClient::with_default_script)
/// writes: a tiny arrow-key canvas game.
const DEFAULT_GAME_HTML: &str = r#"<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>gg mock game</title></head>
<body style="margin:0;background:#111">
<canvas id="c" width="480" height="320" style="display:block;margin:0 auto;background:#222"></canvas>
<script>
const cx = document.getElementById('c').getContext('2d');
const p = { x: 40, y: 160, s: 3 }, goal = { x: 420, y: 160 };
const keys = {};
addEventListener('keydown', e => keys[e.key] = true);
addEventListener('keyup', e => keys[e.key] = false);
function loop() {
  if (keys.ArrowUp) p.y -= p.s;
  if (keys.ArrowDown) p.y += p.s;
  if (keys.ArrowLeft) p.x -= p.s;
  if (keys.ArrowRight) p.x += p.s;
  const win = Math.hypot(p.x - goal.x, p.y - goal.y) < 16;
  cx.clearRect(0, 0, 480, 320);
  cx.fillStyle = '#4caf50'; cx.fillRect(goal.x - 8, goal.y - 8, 16, 16);
  cx.fillStyle = '#03a9f4'; cx.fillRect(p.x - 8, p.y - 8, 16, 16);
  cx.fillStyle = '#fff'; cx.font = '16px sans-serif';
  cx.fillText(win ? 'You win! Reach the goal with the arrow keys.' : 'Reach the green goal.', 12, 24);
  requestAnimationFrame(loop);
}
loop();
</script>
</body>
</html>
"#;

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

/// Which provider a [`GgSlotBinding`] resolves to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    /// The scripted, offline [`MockClient`].
    Mock,
    /// A live [`OpenRouterClient`].
    OpenRouter,
}

impl ProviderKind {
    /// Whether this provider runs without network or credentials.
    pub fn is_offline(self) -> bool {
        matches!(self, ProviderKind::Mock)
    }
}

/// Decide which provider a binding resolves to. `fake_model` is whether the
/// `TCAB_GG_FAKE_MODEL` override is active; passing it in keeps this pure and unit
/// testable. See [module docs](self) for the exact rule.
pub fn resolve_provider_kind(binding: &GgSlotBinding, fake_model: bool) -> ProviderKind {
    if fake_model {
        return ProviderKind::Mock;
    }
    if model_provider_prefix(&binding.model_id).eq_ignore_ascii_case(MOCK_PROVIDER) {
        return ProviderKind::Mock;
    }
    ProviderKind::OpenRouter
}

/// The provider prefix of a model id — the segment before the first `/` or `:`
/// (`"mock/echo"` → `"mock"`, `"anthropic/claude-opus-4-8"` → `"anthropic"`).
fn model_provider_prefix(model_id: &str) -> &str {
    model_id.split(['/', ':']).next().unwrap_or(model_id)
}

/// Whether the `TCAB_GG_FAKE_MODEL` override is set to a non-empty value.
fn fake_model_env() -> bool {
    std::env::var_os(FAKE_MODEL_ENV).is_some_and(|value| !value.is_empty())
}

/// Resolve `binding` to the provider it names (honoring the `TCAB_GG_FAKE_MODEL`
/// override), without constructing a client. The loop uses this to decide whether a
/// resolved client is offline before driving it.
pub fn provider_for(binding: &GgSlotBinding) -> ProviderKind {
    resolve_provider_kind(binding, fake_model_env())
}

/// Build the [`ModelClient`] a slot binds to, per the [selection rule](self). Returns
/// [`ModelError::MissingApiKey`] for a live OpenRouter binding with no credential.
///
/// `cache_key` is the session-wide [`prompt_cache_key`](build_request_body) a live client stamps
/// on every request (the mock client ignores it). It is the run's session id, so every agent's
/// client carries the same value — see [`OpenRouterClient::from_binding`].
pub fn client_for_slot(
    binding: &GgSlotBinding,
    cache_key: Option<&str>,
) -> Result<Box<dyn ModelClient>, ModelError> {
    match provider_for(binding) {
        ProviderKind::Mock => Ok(Box::new(mock_client_for(&binding.model_id))),
        ProviderKind::OpenRouter => Ok(Box::new(OpenRouterClient::from_binding(
            binding, cache_key,
        )?)),
    }
}

/// Choose the offline [`MockClient`] script a mock `model_id` names.
///
/// Most ids get the [default script](MockClient::with_default_script). The `subagent-*` ids select
/// the paired [parent](MockClient::with_subagent_parent_script) /
/// [child](MockClient::with_subagent_child_script) delegation scripts, and a `workflow-parent` id
/// selects the
/// [declared-workflow parent](MockClient::with_workflow_parent_script) (which runs a two-stage
/// fan-out/sequencing workflow whose stages' subagents run on the `worker` slot). A
/// `issue-review-parent` id selects the
/// [issue-review parent](MockClient::with_issue_review_parent_script)
/// (create an issue with a reviewer and dispatch it; the implementer finishing triggers a
/// review → fix → approve cycle);
/// its `review-worker` and `review-reviewer` counterparts are message-driven (their behavior lives
/// in [`MockClient::complete`]). An `fsm-tdd` id selects the
/// [TDD FSM driver](MockClient::with_fsm_tdd_script) (an agent kept in `write_tests → implement →
/// verify` order by the engine). A `speculate-parent` id selects the
/// [best-of-K parent](MockClient::with_speculate_parent_script) (fan out K attempts, judge, and merge
/// the winner); its `speculate-attempt` and `speculate-judge` counterparts are message-driven (each
/// attempt writes a distinctly-named file; the judge picks the first). So the full spawn → wait →
/// return path — and its declared-workflow, issue-review, FSM, and speculative-execution
/// variants — can be driven **offline through the real binary**
/// (bind the primary slot to a `mock/…-subagent-parent`,
/// `mock/…-workflow-parent`, `mock/…-issue-review-parent`, or `mock/…-speculate-parent` model and the
/// role slots to the corresponding `mock/…-subagent-child` / `mock/…-review-worker` /
/// `mock/…-review-reviewer` / `mock/…-speculate-attempt` / `mock/…-speculate-judge` models) and not
/// only the in-crate tests. The child/worker/reviewer/attempt/judge scripts never spawn, so there is
/// no runaway recursion. This keys purely on the (offline) `model_id`, matching how
/// [`resolve_provider_kind`] already selects the mock provider by `model_id`.
fn mock_client_for(model_id: &str) -> MockClient {
    if model_id.contains("subagent-child") {
        MockClient::with_subagent_child_script(model_id)
    } else if model_id.contains("workflow-parent") {
        MockClient::with_workflow_parent_script(model_id)
    } else if model_id.contains("issue-review-parent") {
        MockClient::with_issue_review_parent_script(model_id)
    } else if model_id.contains("review-reviewer") {
        MockClient::with_review_reviewer_script(model_id)
    } else if model_id.contains("review-worker") {
        MockClient::with_review_worker_script(model_id)
    } else if model_id.contains("fsm-tdd") {
        MockClient::with_fsm_tdd_script(model_id)
    } else if model_id.contains("speculate-attempt") {
        MockClient::with_speculate_attempt_script(model_id)
    } else if model_id.contains("speculate-judge") {
        MockClient::with_speculate_judge_script(model_id)
    } else if model_id.contains("speculate-parent") {
        MockClient::with_speculate_parent_script(model_id)
    } else if model_id.contains("subagent-parent") {
        MockClient::with_subagent_parent_script(model_id)
    } else if model_id.contains("code-child") {
        MockClient::with_responses_as_code_child_script(model_id)
    } else if model_id.contains("code-parent") {
        MockClient::with_responses_as_code_parent_script(model_id)
    } else if model_id.contains("code-runaway") {
        MockClient::with_responses_as_code_runaway_script(model_id)
    } else if model_id.contains("responses-as-code") {
        MockClient::with_responses_as_code_script(model_id)
    } else {
        MockClient::with_default_script(model_id)
    }
}

/// Resolves a [slot binding](GgSlotBinding) to a **fresh** [`ModelClient`] each call — the seam
/// every agent (the root and each spawned subagent) resolves its own client through.
///
/// A subagent runs on its own model, possibly a different, cross-provider [slot](GgSlotBinding)
/// than its parent, and each agent needs its own client instance (the [`MockClient`] carries a
/// per-agent script cursor, and a real client its own connection state), so the factory returns a
/// new client per call rather than a shared one. Production uses [`DefaultClientFactory`]
/// (delegating to [`client_for_slot`]); tests inject a scripted factory so a parent and its
/// subagents can be driven by distinct offline scripts with no network.
pub trait ClientFactory: Send + Sync {
    /// Build a fresh client for `binding`, or a [`ModelError`] when it cannot be resolved (for
    /// example a live binding with no credential).
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError>;
}

/// The production [`ClientFactory`]: resolves each binding through [`client_for_slot`], honoring
/// the `TCAB_GG_FAKE_MODEL` / `mock` selection rules.
///
/// It carries the run's session-wide [`prompt_cache_key`](build_request_body) (the session id) and
/// stamps it on every live client it builds, so all of a run's agents — the root and every
/// subagent the factory resolves — share one key. That is what lets a subagent reuse the cached
/// opening prefix a sibling already warmed, instead of each agent paying for it uncached.
pub struct DefaultClientFactory {
    cache_key: Option<String>,
}

impl DefaultClientFactory {
    /// A factory that stamps `cache_key` (the run's session id) on every live client it builds.
    /// `None` builds clients that send no `prompt_cache_key` (the pre-caching behavior).
    pub fn new(cache_key: Option<String>) -> Self {
        Self { cache_key }
    }
}

impl ClientFactory for DefaultClientFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        client_for_slot(binding, self.cache_key.as_deref())
    }
}

#[cfg(test)]
#[path = "client.test.rs"]
mod tests;
