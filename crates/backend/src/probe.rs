//! Model probes: responses-as-code readiness checks run against a catalog model.
//!
//! A responses-as-code turn is a forced [`submit_program`](SUBMIT_PROGRAM_TOOL) tool call whose
//! `program` string is one whole, bare program over the gg modules. A model can hold that call
//! shape and still be unusable — fencing the program, never making the calls the task needs, or
//! calling functions it has not read the documentation of — and every RaC run on such a model is
//! wasted. A probe answers that cheaply before any run is launched: it replays gg's RaC turn-1
//! request through OpenRouter's chat/completions, with the one `submit_program` tool offered and
//! `tool_choice` forced to it exactly as gg shapes the request, and checks each submitted program
//! against its case's expectations.
//!
//! # The cases: two scenarios over several input prompts, per language arm
//!
//! The requests are the embedded fixtures under `probe/fixtures/` — one JSON document per gg
//! program language, projected out of gg's own machinery by `scripts/gg-probe-fixtures.sh`
//! (provenance inside each file). Every fixture carries one case per (scenario, input prompt)
//! pair, at least three input prompts across them:
//!
//! - [`baseline`](SCENARIO_BASELINE) — the conversation holds an open documentation view of every
//!   function the task needs. A passing program is bare code that calls them all
//!   ([`correct-calls`](LABEL_CORRECT_CALLS)).
//! - [`missing-docview`](SCENARIO_MISSING_DOCVIEW) — the task needs a function whose documentation
//!   view is *not* open, and the system prompt instructs the model to open a documentation view of
//!   each function it intends to call and write the call on a later turn. A passing program opens
//!   the missing view and stops ([`docview-first`](LABEL_DOCVIEW_FIRST)); calling the undocumented
//!   function in the same program fails ([`called-undocumented`](LABEL_CALLED_UNDOCUMENTED)).
//!
//! A probe targets one language arm or every arm, and its sample count applies **per input
//! prompt**: a probe of one language with the default sampling makes `8 × 4` calls. The
//! fixture-presented context is always sent whole — file views are faithful, with the total-line
//! headings gg sends — and nothing is trimmed.
//!
//! # Classification, and the verdict
//!
//! The first `submit_program` call's `program` string is checked. Shape faults come first (a
//! fenced program, leaked tool-call or reasoning markup, an empty string); a bare program is then
//! scored against its case as above. Call detection is heuristic and string-literal-aware: string
//! literals are stripped before call needles are matched on identifier boundaries, so a
//! documentation key passed as a string never reads as a call. A reply that submitted nothing is
//! labeled by how it dodged ([`no-submission`](LABEL_NO_SUBMISSION),
//! [`stray-tool-call`](LABEL_STRAY_TOOL_CALL), [`no-program`](LABEL_NO_PROGRAM)).
//!
//! The verdict is `ready` when every probed (language, scenario) group passes at least 80% of its
//! scored calls, and `not-ready` otherwise; the per-call labels say why.
//!
//! The runner executes as a detached task inside the backend process, appending one
//! `model_probe_item` row per call and finishing the `model_probe` row with the verdict and the
//! summed spend. It holds a [lease](crate::db::PROBE_LEASE) on the probe's row while it runs, set
//! when the probe is triggered and renewed every [`PROBE_LEASE_RENEWAL`]; a runner whose renewal
//! finds the lease taken over stops issuing calls and leaves the probe to the runner holding it.
//! A probe still `running` whose lease lapsed — its backend restarted or died — is taken over by
//! the [resumer](spawn_resumer) every backend runs, which issues only the calls the probe holds no
//! item for and reduces the verdict and spend over every item.
//! Calls are sequential, uncapped by temperature (the provider default, matching how
//! gg calls the model), and each carries a fresh session/prompt-cache key so provider routing
//! stays natural. The HTTP endpoint is a parameter so tests can stand in a local server; the real
//! base is [`DEFAULT_COMPLETIONS_ENDPOINT`].

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use test_cabinet_entities::{model_probe, model_probe_item};

use crate::db::{Db, ProbeItemRecorded};

pub use test_cabinet_contracts::backend_api::probe::{
    ProbeMessage, ProbeRequestOut, ProbeToolCall, ProbeToolFunction,
};

/// The OpenRouter chat/completions endpoint probes call in production.
pub const DEFAULT_COMPLETIONS_ENDPOINT: &str = "https://openrouter.ai/api/v1/chat/completions";

/// Completion calls per input prompt when the trigger names no sample count.
pub const DEFAULT_SAMPLES: i32 = 8;
/// The most calls per input prompt a trigger may request.
pub const MAX_SAMPLES: i32 = 128;
/// The completion-token cap when the trigger names none. Generous for a first
/// program, tight enough that a runaway reply stays cheap.
pub const DEFAULT_MAX_TOKENS: i32 = 3500;
/// The largest completion-token cap a trigger may request.
pub const MAX_MAX_TOKENS: i32 = 16_000;

/// The one tool a responses-as-code request offers, and requires.
pub const SUBMIT_PROGRAM_TOOL: &str = "submit_program";

/// The scenario whose conversations hold an open documentation view of every needed function.
pub const SCENARIO_BASELINE: &str = "baseline";
/// The scenario whose task needs a function with no documentation view open.
pub const SCENARIO_MISSING_DOCVIEW: &str = "missing-docview";

// ---------------------------------------------------------------------------
// The embedded fixtures
// ---------------------------------------------------------------------------

/// One language's fixture document, as `scripts/gg-probe-fixtures.sh` writes it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    language: String,
    tool: FixtureTool,
    cases: Vec<FixtureCase>,
}

/// The `submit_program` tool definition, in the chat/completions `function` shape, spelled for the
/// fixture's language (the program description names the language).
#[derive(Debug, Deserialize)]
struct FixtureTool {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

/// One probe case: its coordinate, its conversation, and its pass criteria.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureCase {
    scenario: String,
    prompt: String,
    /// Call needles a passing baseline program must all contain (on identifier boundaries, in the
    /// literal-stripped program).
    #[serde(default)]
    expected_calls: Vec<String>,
    /// The target call's needle a passing missing-docview program must not contain.
    #[serde(default)]
    forbidden_calls: Vec<String>,
    /// The documentation-view-opening call's needle.
    #[serde(default)]
    docview_call: Option<String>,
    /// The key the missing function's documentation view is opened under.
    #[serde(default)]
    docview_key: Option<String>,
    messages: Vec<FixtureMessage>,
}

/// One message of a case's conversation. `source` records which gg mechanism produced it (kept for
/// provenance; never sent).
#[derive(Debug, Deserialize)]
struct FixtureMessage {
    role: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<ProbeToolCall>,
    #[serde(default)]
    tool_call_id: Option<String>,
}

/// The embedded per-language fixtures, in gg's registration order. The pairs are asserted against
/// `GgProgramLanguage::ALL` under test, so a language gg registers without a fixture here fails a
/// test rather than silently probing fewer arms.
static FIXTURES: LazyLock<Vec<Fixture>> = LazyLock::new(|| {
    const RAW: &[(&str, &str)] = &[
        ("typescript", include_str!("probe/fixtures/typescript.json")),
        ("javascript", include_str!("probe/fixtures/javascript.json")),
        ("python", include_str!("probe/fixtures/python.json")),
        ("ruby", include_str!("probe/fixtures/ruby.json")),
        ("purescript", include_str!("probe/fixtures/purescript.json")),
        ("java", include_str!("probe/fixtures/java.json")),
        ("kotlin", include_str!("probe/fixtures/kotlin.json")),
        ("rust", include_str!("probe/fixtures/rust.json")),
        ("swift", include_str!("probe/fixtures/swift.json")),
        ("cpp", include_str!("probe/fixtures/cpp.json")),
        ("csharp", include_str!("probe/fixtures/csharp.json")),
    ];
    RAW.iter()
        .map(|(id, raw)| {
            let fixture: Fixture = serde_json::from_str(raw)
                .unwrap_or_else(|err| panic!("embedded probe fixture `{id}` parses: {err}"));
            assert_eq!(&fixture.language, id, "a fixture names its own language");
            fixture
        })
        .collect()
});

/// The language ids probes can target, in gg's registration order.
pub fn fixture_languages() -> Vec<&'static str> {
    FIXTURES
        .iter()
        .map(|fixture| fixture.language.as_str())
        .collect()
}

/// One planned case of a probe: the fixture case it runs, addressed for the rows it produces.
#[derive(Debug, Clone, Copy)]
pub struct PlannedCase {
    fixture: &'static Fixture,
    case: &'static FixtureCase,
}

impl PlannedCase {
    /// The language arm's wire id.
    pub fn language(&self) -> &'static str {
        &self.fixture.language
    }

    /// The case's scenario.
    pub fn scenario(&self) -> &'static str {
        &self.case.scenario
    }

    /// The case's input prompt id.
    pub fn prompt(&self) -> &'static str {
        &self.case.prompt
    }

    /// The case's conversation in the wire shape.
    pub fn messages(&self) -> Vec<ProbeMessage> {
        self.case
            .messages
            .iter()
            .map(|message| ProbeMessage {
                role: message.role.clone(),
                content: message.content.clone(),
                tool_calls: message.tool_calls.clone(),
                tool_call_id: message.tool_call_id.clone(),
            })
            .collect()
    }
}

/// The cases a probe of `language` runs, in fixture order — every case of the one arm, or every
/// case of every arm for `None`. An unknown id is an error naming the ids that exist.
pub fn plan_cases(language: Option<&str>) -> Result<Vec<PlannedCase>, String> {
    let fixtures: Vec<&'static Fixture> = match language {
        None => FIXTURES.iter().collect(),
        Some(id) => vec![
            FIXTURES
                .iter()
                .find(|fixture| fixture.language == id)
                .ok_or_else(|| {
                    format!(
                        "`{id}` names no gg program language; the probe knows {}",
                        fixture_languages().join(", ")
                    )
                })?,
        ],
    };
    Ok(fixtures
        .into_iter()
        .flat_map(|fixture| {
            fixture
                .cases
                .iter()
                .map(move |case| PlannedCase { fixture, case })
        })
        .collect())
}

/// The per-case requests a probe of `language` sends, for the stored `request_json` and the detail
/// read — the message arrays exactly as sent, addressed by case.
pub fn probe_requests(language: Option<&str>) -> Result<Vec<ProbeRequestOut>, String> {
    Ok(plan_cases(language)?
        .into_iter()
        .map(|case| ProbeRequestOut {
            language: case.language().to_string(),
            scenario: case.scenario().to_string(),
            prompt: case.prompt().to_string(),
            messages: case.messages(),
        })
        .collect())
}

/// Build one call's chat/completions request body: the case's conversation, the one
/// `submit_program` tool in the case's own language, and `tool_choice` forced to it — the same
/// wire shape gg's `build_required_tool_request_body` sends. `provider` pins the route
/// (`provider.order` with fallbacks disabled); the fresh `session_key` keeps routing natural
/// instead of cache-sticky.
pub fn request_body(
    openrouter_slug: &str,
    case: &PlannedCase,
    messages: &[ProbeMessage],
    max_tokens: i32,
    provider: Option<&str>,
    session_key: &str,
) -> serde_json::Value {
    let tool = &case.fixture.tool;
    let mut body = serde_json::json!({
        "model": openrouter_slug,
        "messages": messages,
        "usage": { "include": true },
        "max_tokens": max_tokens,
        "session_id": session_key,
        "prompt_cache_key": session_key,
        "tools": [{
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }],
        "tool_choice": {
            "type": "function",
            "function": { "name": tool.name },
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

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/// The passing baseline label: a bare program containing every expected call.
pub const LABEL_CORRECT_CALLS: &str = "correct-calls";
/// A bare baseline program missing at least one expected call.
pub const LABEL_MISSING_CALLS: &str = "missing-calls";
/// The passing missing-docview label: the program opens the missing documentation view and does
/// not call the undocumented function.
pub const LABEL_DOCVIEW_FIRST: &str = "docview-first";
/// A missing-docview program that called the undocumented function.
pub const LABEL_CALLED_UNDOCUMENTED: &str = "called-undocumented";
/// A missing-docview program that neither opened the missing view nor called the function.
pub const LABEL_NO_DOCVIEW: &str = "no-docview";
/// The label for a reply that made no tool call at all despite the forced choice.
pub const LABEL_NO_SUBMISSION: &str = "no-submission";
/// The label for a reply whose calls named some other tool and never
/// [`submit_program`](SUBMIT_PROGRAM_TOOL).
pub const LABEL_STRAY_TOOL_CALL: &str = "stray-tool-call";
/// The label for a [`submit_program`](SUBMIT_PROGRAM_TOOL) call whose arguments carried no
/// `program` string.
pub const LABEL_NO_PROGRAM: &str = "no-program";

/// `text` with the contents of its string literals removed (the delimiters stay), so a call needle
/// matched afterwards can only have matched code. Understands `"…"`, `'…'` and `` `…` `` with
/// backslash escapes — a heuristic that covers every arm's common literals.
pub fn strip_string_literals(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        out.push(ch);
        if ch == '"' || ch == '\'' || ch == '`' {
            let quote = ch;
            while let Some(inner) = chars.next() {
                if inner == '\\' {
                    // Skip the escaped character.
                    let _ = chars.next();
                    continue;
                }
                if inner == quote {
                    out.push(inner);
                    break;
                }
            }
        }
    }
    out
}

/// Whether `text` contains `needle` on identifier boundaries: the characters directly before and
/// after the match are not identifier characters, so `files.writeFile` matches both bare and
/// `gg.`-qualified call sites and never the middle of a longer name.
pub fn contains_call(text: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let mut from = 0;
    while let Some(at) = text[from..].find(needle) {
        let start = from + at;
        let end = start + needle.len();
        let before_ok = text[..start].chars().next_back().is_none_or(|c| !ident(c));
        let after_ok = text[end..].chars().next().is_none_or(|c| !ident(c));
        if before_ok && after_ok {
            return true;
        }
        from = end;
    }
    false
}

/// `text` with the parenthesized argument span of every `call` occurrence blanked, so a function
/// passed *to* the documentation-view call by reference is not read as a call of its own.
fn blank_call_arguments(text: &str, call: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(call) {
        let after = at + call.len();
        out.push_str(&rest[..after]);
        rest = &rest[after..];
        let mut chars = rest.char_indices();
        // Only a directly following `(` opens an argument span to blank.
        if let Some((_, '(')) = chars.next() {
            let mut depth = 1usize;
            let mut consumed = 1usize;
            out.push('(');
            for (index, ch) in chars {
                consumed = index + ch.len_utf8();
                match ch {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            out.push(')');
                            break;
                        }
                    }
                    _ => {}
                }
            }
            rest = &rest[consumed..];
        }
    }
    out.push_str(rest);
    out
}

/// Classify one submitted `program` string against its case: the label, and whether it passes.
///
/// Shape faults come first, in priority order — raw tool-call token markers, XML-ish tool markup,
/// leaked chain-of-thought, a markdown fence (gg compiles the string exactly as sent, so a fence
/// is part of the program), an empty string. A bare program is then scored against the case's
/// scenario as the module docs describe.
pub fn classify(program: &str, case: &PlannedCase) -> (&'static str, bool) {
    let t = program.trim();
    if t.is_empty() {
        return ("empty", false);
    }
    if ["<|open|>", "<|sep|>", "<|close|>", "<|tool_call"]
        .iter()
        .any(|m| t.contains(m))
    {
        return ("tool-token", false);
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
        return ("xml-pseudo-tools", false);
    }
    if ["<think>", "</think>", "◁think▷"]
        .iter()
        .any(|m| t.contains(m))
    {
        return ("cot-leak", false);
    }
    if t.contains("```") {
        return ("fenced", false);
    }
    let stripped = strip_string_literals(t);
    match case.scenario() {
        SCENARIO_MISSING_DOCVIEW => {
            let opened = case.case.docview_call.as_deref().is_some_and(|open| {
                contains_call(&stripped, open)
                    && case
                        .case
                        .docview_key
                        .as_deref()
                        .is_some_and(|key| t.contains(key))
            });
            // A function handed to the documentation-view call by reference is not a call of it.
            let blanked = match case.case.docview_call.as_deref() {
                Some(open) => blank_call_arguments(&stripped, open),
                None => stripped.clone(),
            };
            let called = case
                .case
                .forbidden_calls
                .iter()
                .any(|needle| contains_call(&blanked, needle));
            if called {
                (LABEL_CALLED_UNDOCUMENTED, false)
            } else if opened {
                (LABEL_DOCVIEW_FIRST, true)
            } else {
                (LABEL_NO_DOCVIEW, false)
            }
        }
        _ => {
            let all = case
                .case
                .expected_calls
                .iter()
                .all(|needle| contains_call(&stripped, needle));
            if all {
                (LABEL_CORRECT_CALLS, true)
            } else {
                (LABEL_MISSING_CALLS, false)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// The verdict reduction
// ---------------------------------------------------------------------------

/// The per-group pass-rate threshold the verdict is measured against.
const PASS_THRESHOLD: f64 = 0.8;

/// A probe's reduced outcome.
#[derive(Debug, Clone, PartialEq)]
pub struct Reduction {
    /// `ready` or `not-ready`.
    pub verdict: &'static str,
    /// The overall pass rate over the scored calls, when any call was scored.
    pub pass_rate: Option<f64>,
}

/// One call, as the reduction sees it: its (language, scenario) group and whether it passed —
/// `None` for a call that errored before classification, which is excluded from the rates.
#[derive(Debug, Clone)]
pub struct ScoredCall {
    pub language: String,
    pub scenario: String,
    pub pass: Option<bool>,
}

/// Reduce a probe's calls to its verdict: `ready` when every probed (language, scenario) group
/// passes at least 80% of its scored calls, `not-ready` otherwise — including when a whole group
/// errored and scored nothing, since a scenario nobody measured is not a scenario that passed.
/// The overall `pass_rate` is across every scored call.
pub fn reduce(calls: &[ScoredCall]) -> Reduction {
    let scored: Vec<&ScoredCall> = calls.iter().filter(|c| c.pass.is_some()).collect();
    if scored.is_empty() {
        return Reduction {
            verdict: "not-ready",
            pass_rate: None,
        };
    }
    let groups: BTreeSet<(&str, &str)> = calls
        .iter()
        .map(|c| (c.language.as_str(), c.scenario.as_str()))
        .collect();
    let mut tallies: BTreeMap<(&str, &str), (usize, usize)> = BTreeMap::new();
    for call in &scored {
        let entry = tallies
            .entry((call.language.as_str(), call.scenario.as_str()))
            .or_default();
        entry.0 += 1;
        if call.pass == Some(true) {
            entry.1 += 1;
        }
    }
    let every_group_passes = groups.iter().all(|group| {
        tallies
            .get(group)
            .is_some_and(|(scored, passed)| *passed as f64 / *scored as f64 >= PASS_THRESHOLD)
    });
    let passed = scored.iter().filter(|c| c.pass == Some(true)).count();
    Reduction {
        verdict: if every_group_passes {
            "ready"
        } else {
            "not-ready"
        },
        pass_rate: Some(passed as f64 / scored.len() as f64),
    }
}

// ---------------------------------------------------------------------------
// The gateway reply
// ---------------------------------------------------------------------------

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

/// Label one parsed reply against its case: the submitted program's [`classify`] outcome, or how
/// the reply dodged the forced call when nothing usable was submitted.
pub fn label_reply(reply: &ProbeReply, case: &PlannedCase) -> (&'static str, bool) {
    match &reply.program {
        Some(program) => classify(program, case),
        None if reply.submit_calls > 0 => (LABEL_NO_PROGRAM, false),
        None if reply.tool_calls > 0 => (LABEL_STRAY_TOOL_CALL, false),
        None => (LABEL_NO_SUBMISSION, false),
    }
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/// How often a running probe's runner renews its lease: well inside
/// [`PROBE_LEASE`](crate::db::PROBE_LEASE), so a renewal or two may fail before the lease lapses.
pub const PROBE_LEASE_RENEWAL: Duration = Duration::from_secs(30);

/// Everything the detached probe runner needs, cloned out of the request state.
pub struct ProbeRunner {
    pub db: Arc<Db>,
    pub http: reqwest::Client,
    /// The chat/completions endpoint ([`DEFAULT_COMPLETIONS_ENDPOINT`] in
    /// production; a local server in tests).
    pub endpoint: String,
    pub api_key: String,
    /// The token this runner holds the probe's lease under (the row's `lease_holder`).
    pub holder: String,
    /// How often the runner renews the lease ([`PROBE_LEASE_RENEWAL`] in production).
    pub renew_every: Duration,
}

/// What a probe's calls add up to so far: the calls the verdict is reduced over, the summed
/// spend, the first fault of a call that scored nothing, and whether any call scored.
#[derive(Default)]
struct Tally {
    calls: Vec<ScoredCall>,
    spend: f64,
    first_error: Option<String>,
    any_scored: bool,
}

impl Tally {
    /// Count one recorded call, which cost `cost`.
    fn add(&mut self, item: &model_probe_item::Model, cost: f64) {
        let pass = item.label.is_some().then_some(item.pass);
        self.spend += cost;
        if pass.is_some() {
            self.any_scored = true;
        } else if self.first_error.is_none() {
            self.first_error = item.error.clone();
        }
        self.calls.push(ScoredCall {
            language: item.language.clone(),
            scenario: item.scenario.clone(),
            pass,
        });
    }
}

/// Aborts the lease renewal task when the runner returns, however it returns.
struct AbortOnDrop(tokio::task::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl ProbeRunner {
    /// Execute a freshly triggered probe to completion while holding its lease: a
    /// [`resume`](Self::resume) of a probe that holds no item yet, issuing every planned call.
    pub async fn run(&self, probe: model_probe::Model) {
        self.drive(probe, Vec::new()).await;
    }

    /// Resume a probe whose lease this runner has just taken over: issue only the calls — the
    /// (language, scenario, prompt, sample) coordinates of its plan — it holds no item for, and
    /// finish it with the verdict and spend reduced over the items it already held and the new
    /// ones together. A store fault reading the held items leaves the probe untouched, for its
    /// lease to lapse and a later pass to resume it.
    pub async fn resume(&self, probe: model_probe::Model) {
        let stored = match self.db.list_model_probe_items(&probe.id).await {
            Ok(stored) => stored,
            Err(err) => {
                tracing::error!(
                    probe.id = %probe.id,
                    error = %err,
                    "reading a resumed probe's recorded calls; leaving it for a later pass"
                );
                return;
            }
        };
        self.drive(probe, stored).await;
    }

    /// Issue every planned call `stored` holds no item for, sequentially, appending an item row
    /// per call, and finish the probe row with the verdict and spend over `stored` and the new
    /// items. The lease is renewed every [`renew_every`](Self::renew_every) meanwhile; once a
    /// renewal, or the recording of a call (which renews it too), finds it taken over, the runner
    /// stops without recording the call in flight or finishing the probe, which belongs to the
    /// runner holding the lease. Every fault is recorded on the rows; nothing is returned.
    async fn drive(&self, probe: model_probe::Model, stored: Vec<model_probe_item::Model>) {
        let (lost_tx, lost) = tokio::sync::watch::channel(false);
        let _renewal = AbortOnDrop(tokio::spawn(renew_lease(
            Arc::clone(&self.db),
            probe.id.clone(),
            self.holder.clone(),
            self.renew_every,
            lost_tx,
        )));
        self.execute(probe, stored, lost).await;
    }

    /// The body of [`drive`](Self::drive), stopping as soon as `lost` reports the lease lost.
    async fn execute(
        &self,
        probe: model_probe::Model,
        stored: Vec<model_probe_item::Model>,
        mut lost: tokio::sync::watch::Receiver<bool>,
    ) {
        let cases = match plan_cases(probe.language.as_deref()) {
            Ok(cases) => cases,
            Err(error) => {
                let spend = stored.iter().filter_map(|item| item.cost).sum();
                self.finish(&probe.id, "failed", Some(error), None, None, spend)
                    .await;
                return;
            }
        };
        let recorded: BTreeSet<(&str, &str, &str, i32)> = stored
            .iter()
            .map(|item| {
                (
                    item.language.as_str(),
                    item.scenario.as_str(),
                    item.prompt.as_str(),
                    item.sample,
                )
            })
            .collect();
        let mut tally = Tally::default();
        for item in &stored {
            tally.add(item, item.cost.unwrap_or(0.0));
        }
        for case in &cases {
            let messages = case.messages();
            for sample in 0..probe.samples {
                if recorded.contains(&(case.language(), case.scenario(), case.prompt(), sample)) {
                    continue;
                }
                // A closed channel means the renewal task is gone, so the lease is no longer
                // kept: stop as if it were lost.
                let call = self.one_call(&probe, case, sample, &messages);
                let (item, cost) = tokio::select! {
                    biased;
                    _ = lost.wait_for(|lost| *lost) => {
                        tracing::warn!(probe.id = %probe.id, "probe lease lost; stopping the runner");
                        return;
                    }
                    done = call => done,
                };
                match self
                    .db
                    .record_model_probe_item(item.clone(), &self.holder, &now_rfc3339())
                    .await
                {
                    Ok(ProbeItemRecorded::Stored) => {}
                    Ok(ProbeItemRecorded::AlreadyStored) => {
                        // The probe holds an item for this call already; it is the record.
                        tracing::warn!(probe.id = %probe.id, "probe call already recorded");
                        continue;
                    }
                    Ok(ProbeItemRecorded::LeaseLost) => {
                        tracing::warn!(probe.id = %probe.id, "probe lease lost; stopping the runner");
                        return;
                    }
                    Err(err) => {
                        tracing::error!(probe.id = %probe.id, error = %err, "recording probe item");
                    }
                }
                tally.add(&item, cost);
            }
        }
        let Tally {
            calls,
            spend,
            first_error,
            any_scored,
        } = tally;
        if any_scored {
            let reduction = reduce(&calls);
            self.finish(
                &probe.id,
                "complete",
                None,
                Some(reduction.verdict.to_string()),
                reduction.pass_rate,
                spend,
            )
            .await;
        } else {
            let error = first_error
                .unwrap_or_else(|| "every probe call failed with no recorded error".to_string());
            self.finish(
                &probe.id,
                "failed",
                Some(format!("every probe call failed; first error: {error}")),
                None,
                None,
                spend,
            )
            .await;
        }
    }

    /// Finish the probe row under this runner's lease, logging rather than surfacing a store fault
    /// (there is no request to fail). A probe whose lease another runner took over is left to it.
    async fn finish(
        &self,
        id: &str,
        status: &str,
        error: Option<String>,
        verdict: Option<String>,
        pass_rate: Option<f64>,
        spend: f64,
    ) {
        let finished_at = now_rfc3339();
        match self
            .db
            .finish_model_probe(
                id,
                &self.holder,
                status,
                error,
                verdict,
                pass_rate,
                spend,
                &finished_at,
            )
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                tracing::warn!(probe.id = %id, "probe lease lost; leaving the probe unfinished");
            }
            Err(err) => tracing::error!(probe.id = %id, error = %err, "finishing probe"),
        }
    }

    /// One sample call: send, parse, classify; an error becomes an unlabeled
    /// item carrying the fault. Returns the item and the call's cost.
    async fn one_call(
        &self,
        probe: &model_probe::Model,
        case: &PlannedCase,
        sample: i32,
        messages: &[ProbeMessage],
    ) -> (model_probe_item::Model, f64) {
        let session_key = format!("probe-{}", cuid2::create_id());
        let body = request_body(
            &probe.openrouter_slug,
            case,
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
            language: case.language().to_string(),
            scenario: case.scenario().to_string(),
            prompt: case.prompt().to_string(),
            sample,
            provider: None,
            finish_reason: None,
            native_finish_reason: None,
            label: None,
            pass: false,
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
                let (label, pass) = label_reply(&reply, case);
                item.pass = pass;
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

/// Renew the lease `holder` holds on probe `id` every `every`, until a renewal reports it lost,
/// then send `true` on `lost` and return. A renewal the store refuses is logged and retried at
/// the next tick: the lease outlives several, and once it has lapsed and been taken over the next
/// renewal that reaches the store reports it lost.
async fn renew_lease(
    db: Arc<Db>,
    id: String,
    holder: String,
    every: Duration,
    lost: tokio::sync::watch::Sender<bool>,
) {
    loop {
        tokio::time::sleep(every).await;
        match db
            .renew_model_probe_lease(&id, &holder, &now_rfc3339())
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                let _ = lost.send(true);
                return;
            }
            Err(err) => tracing::warn!(probe.id = %id, error = %err, "renewing the probe lease"),
        }
    }
}

// ---------------------------------------------------------------------------
// The resumer
// ---------------------------------------------------------------------------

/// How often a backend looks for `running` probes whose lease has lapsed, to resume them.
pub const PROBE_RESUME_INTERVAL: Duration = Duration::from_secs(30);

/// What the [resumer](spawn_resumer) resumes probes with: the backend's HTTP client, the
/// chat/completions endpoint ([`DEFAULT_COMPLETIONS_ENDPOINT`] in production; a local server in
/// tests), its OpenRouter key when one is configured, and how often it looks.
pub struct ResumerConfig {
    pub http: reqwest::Client,
    pub endpoint: String,
    pub api_key: Option<String>,
    pub interval: Duration,
}

/// Spawn the backend's probe resumer: as it starts and every [`interval`](ResumerConfig) after,
/// it takes the lease of each `running` probe whose lease has lapsed — one whose backend
/// restarted or died — and resumes the probe under it, issuing only the calls the probe holds no
/// item for (the API's "Model probes"). The lease is taken by compare-and-swap, so of several
/// backends looking at once exactly one resumes a probe. A backend with no OpenRouter key
/// configured cannot issue the calls, so it fails the probe it took with an error saying so,
/// rather than leaving it `running`, which would refuse every new probe of the model.
///
/// The resumed runners are owned by the returned task: aborting it aborts them, and their
/// probes' leases lapse for another backend to take.
pub fn spawn_resumer(db: Arc<Db>, config: ResumerConfig) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut runners = tokio::task::JoinSet::new();
        loop {
            while runners.try_join_next().is_some() {}
            resume_lapsed(&db, &config, &mut runners).await;
            tokio::time::sleep(config.interval).await;
        }
    })
}

/// One pass of the [resumer](spawn_resumer): take every lapsed lease and resume its probe in
/// `runners`.
async fn resume_lapsed(
    db: &Arc<Db>,
    config: &ResumerConfig,
    runners: &mut tokio::task::JoinSet<()>,
) {
    let lapsed = match db.lapsed_running_model_probes(&now_rfc3339()).await {
        Ok(lapsed) => lapsed,
        Err(err) => {
            tracing::warn!(error = %err, "skipping a probe resume pass: listing the lapsed probes");
            return;
        }
    };
    for lapsed in lapsed {
        let holder = cuid2::create_id();
        let probe = match db
            .take_model_probe_lease(&lapsed.id, &holder, &now_rfc3339())
            .await
        {
            Ok(Some(probe)) => probe,
            // Another backend took it first, or it finished meanwhile.
            Ok(None) => continue,
            Err(err) => {
                tracing::warn!(probe.id = %lapsed.id, error = %err, "taking a lapsed probe lease");
                continue;
            }
        };
        let Some(api_key) = config.api_key.clone() else {
            fail_unresumable(db, &probe, &holder).await;
            continue;
        };
        tracing::info!(probe.id = %probe.id, "resuming a model probe whose lease lapsed");
        let runner = ProbeRunner {
            db: Arc::clone(db),
            http: config.http.clone(),
            endpoint: config.endpoint.clone(),
            api_key,
            holder,
            renew_every: PROBE_LEASE_RENEWAL,
        };
        runners.spawn(async move { runner.resume(probe).await });
    }
}

/// Fail `probe`, whose lease `holder` has just taken, because this backend has no OpenRouter key
/// to issue its remaining calls with. Its spend is what its recorded calls cost.
async fn fail_unresumable(db: &Db, probe: &model_probe::Model, holder: &str) {
    let spend = match db.list_model_probe_items(&probe.id).await {
        Ok(items) => items.iter().filter_map(|item| item.cost).sum(),
        Err(err) => {
            tracing::warn!(probe.id = %probe.id, error = %err, "reading an unresumable probe's calls");
            0.0
        }
    };
    let error = "the probe's backend stopped while it ran, and TCAB_OPENROUTER_API_KEY is not \
                 configured on the backend that took it over, so its remaining calls cannot \
                 be issued"
        .to_string();
    tracing::warn!(probe.id = %probe.id, "{error}");
    if let Err(err) = db
        .finish_model_probe(
            &probe.id,
            holder,
            "failed",
            Some(error),
            None,
            None,
            spend,
            &now_rfc3339(),
        )
        .await
    {
        tracing::error!(probe.id = %probe.id, error = %err, "failing an unresumable probe");
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
