//! Orchestrators: how a test case's harness sessions are conducted.
//!
//! See `docs/components/core/orchestrators.md`. An orchestrator owns the loop
//! around the harness — how many sessions to run, what each is told, and when
//! the work is done — while the [harness layer](crate::harness) still owns each
//! individual session (how it is invoked, how its usage is parsed, how its
//! activity is translated into [events](crate::event)). Orchestration is
//! harness-agnostic.
//!
//! Unlike a harness, an orchestrator carries **no in-tree code**: it is entirely
//! data — a directory with an `orchestrator.toml` manifest and a runner script.
//! The built-ins are embedded at build time (mirroring how the harness registry
//! embeds each `harness.toml`); a custom one can be supplied entirely from
//! outside the repository with `--orchestrator-dir`.
//!
//! The runner script runs **inside the run container**, in place of the single
//! harness invocation, after all shared setup. It drives sessions through the
//! `tcab-session` wrapper this module writes into the container — invoking
//! `tcab-session "<prompt>"` runs the selected harness's CLI with that harness's
//! exact session arguments, substituting the prompt — so a runner needs to know
//! nothing harness-specific. The wrapper emits a sentinel line around each
//! session so the combined runner output can be [segmented](segment_sessions)
//! back into per-session usage and summed into the run's totals; a single-session
//! (`one-shot`) run has exactly one segment, so its metrics are identical to a
//! run with no orchestration layer at all.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::Deserialize;

use crate::error::{Error, Result};
use crate::event::EventSink;
use crate::execution::{
    ContainerHandle, ContainerRuntime, ExecOutput, OutputStream, WORKSPACE_DIR,
};
use crate::harness::{AgentHarness, HarnessOutcome, Usage};
use crate::metrics::TokenCounts;
use crate::run_record::HarnessSlug;

/// The manifest file name for an orchestrator directory (built-in or external).
const MANIFEST_FILE: &str = "orchestrator.toml";

/// The slug of the default, single-session orchestrator.
pub const ONE_SHOT_SLUG: &str = "one-shot";

/// The slug of the built-in [Ralph](../../../orchestrators/ralph/) multi-session
/// orchestrator.
pub const RALPH_SLUG: &str = "ralph";

/// The token the `tcab-session` wrapper carries in place of the prompt argument.
/// It is rendered into the wrapper as an ordinary argv element, then the quoted
/// form is swapped for `"$1"`, so the wrapper substitutes its first argument
/// wherever the prompt belongs — whatever position the harness puts it in.
const PROMPT_SENTINEL: &str = "__TCAB_PROMPT_SENTINEL__";

/// The line the `tcab-session` wrapper prints to stdout immediately before it
/// invokes the harness, so the combined runner stream can be segmented per
/// session. It is not valid JSON, so a usage parse simply skips it.
const SESSION_BEGIN: &str = "__TCAB_SESSION_BEGIN__";
/// The line the `tcab-session` wrapper prints to stdout immediately after the
/// harness invocation returns, closing a session segment.
const SESSION_END: &str = "__TCAB_SESSION_END__";

/// A built-in orchestrator's embedded manifest + runner source, baked in at build
/// time so the catalog needs no filesystem access and a backend-driven worker
/// (which has no checkout) resolves the same way as the CLI.
struct BuiltIn {
    manifest_toml: &'static str,
    runner: &'static str,
}

/// The embedded built-in orchestrators, keyed by slug.
fn built_in(slug: &str) -> Option<BuiltIn> {
    match slug {
        ONE_SHOT_SLUG => Some(BuiltIn {
            manifest_toml: include_str!("../../../orchestrators/one-shot/orchestrator.toml"),
            runner: include_str!("../../../orchestrators/one-shot/runner.sh"),
        }),
        RALPH_SLUG => Some(BuiltIn {
            manifest_toml: include_str!("../../../orchestrators/ralph/orchestrator.toml"),
            runner: include_str!("../../../orchestrators/ralph/runner.sh"),
        }),
        _ => None,
    }
}

/// The slugs of every built-in orchestrator, for enumeration (for example by a
/// CLI listing). Kept in step with [`built_in`].
pub const BUILT_IN_SLUGS: &[&str] = &[ONE_SHOT_SLUG, RALPH_SLUG];

/// An orchestrator's declarative manifest, authored as `orchestrator.toml`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct OrchestratorManifest {
    /// Stable slug. For a built-in it must match the directory name; for an
    /// external directory the manifest's own slug is authoritative.
    pub slug: String,
    /// Human-readable name, for display.
    pub name: String,
    /// What the strategy does, for display.
    pub description: String,
    /// The runner entrypoint filename, relative to the orchestrator directory.
    pub runner: String,
    /// Parameters the runner reads, exposed to it as `TCAB_PARAM_<KEY>` (the key
    /// upper-cased). Empty when the manifest declares no `[params]` table.
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

/// A loaded orchestrator: its manifest plus the contents of its runner script.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Orchestrator {
    /// The parsed manifest.
    pub manifest: OrchestratorManifest,
    /// The runner script's contents, ready to be written into the run container.
    pub runner_script: String,
}

impl Orchestrator {
    /// This orchestrator's slug.
    pub fn slug(&self) -> &str {
        &self.manifest.slug
    }

    /// Parse a manifest from TOML, mapping a failure onto an [`Error::Orchestrator`]
    /// that names `origin` (a slug or a path) so the cause is clear.
    fn parse_manifest(toml_src: &str, origin: &str) -> Result<OrchestratorManifest> {
        toml::from_str(toml_src).map_err(|err| {
            Error::Orchestrator(format!("manifest for `{origin}` is invalid: {err}"))
        })
    }
}

/// Which orchestrator a run selects: a built-in by slug, or an external directory
/// supplied at run time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrchestratorSelection {
    /// The built-in slug to resolve when no directory is given. Ignored when
    /// `dir` is `Some` (the directory's own manifest slug is authoritative).
    pub slug: String,
    /// An external orchestrator directory (`--orchestrator-dir`). When set, the
    /// orchestrator is loaded from disk and the built-in slug is not consulted.
    pub dir: Option<PathBuf>,
}

impl Default for OrchestratorSelection {
    fn default() -> Self {
        Self {
            slug: ONE_SHOT_SLUG.to_string(),
            dir: None,
        }
    }
}

impl OrchestratorSelection {
    /// Select a built-in orchestrator by slug.
    pub fn builtin(slug: impl Into<String>) -> Self {
        Self {
            slug: slug.into(),
            dir: None,
        }
    }

    /// Select an external orchestrator directory.
    pub fn external(dir: impl Into<PathBuf>) -> Self {
        Self {
            slug: String::new(),
            dir: Some(dir.into()),
        }
    }
}

/// Resolves an [`OrchestratorSelection`] into a loaded [`Orchestrator`].
///
/// A built-in is read from the manifest + runner embedded at build time; an
/// external directory is read from disk. Either way the result is one
/// [`Orchestrator`] the run drives identically.
#[derive(Debug, Clone, Copy, Default)]
pub struct OrchestratorCatalog;

impl OrchestratorCatalog {
    /// Build a catalog. The built-ins are embedded, so this is stateless.
    pub fn new() -> Self {
        Self
    }

    /// Resolve a selection into a loaded orchestrator.
    ///
    /// When the selection carries a `dir`, the orchestrator is loaded from disk
    /// and its manifest's own slug is authoritative. Otherwise the built-in named
    /// by the selection's slug is loaded; an unknown slug is a clear error.
    pub fn resolve(&self, selection: &OrchestratorSelection) -> Result<Orchestrator> {
        match &selection.dir {
            Some(dir) => Self::load_external(dir),
            None => Self::load_builtin(&selection.slug),
        }
    }

    /// Load a built-in orchestrator by slug from the embedded sources.
    fn load_builtin(slug: &str) -> Result<Orchestrator> {
        let built_in = built_in(slug).ok_or_else(|| {
            Error::Orchestrator(format!(
                "unknown orchestrator `{slug}` (built-in orchestrators: {})",
                BUILT_IN_SLUGS.join(", ")
            ))
        })?;
        let manifest = Orchestrator::parse_manifest(built_in.manifest_toml, slug)?;
        // A built-in's manifest slug must match the directory it ships under; a
        // mismatch is an authoring bug caught by the catalog's unit test.
        if manifest.slug != slug {
            return Err(Error::Orchestrator(format!(
                "built-in orchestrator in `{slug}/` declares slug `{}`",
                manifest.slug
            )));
        }
        Ok(Orchestrator {
            manifest,
            runner_script: built_in.runner.to_string(),
        })
    }

    /// Load an external orchestrator from a directory on disk: its
    /// `orchestrator.toml` and the runner file the manifest names.
    fn load_external(dir: &Path) -> Result<Orchestrator> {
        let manifest_path = dir.join(MANIFEST_FILE);
        let manifest_src = std::fs::read_to_string(&manifest_path).map_err(|err| {
            Error::Orchestrator(format!(
                "could not read `{}`: {err}",
                manifest_path.display()
            ))
        })?;
        let manifest = Orchestrator::parse_manifest(&manifest_src, &dir.display().to_string())?;
        let runner_path = dir.join(&manifest.runner);
        let runner_script = std::fs::read_to_string(&runner_path).map_err(|err| {
            Error::Orchestrator(format!(
                "could not read runner `{}`: {err}",
                runner_path.display()
            ))
        })?;
        Ok(Orchestrator {
            manifest,
            runner_script,
        })
    }
}

/// Quote a string so a POSIX shell treats it as a single literal word.
///
/// Wraps the value in single quotes — inside which every character except `'`
/// itself is literal — and escapes any embedded single quote as `'\''` (close
/// the quote, an escaped literal quote, reopen). Empty input becomes `''`. The
/// value is *always* quoted, even when it needs no escaping, so a caller can
/// match the quoted form deterministically (this is how the prompt sentinel is
/// found and replaced in the rendered command line).
fn shell_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// Render a harness session command line from its argv, with the prompt left
/// substitutable.
///
/// Every argv element is shell-quoted, then the (quoted) `sentinel` is replaced
/// with `"$1"` so the rendered line invokes the harness with the wrapper's first
/// argument substituted wherever the prompt belongs — regardless of the prompt's
/// position in argv, and for a prompt containing spaces, quotes, `$`, or
/// newlines.
fn render_session_command(argv: &[String], sentinel: &str) -> String {
    let quoted_sentinel = shell_quote(sentinel);
    argv.iter()
        .map(|arg| {
            let quoted = shell_quote(arg);
            if quoted == quoted_sentinel {
                "\"$1\"".to_string()
            } else {
                quoted
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Render the full `tcab-session` wrapper script from a harness's session argv.
///
/// The wrapper takes the prompt as its first argument (`$1`), prints a unique
/// sentinel line before and after the harness invocation so the run can segment
/// the combined runner stream into per-session slices, and preserves the
/// harness's exit status.
fn render_session_wrapper(argv: &[String], sentinel: &str) -> String {
    let command = render_session_command(argv, sentinel);
    format!(
        "#!/bin/sh\n\
         # tcab-session: invoke the selected harness's CLI with the given prompt.\n\
         # Written into the run container by the orchestrator layer; see\n\
         # docs/components/core/orchestrators.md.\n\
         printf '%s\\n' '{SESSION_BEGIN}'\n\
         {command}\n\
         __tcab_status=$?\n\
         printf '%s\\n' '{SESSION_END}'\n\
         exit \"$__tcab_status\"\n"
    )
}

/// The `tcab-session` wrapper script for a harness and model.
fn tcab_session_wrapper(harness: &dyn AgentHarness, model_id: &str) -> String {
    let argv = harness.session_argv(model_id, PROMPT_SENTINEL);
    render_session_wrapper(&argv, PROMPT_SENTINEL)
}

/// One per-session slice of a runner's combined output, reconstructed from the
/// sentinel-delimited raw lines.
#[derive(Debug, Default, PartialEq, Eq)]
struct SessionSegment {
    stdout: String,
    stderr: String,
}

impl SessionSegment {
    /// View the slice as an [`ExecOutput`] so the harness's existing usage
    /// extraction reads it exactly as it reads a direct session's output.
    fn as_exec_output(&self) -> ExecOutput {
        ExecOutput {
            exit_code: 0,
            stdout: self.stdout.clone(),
            stderr: self.stderr.clone(),
        }
    }
}

/// Segment a runner's recorded raw output into per-session slices.
///
/// Each `tcab-session` invocation is bracketed on stdout by [`SESSION_BEGIN`] and
/// [`SESSION_END`] lines. Lines between them are accumulated into the current
/// slice (per stream); lines outside any session (the runner's own output) are
/// ignored — only a harness session reports usage.
fn segment_sessions(raw: &[crate::execution::RawOutputLine]) -> Vec<SessionSegment> {
    let mut segments = Vec::new();
    let mut current: Option<SessionSegment> = None;
    for line in raw {
        if line.stream == OutputStream::Stdout && line.line == SESSION_BEGIN {
            // A new BEGIN opens a fresh slice. A stray BEGIN without an END would
            // discard the partial slice rather than merge it; the wrapper always
            // pairs them, so this is only defensive.
            current = Some(SessionSegment::default());
            continue;
        }
        if line.stream == OutputStream::Stdout && line.line == SESSION_END {
            if let Some(segment) = current.take() {
                segments.push(segment);
            }
            continue;
        }
        if let Some(segment) = current.as_mut() {
            let buffer = match line.stream {
                OutputStream::Stdout => &mut segment.stdout,
                OutputStream::Stderr => &mut segment.stderr,
            };
            buffer.push_str(&line.line);
            buffer.push('\n');
        }
    }
    segments
}

/// Sum two optional token counts the way the run's totals must combine across
/// sessions: an unreported class on both sides stays unreported (`None`), so a
/// genuinely-empty class is never silently treated as zero; otherwise the present
/// values add (an unreported side contributing zero). This mirrors how a single
/// harness reports its own classes, so summing one session reproduces it exactly.
fn add_optional(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (None, None) => None,
        (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
    }
}

/// Add one session's token counts into a running total.
fn add_tokens(total: TokenCounts, next: TokenCounts) -> TokenCounts {
    TokenCounts {
        uncached_input: add_optional(total.uncached_input, next.uncached_input),
        cached_input: add_optional(total.cached_input, next.cached_input),
        output: add_optional(total.output, next.output),
        reasoning: add_optional(total.reasoning, next.reasoning),
    }
}

/// Write a file into a started run container at an absolute path, with the given
/// mode, carrying arbitrary bytes safely.
///
/// The bytes are base64-encoded and embedded as a single-quoted literal in a
/// `sh -c` script that base64-decodes them into the destination (after creating
/// its parent) and `chmod`s it. Base64 is shell-safe, so no stdin piping or byte
/// escaping is needed.
async fn write_container_file(
    runtime: &dyn ContainerRuntime,
    container: &ContainerHandle,
    dest: &str,
    contents: &[u8],
    mode: u32,
) -> Result<()> {
    let encoded = base64::engine::general_purpose::STANDARD.encode(contents);
    let quoted_dest = shell_quote(dest);
    let script = format!(
        "set -e\n\
         dest={quoted_dest}\n\
         mkdir -p \"$(dirname \"$dest\")\"\n\
         printf '%s' '{encoded}' | base64 -d > \"$dest\"\n\
         chmod {mode:o} \"$dest\"\n"
    );
    let command = vec!["sh".to_string(), "-c".to_string(), script];
    let output = runtime.exec(container, &command).await?;
    if output.exit_code != 0 {
        return Err(Error::Orchestrator(format!(
            "writing `{dest}` into the run container failed (exit {}): {}",
            output.exit_code,
            output.stderr.trim()
        )));
    }
    Ok(())
}

/// Build the runner environment-file body: each `(name, value)` becomes a
/// base64-decoded, exported shell variable, so a value with arbitrary shell
/// metacharacters (the prompt is large and multiline) is exposed verbatim. The
/// runner sources this file before exec'ing the runner script.
fn render_env_file(vars: &[(String, String)]) -> String {
    let mut body = String::new();
    for (name, value) in vars {
        let encoded = base64::engine::general_purpose::STANDARD.encode(value);
        // Decode the value into the variable, then export it. Command
        // substitution strips trailing newlines; the runner-contract values
        // (prompt, workspace, deadline, params) never end in one.
        body.push_str(&format!(
            "{name}=$(printf '%s' '{encoded}' | base64 -d)\nexport {name}\n"
        ));
    }
    body
}

/// The runner environment, per the contract table in the design doc.
fn runner_env(
    base_prompt: &str,
    deadline_epoch: u64,
    params: &BTreeMap<String, String>,
) -> Vec<(String, String)> {
    let mut vars = vec![
        ("TCAB_PROMPT".to_string(), base_prompt.to_string()),
        ("TCAB_WORKSPACE".to_string(), WORKSPACE_DIR.to_string()),
        ("TCAB_DEADLINE".to_string(), deadline_epoch.to_string()),
    ];
    for (key, value) in params {
        vars.push((format!("TCAB_PARAM_{}", key.to_uppercase()), value.clone()));
    }
    vars
}

/// Drive an orchestrator's runner inside a started run container, replacing the
/// single harness invocation.
///
/// Writes the `tcab-session` wrapper, the runner script, and a runner
/// environment file into the container; runs the runner through the shared
/// streaming-translation seam (so the harness's output flowing through it is
/// translated into events exactly as a direct session is); then segments the
/// recorded output by the wrapper's sentinels and runs the harness's existing
/// usage extraction on each session, summing the per-session usage and cost into
/// one aggregate [`HarnessOutcome`].
///
/// The caller bounds this whole future by the run's maximum runtime, exactly as a
/// single invocation is bounded.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn drive_orchestrator(
    runtime: &dyn ContainerRuntime,
    container: &ContainerHandle,
    harness: &dyn AgentHarness,
    orchestrator: &Orchestrator,
    slug: HarnessSlug,
    model_id: &str,
    base_prompt: &str,
    deadline_epoch: u64,
    events: &mut dyn EventSink,
) -> Result<HarnessOutcome> {
    // Resolve the run user's home so the wrapper lands on the PATH the base image
    // gives it (`~/.local/bin`) without hard-coding the user's home path.
    let home = resolve_home(runtime, container).await?;
    let bin_dir = format!("{home}/.local/bin");
    let wrapper_path = format!("{bin_dir}/tcab-session");
    // Orchestrator scratch lives under a dot-directory so it is easy to keep out
    // of the collected implementation.
    let runner_path = format!("{home}/.tcab/runner.sh");
    let env_path = format!("{home}/.tcab/runner.env");

    // The `tcab-session` wrapper: invokes the harness's CLI with the runner's
    // prompt substituted, sentinel-bracketed for segmentation. Mode 0755 — it is
    // executed off the PATH.
    let wrapper = tcab_session_wrapper(harness, model_id);
    write_container_file(runtime, container, &wrapper_path, wrapper.as_bytes(), 0o755).await?;

    // The runner script the orchestrator ships, and its environment.
    write_container_file(
        runtime,
        container,
        &runner_path,
        orchestrator.runner_script.as_bytes(),
        0o755,
    )
    .await?;
    let env = render_env_file(&runner_env(
        base_prompt,
        deadline_epoch,
        &orchestrator.manifest.params,
    ));
    write_container_file(runtime, container, &env_path, env.as_bytes(), 0o600).await?;

    // Source the environment, then exec the runner. A non-login `sh -c` keeps the
    // container's own PATH (so `tcab-session` resolves off `~/.local/bin`).
    let invocation = format!(
        ". {} && exec sh {}",
        shell_quote(&env_path),
        shell_quote(&runner_path)
    );
    let command = vec!["sh".to_string(), "-c".to_string(), invocation];

    let streamed = crate::harness_registry::run_streamed_translation(
        runtime,
        container,
        &command,
        harness.event_format(),
        events,
    )
    .await?;

    if streamed.output.exit_code != 0 {
        let detail = format!(
            "orchestrator `{}` runner exited with code {}",
            orchestrator.slug(),
            streamed.output.exit_code
        );
        events.emit(&crate::event::HarnessEvent {
            timestamp: now_timestamp(),
            session_id: None,
            kind: crate::event::EventKind::Error {
                message: detail.clone(),
                code: None,
            },
        });
        return Err(Error::HarnessInvocation {
            slug: slug.as_str().to_string(),
            detail,
        });
    }

    // Segment the combined runner output back into sessions and sum each
    // session's usage. For a single session (one-shot) there is exactly one
    // segment, whose extracted usage equals what a direct `invoke` produces.
    let segments = segment_sessions(&streamed.raw_output);
    let mut tokens = TokenCounts::default();
    let mut reported_cost: Option<f64> = None;
    for segment in &segments {
        let (usage, cost) = harness.parse_session_usage(&segment.as_exec_output());
        tokens = add_tokens(tokens, usage.tokens);
        if let Some(cost) = cost {
            reported_cost = Some(reported_cost.unwrap_or(0.0) + cost);
        }
    }

    Ok(HarnessOutcome {
        usage: Usage { tokens },
        harness_version: None,
        reported_cost,
        raw_output: streamed.raw_output,
        translated_events: streamed.translated_events,
    })
}

/// Resolve the run user's `$HOME` inside the container.
async fn resolve_home(
    runtime: &dyn ContainerRuntime,
    container: &ContainerHandle,
) -> Result<String> {
    let command = vec![
        "sh".to_string(),
        "-c".to_string(),
        "printf %s \"$HOME\"".to_string(),
    ];
    let output = runtime.exec(container, &command).await?;
    let home = output.stdout.trim();
    if output.exit_code != 0 || home.is_empty() {
        return Err(Error::Orchestrator(
            "could not resolve the run user's home directory in the container".to_string(),
        ));
    }
    Ok(home.to_string())
}

/// The current time as an RFC 3339 string, for stamping the synthesized error
/// event a failed runner emits.
fn now_timestamp() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "orchestrator.test.rs"]
mod tests;
