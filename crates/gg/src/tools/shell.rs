//! The `shell` tool: run a command in the run container, rooted at the workspace.
//!
//! gg runs inside the run container, so the shell tool executes on the **local**
//! shell (`sh -c`) with its working directory set to the invocation's workspace
//! root. It captures the command's combined output (stdout then stderr), truncates it
//! to a cap so a chatty build can't flood the model's context or the telemetry
//! stream, and enforces a per-command timeout so a hung command can never wedge the
//! run. The tool is contributed only when the
//! [`shell`](test_cabinet_core::gg::CAPABILITY_SHELL) capability is enabled.
//!
//! # Output offloading
//!
//! How much of a command's output comes back inline is the shell capability's swappable
//! implementation ([`OffloadPolicy`]). Under [inline](OffloadPolicy::Inline) a command's merged
//! output is returned as gg has always returned it, tail-truncated at [`MAX_OUTPUT_BYTES`]. Under
//! [offload](OffloadPolicy::Offload) every command's stdout and stderr are additionally written to a
//! **pair of files** in a gg-managed directory, and only the tail permitted by the configured
//! [line/character ceilings](OffloadLimits) comes back — followed by a note naming the two files, so
//! an agent that needs more can `grep` them instead of being handed a build log it did not ask for.
//!
//! Both execution modes go through [`run_command`], so the policy governs a JSON tool call and a
//! [responses-as-code](crate::sandbox) program's `system.shell(…)` identically.
//!
//! # The seam
//!
//! Starting the process is **not** this module's job: it belongs to the
//! [`ShellRunner`] the [`ToolContext`] carries, so what a command *did* can be substituted while
//! everything here — the merge, the policy, the truncation notes, the [`ToolOutcome`] — stays this
//! build of gg's. See [`runner`] for where the line is drawn and why.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};
// The shell vocabulary — the two mode ids and the two ceilings — is `crates/core`'s, because the
// console writes a shell capability with the same names this reads it back by.
use test_cabinet_core::gg::{
    CAPABILITY_SHELL, PARAM_MAX_CHARS, PARAM_MAX_LINES, SHELL_OUTPUT_INLINE, SHELL_OUTPUT_MODES,
    SHELL_OUTPUT_OFFLOAD,
};
use test_cabinet_core::gg_session_record::GgShellOrigin;

use super::{
    ApiData, ArgumentError, ShellData, Tool, ToolContext, ToolFailure, ToolOutcome, required_str,
};
use crate::model::ToolDefinition;

#[path = "shell.runner.rs"]
pub(super) mod runner;

/// The seam's [test double](runner::StubShellRunner), re-exported for the modules on the other two
/// command-line paths — a [responses-as-code](crate::sandbox) program's and a
/// [hook's](crate::hooks) — whose tests substitute it.
pub(crate) use runner::{ShellExecution, ShellRequest, ShellRunner, ShellStatus, real_shell};

/// The tool's name, matched during dispatch and offered to the model.
pub const SHELL_TOOL: &str = "shell";
/// Default per-command timeout (seconds) when a call does not specify one. The sandbox membrane
/// clamps against this same figure, so the two surfaces cannot disagree about it.
pub(crate) const DEFAULT_TIMEOUT_SECS: f64 = 600.0;
/// Ceiling on the captured output handed back to the model, in bytes. Output beyond
/// this is dropped with a truncation note so a noisy command cannot flood context.
/// Applied under both [policies](OffloadPolicy) — under
/// [offload](OffloadPolicy::Offload) it is the backstop behind a line/character ceiling
/// generous enough to still exceed it.
const MAX_OUTPUT_BYTES: usize = 16 * 1024;

/// What either ceiling of zero would do, in the capability's own terms — the clause a
/// [refusal](crate::validate) carries, written once so both ceilings say it the same way.
const CEILING_CONSEQUENCE: &str = "a ceiling of nothing would return none of the command's output";

/// The gg-managed directory offloaded output is written to. Outside the workspace on purpose: these
/// files are gg's bookkeeping, not the agent's work product, and a run's diff should not fill up
/// with build logs.
///
/// A **sibling** of the gg binary rather than a child of it. The binary is installed at
/// [`BINARY_PATH`](test_cabinet_core::gg::BINARY_PATH) — `/tmp/gg`, a regular file — so the
/// `/tmp/gg/shell` this once was could never be created in a real run: every `create_dir_all`
/// failed with `ENOTDIR`, offloading fell back to inline output for the whole of every session, and
/// nothing caught it because a unit test pointing `dir` at a temp directory never touches the
/// production path. `offload_dir_is_not_under_the_gg_binary` in `shell.offload.test.rs` guards it.
pub const OFFLOAD_DIR: &str = "/tmp/gg-shell";

/// The serial number of the next offloaded command, so no two commands in a process — including two
/// agents running concurrently on the subagent scheduler — ever share a file pair.
static OFFLOAD_SEQUENCE: AtomicU64 = AtomicU64::new(0);

// ---------------------------------------------------------------------------
// Offload policy
// ---------------------------------------------------------------------------

/// How much of a command's output comes back inline, and whether the whole of it is kept on disk —
/// the [shell](test_cabinet_core::gg::CAPABILITY_SHELL) capability's swappable implementation.
///
/// A chatty command is one of the few things an agent does that can spend a large fraction of its
/// context window in a single call, on text it usually needed three lines of. Offloading makes that
/// an experimental variable: the tail the agent is shown is bounded, the full output stays
/// addressable on disk, and the agent gets it back with `grep` when it actually needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OffloadPolicy {
    /// Return the merged output inline (tail-truncated at [`MAX_OUTPUT_BYTES`]) and write nothing to
    /// disk — gg's original behavior, and the control arm.
    Inline,
    /// Write every command's stdout and stderr to a file pair, and return only the tail the
    /// [limits](OffloadLimits) permit, followed by a note naming the two files.
    Offload(OffloadLimits),
    /// **Not an output mode: the launch is already refused.** What [`resolve`](Self::resolve) and
    /// [`for_mode`](Self::for_mode) hand back once they have nothing left to select — the capability
    /// named no arm, or named one gg has no mode for, or wrote no ceilings for a truncating arm to
    /// truncate past. Both are total, so they answer with something; this is the something, and its
    /// name is what tells the next reader of that line that no run is going to reach it.
    ///
    /// It is deliberately not one of the two modes. Resolving a hole to
    /// [`Offload`](Self::Offload) — or to ceilings gg picked — is exactly the substitution the
    /// [refusal](crate::validate) exists to prevent: it runs one arm of the offloading experiment
    /// under another's name.
    LaunchRefused,
}

impl OffloadPolicy {
    /// **A truncating policy with ceilings no fixture's output approaches** — 250 trailing lines
    /// and 4 096 trailing characters — which is what gg's own loop tests bind `shell` with.
    ///
    /// `#[cfg(test)]`, because it is a fixture and not a figure gg would stand in for an absent
    /// pair: a run's ceilings come from that run's own document or the launch is refused. What a
    /// test that is not *about* truncation needs from it is that a mode is armed at all, which is
    /// the shape the loop under test is written against.
    #[cfg(test)]
    pub(crate) fn ample() -> Self {
        Self::Offload(OffloadLimits {
            max_lines: 250,
            max_chars: 4_096,
            dir: PathBuf::from(OFFLOAD_DIR),
        })
    }

    /// This policy under an explicit `mode` — one of [`SHELL_OUTPUT_MODES`] — keeping whatever
    /// [limits](OffloadLimits) `fallback` carries.
    ///
    /// What a [hook](crate::hooks) reads its own `output` override through, and `locus` is where
    /// that override sits in the configuration document, because a hook is the one place this is
    /// read from something other than the shell capability itself. The limits come from the agent
    /// rather than from the hook because they are a property of the *window* the output lands in,
    /// not of the command that produced it: an operator overriding the mode is saying "keep this one
    /// inline", not "and size it differently from everything else".
    ///
    /// Two ways this refuses the launch. A mode gg does not recognize is the obvious one: it is the
    /// one hook field no launch diagnostic reads otherwise, so a hook written to keep its build
    /// output inline would be conducted under a mode nobody named. The other is a truncating
    /// `mode` asked for over a
    /// `fallback` that carries **no** ceilings — an agent whose own shell runs
    /// [inline](Self::Inline), or offers no shell at all. There is nothing there to truncate past
    /// and gg picks no figure, so the override is refused rather than conducted at ceilings nobody
    /// wrote. The one `fallback` that carries no ceilings and is *not* reported here is
    /// [`LaunchRefused`](Self::LaunchRefused): that agent's `shell` is already named at its own
    /// locus, and this would be the same defect counted twice.
    pub fn for_mode(
        mode: &str,
        fallback: &Self,
        locus: &str,
        report: &mut crate::validate::LaunchReport,
    ) -> Self {
        let truncating = |arm: fn(OffloadLimits) -> Self| fallback.limits().cloned().map(arm);
        let selected = match mode.trim() {
            SHELL_OUTPUT_INLINE => return Self::Inline,
            SHELL_OUTPUT_OFFLOAD => truncating(Self::Offload),
            unknown => {
                report.report(
                    crate::validate::LaunchDefect::run_level(
                        locus.to_string(),
                        unknown,
                        "the `output` field names where a hook command's output goes, and \
                         gg has no such mode"
                            .to_string(),
                    )
                    .known(SHELL_OUTPUT_MODES),
                );
                return Self::LaunchRefused;
            }
        };
        selected.unwrap_or_else(|| {
            // Unless the fallback is itself already refused: then the agent's `shell` has been
            // named at its own locus in this same pass, and this is that one defect seen from a
            // second place rather than a second defect.
            if !matches!(fallback, Self::LaunchRefused) {
                report.report(crate::validate::LaunchDefect::run_level(
                    locus.to_string(),
                    mode.trim(),
                    format!(
                        "the `output` field asks for a mode that returns a tail of the \
                         command's output, and this agent's own `{CAPABILITY_SHELL}` capability \
                         declares no ceiling for that tail to be measured against"
                    ),
                ));
            }
            Self::LaunchRefused
        })
    }

    /// Resolve the policy from an **enabled** shell capability's `implementation` and `params`.
    ///
    /// Enabled is the caller's to establish: the two ceilings are required of a capability that
    /// offers a `shell` and of nothing else, so a declaration that offers none is read by
    /// [`check_declaration`] instead.
    ///
    /// Three ways a declaration leaves nothing to select, and all three end at
    /// [`LaunchRefused`](Self::LaunchRefused):
    ///
    /// - **No arm.** The mode is the offloading experiment's own variable and gg selects none on an
    ///   operator's behalf. Reporting the absence belongs to the launch pass, which is the one
    ///   reader that can see the switch, so nothing is said here.
    /// - **An arm gg has no mode for.** Reported here: reading it as either of the two would
    ///   measure one arm of the offloading experiment under another's name.
    /// - **A ceiling missing, or naming no count of one or more.** Reported at its own locus by
    ///   [`required_positive_count_param`](crate::validate::required_positive_count_param).
    ///
    /// Both [limits](OffloadLimits) are required whichever arm is selected — including
    /// [`Inline`](Self::Inline), which does not carry them — so one shared params block swept across
    /// the two modes is judged the same way on every launch in it.
    pub fn resolve(
        implementation: Option<&str>,
        params: &Value,
        report: &mut crate::validate::LaunchReport,
    ) -> Self {
        Self::select(
            implementation,
            OffloadLimits::required(params, report),
            report,
        )
    }

    /// The mode `implementation` names, carrying whatever `limits` survived being read — the half of
    /// [`resolve`](Self::resolve) that is the same question whether or not the capability offers a
    /// `shell`, so [`check_declaration`] asks it too and an unrecognized mode is refused wherever it
    /// is written.
    fn select(
        implementation: Option<&str>,
        limits: Option<OffloadLimits>,
        report: &mut crate::validate::LaunchReport,
    ) -> Self {
        match implementation.map(str::trim) {
            Some(SHELL_OUTPUT_INLINE) => Self::Inline,
            Some(SHELL_OUTPUT_OFFLOAD) => limits.map_or(Self::LaunchRefused, Self::Offload),
            Some("") | None => Self::LaunchRefused,
            Some(unknown) => {
                report.report(
                    crate::validate::LaunchDefect::run_level(
                        crate::validate::implementation_locus(CAPABILITY_SHELL),
                        unknown,
                        format!(
                            "the `{CAPABILITY_SHELL}` capability's implementation names how \
                             much of a command's output comes back inline, and gg has no such \
                             mode"
                        ),
                    )
                    .known(SHELL_OUTPUT_MODES),
                );
                Self::LaunchRefused
            }
        }
    }

    /// The limits in force, or `None` under [`Inline`](Self::Inline), which carries none, and under
    /// [`LaunchRefused`](Self::LaunchRefused), which has no run to carry any for. Read by the tool
    /// itself, which is where a truncated command's note states them; the ceiling is a fact about
    /// one call's result rather than about the run, so nothing states it up front.
    pub fn limits(&self) -> Option<&OffloadLimits> {
        match self {
            Self::Inline | Self::LaunchRefused => None,
            Self::Offload(limits) => Some(limits),
        }
    }
}

/// How much of an offloaded command's output comes back inline, and where the whole of it is
/// written.
///
/// **Both** ceilings are always set, because a truncating mode is defined by what it truncates past
/// and an enabled shell capability writes both whichever mode it selects. The output satisfies both,
/// so the tighter one decides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OffloadLimits {
    /// The most trailing lines that come back inline.
    pub max_lines: usize,
    /// The most trailing characters that come back inline.
    pub max_chars: usize,
    /// The directory the file pair is written to — [`OFFLOAD_DIR`] for every resolved policy, and a
    /// temporary directory under test.
    pub dir: PathBuf,
}

impl OffloadLimits {
    /// Both ceilings, read out of an **enabled** shell capability's `params` and required of it.
    ///
    /// `None` says at least one of them is missing or names no count of one or more, and by the time
    /// it comes back the launch is already refused at that ceiling's own locus. A pair with a hole
    /// in it is not a pair: "offload past nothing" is the inline mode wearing another name, so there
    /// is no half-configured shape for this to return.
    fn required(params: &Value, report: &mut crate::validate::LaunchReport) -> Option<Self> {
        // Both read before either is answered, so an operator short of both hears about both.
        let max_lines = required_positive_param(params, PARAM_MAX_LINES, report);
        let max_chars = required_positive_param(params, PARAM_MAX_CHARS, report);
        Some(Self {
            max_lines: max_lines?,
            max_chars: max_chars?,
            dir: PathBuf::from(OFFLOAD_DIR),
        })
    }

    /// Both ceilings as a **disabled** shell capability happens to have written them: read on
    /// exactly the terms an enabled one's are, and required of nothing.
    fn written(params: &Value, report: &mut crate::validate::LaunchReport) -> Option<Self> {
        let max_lines = positive_param(params, PARAM_MAX_LINES, report);
        let max_chars = positive_param(params, PARAM_MAX_CHARS, report);
        Some(Self {
            max_lines: max_lines?,
            max_chars: max_chars?,
            dir: PathBuf::from(OFFLOAD_DIR),
        })
    }
}

/// One **required** ceiling: read, range-checked, and — absent — reported at its own locus, all in
/// the one call that is the only way a resolver reaches it.
///
/// `None` covers every way the launch is now refused: the key was not written, or it names no whole
/// count, or it names zero. A zero ceiling would return none of the command's output, which is not a
/// thing anybody configures on purpose.
fn required_positive_param(
    params: &Value,
    key: &str,
    report: &mut crate::validate::LaunchReport,
) -> Option<usize> {
    crate::validate::required_positive_count_param(
        params,
        CAPABILITY_SHELL,
        key,
        CEILING_CONSEQUENCE,
        report,
    )
    .map(saturating_ceiling)
}

/// One ceiling as written, or `None` when it is **absent or `null`** — the reader for a capability
/// that is owed nothing, which is the disabled one. Everything present is judged exactly as
/// [`required_positive_param`] judges it.
fn positive_param(
    params: &Value,
    key: &str,
    report: &mut crate::validate::LaunchReport,
) -> Option<usize> {
    crate::validate::positive_count_param(
        params,
        CAPABILITY_SHELL,
        key,
        CEILING_CONSEQUENCE,
        report,
    )
    .map(saturating_ceiling)
}

/// One ceiling narrowed to `usize`, saturating rather than refusing: a ceiling past `usize` is a
/// count no command's output reaches, and "all of it" is exactly what the operator asked for.
fn saturating_ceiling(count: u64) -> usize {
    usize::try_from(count).unwrap_or(usize::MAX)
}

/// The shell half of one profile's contribution to the
/// [launch pass](crate::validate::validate_launch): the [output mode](OffloadPolicy) and the two
/// inline ceilings it declares, read exactly as the run will read them.
///
/// **The switch decides which reading it gets.** An enabled capability offers a `shell` and is
/// therefore owed both ceilings, so it goes through [`OffloadPolicy::resolve`] — the same function,
/// reading the same `PARAM_*` constants, that [`shell_offload`](super::shell_offload) will call on
/// the first turn. A disabled one offers nothing and is short of nothing; what it carries is the
/// configuration the arm *would* have run at, so it is read by [`check_declaration`] and every value
/// in it is still judged.
pub fn check_launch(
    profile: &test_cabinet_core::gg::GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) {
    let Some(capability) = profile.capability(CAPABILITY_SHELL) else {
        return;
    };
    if capability.enabled {
        OffloadPolicy::resolve(
            capability.implementation.as_deref(),
            &capability.params,
            report,
        );
    } else {
        check_declaration(
            capability.implementation.as_deref(),
            &capability.params,
            report,
        );
    }
}

/// Everything a **disabled** shell capability's declaration is judged on: the mode it names, and the
/// two ceilings it writes, each read exactly as an enabled one's is.
///
/// What it is *not* judged on is absence. A capability that offers no `shell` configures nothing, so
/// there is no ceiling it could be short of — and requiring one here would refuse the very document
/// that expresses the off arm of a comparison. Everything written is still read, which is what keeps
/// the two arms of that comparison one document with one switch moved rather than two documents
/// judged differently.
fn check_declaration(
    implementation: Option<&str>,
    params: &Value,
    report: &mut crate::validate::LaunchReport,
) {
    OffloadPolicy::select(
        implementation,
        OffloadLimits::written(params, report),
        report,
    );
}

/// Runs a shell command in the workspace via `sh -c`, under an [output policy](OffloadPolicy).
pub struct ShellTool {
    /// How much of a command's output this tool returns inline, and whether it keeps the whole of it
    /// on disk.
    offload: OffloadPolicy,
}

impl ShellTool {
    /// Construct the shell tool under `offload`.
    pub fn new(offload: OffloadPolicy) -> Self {
        Self { offload }
    }
}

#[async_trait]
impl Tool for ShellTool {
    fn name(&self) -> &str {
        SHELL_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        // Only the branch in force is rendered: a model reading the schema of the tool it is about
        // to call is told what this build of gg returns, not what some other configuration would.
        // The files are named in the result, so the description says only that they exist.
        let description = match self.offload.limits() {
            None => "Run a command with `sh -c` in the workspace directory. Returns the exit code \
                     and merged stdout+stderr."
                .to_string(),
            Some(_) => "Run a command with `sh -c` in the workspace directory. Returns the exit \
                        code and the tail of merged stdout+stderr. Full stdout and stderr are \
                        written to files named in the result — `grep` them for more."
                .to_string(),
        };
        ToolDefinition::new(
            SHELL_TOOL,
            description,
            json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command line to run."
                    },
                    "timeout_secs": {
                        "type": "number",
                        "description": "Timeout in seconds (default 600)."
                    }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome {
        let command = match required_str(&args, "command") {
            Ok(command) => command,
            Err(error) => return error.into(),
        };

        let timeout = match parse_timeout(&args) {
            Ok(timeout) => timeout,
            Err(error) => return error.into(),
        };

        run_command(&command, timeout, &self.offload, ctx, GgShellOrigin::Tool).await
    }
}

/// Parse the optional `timeout_secs` argument into a [`Duration`], defaulting to
/// [`DEFAULT_TIMEOUT_SECS`]. A present-but-non-positive or non-numeric value is an
/// [invalid-argument](ToolFailure::InvalidArgument) error the model can correct.
fn parse_timeout(args: &Value) -> Result<Duration, ArgumentError> {
    match args.get("timeout_secs") {
        None | Some(Value::Null) => Ok(Duration::from_secs_f64(DEFAULT_TIMEOUT_SECS)),
        Some(value) => {
            let secs = value.as_f64().ok_or_else(|| {
                ArgumentError(format!(
                    "`{SHELL_TOOL}`: argument `timeout_secs` must be a number"
                ))
            })?;
            if !secs.is_finite() || secs <= 0.0 {
                return Err(ArgumentError(format!(
                    "`{SHELL_TOOL}`: argument `timeout_secs` must be a positive number"
                )));
            }
            Ok(Duration::from_secs_f64(secs))
        }
    }
}

/// Run `command` through the context's [shell runner](ShellRunner), enforce `timeout`, and turn
/// the result into a [`ToolOutcome`] under `offload`. `ok` is true only for a clean exit
/// (status `0`).
///
/// This is the **standard, typed** `shell` API function both call paths reach: the JSON
/// tool-calling [adapter](Tool::invoke) after it parses `command`/`timeout_secs`, and the
/// [responses-as-code membrane](crate::sandbox) directly with the command and the
/// budget-clamped timeout a program passed. Because the [output policy](OffloadPolicy) is applied
/// here rather than in either adapter, a program's `system.shell(…)` is offloaded on exactly the
/// terms a tool call is — and because the *process* is started behind
/// [`ctx.shell`](ToolContext::shell) rather than here, all three call paths — those two and gg's
/// own [hook](crate::hooks) runner, which reaches this function with the command line an operator
/// configured — go through one substitution.
///
/// `origin` says **which** of the three this is. The seam is where they meet and the caller is gone
/// by the time a command reaches a runner, so the path has to travel on the request: a
/// [recording](crate::capture::RecordingShellRunner) runner files a hook's command under its own
/// origin rather than on the agent's ordinary one, so a session record does not attribute an
/// agent-stop hook's build to a `shell` tool call — the command gg runs *without
/// the model asking*.
pub(crate) async fn run_command(
    command: &str,
    timeout: Duration,
    offload: &OffloadPolicy,
    ctx: &ToolContext,
    origin: GgShellOrigin,
) -> ToolOutcome {
    // The one place a command line becomes a process — behind the context's
    // [seam](ShellRunner), so a substituted runner answers it while everything below
    // (the output policy, gg's notes, the outcome's shape) stays this build of gg's.
    let ShellExecution {
        status,
        stdout,
        stderr,
    } = ctx
        .shell
        .run(ShellRequest {
            command: command.to_string(),
            cwd: ctx.workspace_dir.clone(),
            timeout,
            agent_id: ctx.agent_id.clone(),
            origin,
        })
        .await;

    // Nothing ran, so there is no exit code to report, no `ShellData` to attach, and no output to
    // apply a policy to: this is the one shell failure that is a failure *of the call* rather than
    // a result of it.
    if let ShellStatus::LaunchFailed { failure, message } = status {
        return ToolOutcome::failed(failure, message);
    }

    // What comes back inline, under whichever output policy is in force. Computed before the
    // terminal branches so a killed command's partial output is offloaded on the same terms a
    // completed one's is — a command that hung after printing a hundred megabytes is exactly the
    // case offloading exists for.
    let Captured {
        body,
        truncated,
        explained,
    } = capture_output(&stdout, &stderr, offload).await;

    let code = match status {
        ShellStatus::Exited { code } => code,
        ShellStatus::TimedOut => {
            let mut output = format!(
                "command timed out after {:.3}s and was killed.",
                timeout.as_secs_f64()
            );
            if !body.is_empty() {
                output.push_str("\n\n");
                output.push_str(&body);
            }
            // A gg-side ceiling killed a command that was otherwise running fine, which is a
            // different thing from the command failing — so it is classified as the limit it is,
            // and carries no `ShellData`: there is no exit code, and whatever the process had
            // printed is already in the message.
            return ToolOutcome::failed(ToolFailure::LimitExceeded, output);
        }
        ShellStatus::WaitFailed { failure, message } => {
            return ToolOutcome::failed(failure, message);
        }
        ShellStatus::LaunchFailed { .. } => unreachable!("the launch-failure branch is above"),
    };

    let ok = code == Some(0);
    let mut output = format!("exit code: {}\n", describe_exit_code(code));
    if body.is_empty() {
        output.push_str("(no output)");
    } else {
        output.push_str(&body);
    }
    // Only gg's byte cap needs a note added here: an offloaded body carries its own, inside the
    // body, so a program that prints `output` sees where the rest of it went.
    if truncated && !explained {
        output.push_str(&format!(
            "\n\n[output truncated to {MAX_OUTPUT_BYTES} bytes]"
        ));
    }

    let summary = match code {
        Some(0) => "exited 0".to_string(),
        Some(code) => format!("exited {code}"),
        None => "terminated by signal".to_string(),
    };
    ToolOutcome {
        ok,
        output,
        summary: Some(summary),
        images: Vec::new(),
        // The process ran, so its facts are reported whatever it exited with. A non-zero exit
        // leaves `ok` false (the model is told plainly that the command failed) but `failure`
        // empty: nothing about the *call* went wrong, and a caller that wants to branch on the
        // code reads it from here rather than from the first line of `output`.
        data: Some(ApiData::Shell(ShellData {
            exit_code: code,
            body,
            truncated,
        })),
        failure: None,
    }
}

/// Merge stdout and stderr into one block: stdout first, then stderr, each labeled
/// only when the other is also present so single-stream output stays clean.
fn merge_output(stdout: &str, stderr: &str) -> String {
    match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (false, false) => format!("{stdout}\n{stderr}"),
    }
}

/// Truncate `text` to at most `cap` bytes on a char boundary, reporting whether it was
/// cut. Keeps the *tail* of the output, since a command's final lines (errors, the
/// prompt that follows) are usually the most useful.
fn truncate(text: &str, cap: usize) -> (String, bool) {
    if text.len() <= cap {
        return (text.to_string(), false);
    }
    let mut start = text.len() - cap;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    (text[start..].to_string(), true)
}

// ---------------------------------------------------------------------------
// Offloading a command's output
// ---------------------------------------------------------------------------

/// What one command's output comes back as, after the [output policy](OffloadPolicy) has been
/// applied to it.
struct Captured {
    /// The text the model is shown as the command's output: the tail that fits, plus — when it was
    /// offloaded — the note naming the files the whole of it went to.
    body: String,
    /// Whether anything was dropped from the head of the output.
    truncated: bool,
    /// Whether [`body`](Self::body) already explains its own truncation. True for every offloaded
    /// body (the note is part of it, so a code program that prints the body sees the file paths);
    /// false under the inline policy, where the prose adds gg's byte-cap note around it.
    explained: bool,
}

/// The file pair one offloaded command's streams were written to.
struct OffloadPaths {
    /// Everything the command wrote to stdout.
    stdout: PathBuf,
    /// Everything it wrote to stderr.
    stderr: PathBuf,
}

/// Apply `offload` to a finished command's streams: merge them, keep whatever the policy permits
/// inline, and — under the [offload](OffloadPolicy::Offload) policy — write the whole of both
/// streams to a file pair first.
///
/// The pair is written for **every** command, not only a chatty one, because "the full output is on
/// disk" is only useful if it is true unconditionally: an agent that has to guess whether this
/// command's log exists is back to re-running the command to find out. The note that names the pair
/// is added only when something was actually dropped, so a two-line command costs no context.
async fn capture_output(stdout: &str, stderr: &str, offload: &OffloadPolicy) -> Captured {
    let merged = merge_output(stdout, stderr);
    let Some(limits) = offload.limits() else {
        let (body, truncated) = truncate(&merged, MAX_OUTPUT_BYTES);
        return Captured {
            body,
            truncated,
            explained: false,
        };
    };

    let paths = match write_offload_pair(stdout, stderr, limits).await {
        Ok(paths) => paths,
        // The files are the whole promise of this mode, and gg could not keep it. Falling back to
        // the inline policy hands over the most output still available rather than truncating to a
        // tail whose remainder now exists nowhere — and the note says plainly why the file pair the
        // model was told to expect is not there.
        Err(err) => {
            let (mut body, truncated) = truncate(&merged, MAX_OUTPUT_BYTES);
            body.push_str(&separator(&body));
            body.push_str(&format!(
                "[could not write output to {}: {err}{}]",
                limits.dir.display(),
                if truncated {
                    format!("; kept the last {MAX_OUTPUT_BYTES} bytes")
                } else {
                    String::new()
                },
            ));
            return Captured {
                body,
                truncated,
                explained: true,
            };
        }
    };

    let (tail, cut) = limits.tail(&merged);
    // gg's byte cap still applies behind the configured ceiling: a `maxLines` generous enough to
    // admit a megabyte of output would otherwise defeat the very thing offloading is for.
    let (mut body, byte_cut) = truncate(tail, MAX_OUTPUT_BYTES);
    let truncated = cut || byte_cut;
    if truncated {
        body.push_str(&separator(&body));
        body.push_str(&format!(
            "[Output truncated: {}{}]\nstdout: {}{}\nstderr: {}{}",
            limits.describe(),
            if byte_cut {
                format!(", capped at {MAX_OUTPUT_BYTES} bytes")
            } else {
                String::new()
            },
            paths.stdout.display(),
            describe_shape(stdout),
            paths.stderr.display(),
            describe_shape(stderr),
        ));
    }
    Captured {
        body,
        truncated,
        explained: true,
    }
}

/// How an exit status reads in the model-facing output: the code, or — for a process a signal ended
/// — that it was ended by one. An option rather than a sentinel `-1` all the way out, because
/// "killed" and "exited 255" are different events.
fn describe_exit_code(code: Option<i32>) -> String {
    match code {
        Some(code) => code.to_string(),
        None => "(terminated by signal)".to_string(),
    }
}

/// The shape of one offloaded file, printed beneath the path that names it in the truncation note:
/// its total line count, its 50th/95th/99th-percentile line lengths (in characters), and the length
/// and 1-based line number of its five longest lines. The tail says what happened last; the shape
/// says where the bulk sits and which lines are pathological, so a model can aim a windowed view at
/// the right region of a file it has never seen rather than paging from the top.
///
/// Percentiles are nearest-rank (the length at rank `round(p × lines)`, 1-clamped), so they are
/// always a length some line actually has. The longest-lines list is longest first, a tie going to
/// the earlier line, and lists every line when the file has fewer than five. A stream that printed
/// nothing is just `0 lines` — there is no length distribution to describe.
fn describe_shape(text: &str) -> String {
    let lengths: Vec<usize> = text.lines().map(|line| line.chars().count()).collect();
    let count = lengths.len();
    if count == 0 {
        return "\n  0 lines".to_string();
    }

    let mut sorted = lengths.clone();
    sorted.sort_unstable();
    let percentile = |p: f64| {
        let rank = ((p * count as f64).round() as usize).clamp(1, count);
        sorted[rank - 1]
    };

    let mut longest: Vec<(usize, usize)> = lengths
        .iter()
        .enumerate()
        .map(|(index, &length)| (length, index + 1))
        .collect();
    longest.sort_unstable_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    longest.truncate(5);
    let longest = longest
        .iter()
        .enumerate()
        .map(|(rank, (length, line))| {
            // "chars" once, on the first entry, names the unit for the whole list.
            if rank == 0 {
                format!("{length} chars @ {line}")
            } else {
                format!("{length} @ {line}")
            }
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "\n  {count} line{}; line length p50 {}, p95 {}, p99 {}\n  longest lines: {longest}",
        if count == 1 { "" } else { "s" },
        percentile(0.50),
        percentile(0.95),
        percentile(0.99),
    )
}

/// The blank line that separates a body from the note appended to it — nothing at all when the body
/// is empty, so a command that printed nothing does not come back as a leading blank line.
fn separator(body: &str) -> String {
    match (body.is_empty(), body.ends_with('\n')) {
        (true, _) => String::new(),
        (false, true) => "\n".to_string(),
        (false, false) => "\n\n".to_string(),
    }
}

/// Write both of a command's streams to a fresh file pair under `limits.dir`, returning where they
/// went.
///
/// Both files are always written, even for a stream that produced nothing: a missing file would
/// read as gg having lost the output rather than as the command having printed none.
async fn write_offload_pair(
    stdout: &str,
    stderr: &str,
    limits: &OffloadLimits,
) -> std::io::Result<OffloadPaths> {
    // The process id is in the name as well as the counter: two gg processes sharing a machine (a
    // developer running two runs at once) share `/tmp/gg-shell`, and the counter alone is
    // per-process.
    let sequence = OFFLOAD_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let stem = format!("cmd-{}-{sequence:04}", std::process::id());
    tokio::fs::create_dir_all(&limits.dir).await?;
    let paths = OffloadPaths {
        stdout: limits.dir.join(format!("{stem}.stdout")),
        stderr: limits.dir.join(format!("{stem}.stderr")),
    };
    tokio::fs::write(&paths.stdout, stdout).await?;
    tokio::fs::write(&paths.stderr, stderr).await?;
    Ok(paths)
}

impl OffloadLimits {
    /// The tail of `text` that satisfies **both** ceilings, and whether anything was dropped to get
    /// there. The tighter one decides, since the result has to satisfy both.
    fn tail<'a>(&self, text: &'a str) -> (&'a str, bool) {
        let start =
            line_tail_start(text, self.max_lines).max(char_tail_start(text, self.max_chars));
        (&text[start..], start > 0)
    }

    /// How the ceilings read in prose — "last 200 lines and 4000 characters" — for the tool
    /// description, the system prompt, and the truncation note.
    pub fn describe(&self) -> String {
        format!(
            "last {} lines and {} characters",
            self.max_lines, self.max_chars
        )
    }
}

/// The byte index at which the last `max_lines` lines of `text` begin, or `0` when it has no more
/// lines than that.
///
/// A trailing newline terminates the final line rather than starting a new one, so `"a\nb\n"` is two
/// lines and its last line is `"b\n"` — which is what a shell's own `tail -n` reports, and so what
/// an agent comparing the two will expect.
fn line_tail_start(text: &str, max_lines: usize) -> usize {
    let body = text.strip_suffix('\n').unwrap_or(text);
    let mut seen = 0;
    for (index, _) in body.rmatch_indices('\n') {
        seen += 1;
        if seen == max_lines {
            return index + 1;
        }
    }
    0
}

/// The byte index at which the last `max_chars` characters of `text` begin, or `0` when it has no
/// more characters than that. Counted in **characters** rather than bytes, so a ceiling means the
/// same thing whatever the output is written in.
fn char_tail_start(text: &str, max_chars: usize) -> usize {
    text.char_indices()
        .rev()
        .nth(max_chars.saturating_sub(1))
        .map_or(0, |(index, _)| index)
}

#[cfg(test)]
#[path = "shell.test.rs"]
mod tests;

#[cfg(test)]
#[path = "shell.offload.test.rs"]
mod offload_tests;
