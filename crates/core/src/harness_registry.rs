//! Concrete agent harness adapters and the registry that owns them.
//!
//! An adapter has two halves. The **declarative** half — the harness's name, the
//! CLI binary, and the command that installs that CLI into the run container —
//! is authored as a manifest under `harnesses/<slug>/harness.toml`, embedded
//! here at build time and parsed into a [`HarnessManifest`]. The **imperative**
//! half — the flags that run a single prompt to completion, the API-key
//! environment variable, and how to translate the harness's own usage reporting
//! into the normalized [`TokenCounts`] classes — is code, kept in
//! [`adapter_spec`]. [`descriptor`] merges the two into one [`CliHarness`].
//!
//! Every harness runs in the shared base run-container image and installs its
//! own CLI at run time; the adapter only builds commands and parses output.
//!
//! Usage parsing is intentionally tolerant — it searches each harness's JSON
//! event stream for known token fields — because several harnesses' exact field
//! names are provider-shaped and must be confirmed against the real CLIs.

use serde::Deserialize;
use serde_json::Value;
use tracing::instrument;

use crate::error::{Error, Result};
use crate::event::{EventFormat, EventKind, EventParser, EventSink, HarnessEvent};
use crate::execution::{
    ContainerHandle, ContainerRuntime, ExecOutput, OutputSink, OutputStream, RawOutputLine,
};
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

/// A harness definition authored under `harnesses/<slug>/harness.toml`: the
/// declarative half of an adapter. Embedded at build time and parsed into this
/// shape; see the module docs and `harnesses/README.md`.
#[derive(Debug, Deserialize)]
struct HarnessManifest {
    /// Stable slug; must match the manifest's directory name.
    slug: HarnessSlug,
    /// Human-readable name, for display.
    name: String,
    /// The CLI binary a run probes (`<binary> --version`) and invokes.
    binary: String,
    /// Shell command run inside the run container, before the session, to
    /// install the CLI.
    install: String,
}

/// The imperative half of an adapter: how a harness's CLI is invoked
/// non-interactively and how its output is interpreted. This is code rather than
/// manifest configuration. Merged with a [`HarnessManifest`] by [`descriptor`].
struct AdapterSpec {
    /// Prefix prepended to the model ID to form the OpenRouter catalog ID used
    /// for the comparable-cost lookup, when the harness takes a provider-native
    /// model ID rather than an OpenRouter one. `None` passes the ID through
    /// unchanged. See [`AgentHarness::pricing_model_id`].
    pricing_model_prefix: Option<&'static str>,
    api_key_env: Option<&'static str>,
    /// The variable the key is injected into inside the container, when it
    /// differs from `api_key_env`. `None` reuses `api_key_env` on both sides.
    container_key_env: Option<&'static str>,
    /// Builds the session argument vector (after the binary) from model + prompt.
    session_args: fn(model: &str, prompt: &str) -> Vec<String>,
    usage: UsageShape,
    /// How this harness's raw output is translated into normalized events.
    event_format: EventFormat,
}

/// A generic adapter, built by merging a [`HarnessManifest`] with an
/// [`AdapterSpec`].
pub struct CliHarness {
    slug: HarnessSlug,
    /// Display name, from the manifest.
    name: String,
    /// CLI binary, from the manifest.
    binary: String,
    /// Command that installs the CLI into the run container at run time, from
    /// the manifest.
    install: String,
    pricing_model_prefix: Option<&'static str>,
    api_key_env: Option<&'static str>,
    container_key_env: Option<&'static str>,
    session_args: fn(model: &str, prompt: &str) -> Vec<String>,
    usage: UsageShape,
    event_format: EventFormat,
}

#[async_trait::async_trait]
impl AgentHarness for CliHarness {
    fn slug(&self) -> HarnessSlug {
        self.slug
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn install_command(&self) -> Option<&str> {
        Some(&self.install)
    }

    fn api_key_env(&self) -> Option<&'static str> {
        self.api_key_env
    }

    fn container_key_env(&self) -> Option<&'static str> {
        self.container_key_env.or(self.api_key_env)
    }

    fn pricing_model_id(&self, model_id: &str) -> String {
        match self.pricing_model_prefix {
            // Already an OpenRouter-style ID; don't double-prefix.
            Some(prefix) if !model_id.starts_with(prefix) => format!("{prefix}{model_id}"),
            _ => model_id.to_string(),
        }
    }

    async fn probe(
        &self,
        runtime: &dyn ContainerRuntime,
        container: &ContainerHandle,
    ) -> Result<Availability> {
        // Probe the binary the install command put on PATH, inside the running
        // container. A clean `--version` confirms the install produced a working
        // CLI and yields the version recorded for the run.
        let probe = vec![self.binary.clone(), "--version".to_string()];
        match runtime.exec(container, &probe).await {
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

    #[instrument(
        name = "harness.invoke",
        skip_all,
        fields(
            harness = %self.slug.as_str(),
            model = %invocation.model_id,
            container.id = %container.id,
        ),
        err,
    )]
    async fn invoke(
        &self,
        runtime: &dyn ContainerRuntime,
        container: &ContainerHandle,
        invocation: &HarnessInvocation,
        events: &mut dyn EventSink,
    ) -> Result<HarnessOutcome> {
        let mut command = vec![self.binary.to_string()];
        command.extend((self.session_args)(
            &invocation.model_id,
            &invocation.prompt,
        ));

        // Translate each output line into normalized events as it streams, while
        // recording the raw lines and the translated events so the run can be
        // persisted. The translator reborrows `events`; once its fields are taken
        // and it is dropped, `events` is free again to report a terminal failure.
        let mut translator = StreamingTranslator {
            parser: EventParser::new(self.event_format),
            events: &mut *events,
            raw: Vec::new(),
            recorded: Vec::new(),
        };
        let output = runtime
            .exec_streamed(container, &command, &mut translator)
            .await?;
        let raw_output = std::mem::take(&mut translator.raw);
        let translated_events = std::mem::take(&mut translator.recorded);
        drop(translator);

        if output.exit_code != 0 {
            let detail = failure_detail(&output);
            // Surface the failure as an error event too, so non-CLI observers see
            // it in the same stream as the rest of the run.
            events.emit(&HarnessEvent {
                timestamp: now_timestamp(),
                session_id: None,
                kind: EventKind::Error {
                    message: detail.clone(),
                    code: None,
                },
            });
            return Err(Error::HarnessInvocation {
                slug: self.slug.as_str().to_string(),
                detail,
            });
        }

        Ok(HarnessOutcome {
            usage: parse_usage(&output, self.usage),
            harness_version: None,
            reported_cost: parse_reported_cost(&output, self.usage),
            raw_output,
            translated_events,
        })
    }
}

/// Adapts raw output lines into normalized events forwarded to an [`EventSink`],
/// recording both the raw lines and the translated events for persistence.
struct StreamingTranslator<'a> {
    parser: EventParser,
    events: &'a mut dyn EventSink,
    /// Every raw line seen, in arrival order, tagged with its stream.
    raw: Vec<RawOutputLine>,
    /// Every translated event, in the order produced.
    recorded: Vec<HarnessEvent>,
}

impl OutputSink for StreamingTranslator<'_> {
    fn on_line(&mut self, stream: OutputStream, line: &str) {
        self.raw.push(RawOutputLine {
            stream,
            line: line.to_string(),
        });
        for event in self.parser.ingest(stream, line) {
            self.events.emit(&event);
            self.recorded.push(event);
        }
    }
}

/// Build a detailed failure message from a harness invocation that exited non
/// zero.
///
/// The previous behavior kept only the first line of standard error, which threw
/// away the harness's actual complaint. This keeps the tail of whichever stream
/// carried output — standard error first, then standard output — so the real
/// cause survives, capped so a runaway log cannot dominate the error.
fn failure_detail(output: &ExecOutput) -> String {
    let exit = format!("harness exited with code {}", output.exit_code);
    let tail = last_lines(&output.stderr, 20).or_else(|| last_lines(&output.stdout, 20));
    match tail {
        Some(tail) => format!("{exit}\n{tail}"),
        None => exit,
    }
}

/// The last `max` non-empty lines of `text`, joined with newlines, or `None`
/// when there are none.
fn last_lines(text: &str, max: usize) -> Option<String> {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        return None;
    }
    let start = lines.len().saturating_sub(max);
    Some(lines[start..].join("\n"))
}

/// The current time as an RFC 3339 string, for stamping synthesized events.
fn now_timestamp() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
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

/// The embedded `harnesses/<slug>/harness.toml` source for a slug. Baked in at
/// build time so the registry needs no filesystem access at run time and a
/// backend-driven worker (which has no local checkout) resolves harnesses the
/// same way as the CLI.
fn manifest_toml(slug: HarnessSlug) -> &'static str {
    match slug {
        HarnessSlug::Claude => include_str!("../../../harnesses/claude/harness.toml"),
        HarnessSlug::Codex => include_str!("../../../harnesses/codex/harness.toml"),
        HarnessSlug::Cline => include_str!("../../../harnesses/cline/harness.toml"),
        HarnessSlug::Antigravity => include_str!("../../../harnesses/antigravity/harness.toml"),
        HarnessSlug::Goose => include_str!("../../../harnesses/goose/harness.toml"),
        HarnessSlug::Kilo => include_str!("../../../harnesses/kilo/harness.toml"),
        HarnessSlug::Opencode => include_str!("../../../harnesses/opencode/harness.toml"),
        HarnessSlug::Pi => include_str!("../../../harnesses/pi/harness.toml"),
    }
}

/// Parse the embedded manifest for a slug. The manifests ship in the repo and
/// are validated by a unit test, so a parse failure or a slug that disagrees
/// with its directory is a build-time authoring bug, not a runtime user error.
fn load_manifest(slug: HarnessSlug) -> HarnessManifest {
    let manifest: HarnessManifest = toml::from_str(manifest_toml(slug)).unwrap_or_else(|err| {
        panic!(
            "embedded harness manifest for `{}` is invalid: {err}",
            slug.as_str()
        )
    });
    assert_eq!(
        manifest.slug,
        slug,
        "harness manifest declares slug `{}` but lives in the `{}` directory",
        manifest.slug.as_str(),
        slug.as_str(),
    );
    manifest
}

/// Build a harness adapter for a slug by merging its embedded manifest (name,
/// binary, install command) with its code-defined [`AdapterSpec`].
fn descriptor(slug: HarnessSlug) -> Box<dyn AgentHarness> {
    let manifest = load_manifest(slug);
    let spec = adapter_spec(slug);
    Box::new(CliHarness {
        slug,
        name: manifest.name,
        binary: manifest.binary,
        install: manifest.install,
        pricing_model_prefix: spec.pricing_model_prefix,
        api_key_env: spec.api_key_env,
        container_key_env: spec.container_key_env,
        session_args: spec.session_args,
        usage: spec.usage,
        event_format: spec.event_format,
    })
}

/// The code-defined invocation spec for a single slug.
///
/// The flags here are the documented non-interactive invocations for each
/// harness. Token field names that are provider-shaped (kilo, opencode, pi) are
/// best-effort and should be confirmed against the real CLI output.
fn adapter_spec(slug: HarnessSlug) -> AdapterSpec {
    match slug {
        HarnessSlug::Claude => AdapterSpec {
            pricing_model_prefix: None,
            api_key_env: Some("ANTHROPIC_API_KEY"),
            container_key_env: None,
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
            event_format: EventFormat::Claude,
        },
        HarnessSlug::Codex => AdapterSpec {
            pricing_model_prefix: Some("openai/"),
            api_key_env: Some("OPENAI_API_KEY"),
            // `codex exec` authenticates only from `CODEX_API_KEY`; it ignores
            // `OPENAI_API_KEY`, so the key the user exports as `OPENAI_API_KEY`
            // on the host is injected into the container under this name.
            container_key_env: Some("CODEX_API_KEY"),
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
            event_format: EventFormat::Codex,
        },
        HarnessSlug::Cline => AdapterSpec {
            pricing_model_prefix: None,
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
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
            event_format: EventFormat::Cline,
        },
        HarnessSlug::Antigravity => AdapterSpec {
            pricing_model_prefix: None,
            // Antigravity only supports Google-account auth; with no API-key mode
            // it cannot participate in The Test Cabinet's API-key-only runs.
            api_key_env: None,
            container_key_env: None,
            session_args: |_model, prompt| {
                vec![
                    "--print".into(),
                    "--dangerously-skip-permissions".into(),
                    prompt.into(),
                ]
            },
            usage: UsageShape::NONE,
            event_format: EventFormat::Generic,
        },
        HarnessSlug::Goose => AdapterSpec {
            pricing_model_prefix: None,
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
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
            event_format: EventFormat::Goose,
        },
        HarnessSlug::Kilo => AdapterSpec {
            pricing_model_prefix: None,
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
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
            event_format: EventFormat::Kilo,
        },
        HarnessSlug::Opencode => AdapterSpec {
            pricing_model_prefix: None,
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
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
            event_format: EventFormat::Opencode,
        },
        HarnessSlug::Pi => AdapterSpec {
            pricing_model_prefix: None,
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
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
            event_format: EventFormat::Pi,
        },
    }
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
