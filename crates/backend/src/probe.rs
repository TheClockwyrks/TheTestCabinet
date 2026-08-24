//! Model probes: responses-as-code readiness checks run against a catalog model.
//!
//! A responses-as-code turn is a forced [`submit_program`](SUBMIT_PROGRAM_TOOL) tool call whose
//! `program` string is one whole, bare program over the gg modules. A model can hold that call
//! shape and still be unusable — fencing the program inside the string, opening it with prose,
//! never importing the modules, or dodging the forced choice entirely — and every RaC run on such
//! a model is wasted. A probe answers that cheaply before any run is launched: it replays gg's
//! real RaC turn-1 request through OpenRouter's chat/completions, with the one `submit_program`
//! tool offered and `tool_choice` forced to it exactly as gg shapes the request, samples it
//! several times, classifies each submitted program, and reduces the results to a verdict.
//!
//! The request is the embedded fixture `probe/fixtures/gg-rac-turn1.json` (its provenance is
//! recorded inside it): the system-code prompt, the Carom task, two seeded example programs as
//! synthesized `submit_program` calls answered by their `ok` acknowledgements, the case's spec
//! views (trimmed by default to keep a probe cheap), and the trailing contract notice.
//!
//! Classification reads the first `submit_program` call's `program` string (labels in
//! [`classify`]); [`clean-program`](LABEL_CLEAN) means the string is a bare program whose first
//! line is code and that imports from `"gg"`. A reply that submitted nothing is labeled by how it
//! dodged ([`no-submission`](LABEL_NO_SUBMISSION), [`stray-tool-call`](LABEL_STRAY_TOOL_CALL),
//! [`no-program`](LABEL_NO_PROGRAM)). The verdict is on the clean rate: at least 80% clean is
//! `ready`, anything else is `not-ready`, and the per-call labels say why.
//!
//! The runner executes as a detached task inside the backend process, appending one
//! `model_probe_item` row per call and finishing the `model_probe` row with the verdict and the
//! summed spend. Calls are sequential, uncapped by temperature (the provider default, matching
//! how gg calls the model), and each carries a fresh session/prompt-cache key so provider routing
//! stays natural. The HTTP endpoint is a parameter so tests can stand in a local server; the real
//! base is [`DEFAULT_COMPLETIONS_ENDPOINT`].

use std::sync::{Arc, LazyLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_entities::{model_probe, model_probe_item};

use crate::db::Db;

/// The OpenRouter chat/completions endpoint probes call in production.
pub const DEFAULT_COMPLETIONS_ENDPOINT: &str = "https://openrouter.ai/api/v1/chat/completions";

/// Completion calls when the trigger names no sample count.
pub const DEFAULT_SAMPLES: i32 = 3;
/// The most calls a trigger may request (a probe is a cheap check, not a benchmark).
pub const MAX_SAMPLES: i32 = 8;
/// The completion-token cap when the trigger names none. Generous for a first
/// program, tight enough that a runaway reply stays cheap.
pub const DEFAULT_MAX_TOKENS: i32 = 3500;
/// The largest completion-token cap a trigger may request.
pub const MAX_MAX_TOKENS: i32 = 16_000;

/// How many characters of each seeded spec view a default probe sends (about 7k
/// prompt tokens across the request). A full-context probe sends the views whole
/// (about 17k prompt tokens).
const TRIM_CHARS: usize = 1500;

/// The one tool a responses-as-code request offers, and requires.
pub const SUBMIT_PROGRAM_TOOL: &str = "submit_program";

/// The [`submit_program`](SUBMIT_PROGRAM_TOOL) definition the request offers, in the
/// chat/completions wire shape — the same name, description and schema gg's own completion module
/// builds for the TypeScript arm (`crates/gg/src/completion.rs`), stated here because the backend
/// does not depend on the gg crate.
pub fn submit_program_tool() -> serde_json::Value {
    serde_json::json!({
        "type": "function",
        "function": {
            "name": SUBMIT_PROGRAM_TOOL,
            "description": "Run this turn's program. `program` must be one whole TypeScript \
                            program; it is compiled and executed exactly as written.",
            "parameters": {
                "type": "object",
                "properties": {
                    "program": {
                        "type": "string",
                        "description": "The complete TypeScript program to run.",
                    }
                },
                "required": ["program"],
                "additionalProperties": false,
            },
        },
    })
}

/// One message of the embedded turn-1 fixture. `source` records which gg event produced it (only
/// `file_view` messages are trimmed); it is never sent.
#[derive(Debug, Clone, Deserialize)]
struct FixtureMessage {
    role: String,
    source: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<ProbeToolCall>,
    #[serde(default)]
    tool_call_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Fixture {
    messages: Vec<FixtureMessage>,
}

/// The embedded gg RaC turn-1 request (provenance inside the file).
static FIXTURE: LazyLock<Vec<FixtureMessage>> = LazyLock::new(|| {
    serde_json::from_str::<Fixture>(include_str!("probe/fixtures/gg-rac-turn1.json"))
        .expect("embedded probe fixture parses")
        .messages
});

/// One chat message as sent to the provider — the OpenAI chat/completions shape, which is why an
/// assistant message may carry `tool_calls` and a `tool` message answers one by `tool_call_id`,
/// and why those two keys stay snake_case on the wire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeMessage {
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "contract", ts(optional = nullable))]
    pub tool_calls: Vec<ProbeToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub tool_call_id: Option<String>,
}

/// One tool call on an assistant message, in the chat/completions wire shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ProbeToolFunction,
}

/// The function half of a tool call: the tool's name and its JSON-encoded arguments string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeToolFunction {
    pub name: String,
    /// The call's arguments as the JSON-encoded string the wire carries.
    pub arguments: String,
}

/// Build the request's message array from the fixture: trim the spec views unless `full_context`.
pub fn build_messages(full_context: bool) -> Vec<ProbeMessage> {
    FIXTURE
        .iter()
        .map(|m| {
            let content = m.content.clone().map(|mut content| {
                if !full_context && m.source == "file_view" && content.len() > TRIM_CHARS {
                    let mut cut = TRIM_CHARS;
                    while !content.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    content.truncate(cut);
                }
                content
            });
            ProbeMessage {
                role: m.role.clone(),
                content,
                tool_calls: m.tool_calls.clone(),
                tool_call_id: m.tool_call_id.clone(),
            }
        })
        .collect()
}

/// The label for a clean submission: the `program` string is a bare program over the gg modules.
pub const LABEL_CLEAN: &str = "clean-program";
/// The label for a reply that made no tool call at all despite the forced choice.
pub const LABEL_NO_SUBMISSION: &str = "no-submission";
/// The label for a reply whose calls named some other tool and never
/// [`submit_program`](SUBMIT_PROGRAM_TOOL).
pub const LABEL_STRAY_TOOL_CALL: &str = "stray-tool-call";
/// The label for a [`submit_program`](SUBMIT_PROGRAM_TOOL) call whose arguments carried no
/// `program` string.
pub const LABEL_NO_PROGRAM: &str = "no-program";

/// Classify the shape of a submitted `program` string. Heuristic, in priority order:
///
/// - `empty` — nothing but whitespace.
/// - `tool-token` — raw tool-call token markers (`<|…|>`).
/// - `xml-pseudo-tools` — XML-ish tool-call markup (`<function…>`, `<tool_call>`,
///   `<invoke …>`, …).
/// - `cot-leak` — chain-of-thought markers leaked into the program.
/// - `fenced` — a markdown code fence anywhere; gg compiles the string exactly as sent, so a
///   fence is part of the program and the compiler refuses it.
/// - `clean-program` — the first line is code and the program imports from `"gg"`.
/// - `prose+program` — imports from `"gg"` but opens with prose.
/// - `program-no-gg` — opens as code but never imports the gg modules.
/// - `other` — anything else.
pub fn classify(text: &str) -> &'static str {
    let t = text.trim();
    if t.is_empty() {
        return "empty";
    }
    if ["<|open|>", "<|sep|>", "<|close|>", "<|tool_call"]
        .iter()
        .any(|m| t.contains(m))
    {
        return "tool-token";
    }
    if [
        "<function ",
        "<function>",
        "<function_call",
        "<function_calls",
        "<tool_call",
        "<tool_result",
        "<invoke ",
        "</tool",
    ]
    .iter()
    .any(|m| t.contains(m))
    {
        return "xml-pseudo-tools";
    }
    if ["<think>", "</think>", "◁think▷"]
        .iter()
        .any(|m| t.contains(m))
    {
        return "cot-leak";
    }
    if t.contains("```") {
        return "fenced";
    }
    let first = t.lines().next().unwrap_or_default().trim();
    let codey = [
        "import ",
        "//",
        "/*",
        "const ",
        "let ",
        "type ",
        "function ",
        "interface ",
    ]
    .iter()
    .any(|p| first.starts_with(p));
    let has_gg = t.contains("from \"gg\"") || t.contains("from 'gg'");
    match (codey, has_gg) {
        (true, true) => LABEL_CLEAN,
        (false, true) => "prose+program",
        (true, false) => "program-no-gg",
        (false, false) => "other",
    }
}

/// Whether a label counts as clean for the verdict.
pub fn is_clean(label: &str) -> bool {
    label == LABEL_CLEAN
}

/// The clean-rate threshold the verdict is measured against.
const CLEAN_THRESHOLD: f64 = 0.8;

/// A probe's reduced outcome.
#[derive(Debug, Clone, PartialEq)]
pub struct Reduction {
    /// `ready` or `not-ready`.
    pub verdict: &'static str,
    /// The clean rate over the scored calls, when any call was scored.
    pub clean_rate: Option<f64>,
}

/// One scored call, as the reduction sees it: its label. A call that errored has
/// no label and is excluded from the rate.
#[derive(Debug, Clone)]
pub struct ScoredCall {
    pub label: Option<String>,
}

/// Reduce a probe's calls to its verdict: a clean rate of at least 80% over the
/// scored calls is `ready`, anything else is `not-ready` (the per-call labels
/// and raw replies say why).
pub fn reduce(calls: &[ScoredCall]) -> Reduction {
    let scored: Vec<&ScoredCall> = calls.iter().filter(|c| c.label.is_some()).collect();
    if scored.is_empty() {
        return Reduction {
            verdict: "not-ready",
            clean_rate: None,
        };
    }
    let clean = scored
        .iter()
        .filter(|c| c.label.as_deref().is_some_and(is_clean))
        .count();
    let rate = clean as f64 / scored.len() as f64;
    Reduction {
        verdict: if rate >= CLEAN_THRESHOLD {
            "ready"
        } else {
            "not-ready"
        },
        clean_rate: Some(rate),
    }
}

/// The parts of one gateway reply the probe records.
#[derive(Debug, Clone, Default)]
pub struct ProbeReply {
    pub provider: Option<String>,
    pub finish_reason: Option<String>,
    pub native_finish_reason: Option<String>,
    /// The reply's text content — commentary beside the call, recorded and never classified.
    pub content: String,
    pub reasoning: Option<String>,
    /// Every tool call the reply made, whatever it named.
    pub tool_calls: usize,
    /// The calls among them that named [`submit_program`](SUBMIT_PROGRAM_TOOL).
    pub submit_calls: usize,
    /// The first `submit_program` call's `program` string, when it carried one.
    pub program: Option<String>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub cost: Option<f64>,
}

/// Build one call's chat/completions request body: the fixture conversation, the one
/// [`submit_program`](submit_program_tool) tool, and `tool_choice` forced to it — the same wire
/// shape gg's `build_required_tool_request_body` sends. `provider` pins the route
/// (`provider.order` with fallbacks disabled); the fresh `session_key` keeps routing natural
/// instead of cache-sticky.
pub fn request_body(
    openrouter_slug: &str,
    messages: &[ProbeMessage],
    max_tokens: i32,
    provider: Option<&str>,
    session_key: &str,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": openrouter_slug,
        "messages": messages,
        "usage": { "include": true },
        "max_tokens": max_tokens,
        "session_id": session_key,
        "prompt_cache_key": session_key,
        "tools": [submit_program_tool()],
        "tool_choice": {
            "type": "function",
            "function": { "name": SUBMIT_PROGRAM_TOOL },
        },
    });
    if let Some(provider) = provider {
        body["provider"] = serde_json::json!({
            "order": [provider],
            "allow_fallbacks": false,
        });
    }
    body
}

/// Parse a gateway response body into the parts the probe records — including the first
/// `submit_program` call's `program` string, which is what gets classified. A body that carries an
/// `error` member (OpenRouter reports some provider faults inside a 200) is an `Err` with its
/// serialized detail.
pub fn parse_reply(body: &serde_json::Value) -> Result<ProbeReply, String> {
    if let Some(error) = body.get("error") {
        return Err(format!("gateway error: {error}"));
    }
    let choice = body
        .get("choices")
        .and_then(|c| c.get(0))
        .ok_or_else(|| "gateway response carried no choices".to_string())?;
    let message = choice.get("message").cloned().unwrap_or_default();
    let string_of = |v: Option<&serde_json::Value>| {
        v.and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let empty = Vec::new();
    let calls = message
        .get("tool_calls")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    let mut submit_calls = 0usize;
    let mut program: Option<String> = None;
    for call in calls {
        let function = call.get("function");
        let name = function
            .and_then(|f| f.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if name == SUBMIT_PROGRAM_TOOL {
            submit_calls += 1;
            if program.is_none() {
                program = function
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .and_then(|args| serde_json::from_str::<serde_json::Value>(args).ok())
                    .and_then(|args| {
                        args.get("program")
                            .and_then(|p| p.as_str())
                            .map(str::to_string)
                    });
            }
        }
    }
    let usage = body.get("usage").cloned().unwrap_or_default();
    Ok(ProbeReply {
        provider: string_of(body.get("provider")),
        finish_reason: string_of(choice.get("finish_reason")),
        native_finish_reason: string_of(choice.get("native_finish_reason")),
        content: message
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        reasoning: string_of(message.get("reasoning")),
        tool_calls: calls.len(),
        submit_calls,
        program,
        prompt_tokens: usage.get("prompt_tokens").and_then(|v| v.as_i64()),
        completion_tokens: usage.get("completion_tokens").and_then(|v| v.as_i64()),
        cost: usage.get("cost").and_then(|v| v.as_f64()),
    })
}

/// Label one parsed reply: the submitted program's [`classify`] shape, or how the reply dodged the
/// forced call when nothing usable was submitted.
pub fn label_reply(reply: &ProbeReply) -> &'static str {
    match &reply.program {
        Some(program) => classify(program),
        None if reply.submit_calls > 0 => LABEL_NO_PROGRAM,
        None if reply.tool_calls > 0 => LABEL_STRAY_TOOL_CALL,
        None => LABEL_NO_SUBMISSION,
    }
}

/// Everything the detached probe runner needs, cloned out of the request state.
pub struct ProbeRunner {
    pub db: Arc<Db>,
    pub http: reqwest::Client,
    /// The chat/completions endpoint ([`DEFAULT_COMPLETIONS_ENDPOINT`] in
    /// production; a local server in tests).
    pub endpoint: String,
    pub api_key: String,
}

impl ProbeRunner {
    /// Execute one probe to completion: run the samples sequentially, append an
    /// item row per call, and finish the probe row with its verdict and spend.
    /// Every fault is recorded on the rows; nothing is returned.
    pub async fn run(&self, probe: model_probe::Model) {
        let mut calls: Vec<ScoredCall> = Vec::new();
        let mut spend = 0.0_f64;
        let mut first_error: Option<String> = None;
        let mut any_scored = false;
        let messages = build_messages(probe.full_context);
        for sample in 0..probe.samples {
            let (item, cost) = self.one_call(&probe, sample, &messages).await;
            spend += cost;
            if item.label.is_some() {
                any_scored = true;
            } else if first_error.is_none() {
                first_error = item.error.clone();
            }
            calls.push(ScoredCall {
                label: item.label.clone(),
            });
            if let Err(err) = self.db.insert_model_probe_item(item).await {
                tracing::error!(probe.id = %probe.id, error = %err, "recording probe item");
            }
        }
        let finished_at = now_rfc3339();
        let result = if any_scored {
            let reduction = reduce(&calls);
            self.db
                .finish_model_probe(
                    &probe.id,
                    "complete",
                    None,
                    Some(reduction.verdict.to_string()),
                    reduction.clean_rate,
                    spend,
                    &finished_at,
                )
                .await
        } else {
            let error = first_error
                .unwrap_or_else(|| "every probe call failed with no recorded error".to_string());
            self.db
                .finish_model_probe(
                    &probe.id,
                    "failed",
                    Some(format!("every probe call failed; first error: {error}")),
                    None,
                    None,
                    spend,
                    &finished_at,
                )
                .await
        };
        if let Err(err) = result {
            tracing::error!(probe.id = %probe.id, error = %err, "finishing probe");
        }
    }

    /// One sample call: send, parse, classify; an error becomes an unlabeled
    /// item carrying the fault. Returns the item and the call's cost.
    async fn one_call(
        &self,
        probe: &model_probe::Model,
        sample: i32,
        messages: &[ProbeMessage],
    ) -> (model_probe_item::Model, f64) {
        let session_key = format!("probe-{}", cuid2::create_id());
        let body = request_body(
            &probe.openrouter_slug,
            messages,
            probe.max_tokens,
            probe.provider.as_deref(),
            &session_key,
        );
        let started = Instant::now();
        let outcome = self.complete(&body).await;
        let duration_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
        let mut item = model_probe_item::Model {
            id: cuid2::create_id(),
            probe_id: probe.id.clone(),
            sample,
            provider: None,
            finish_reason: None,
            native_finish_reason: None,
            label: None,
            clean: false,
            program_text: None,
            response_text: String::new(),
            reasoning_text: None,
            prompt_tokens: None,
            completion_tokens: None,
            cost: None,
            duration_ms,
            error: None,
            created_at: now_rfc3339(),
        };
        let mut cost = 0.0;
        match outcome {
            Ok(reply) => {
                let label = label_reply(&reply);
                item.clean = is_clean(label);
                item.label = Some(label.to_string());
                item.provider = reply.provider;
                item.finish_reason = reply.finish_reason;
                item.native_finish_reason = reply.native_finish_reason;
                item.program_text = reply.program;
                item.response_text = reply.content;
                item.reasoning_text = reply.reasoning;
                item.prompt_tokens = reply.prompt_tokens;
                item.completion_tokens = reply.completion_tokens;
                item.cost = reply.cost;
                cost = reply.cost.unwrap_or(0.0);
            }
            Err(error) => item.error = Some(error),
        }
        (item, cost)
    }

    /// POST one request to the completions endpoint and parse the reply.
    async fn complete(&self, body: &serde_json::Value) -> Result<ProbeReply, String> {
        let response = self
            .http
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .json(body)
            .send()
            .await
            .map_err(|err| format!("reaching OpenRouter: {err}"))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|err| format!("reading the OpenRouter response: {err}"))?;
        if !status.is_success() {
            let detail: String = text.chars().take(500).collect();
            return Err(format!("OpenRouter answered HTTP {status}: {detail}"));
        }
        let parsed: serde_json::Value = serde_json::from_str(&text)
            .map_err(|err| format!("parsing the OpenRouter response: {err}"))?;
        parse_reply(&parsed)
    }
}

/// The current time as an RFC 3339 string (best-effort inside the runner, where
/// there is no request to fail).
fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "probe.test.rs"]
mod tests;
