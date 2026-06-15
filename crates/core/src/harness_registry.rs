//! Concrete agent harness adapters and the registry that owns them.
//!
//! Each adapter encodes one third-party harness's non-interactive invocation:
//! the binary, the flags that run a single prompt to completion, the API-key
//! environment variable, and how to translate the harness's own usage reporting
//! into the normalized [`TokenCounts`] classes. The harness CLI runs inside the
//! per-harness container image; the adapter only builds commands and parses
//! output.
//!
//! Usage parsing is intentionally tolerant — it searches each harness's JSON
//! event stream for known token fields — because several harnesses' exact field
//! names are provider-shaped and must be confirmed against the real CLIs.

use serde_json::Value;

use crate::error::{Error, Result};
use crate::execution::{ContainerHandle, ContainerRuntime, ExecOutput};
use crate::harness::{AgentHarness, Availability, HarnessInvocation, HarnessOutcome, Usage};
use crate::metrics::TokenCounts;
use crate::run_record::HarnessSlug;

/// How a harness's per-event token numbers combine across its output stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Aggregation {
    /// The stream reports cumulative totals; take the last event that has them.
    Last,
    /// The stream reports per-step deltas; sum them across the stream.
    Sum,
}

/// Describes where a harness reports its token usage and how the raw numbers map
/// onto the four normalized classes.
#[derive(Debug, Clone, Copy)]
struct UsageShape {
    /// JSON keys whose values are (possibly cache-inclusive) input tokens.
    input: &'static [&'static str],
    /// JSON keys for cache-read input tokens.
    cached: &'static [&'static str],
    /// JSON keys for cache-creation tokens (billed as, and counted into, input).
    cache_creation: &'static [&'static str],
    /// JSON keys for non-reasoning output tokens.
    output: &'static [&'static str],
    /// JSON keys for reasoning tokens.
    reasoning: &'static [&'static str],
    /// JSON keys for the exact run cost (USD) the harness reports for itself.
    ///
    /// Most harnesses report no cost and leave this empty; the comparable cost
    /// is then derived from OpenRouter prices. A harness that drives one
    /// provider directly via an API key (such as Claude Code's
    /// `total_cost_usd`) reports the exact charge here, which the orchestrator
    /// uses in place of an OpenRouter lookup.
    cost: &'static [&'static str],
    /// Whether `input` already includes the cached-read tokens.
    input_includes_cache: bool,
    /// How per-event numbers combine across the stream.
    aggregation: Aggregation,
}

impl UsageShape {
    /// A shape that reports no usage at all.
    const NONE: UsageShape = UsageShape {
        input: &[],
        cached: &[],
        cache_creation: &[],
        output: &[],
        reasoning: &[],
        cost: &[],
        input_includes_cache: false,
        aggregation: Aggregation::Last,
    };
}

/// A generic adapter driven by a per-harness descriptor.
pub struct CliHarness {
    slug: HarnessSlug,
    binary: &'static str,
    api_key_env: Option<&'static str>,
    /// Builds the session argument vector (after the binary) from model + prompt.
    session_args: fn(model: &str, prompt: &str) -> Vec<String>,
    usage: UsageShape,
}

#[async_trait::async_trait]
impl AgentHarness for CliHarness {
    fn slug(&self) -> HarnessSlug {
        self.slug
    }

    fn api_key_env(&self) -> Option<&'static str> {
        self.api_key_env
    }

    async fn check_availability(&self, runtime: &dyn ContainerRuntime) -> Result<Availability> {
        if self.api_key_env.is_none() {
            return Ok(Availability {
                available: false,
                version: None,
                detail: Some("API-key authentication is not supported by this harness".to_string()),
            });
        }
        let probe = vec![self.binary.to_string(), "--version".to_string()];
        match runtime.run_once(&self.image(), &probe).await {
            Ok(output) if output.exit_code == 0 => Ok(Availability {
                available: true,
                version: parse_version(&output.stdout),
                detail: None,
            }),
            Ok(output) => Ok(Availability {
                available: false,
                version: None,
                detail: Some(first_line(&output.stderr).unwrap_or_else(|| {
                    format!(
                        "`{} --version` exited with {}",
                        self.binary, output.exit_code
                    )
                })),
            }),
            Err(err) => Ok(Availability {
                available: false,
                version: None,
                detail: Some(err.to_string()),
            }),
        }
    }

    async fn invoke(
        &self,
        runtime: &dyn ContainerRuntime,
        container: &ContainerHandle,
        invocation: &HarnessInvocation,
    ) -> Result<HarnessOutcome> {
        let mut command = vec![self.binary.to_string()];
        command.extend((self.session_args)(
            &invocation.model_id,
            &invocation.prompt,
        ));

        let output = runtime.exec(container, &command).await?;
        if output.exit_code != 0 {
            return Err(Error::HarnessInvocation {
                slug: self.slug.as_str().to_string(),
                detail: first_line(&output.stderr)
                    .unwrap_or_else(|| format!("exited with {}", output.exit_code)),
            });
        }

        Ok(HarnessOutcome {
            usage: parse_usage(&output, self.usage),
            harness_version: None,
            reported_cost: parse_reported_cost(&output, self.usage),
        })
    }
}

/// The default registry over all supported harnesses.
pub struct DefaultHarnessRegistry {
    harnesses: Vec<Box<dyn AgentHarness>>,
}

impl DefaultHarnessRegistry {
    /// Build the registry with every supported harness adapter.
    pub fn new() -> Self {
        Self {
            harnesses: all_harnesses(),
        }
    }
}

impl Default for DefaultHarnessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl crate::harness::HarnessRegistry for DefaultHarnessRegistry {
    fn get(&self, slug: HarnessSlug) -> Option<&dyn AgentHarness> {
        self.harnesses
            .iter()
            .find(|h| h.slug() == slug)
            .map(|h| h.as_ref())
    }
}

/// Construct an adapter for every harness slug.
fn all_harnesses() -> Vec<Box<dyn AgentHarness>> {
    HarnessSlug::ALL.into_iter().map(descriptor).collect()
}

/// The adapter for a single slug.
///
/// The flags here are the documented non-interactive invocations for each
/// harness. Token field names that are provider-shaped (kilo, opencode, pi) are
/// best-effort and should be confirmed against the real CLI output.
fn descriptor(slug: HarnessSlug) -> Box<dyn AgentHarness> {
    let harness = match slug {
        HarnessSlug::Claude => CliHarness {
            slug,
            binary: "claude",
            api_key_env: Some("ANTHROPIC_API_KEY"),
            session_args: |model, prompt| {
                vec![
                    "--print".into(),
                    "--permission-mode".into(),
                    "bypassPermissions".into(),
                    "--output-format".into(),
                    "stream-json".into(),
                    "--verbose".into(),
                    "--model".into(),
                    model.into(),
                    prompt.into(),
                ]
            },
            usage: UsageShape {
                input: &["input_tokens"],
                cached: &["cache_read_input_tokens"],
                cache_creation: &["cache_creation_input_tokens"],
                output: &["output_tokens"],
                reasoning: &[],
                // Claude Code reports the exact charge on its terminal
                // `result` event; the orchestrator uses it instead of an
                // OpenRouter lookup, whose catalog does not list Claude Code's
                // native model IDs.
                cost: &["total_cost_usd"],
                input_includes_cache: false,
                aggregation: Aggregation::Last,
            },
        },
        HarnessSlug::Codex => CliHarness {
            slug,
            binary: "codex",
            api_key_env: Some("OPENAI_API_KEY"),
            session_args: |model, prompt| {
                vec![
                    "exec".into(),
                    "--json".into(),
                    "--skip-git-repo-check".into(),
                    "--dangerously-bypass-approvals-and-sandbox".into(),
                    "--model".into(),
                    model.into(),
                    prompt.into(),
                ]
            },
            usage: UsageShape {
                input: &["input_tokens"],
                cached: &["cached_input_tokens"],
                cache_creation: &[],
                output: &["output_tokens"],
                reasoning: &["reasoning_output_tokens"],
                cost: &[],
                input_includes_cache: true,
                aggregation: Aggregation::Last,
            },
        },
        HarnessSlug::Cline => CliHarness {
            slug,
            binary: "cline",
            api_key_env: Some("OPENROUTER_API_KEY"),
            session_args: |model, prompt| {
                vec![
                    "--json".into(),
                    "--auto-approve".into(),
                    "true".into(),
                    "--provider".into(),
                    "openrouter".into(),
                    "--model".into(),
                    model.into(),
                    prompt.into(),
                ]
            },
            usage: UsageShape {
                input: &["inputTokens"],
                cached: &["cacheReadTokens"],
                cache_creation: &["cacheWriteTokens"],
                output: &["outputTokens"],
                reasoning: &[],
                cost: &[],
                input_includes_cache: false,
                aggregation: Aggregation::Last,
            },
        },
        HarnessSlug::Antigravity => CliHarness {
            slug,
            binary: "agy",
            // Antigravity only supports Google-account auth; with no API-key mode
            // it cannot participate in The Test Cabinet's API-key-only runs.
            api_key_env: None,
            session_args: |_model, prompt| {
                vec![
                    "--print".into(),
                    "--dangerously-skip-permissions".into(),
                    prompt.into(),
                ]
            },
            usage: UsageShape::NONE,
        },
        HarnessSlug::Goose => CliHarness {
            slug,
            binary: "goose",
            api_key_env: Some("OPENROUTER_API_KEY"),
            session_args: |model, prompt| {
                vec![
                    "run".into(),
                    "--provider".into(),
                    "openrouter".into(),
                    "--model".into(),
                    model.into(),
                    "--output-format".into(),
                    "stream-json".into(),
                    "--quiet".into(),
                    "--text".into(),
                    prompt.into(),
                ]
            },
            usage: UsageShape {
                input: &["input_tokens"],
                cached: &[],
                cache_creation: &[],
                output: &["output_tokens"],
                reasoning: &[],
                cost: &[],
                input_includes_cache: false,
                aggregation: Aggregation::Last,
            },
        },
        HarnessSlug::Kilo => CliHarness {
            slug,
            binary: "kilo",
            api_key_env: Some("OPENROUTER_API_KEY"),
            session_args: |model, prompt| {
                vec![
                    "run".into(),
                    "--format".into(),
                    "json".into(),
                    "--auto".into(),
                    "--model".into(),
                    model.into(),
                    prompt.into(),
                ]
            },
            usage: UsageShape {
                input: &["inputTokens", "input"],
                cached: &["cacheReadTokens", "cache_read"],
                cache_creation: &["cacheWriteTokens"],
                output: &["outputTokens", "output"],
                reasoning: &["reasoningTokens", "reasoning"],
                cost: &[],
                input_includes_cache: false,
                aggregation: Aggregation::Sum,
            },
        },
        HarnessSlug::Opencode => CliHarness {
            slug,
            binary: "opencode",
            api_key_env: Some("OPENROUTER_API_KEY"),
            session_args: |model, prompt| {
                vec![
                    "run".into(),
                    "--format".into(),
                    "json".into(),
                    "--dangerously-skip-permissions".into(),
                    "--model".into(),
                    model.into(),
                    prompt.into(),
                ]
            },
            usage: UsageShape {
                input: &["input"],
                cached: &["cache_read", "cacheRead"],
                cache_creation: &["cache_write", "cacheWrite"],
                output: &["output"],
                reasoning: &["reasoning"],
                cost: &[],
                input_includes_cache: false,
                aggregation: Aggregation::Sum,
            },
        },
        HarnessSlug::Pi => CliHarness {
            slug,
            binary: "pi",
            api_key_env: Some("OPENROUTER_API_KEY"),
            session_args: |model, prompt| {
                vec![
                    "--mode".into(),
                    "json".into(),
                    "--print".into(),
                    "--provider".into(),
                    "openrouter".into(),
                    "--model".into(),
                    model.into(),
                    prompt.into(),
                ]
            },
            usage: UsageShape {
                input: &["input_tokens", "inputTokens", "input"],
                cached: &["cached_input_tokens", "cacheReadTokens"],
                cache_creation: &[],
                output: &["output_tokens", "outputTokens", "output"],
                reasoning: &["reasoning_output_tokens", "reasoningTokens"],
                cost: &[],
                input_includes_cache: true,
                aggregation: Aggregation::Last,
            },
        },
    };
    Box::new(harness)
}

/// Parse normalized usage out of a harness's command output.
fn parse_usage(output: &ExecOutput, shape: UsageShape) -> Usage {
    let mut tokens = TokenCounts::default();
    for line in output.stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let line_tokens = extract_tokens(&value, shape);
        if line_tokens.total_input() == 0 && line_tokens.total_output() == 0 {
            continue;
        }
        match shape.aggregation {
            Aggregation::Last => tokens = line_tokens,
            Aggregation::Sum => {
                tokens.uncached_input += line_tokens.uncached_input;
                tokens.cached_input += line_tokens.cached_input;
                tokens.output += line_tokens.output;
                tokens.reasoning += line_tokens.reasoning;
            }
        }
    }
    Usage { tokens }
}

/// Parse the harness's self-reported run cost (USD) out of its command output.
///
/// Returns `None` when the shape declares no cost field or no event carries
/// one. The reported cost is cumulative for the session, so the last event
/// that reports it wins.
fn parse_reported_cost(output: &ExecOutput, shape: UsageShape) -> Option<f64> {
    if shape.cost.is_empty() {
        return None;
    }
    let mut reported = None;
    for line in output.stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(found) = shape.cost.iter().find_map(|key| find_f64(&value, key)) {
            reported = Some(found);
        }
    }
    reported
}

/// Extract the normalized token classes from one JSON event.
fn extract_tokens(value: &Value, shape: UsageShape) -> TokenCounts {
    let sum = |keys: &[&str]| keys.iter().filter_map(|k| find_u64(value, k)).sum::<u64>();

    let raw_input = sum(shape.input);
    let cached = sum(shape.cached);
    let cache_creation = sum(shape.cache_creation);
    let uncached_base = if shape.input_includes_cache {
        raw_input.saturating_sub(cached)
    } else {
        raw_input
    };

    TokenCounts {
        uncached_input: uncached_base + cache_creation,
        cached_input: cached,
        output: sum(shape.output),
        reasoning: sum(shape.reasoning),
    }
}

/// Find the first `u64` value stored under `key` anywhere in a JSON value.
fn find_u64(value: &Value, key: &str) -> Option<u64> {
    match value {
        Value::Object(map) => {
            if let Some(found) = map.get(key).and_then(Value::as_u64) {
                return Some(found);
            }
            map.values().find_map(|v| find_u64(v, key))
        }
        Value::Array(items) => items.iter().find_map(|v| find_u64(v, key)),
        _ => None,
    }
}

/// Find the first `f64` value stored under `key` anywhere in a JSON value.
///
/// Used for reported costs, which harnesses report as fractional dollar
/// amounts (for example Claude Code's `total_cost_usd`).
fn find_f64(value: &Value, key: &str) -> Option<f64> {
    match value {
        Value::Object(map) => {
            if let Some(found) = map.get(key).and_then(Value::as_f64) {
                return Some(found);
            }
            map.values().find_map(|v| find_f64(v, key))
        }
        Value::Array(items) => items.iter().find_map(|v| find_f64(v, key)),
        _ => None,
    }
}

/// Pull a version number out of a `--version` line such as `claude 1.2.3`.
fn parse_version(stdout: &str) -> Option<String> {
    let line = first_line(stdout)?;
    line.split_whitespace()
        .map(|token| token.trim_start_matches('v'))
        .find(|token| token.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(str::to_string)
}

/// The first non-empty, trimmed line of some text.
fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
#[path = "harness_registry.test.rs"]
mod tests;
