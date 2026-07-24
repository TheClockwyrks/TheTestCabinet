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
//! [`MockClient`] when **any** of these holds (checked in this order):
//!
//! 1. the `TCAB_GG_FAKE_MODEL` environment variable is set to a non-empty value — a
//!    global offline override for CI and local iteration;
//! 2. the binding's `provider` is `"mock"` (case-insensitive);
//! 3. the binding's `model_id` names the `mock` provider by prefix (`mock/…` or
//!    `mock:…`).
//!
//! Otherwise it builds an [`OpenRouterClient`], which requires `OPENROUTER_API_KEY`
//! and returns [`ModelError::MissingApiKey`]
//! when it is absent — a real binding with no key fails loudly rather than silently
//! falling back to the mock.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};
use test_cabinet_core::gg::GgSlotBinding;
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
}

impl OpenRouterClient {
    /// Construct a client from its parts. `base_url` is the API root (no trailing
    /// `/chat/completions`); pass an injected `http` and a test `base_url` to exercise
    /// it offline.
    pub fn new(
        base_url: impl Into<String>,
        http: reqwest::Client,
        model_id: impl Into<String>,
        api_key: impl Into<String>,
        retry: RetryPolicy,
    ) -> Self {
        Self {
            http,
            base_url: base_url.into(),
            model_id: model_id.into(),
            api_key: api_key.into(),
            retry,
        }
    }

    /// Build a live client for `binding`, reading `OPENROUTER_API_KEY` from the
    /// environment. Returns [`ModelError::MissingApiKey`] when the credential is
    /// absent or empty.
    pub fn from_binding(binding: &GgSlotBinding) -> Result<Self, ModelError> {
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
        let body = build_request_body(&self.model_id, messages, tools);
        let url = self.endpoint();
        let mut last_err = String::new();

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

    fn model_id(&self) -> &str {
        &self.model_id
    }
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
pub fn build_request_body(model_id: &str, messages: &[Message], tools: &[ToolDefinition]) -> Value {
    let messages: Vec<Value> = messages.iter().map(wire_message).collect();
    let mut body = json!({
        "model": model_id,
        "messages": messages,
        "usage": { "include": true },
    });

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

/// Serialize one [`Message`] into the OpenAI wire shape. Assistant tool-call arguments
/// are re-encoded as a JSON **string**, as the API expects.
fn wire_message(message: &Message) -> Value {
    let mut obj = json!({ "role": role_str(message.role) });
    if let Some(content) = &message.content {
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
}

impl MockClient {
    /// A mock bound to `model_id` that replays `script` in order.
    pub fn new(model_id: impl Into<String>, script: Vec<ModelResponse>) -> Self {
        Self {
            model_id: model_id.into(),
            script,
            cursor: AtomicUsize::new(0),
        }
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
    /// 7. `write_file` creates a minimal playable `index.html` (a tiny HTML5 canvas game);
    /// 8. a final tool-free turn reports completion and stops.
    ///
    /// This drives the whole loop + tools + telemetry deterministically with no key.
    ///
    /// The `read_skill`, `write_memory`, and task calls are harmless when the run offers the
    /// matching capability off — each simply comes back as an unknown/unavailable tool error
    /// and the script proceeds — so a workspace without a seeded `.gg/skills/`, or a run with
    /// memories or tasks ablated, still runs the remaining turns unchanged.
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
        Self::new(
            model_id,
            vec![
                read_skill_call,
                write_memory_call,
                add_scaffold_task,
                add_movement_task,
                cyclic_edge,
                complete_scaffold_task,
                write_call,
                finish,
            ],
        )
    }
}

#[async_trait::async_trait]
impl ModelClient for MockClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
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
    if binding
        .provider
        .as_deref()
        .is_some_and(|provider| provider.eq_ignore_ascii_case(MOCK_PROVIDER))
    {
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
pub fn client_for_slot(binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
    match provider_for(binding) {
        ProviderKind::Mock => Ok(Box::new(MockClient::with_default_script(&binding.model_id))),
        ProviderKind::OpenRouter => Ok(Box::new(OpenRouterClient::from_binding(binding)?)),
    }
}

#[cfg(test)]
#[path = "client.test.rs"]
mod tests;
