//! Model probes: responses-as-code readiness checks run against a catalog model.
//!
//! Some models are so overfit on native tool calling that, handed gg's RaC
//! contract ("your entire reply is one TypeScript program", no tools array),
//! they emit tool-call token syntax, XML pseudo-tool markup, or prose anyway,
//! and every RaC run on them is wasted. A probe answers that cheaply before any
//! run is launched: it replays gg's real RaC turn-1 request through OpenRouter's
//! chat/completions — with no tools array — across a fixed matrix of prompt
//! conditions, classifies the shape of every reply, and reduces the results to a
//! verdict.
//!
//! The turn-1 request is the embedded fixture `probe/fixtures/gg-rac-turn1.json`
//! (its provenance is recorded inside it): the system-code prompt, the Carom
//! task, two seeded example programs with their results, and the case's spec
//! views, which are trimmed by default to keep a probe cheap. The matrix is the
//! `base` condition (the request exactly as gg sends it) plus three variations
//! that restate the contract — an explicit no-tools clause in the system prompt
//! (`no-tools`), a trailing user notice (`notice`), and both at once (`combo`) —
//! because a model that only behaves under the variations is usable with
//! cross-model prompt reminders, while one that emits tool syntax even then is
//! not worth running in RaC mode at all.
//!
//! Classification is heuristic, over the reply text (labels in [`classify`]);
//! `clean` means a bare program whose first line is code and that imports from
//! `"gg"`. The verdict thresholds are on the per-condition clean rates: every
//! condition at ≥ 80% is `ready`; a variation reaching 80% where base did not is
//! `ready-with-reminders`; tool-call syntax surviving the variations is
//! `tool-call-overfit`; anything else is `not-ready`.
//!
//! The runner executes as a detached task inside the backend process, appending
//! one `model_probe_item` row per call and finishing the `model_probe` row with
//! the verdict and the summed spend. Calls are sequential, uncapped by
//! temperature (the provider default, matching how gg calls the model), and each
//! carries a fresh session/prompt-cache key so provider routing stays natural.
//! The HTTP endpoint is a parameter so tests can stand in a local server; the
//! real base is [`DEFAULT_COMPLETIONS_ENDPOINT`].

use std::sync::{Arc, LazyLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_entities::{model_probe, model_probe_item};

use crate::db::Db;

/// The OpenRouter chat/completions endpoint probes call in production.
pub const DEFAULT_COMPLETIONS_ENDPOINT: &str = "https://openrouter.ai/api/v1/chat/completions";

/// Samples per condition when the trigger names none.
pub const DEFAULT_SAMPLES: i32 = 3;
/// The most samples per condition a trigger may request (a probe is a cheap
/// check, not a benchmark).
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

/// The `no-tools` variation: an explicit clause appended to the system prompt.
pub const NO_TOOLS_CLAUSE: &str = "\n\n## No tools\n\nYou have NO tools and there is no tool-calling protocol. Tool-call syntax of any kind (XML tags, `<|...|>` tokens, function-call markup, JSON tool calls) is an error. Your entire reply must be one bare TypeScript program and nothing else: no prose before it, no markdown fences around it.";

/// The `notice` variation: a trailing user message restating the contract.
pub const NOTICE_MESSAGE: &str = "Notice\n----\nReminder: your entire reply is executed as one TypeScript program. Reply with one legal TypeScript program and nothing else — no prose, no markdown fences, no tool-call syntax of any kind.";

/// One cell family of the probe matrix: a named prompt condition.
#[derive(Debug, Clone, Copy)]
pub struct ProbeCondition {
    /// The condition's wire name (`base`, `no-tools`, `notice`, `combo`).
    pub name: &'static str,
    /// Whether [`NO_TOOLS_CLAUSE`] is appended to the system prompt.
    pub no_tools_clause: bool,
    /// Whether [`NOTICE_MESSAGE`] is appended as a trailing user message.
    pub trailing_notice: bool,
    /// Whether this condition is a variation (everything but `base`).
    pub variation: bool,
}

/// The fixed probe matrix, in execution order.
pub const CONDITIONS: [ProbeCondition; 4] = [
    ProbeCondition {
        name: "base",
        no_tools_clause: false,
        trailing_notice: false,
        variation: false,
    },
    ProbeCondition {
        name: "no-tools",
        no_tools_clause: true,
        trailing_notice: false,
        variation: true,
    },
    ProbeCondition {
        name: "notice",
        no_tools_clause: false,
        trailing_notice: true,
        variation: true,
    },
    ProbeCondition {
        name: "combo",
        no_tools_clause: true,
        trailing_notice: true,
        variation: true,
    },
];

/// One message of the embedded turn-1 fixture. `source` records which gg event
/// produced it (only `file_view` messages are trimmed); it is never sent.
#[derive(Debug, Clone, Deserialize)]
struct FixtureMessage {
    role: String,
    source: String,
    content: String,
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

/// One chat message as sent to the provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ProbeMessage {
    pub role: String,
    pub content: String,
}

/// Build one condition's message array from the fixture: trim the spec views
/// (unless `full_context`), then apply the condition's contract restatements.
pub fn build_messages(condition: &ProbeCondition, full_context: bool) -> Vec<ProbeMessage> {
    let mut messages: Vec<ProbeMessage> = FIXTURE
        .iter()
        .map(|m| {
            let mut content = m.content.clone();
            if !full_context && m.source == "file_view" && content.len() > TRIM_CHARS {
                let mut cut = TRIM_CHARS;
                while !content.is_char_boundary(cut) {
                    cut -= 1;
                }
                content.truncate(cut);
            }
            ProbeMessage {
                role: m.role.clone(),
                content,
            }
        })
        .collect();
    if condition.no_tools_clause
        && let Some(system) = messages.first_mut()
    {
        system.content.push_str(NO_TOOLS_CLAUSE);
    }
    if condition.trailing_notice {
        messages.push(ProbeMessage {
            role: "user".to_string(),
            content: NOTICE_MESSAGE.to_string(),
        });
    }
    messages
}

/// The label a reply the gateway answered with native `tool_calls` gets, ahead
/// of any text heuristic: the model bypassed the text channel entirely.
pub const LABEL_NATIVE_TOOL_CALL: &str = "native-tool-call";
/// The label for a clean reply: a bare program over the gg modules.
pub const LABEL_CLEAN: &str = "clean-program";

/// Classify the shape of a reply's text. Heuristic, in priority order:
///
/// - `empty` — nothing but whitespace.
/// - `tool-token` — raw tool-call token markers (`<|…|>`).
/// - `xml-pseudo-tools` — XML-ish tool-call markup (`<function…>`, `<tool_call>`,
///   `<invoke …>`, …).
/// - `cot-leak` — chain-of-thought markers leaked into the content.
/// - `fenced` — a markdown code fence anywhere.
/// - `clean-program` — the first line is code and the reply imports from `"gg"`.
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

/// Whether a label is tool-call-shaped (the overfit signature).
pub fn is_tool_syntax(label: &str) -> bool {
    matches!(
        label,
        "tool-token" | "xml-pseudo-tools" | LABEL_NATIVE_TOOL_CALL
    )
}

/// The clean-rate threshold every verdict tier is measured against.
const CLEAN_THRESHOLD: f64 = 0.8;

/// A probe's reduced outcome.
#[derive(Debug, Clone, PartialEq)]
pub struct Reduction {
    /// `ready`, `ready-with-reminders`, `tool-call-overfit`, or `not-ready`.
    pub verdict: &'static str,
    /// The base condition's clean rate, when it produced any scored call.
    pub base_clean_rate: Option<f64>,
    /// The best variation's clean rate, when any variation produced a scored
    /// call.
    pub best_variation_clean_rate: Option<f64>,
}

/// One scored call, as the reduction sees it: its condition name and label. A
/// call that errored has no label and is excluded from the rates.
#[derive(Debug, Clone)]
pub struct ScoredCall {
    pub condition: String,
    pub label: Option<String>,
}

/// Reduce a probe's calls to its verdict:
///
/// - base and every variation ≥ 80% clean → `ready`;
/// - a variation reaches 80% where base did not → `ready-with-reminders`;
/// - no variation reaches 80% and tool-call syntax appears under the
///   variations → `tool-call-overfit`;
/// - otherwise → `not-ready` (the failures are not tool-shaped; the raw replies
///   say what they are).
pub fn reduce(calls: &[ScoredCall]) -> Reduction {
    let rate = |name: &str| {
        let scored: Vec<&ScoredCall> = calls
            .iter()
            .filter(|c| c.condition == name && c.label.is_some())
            .collect();
        if scored.is_empty() {
            return None;
        }
        let clean = scored
            .iter()
            .filter(|c| c.label.as_deref().is_some_and(is_clean))
            .count();
        Some(clean as f64 / scored.len() as f64)
    };
    let base = rate("base");
    let variation_rates: Vec<Option<f64>> = CONDITIONS
        .iter()
        .filter(|c| c.variation)
        .map(|c| rate(c.name))
        .collect();
    let best_variation = variation_rates
        .iter()
        .filter_map(|r| *r)
        .fold(None::<f64>, |best, r| Some(best.map_or(r, |b| b.max(r))));

    let all_ready = base.is_some_and(|r| r >= CLEAN_THRESHOLD)
        && !variation_rates.is_empty()
        && variation_rates
            .iter()
            .all(|r| r.is_some_and(|r| r >= CLEAN_THRESHOLD));
    let verdict = if all_ready {
        "ready"
    } else if best_variation.is_some_and(|r| r >= CLEAN_THRESHOLD) {
        "ready-with-reminders"
    } else if calls.iter().any(|c| {
        c.label.as_deref().is_some_and(is_tool_syntax)
            && CONDITIONS
                .iter()
                .any(|cond| cond.variation && cond.name == c.condition)
    }) {
        "tool-call-overfit"
    } else {
        "not-ready"
    };
    Reduction {
        verdict,
        base_clean_rate: base,
        best_variation_clean_rate: best_variation,
    }
}

/// The parts of one gateway reply the probe records.
#[derive(Debug, Clone, Default)]
pub struct ProbeReply {
    pub provider: Option<String>,
    pub finish_reason: Option<String>,
    pub native_finish_reason: Option<String>,
    pub content: String,
    pub reasoning: Option<String>,
    pub tool_calls: usize,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub cost: Option<f64>,
}

/// Build one call's chat/completions request body. `provider` pins the route
/// (`provider.order` with fallbacks disabled); the fresh `session_key` keeps
/// routing natural instead of cache-sticky.
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
    });
    if let Some(provider) = provider {
        body["provider"] = serde_json::json!({
            "order": [provider],
            "allow_fallbacks": false,
        });
    }
    body
}

/// Parse a gateway response body into the parts the probe records. A body that
/// carries an `error` member (OpenRouter reports some provider faults inside a
/// 200) is an `Err` with its serialized detail.
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
        tool_calls: message
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .map_or(0, |a| a.len()),
        prompt_tokens: usage.get("prompt_tokens").and_then(|v| v.as_i64()),
        completion_tokens: usage.get("completion_tokens").and_then(|v| v.as_i64()),
        cost: usage.get("cost").and_then(|v| v.as_f64()),
    })
}

/// Label one parsed reply: a native tool call outranks the text heuristics.
pub fn label_reply(reply: &ProbeReply) -> &'static str {
    if reply.tool_calls > 0 {
        LABEL_NATIVE_TOOL_CALL
    } else {
        classify(&reply.content)
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
    /// Execute one probe to completion: run the matrix sequentially, append an
    /// item row per call, and finish the probe row with its verdict and spend.
    /// Every fault is recorded on the rows; nothing is returned.
    pub async fn run(&self, probe: model_probe::Model) {
        let mut calls: Vec<ScoredCall> = Vec::new();
        let mut spend = 0.0_f64;
        let mut first_error: Option<String> = None;
        let mut any_scored = false;
        for condition in &CONDITIONS {
            let messages = build_messages(condition, probe.full_context);
            for sample in 0..probe.samples {
                let (item, cost) = self.one_call(&probe, condition, sample, &messages).await;
                spend += cost;
                if item.label.is_some() {
                    any_scored = true;
                } else if first_error.is_none() {
                    first_error = item.error.clone();
                }
                calls.push(ScoredCall {
                    condition: condition.name.to_string(),
                    label: item.label.clone(),
                });
                if let Err(err) = self.db.insert_model_probe_item(item).await {
                    tracing::error!(probe.id = %probe.id, error = %err, "recording probe item");
                }
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
                    reduction.base_clean_rate,
                    reduction.best_variation_clean_rate,
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

    /// One (condition, sample) call: send, parse, classify; an error becomes an
    /// unlabeled item carrying the fault. Returns the item and the call's cost.
    async fn one_call(
        &self,
        probe: &model_probe::Model,
        condition: &ProbeCondition,
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
            condition: condition.name.to_string(),
            sample,
            provider: None,
            finish_reason: None,
            native_finish_reason: None,
            label: None,
            clean: false,
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
