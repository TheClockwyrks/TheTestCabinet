//! Per-harness OpenTelemetry configuration for a run container.
//!
//! The Test Cabinet's own processes are instrumented directly (see the
//! `test-cabinet-telemetry` crate). The *harness* is a third-party CLI running
//! inside the run container, so it can only be instrumented by configuring it
//! the way its vendor documents — which is different for every harness, and
//! impossible for some. This module is the single place that knowledge lives.
//!
//! # How a harness is configured
//!
//! A run resolves a [`TelemetryContext`] from the ambient `OTEL_*` environment
//! ([`TelemetryContext::from_env`]). When telemetry is off — the default, since
//! `OTEL_EXPORTER_OTLP_ENDPOINT` is unset — there is no context and nothing is
//! configured, exactly matching the opt-in contract the rest of the system
//! follows. When it is on, the harness's [`HarnessTelemetry`] descriptor turns
//! that context into a [`TelemetryPlan`]: environment variables and, for the
//! harnesses configured by file rather than environment, config files to
//! materialize in the container.
//!
//! # Trace linking
//!
//! Where a harness supports it, the run's current trace context is handed to it
//! as a W3C `traceparent` so its spans land **in the run's trace** rather than in
//! a disconnected trace of their own. Support is uneven, so
//! [`TraceLinking`] records what each harness actually does and the per-harness
//! documentation states it plainly. Every harness that exports anything is given
//! `tcab.*` resource attributes regardless, so its telemetry can still be
//! correlated to the run by query when it cannot be linked by trace.
//!
//! Note that the `traceparent` carries the sampling decision: when the run's
//! trace is not sampled, a linking harness will correctly suppress its own
//! export too.
//!
//! # Endpoint reachability
//!
//! The endpoint is resolved from the perspective of the *container*, not the
//! host. In a cluster that is the collector's Service DNS name and needs no
//! translation. On a developer machine the ambient endpoint is a loopback
//! address, which inside the container would resolve to the container itself, so
//! it is rewritten to the host gateway — see [`TelemetryPlan::needs_host_gateway`].

use std::collections::BTreeMap;

use crate::execution::ContainerFile;
use crate::run_record::HarnessSlug;

/// The container-side home directory of the run user. Harness config files are
/// materialized beneath it, matching the credential paths the auth layer uses.
const CONTAINER_HOME: &str = "/home/node";

/// The hostname a container uses to reach the run host, paired with
/// [`crate::preview::HOST_GATEWAY_ADD_HOST`].
const HOST_GATEWAY_HOST: &str = "host.docker.internal";

/// Whether — and how — a harness links its spans into the run's trace.
///
/// This is recorded rather than inferred because the answer is a property of the
/// harness's implementation, is frequently *not* what the OpenTelemetry
/// specification would suggest, and directly determines whether an operator
/// should expect to find the harness nested under a run in Tempo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraceLinking {
    /// The harness reads the standard `TRACEPARENT` environment variable, so its
    /// spans are children of the run's span.
    Traceparent,
    /// The harness reads the trace context from a vendor-specific variable
    /// instead of the standard one. The variable is named here.
    VendorVariable(&'static str),
    /// The harness exports telemetry but has no way to accept an inbound trace
    /// context, so its spans form their own trace. The string documents what is
    /// known, for the operator who wonders why the trace is detached.
    Unlinked(&'static str),
}

/// What a harness needs in its container to export telemetry.
///
/// Produced by [`HarnessTelemetry::plan`] from a [`TelemetryContext`]; consumed
/// by the run flow, which merges it into the [`ContainerSpec`] before the
/// container starts.
///
/// [`ContainerSpec`]: crate::execution::ContainerSpec
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TelemetryPlan {
    /// Non-secret environment variables for the container. These go into
    /// [`ContainerSpec::env`](crate::execution::ContainerSpec::env), not
    /// `secrets`.
    pub env: BTreeMap<String, String>,
    /// Config files to materialize, for the harnesses that are configured by
    /// file rather than by environment (Codex, OpenCode).
    pub files: Vec<ContainerFile>,
    /// Whether the container must be given a route back to the run host for the
    /// endpoint to resolve. Set when the endpoint was rewritten from a loopback
    /// address; always false in a cluster, where the collector has its own DNS
    /// name.
    pub needs_host_gateway: bool,
}

/// The ambient OTLP configuration a run exports harness telemetry with,
/// resolved once per run.
///
/// Absent (`None` from [`from_env`](Self::from_env)) whenever
/// `OTEL_EXPORTER_OTLP_ENDPOINT` is unset or blank, which is what keeps harness
/// telemetry opt-in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelemetryContext {
    /// The OTLP HTTP base endpoint, already rewritten to be reachable from
    /// inside the container. Never has a trailing slash, so a signal path can be
    /// appended directly.
    pub endpoint: String,
    /// The OTLP protocol, defaulting to `http/protobuf`. Only the HTTP protocols
    /// are meaningful here: every harness that supports OTLP at all supports
    /// HTTP, and several support nothing else.
    pub protocol: String,
    /// `OTEL_RESOURCE_ATTRIBUTES` for the harness: the run's `tcab.*` attributes,
    /// followed by any ambient attributes so an operator-set attribute survives.
    pub resource_attributes: String,
    /// The run's current W3C trace context, when a trace is in scope.
    pub traceparent: Option<String>,
    /// Whether [`endpoint`](Self::endpoint) was rewritten from a loopback
    /// address and therefore needs a host-gateway mapping.
    pub rewrote_loopback: bool,
}

/// What a run is, for the resource attributes attached to its harness telemetry.
#[derive(Debug, Clone, Copy)]
pub struct TelemetrySubject<'a> {
    /// The harness being driven.
    pub harness: HarnessSlug,
    /// The test case (or game jam) slug.
    pub test_case: &'a str,
    /// The variant slug.
    pub variant: &'a str,
    /// The opaque model ID passed to the harness.
    pub model_id: &'a str,
    /// The run's record ID, minted before the harness starts precisely so the
    /// harness can stamp it on its own telemetry. This is the key that ties a
    /// harness's spans — its tool calls, model turns and errors — to the run they
    /// belong to; without it those spans are uncorrelated and can only be read as
    /// an undifferentiated stream.
    pub run_id: &'a str,
}

impl TelemetryContext {
    /// Resolve the ambient OTLP configuration, or `None` when harness telemetry
    /// is off.
    ///
    /// Reads the same `OTEL_EXPORTER_OTLP_ENDPOINT` master switch the rest of
    /// the system uses, so a deployment that exports its own telemetry exports
    /// its harnesses' telemetry too, with no second thing to turn on.
    pub fn from_env(subject: &TelemetrySubject<'_>) -> Option<Self> {
        let raw = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
            .ok()
            .filter(|endpoint| !endpoint.trim().is_empty())?;
        Some(Self::resolve(raw.trim(), subject, |key| {
            std::env::var(key).ok()
        }))
    }

    /// The resolution itself, with the environment injected so it is testable
    /// without mutating the process environment.
    fn resolve(
        raw_endpoint: &str,
        subject: &TelemetrySubject<'_>,
        var: impl Fn(&str) -> Option<String>,
    ) -> Self {
        let trimmed = raw_endpoint.trim_end_matches('/');
        let (endpoint, rewrote_loopback) = rewrite_loopback(trimmed);

        // Only the HTTP protocols are offered to a harness. Several harnesses
        // support nothing else, and an ambient `grpc` would otherwise be handed
        // to a harness that cannot speak it — a silently broken exporter is
        // worse than a consistent one.
        let protocol = match var("OTEL_EXPORTER_OTLP_PROTOCOL").as_deref() {
            Some("http/json") => "http/json",
            _ => "http/protobuf",
        }
        .to_string();

        Self {
            endpoint,
            protocol,
            resource_attributes: resource_attributes(subject, var("OTEL_RESOURCE_ATTRIBUTES")),
            traceparent: test_cabinet_telemetry::propagation::current_traceparent(),
            rewrote_loopback,
        }
    }

    /// The endpoint for one OTLP signal, for a harness that wants full signal
    /// paths rather than a base URL.
    fn signal_endpoint(&self, signal: &str) -> String {
        format!("{}/v1/{signal}", self.endpoint)
    }

    /// The service name a harness reports under. Namespaced so harness spans are
    /// obviously The Test Cabinet's and are trivially separable from the spans
    /// its own processes emit.
    fn service_name(slug: HarnessSlug) -> String {
        format!("tcab-harness-{}", slug.as_str())
    }
}

/// Rewrite a loopback endpoint to the host gateway, so it resolves from inside
/// the container rather than to the container itself.
///
/// Returns the endpoint and whether a rewrite happened. A non-loopback endpoint
/// — a collector Service in a cluster, or a vendor's URL — is returned
/// unchanged, so this is inert everywhere except a developer machine.
fn rewrite_loopback(endpoint: &str) -> (String, bool) {
    for loopback in ["//localhost", "//127.0.0.1", "//[::1]"] {
        if let Some(index) = endpoint.find(loopback) {
            let (prefix, rest) = endpoint.split_at(index + 2);
            let suffix = &rest[loopback.len() - 2..];
            return (format!("{prefix}{HOST_GATEWAY_HOST}{suffix}"), true);
        }
    }
    (endpoint.to_string(), false)
}

/// Build `OTEL_RESOURCE_ATTRIBUTES` describing the run, with any ambient
/// attributes appended so an operator-set attribute is not dropped.
fn resource_attributes(subject: &TelemetrySubject<'_>, ambient: Option<String>) -> String {
    let mut attributes = vec![
        format!("tcab.harness={}", encode_value(subject.harness.as_str())),
        format!("tcab.test_case={}", encode_value(subject.test_case)),
        format!("tcab.variant={}", encode_value(subject.variant)),
        format!("tcab.model={}", encode_value(subject.model_id)),
        format!("tcab.run_id={}", encode_value(subject.run_id)),
    ];
    if let Some(ambient) = ambient.filter(|ambient| !ambient.trim().is_empty()) {
        attributes.push(ambient.trim().to_string());
    }
    attributes.join(",")
}

/// Percent-encode a resource-attribute value.
///
/// `OTEL_RESOURCE_ATTRIBUTES` is a comma-separated list of `key=value` pairs, so
/// a value containing a comma or an equals sign would otherwise be parsed as
/// extra attributes. Model IDs routinely contain `/` and `:` and occasionally
/// worse, so everything outside an unreserved set is encoded.
fn encode_value(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// How one harness is configured to export telemetry, or why it cannot be.
///
/// Declared per harness in its adapter spec, alongside the rest of the
/// harness's imperative behaviour.
pub enum HarnessTelemetry {
    /// The harness has no OTLP export path a run can configure. The string
    /// documents why, and is surfaced in the per-harness documentation rather
    /// than left for a reader to rediscover.
    Unsupported(&'static str),
    /// The harness exports telemetry. Carries how it links to the run's trace
    /// and the builder that turns a context into a plan.
    Supported {
        /// How the harness's spans relate to the run's trace.
        linking: TraceLinking,
        /// Builds the container configuration from the resolved context.
        plan: fn(&TelemetryContext, HarnessSlug) -> TelemetryPlan,
    },
}

impl HarnessTelemetry {
    /// How this harness links to the run's trace, or `None` when it exports
    /// nothing.
    pub fn linking(&self) -> Option<TraceLinking> {
        match self {
            Self::Unsupported(_) => None,
            Self::Supported { linking, .. } => Some(*linking),
        }
    }

    /// The container configuration for this harness, or `None` when the harness
    /// cannot export telemetry at all.
    pub fn plan(&self, context: &TelemetryContext, slug: HarnessSlug) -> Option<TelemetryPlan> {
        match self {
            Self::Unsupported(_) => None,
            Self::Supported { plan, .. } => {
                let mut plan = plan(context, slug);
                plan.needs_host_gateway = context.rewrote_loopback;
                Some(plan)
            }
        }
    }
}

/// The `OTEL_*` variables shared by every harness whose SDK reads the standard
/// environment. Individual builders extend this with their vendor's own switches.
fn standard_env(context: &TelemetryContext, slug: HarnessSlug) -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "OTEL_EXPORTER_OTLP_ENDPOINT".to_string(),
            context.endpoint.clone(),
        ),
        (
            "OTEL_EXPORTER_OTLP_PROTOCOL".to_string(),
            context.protocol.clone(),
        ),
        (
            "OTEL_SERVICE_NAME".to_string(),
            TelemetryContext::service_name(slug),
        ),
        (
            "OTEL_RESOURCE_ATTRIBUTES".to_string(),
            context.resource_attributes.clone(),
        ),
    ])
}

/// Claude Code: fully native, all three signals, and the only harness that reads
/// the standard `TRACEPARENT`.
///
/// Two switches are required — the second, beta one gates traces specifically;
/// without it only metrics and logs are emitted. The export intervals are
/// shortened from their multi-second defaults because a run is short-lived and
/// the default batching loses the tail of a session.
///
/// Trace linking applies because a run always invokes `claude --print`;
/// interactive sessions ignore an inbound `TRACEPARENT`, but a run never has one.
fn claude_plan(context: &TelemetryContext, slug: HarnessSlug) -> TelemetryPlan {
    let mut env = standard_env(context, slug);
    env.extend([
        ("CLAUDE_CODE_ENABLE_TELEMETRY".to_string(), "1".to_string()),
        (
            "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA".to_string(),
            "1".to_string(),
        ),
        ("OTEL_TRACES_EXPORTER".to_string(), "otlp".to_string()),
        ("OTEL_METRICS_EXPORTER".to_string(), "otlp".to_string()),
        ("OTEL_LOGS_EXPORTER".to_string(), "otlp".to_string()),
        (
            "OTEL_METRIC_EXPORT_INTERVAL".to_string(),
            "1000".to_string(),
        ),
        ("OTEL_LOGS_EXPORT_INTERVAL".to_string(), "1000".to_string()),
        (
            "OTEL_TRACES_EXPORT_INTERVAL".to_string(),
            "1000".to_string(),
        ),
    ]);
    if let Some(traceparent) = &context.traceparent {
        env.insert("TRACEPARENT".to_string(), traceparent.clone());
    }
    TelemetryPlan {
        env,
        ..Default::default()
    }
}

/// Codex: configured entirely from `config.toml`; it reads no `OTEL_*` variable.
///
/// All three exporters are set explicitly. That is not redundant for
/// `metrics_exporter`, whose default is `statsig` — leaving it alone would ship
/// a run's metrics to the vendor rather than to the configured collector.
/// `log_user_prompt` is left at its default `false` so a run's prompt is not
/// copied into telemetry.
///
/// Codex takes full signal paths rather than a base endpoint, and spells the
/// protocol `binary`/`json` rather than the OTLP names.
fn codex_plan(context: &TelemetryContext, _slug: HarnessSlug) -> TelemetryPlan {
    let protocol = if context.protocol == "http/json" {
        "json"
    } else {
        "binary"
    };
    let environment = std::env::var("TCAB_ENV").unwrap_or_else(|_| "local".to_string());
    let config = format!(
        "# Written by The Test Cabinet for this run; see the Codex telemetry docs.\n\
         [otel]\n\
         environment = \"{environment}\"\n\
         log_user_prompt = false\n\
         exporter = {{ otlp-http = {{ endpoint = \"{logs}\", protocol = \"{protocol}\" }} }}\n\
         trace_exporter = {{ otlp-http = {{ endpoint = \"{traces}\", protocol = \"{protocol}\" }} }}\n\
         metrics_exporter = {{ otlp-http = {{ endpoint = \"{metrics}\", protocol = \"{protocol}\" }} }}\n",
        logs = context.signal_endpoint("logs"),
        traces = context.signal_endpoint("traces"),
        metrics = context.signal_endpoint("metrics"),
    );
    TelemetryPlan {
        env: BTreeMap::new(),
        files: vec![ContainerFile {
            container_path: format!("{CONTAINER_HOME}/.codex/config.toml"),
            contents: config.into_bytes(),
            // Not a credential, but it sits in the same directory as `auth.json`
            // and there is no reason for it to be world-readable.
            mode: 0o644,
        }],
        needs_host_gateway: false,
    }
}

/// Goose: a Rust CLI on `opentelemetry-rust`, configured by the standard
/// environment. Setting the endpoint is what enables it; there is no separate
/// switch.
fn goose_plan(context: &TelemetryContext, slug: HarnessSlug) -> TelemetryPlan {
    let mut env = standard_env(context, slug);
    env.extend([
        ("OTEL_TRACES_EXPORTER".to_string(), "otlp".to_string()),
        ("OTEL_METRICS_EXPORTER".to_string(), "otlp".to_string()),
        ("OTEL_LOGS_EXPORTER".to_string(), "otlp".to_string()),
    ]);
    TelemetryPlan {
        env,
        ..Default::default()
    }
}

/// Kilo Code: native, telemetry on by default, and enabled purely by the
/// presence of the endpoint. Traces and logs only — it emits no metrics.
fn kilo_plan(context: &TelemetryContext, slug: HarnessSlug) -> TelemetryPlan {
    TelemetryPlan {
        env: standard_env(context, slug),
        ..Default::default()
    }
}

/// OpenCode: no native support, so a plugin provides it. The plugin is named in
/// `opencode.json` and resolved from npm when OpenCode starts, so there is no
/// separate install step — but the run container does need registry access on
/// first start, which it already has.
///
/// Everything is vendor-prefixed, including the trace context: the plugin reads
/// `OPENCODE_TRACEPARENT` and ignores the standard `TRACEPARENT`, so the run's
/// context is passed under both names.
fn opencode_plan(context: &TelemetryContext, _slug: HarnessSlug) -> TelemetryPlan {
    let mut env = BTreeMap::from([
        ("OPENCODE_ENABLE_TELEMETRY".to_string(), "1".to_string()),
        (
            "OPENCODE_OTLP_ENDPOINT".to_string(),
            context.endpoint.clone(),
        ),
        (
            "OPENCODE_OTLP_PROTOCOL".to_string(),
            context.protocol.clone(),
        ),
    ]);
    if let Some(traceparent) = &context.traceparent {
        env.insert("OPENCODE_TRACEPARENT".to_string(), traceparent.clone());
    }
    let config = "{\n  \"$schema\": \"https://opencode.ai/config.json\",\n  \
                  \"plugin\": [\"@devtheops/opencode-plugin-otel\"]\n}\n";
    TelemetryPlan {
        env,
        files: vec![ContainerFile {
            container_path: format!("{CONTAINER_HOME}/.config/opencode/opencode.json"),
            contents: config.as_bytes().to_vec(),
            mode: 0o644,
        }],
        needs_host_gateway: false,
    }
}

/// The telemetry descriptor for a harness.
///
/// Kept here rather than inline in the adapter specs so that the whole support
/// matrix — including the reasons for the gaps — reads in one place.
pub fn harness_telemetry(slug: HarnessSlug) -> HarnessTelemetry {
    match slug {
        HarnessSlug::Claude => HarnessTelemetry::Supported {
            linking: TraceLinking::Traceparent,
            plan: claude_plan,
        },
        HarnessSlug::Codex => HarnessTelemetry::Supported {
            linking: TraceLinking::Unlinked(
                "Codex documents no inbound trace-context configuration; its spans \
                 form their own trace, correlated by the tcab.* resource attributes.",
            ),
            plan: codex_plan,
        },
        HarnessSlug::Goose => HarnessTelemetry::Supported {
            linking: TraceLinking::Unlinked(
                "Goose documents no inbound trace-context configuration; its spans \
                 form their own trace, correlated by the tcab.* resource attributes.",
            ),
            plan: goose_plan,
        },
        HarnessSlug::Kilo => HarnessTelemetry::Supported {
            linking: TraceLinking::Unlinked(
                "Kilo Code documents no inbound trace-context configuration; its \
                 spans form their own trace, correlated by the tcab.* resource \
                 attributes.",
            ),
            plan: kilo_plan,
        },
        HarnessSlug::Opencode => HarnessTelemetry::Supported {
            linking: TraceLinking::VendorVariable("OPENCODE_TRACEPARENT"),
            plan: opencode_plan,
        },
        HarnessSlug::Cline => HarnessTelemetry::Unsupported(
            "Cline's OpenTelemetry export is an enterprise feature configured from \
             its hosted dashboard, with no environment or config-file equivalent a \
             run could set, and it emits metrics and logs only — no traces.",
        ),
        HarnessSlug::Pi => HarnessTelemetry::Unsupported(
            "Pi has no native export, and every mature third-party extension \
             (pi-telemetry-otel, @devkade/pi-opentelemetry) still peer-depends on \
             the retired @mariozechner/pi-coding-agent package and will not load \
             against current Pi. The one extension built against the current \
             @earendil-works scope, pi-otel, is a single unverified release; \
             registering an extension Pi cannot load would break Pi runs outright, \
             so it is documented rather than enabled.",
        ),
        HarnessSlug::Antigravity => {
            HarnessTelemetry::Unsupported("Antigravity exposes no telemetry export of any kind.")
        }
    }
}

#[cfg(test)]
#[path = "harness_telemetry.test.rs"]
mod tests;
