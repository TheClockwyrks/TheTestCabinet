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
//! Usage parsing is intentionally tolerant — by default it searches each
//! harness's JSON event stream for known token fields — because several
//! harnesses' exact field names are provider-shaped and must be confirmed
//! against the real CLIs. A [`UsageShape`] can narrow that search to the
//! specific event type and sub-object that carry the authoritative usage, which
//! is required for harnesses that restate the same usage across several event
//! types (Pi) or nest it under keys that would otherwise collide (OpenCode).

use serde::Deserialize;
use serde_json::Value;
use tracing::instrument;

use crate::auth::{CredFile, CredSource, SubscriptionSpec};
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
    /// The values of a record's top-level `type` field whose lines carry the
    /// authoritative usage. When empty, every line is considered (the tolerant
    /// default). When set, lines of any other type are skipped — this is how a
    /// harness that restates the same usage across several event types (or buries
    /// numbers in tool arguments) is read from exactly one event without
    /// double-counting or misreading.
    usage_events: &'static [&'static str],
    /// The path to the usage object within a record. When empty, the token keys
    /// are searched across the whole record (the tolerant default). When set, the
    /// search is confined to the sub-object at this path, so a nested usage block
    /// is read without colliding with same-named keys elsewhere in the record.
    usage_path: &'static [&'static str],
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
        usage_events: &[],
        usage_path: &[],
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

/// How a harness's model ID is mapped onto the OpenRouter catalog ID used for
/// the comparable-cost lookup. See [`AgentHarness::pricing_model_id`].
#[derive(Clone, Copy)]
enum PricingModelId {
    /// The harness already reports OpenRouter IDs; use the model ID unchanged.
    Passthrough,
    /// Prepend this provider prefix to a provider-native ID — for example
    /// `openai/` for Codex's bare `gpt-5.5` — unless the ID already carries it.
    AddPrefix(&'static str),
    /// Strip this provider prefix the harness prepends — for example
    /// `openrouter/` for OpenCode and Kilo Code's
    /// `openrouter/anthropic/claude-opus-4.8` — leaving the bare OpenRouter slug.
    StripPrefix(&'static str),
}

/// The imperative half of an adapter: how a harness's CLI is invoked
/// non-interactively and how its output is interpreted. This is code rather than
/// manifest configuration. Merged with a [`HarnessManifest`] by [`descriptor`].
struct AdapterSpec {
    /// How the harness's model ID is mapped onto the OpenRouter catalog ID for
    /// the comparable-cost lookup. See [`AgentHarness::pricing_model_id`].
    pricing_model: PricingModelId,
    api_key_env: Option<&'static str>,
    /// The variable the key is injected into inside the container, when it
    /// differs from `api_key_env`. `None` reuses `api_key_env` on both sides.
    container_key_env: Option<&'static str>,
    /// The subscription-authentication descriptor, when the harness supports it
    /// (Claude Code, Codex, Antigravity). `None` for an API-key-only harness.
    subscription: Option<SubscriptionSpec>,
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
    pricing_model: PricingModelId,
    api_key_env: Option<&'static str>,
    container_key_env: Option<&'static str>,
    subscription: Option<SubscriptionSpec>,
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

    fn subscription_spec(&self) -> Option<SubscriptionSpec> {
        self.subscription
    }

    fn pricing_model_id(&self, model_id: &str) -> String {
        match self.pricing_model {
            PricingModelId::Passthrough => model_id.to_string(),
            // Already an OpenRouter-style ID; don't double-prefix.
            PricingModelId::AddPrefix(prefix) if model_id.starts_with(prefix) => {
                model_id.to_string()
            }
            PricingModelId::AddPrefix(prefix) => format!("{prefix}{model_id}"),
            // Drop the harness's own provider prefix to recover the OpenRouter
            // slug; leave the ID alone when it isn't there.
            PricingModelId::StripPrefix(prefix) => model_id
                .strip_prefix(prefix)
                .unwrap_or(model_id)
                .to_string(),
        }
    }

    fn session_argv(&self, model_id: &str, prompt: &str) -> Vec<String> {
        let mut argv = vec![self.binary.clone()];
        argv.extend((self.session_args)(model_id, prompt));
        argv
    }

    fn event_format(&self) -> EventFormat {
        self.event_format
    }

    fn parse_session_usage(&self, output: &ExecOutput) -> (Usage, Option<f64>) {
        (
            parse_usage(output, self.usage),
            parse_reported_cost(output, self.usage),
        )
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
        let command = self.session_argv(&invocation.model_id, &invocation.prompt);

        // Run the session, translating each output line into normalized events as
        // it streams while recording the raw lines and the translated events so the
        // run can be persisted. The same streaming machinery drives an
        // orchestrator's runner (see [`run_streamed_translation`]), so the two
        // paths translate output identically.
        let Streamed {
            output,
            raw_output,
            translated_events,
        } = run_streamed_translation(runtime, container, &command, self.event_format, events)
            .await?;

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

/// The result of running a command through [`run_streamed_translation`]: the
/// captured output plus the recorded raw lines and translated events.
pub(crate) struct Streamed {
    /// The full captured output once the command finished.
    pub output: ExecOutput,
    /// Every raw line seen, in arrival order, tagged with its stream.
    pub raw_output: Vec<RawOutputLine>,
    /// Every translated event, in the order produced.
    pub translated_events: Vec<HarnessEvent>,
}

/// Run `command` inside the container, translating each output line into
/// normalized events (in `format`) as it streams and emitting them to `events`,
/// while recording both the raw lines and the translated events.
///
/// This is the shared streaming-translation seam: a harness's direct
/// [`invoke`](AgentHarness::invoke) runs the session command through it, and an
/// [orchestrator](crate::orchestrator) runs its runner script through it, so a
/// session's output is translated into events identically whichever path drives
/// it.
pub(crate) async fn run_streamed_translation(
    runtime: &dyn ContainerRuntime,
    container: &ContainerHandle,
    command: &[String],
    format: EventFormat,
    events: &mut dyn EventSink,
) -> Result<Streamed> {
    // The translator reborrows `events`; once its fields are taken and it is
    // dropped, `events` is free again for the caller to report a terminal failure.
    let mut translator = StreamingTranslator {
        parser: EventParser::new(format),
        events: &mut *events,
        raw: Vec::new(),
        recorded: Vec::new(),
    };
    let output = runtime
        .exec_streamed(container, command, &mut translator)
        .await?;
    let raw_output = std::mem::take(&mut translator.raw);
    let translated_events = std::mem::take(&mut translator.recorded);
    drop(translator);
    Ok(Streamed {
        output,
        raw_output,
        translated_events,
    })
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

/// Every API-key value currently set in the host environment, across all
/// built-in harnesses — both the shared provider variables (`ANTHROPIC_API_KEY`,
/// `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, …) and the per-harness
/// `TCAB_API_KEY_<SLUG>` overrides ([`api_key_override_var`](crate::auth::api_key_override_var)).
///
/// These are the keys a run launched on this host would have authenticated with,
/// so the publisher uses them as exact-match redaction literals when releasing a
/// run's source to its public repository (see [`crate::redact::SecretScrubber::from_host_env`]).
/// Returns values only — never variable names — and skips blank ones. Order is
/// not meaningful; values are deduplicated.
pub fn host_api_key_values() -> Vec<String> {
    let mut values = Vec::new();
    let mut push_env = |var: &str| {
        if let Ok(value) = std::env::var(var) {
            if !value.trim().is_empty() {
                values.push(value);
            }
        }
    };
    for slug in HarnessSlug::ALL {
        if let Some(env) = adapter_spec(slug).api_key_env {
            push_env(env);
        }
        push_env(&crate::auth::api_key_override_var(slug));
    }
    values.sort();
    values.dedup();
    values
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
        pricing_model: spec.pricing_model,
        api_key_env: spec.api_key_env,
        container_key_env: spec.container_key_env,
        subscription: spec.subscription,
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
            pricing_model: PricingModelId::Passthrough,
            api_key_env: Some("ANTHROPIC_API_KEY"),
            container_key_env: None,
            // Claude Code reads a Claude subscription from credentials the `claude`
            // CLI writes when the user signs in. `.credentials.json` carries the
            // token; `.claude.json` holds non-secret CLI state and is copied when
            // present. When subscription auth is used, `ANTHROPIC_API_KEY` is not
            // injected, so the CLI authenticates with the subscription.
            subscription: Some(SubscriptionSpec {
                files: &[
                    CredFile {
                        source: CredSource::HomeRelative(".claude/.credentials.json"),
                        container_path: "/home/node/.claude/.credentials.json",
                        mode: 0o600,
                        required: true,
                    },
                    CredFile {
                        source: CredSource::HomeRelative(".claude.json"),
                        container_path: "/home/node/.claude.json",
                        mode: 0o600,
                        required: false,
                    },
                ],
            }),
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
                usage_events: &[],
                usage_path: &[],
            },
            event_format: EventFormat::Claude,
        },
        HarnessSlug::Codex => AdapterSpec {
            pricing_model: PricingModelId::AddPrefix("openai/"),
            api_key_env: Some("OPENAI_API_KEY"),
            // `codex exec` authenticates only from `CODEX_API_KEY`; it ignores
            // `OPENAI_API_KEY`, so the key the user exports as `OPENAI_API_KEY`
            // on the host is injected into the container under this name.
            container_key_env: Some("CODEX_API_KEY"),
            // Codex reads a ChatGPT subscription from `auth.json` in its home
            // directory (`CODEX_HOME`, default `~/.codex`). When subscription auth
            // is used, neither `CODEX_API_KEY` nor `OPENAI_API_KEY` is injected, so
            // `codex exec` authenticates with the subscription.
            subscription: Some(SubscriptionSpec {
                files: &[CredFile {
                    source: CredSource::HomeDir {
                        env: "CODEX_HOME",
                        default_rel: ".codex",
                        file: "auth.json",
                    },
                    container_path: "/home/node/.codex/auth.json",
                    mode: 0o600,
                    required: true,
                }],
            }),
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
                usage_events: &[],
                usage_path: &[],
            },
            event_format: EventFormat::Codex,
        },
        HarnessSlug::Cline => AdapterSpec {
            pricing_model: PricingModelId::Passthrough,
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
            subscription: None,
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
                // Cline's `inputTokens` is cache-inclusive: it already contains the
                // `cacheReadTokens`, restated alongside it. So `input_includes_cache`
                // must be true and the cache reads subtracted to recover the uncached
                // input — the prior `false` counted the cached reads twice (once in
                // uncached input at the full prompt rate, once as cached input),
                // inflating total input and cost (a run that cost $1.86 was recorded
                // at $6.45). Verified against a run's per-iteration and total
                // `cost`: uncached = `inputTokens - cacheReadTokens`.
                input: &["inputTokens"],
                cached: &["cacheReadTokens"],
                cache_creation: &["cacheWriteTokens"],
                output: &["outputTokens"],
                reasoning: &[],
                cost: &[],
                input_includes_cache: true,
                aggregation: Aggregation::Last,
                usage_events: &[],
                usage_path: &[],
            },
            event_format: EventFormat::Cline,
        },
        HarnessSlug::Antigravity => AdapterSpec {
            pricing_model: PricingModelId::Passthrough,
            // Antigravity authenticates only through a Google account, so it has no
            // API-key mode; it runs under subscription authentication only.
            api_key_env: None,
            container_key_env: None,
            // The `agy` CLI writes a Google-account OAuth token to
            // `~/.gemini/antigravity-cli/` when the user signs in; copying it into
            // the container is what makes Antigravity runnable.
            subscription: Some(SubscriptionSpec {
                files: &[CredFile {
                    source: CredSource::HomeRelative(
                        ".gemini/antigravity-cli/antigravity-oauth-token",
                    ),
                    container_path: "/home/node/.gemini/antigravity-cli/antigravity-oauth-token",
                    mode: 0o600,
                    required: true,
                }],
            }),
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
            pricing_model: PricingModelId::Passthrough,
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
            subscription: None,
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
                usage_events: &[],
                usage_path: &[],
            },
            event_format: EventFormat::Goose,
        },
        HarnessSlug::Kilo => AdapterSpec {
            pricing_model: PricingModelId::StripPrefix("openrouter/"),
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
            subscription: None,
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
                // Kilo Code's runtime is OpenCode's, so it reports usage the same
                // way: per-step totals on `step_finish` under `part.tokens`, with
                // cache reads/writes nested one level deeper in a `cache` object
                // (`cache.read`, `cache.write`). Confining the search to
                // `part.tokens` is what lets those bare `read`/`write` keys resolve
                // to the cache counts. The previous flat `cacheReadTokens`/
                // `cache_read` keys never matched, so every cached-read token (the
                // bulk of a cache-heavy run) was silently dropped, leaving the
                // comparable cost far too low.
                input: &["input"],
                cached: &["read"],
                cache_creation: &["write"],
                output: &["output"],
                reasoning: &["reasoning"],
                cost: &[],
                input_includes_cache: false,
                aggregation: Aggregation::Sum,
                usage_events: &["step_finish"],
                usage_path: &["part", "tokens"],
            },
            event_format: EventFormat::Kilo,
        },
        HarnessSlug::Opencode => AdapterSpec {
            pricing_model: PricingModelId::StripPrefix("openrouter/"),
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
            subscription: None,
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
                // OpenCode reports per-step usage on its `step_finish` events,
                // under `part.tokens`, with cache reads/writes nested one level
                // deeper in a `cache` object (`cache.read`, `cache.write`). The
                // search is confined to `part.tokens` so those bare `read`/`write`
                // keys resolve to the cache counts and nothing else.
                input: &["input"],
                cached: &["read"],
                cache_creation: &["write"],
                output: &["output"],
                reasoning: &["reasoning"],
                cost: &[],
                input_includes_cache: false,
                aggregation: Aggregation::Sum,
                usage_events: &["step_finish"],
                usage_path: &["part", "tokens"],
            },
            event_format: EventFormat::Opencode,
        },
        HarnessSlug::Pi => AdapterSpec {
            pricing_model: PricingModelId::Passthrough,
            api_key_env: Some("OPENROUTER_API_KEY"),
            container_key_env: None,
            subscription: None,
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
                // Pi reports usage per assistant message, under `message.usage`,
                // on its `message_end` events. The same usage block is restated on
                // the surrounding `turn_end` (and streamed, all-zero, on
                // `message_update`), so usage is read from `message_end` alone and
                // summed across the run. `input` is the uncached prompt; cache
                // reads sit alongside it under `cacheRead`/`cacheWrite`.
                input: &["input"],
                cached: &["cacheRead"],
                cache_creation: &["cacheWrite"],
                output: &["output"],
                reasoning: &[],
                cost: &[],
                input_includes_cache: false,
                aggregation: Aggregation::Sum,
                usage_events: &["message_end"],
                usage_path: &["message", "usage"],
            },
            event_format: EventFormat::Pi,
        },
    }
}

/// Raw per-class token totals, before the shape's per-class presence is applied.
///
/// Usage is accumulated here as plain integers; whether each class is actually
/// reported by the harness — and so becomes `Some` rather than `None` in the
/// final [`TokenCounts`] — is decided once, from the shape, in [`UsageShape::finalize`].
#[derive(Debug, Clone, Copy, Default)]
struct RawCounts {
    uncached_input: u64,
    cached_input: u64,
    output: u64,
    reasoning: u64,
}

impl RawCounts {
    fn total_input(&self) -> u64 {
        self.uncached_input + self.cached_input
    }

    fn total_output(&self) -> u64 {
        self.output + self.reasoning
    }
}

impl UsageShape {
    /// Whether this shape reports input usage at all: it does when it names input
    /// keys, or cache-creation keys (which fold into the uncached input class).
    fn reports_input(&self) -> bool {
        !self.input.is_empty() || !self.cache_creation.is_empty()
    }

    /// Apply this shape's per-class presence to accumulated raw totals: a class
    /// the shape declares keys for becomes `Some` (even when the total is zero, so
    /// a genuine zero is distinguished from an unreported class); a class with no
    /// keys becomes `None`, marking it as not determinable for this harness.
    fn finalize(&self, raw: RawCounts) -> TokenCounts {
        TokenCounts {
            uncached_input: self.reports_input().then_some(raw.uncached_input),
            cached_input: (!self.cached.is_empty()).then_some(raw.cached_input),
            output: (!self.output.is_empty()).then_some(raw.output),
            reasoning: (!self.reasoning.is_empty()).then_some(raw.reasoning),
        }
    }
}

/// Parse normalized usage out of a harness's command output.
fn parse_usage(output: &ExecOutput, shape: UsageShape) -> Usage {
    let mut raw = RawCounts::default();
    for line in output.stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        // When the shape names the events that carry usage, ignore every other
        // line so usage restated across several event types is not double-counted.
        if !shape.usage_events.is_empty() {
            let event_type = value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !shape.usage_events.contains(&event_type) {
                continue;
            }
        }
        // When the shape names where the usage object sits, read the token fields
        // from that sub-object rather than searching the whole record.
        let scope = if shape.usage_path.is_empty() {
            &value
        } else {
            match dig(&value, shape.usage_path) {
                Some(scope) => scope,
                None => continue,
            }
        };
        let line_tokens = extract_tokens(scope, shape);
        if line_tokens.total_input() == 0 && line_tokens.total_output() == 0 {
            continue;
        }
        match shape.aggregation {
            Aggregation::Last => raw = line_tokens,
            Aggregation::Sum => {
                raw.uncached_input += line_tokens.uncached_input;
                raw.cached_input += line_tokens.cached_input;
                raw.output += line_tokens.output;
                raw.reasoning += line_tokens.reasoning;
            }
        }
    }
    Usage {
        tokens: shape.finalize(raw),
    }
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

/// The sub-value reached by following `path` key by key, or `None` when any key
/// along the way is missing. Used to confine a usage search to a nested block.
fn dig<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

/// Extract the raw per-class token totals from one JSON event. Presence (`Some`
/// vs `None`) is applied later, from the shape, in [`UsageShape::finalize`].
fn extract_tokens(value: &Value, shape: UsageShape) -> RawCounts {
    let sum = |keys: &[&str]| keys.iter().filter_map(|k| find_u64(value, k)).sum::<u64>();

    let raw_input = sum(shape.input);
    let cached = sum(shape.cached);
    let cache_creation = sum(shape.cache_creation);
    let uncached_base = if shape.input_includes_cache {
        raw_input.saturating_sub(cached)
    } else {
        raw_input
    };

    RawCounts {
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
