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
//! Under [adaptive](OffloadPolicy::Adaptive) — the default — offloading applies only to the commands
//! whose output an agent actually reads: a command that **succeeded** comes back as its exit code
//! and the paths its output went to, and one that **failed** comes back exactly as it would under
//! offloading.
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
use test_cabinet_core::gg::{SHELL_OUTPUT_ADAPTIVE, SHELL_OUTPUT_INLINE, SHELL_OUTPUT_OFFLOAD};
use test_cabinet_core::gg_session_record::GgShellOrigin;

use super::{
    ArgumentError, ShellData, Tool, ToolContext, ToolData, ToolFailure, ToolOutcome, required_str,
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
/// Default per-command timeout (seconds) when a call does not specify one.
const DEFAULT_TIMEOUT_SECS: f64 = 120.0;
/// Ceiling on the captured output handed back to the model, in bytes. Output beyond
/// this is dropped with a truncation note so a noisy command cannot flood context.
/// Applied under both [policies](OffloadPolicy) — under
/// [offload](OffloadPolicy::Offload) it is the backstop behind a line/character ceiling
/// generous enough to still exceed it.
const MAX_OUTPUT_BYTES: usize = 16 * 1024;

/// The shell capability's `maxLines` param: how many trailing **lines** of a command's output come
/// back inline under [offloading](SHELL_OUTPUT_OFFLOAD) — and, for a failed command, under
/// [adaptive](SHELL_OUTPUT_ADAPTIVE).
pub const PARAM_MAX_LINES: &str = "maxLines";

/// The shell capability's `maxChars` param: how many trailing **characters** of a command's output
/// come back inline under [offloading](SHELL_OUTPUT_OFFLOAD) — and, for a failed command, under
/// [adaptive](SHELL_OUTPUT_ADAPTIVE).
pub const PARAM_MAX_CHARS: &str = "maxChars";

/// The [line ceiling](PARAM_MAX_LINES) applied when a truncating mode names **neither** ceiling.
///
/// The truncating modes are defined by the ceiling they truncate past, so "offload with no ceiling"
/// is not a mode — it is a config that forgot to finish the sentence. Rather than quietly running
/// the control arm under the treatment arm's name, an unspecified ceiling takes this default, which
/// is also what the console pre-fills the two inputs with.
pub const DEFAULT_MAX_LINES: usize = 250;

/// The [character ceiling](PARAM_MAX_CHARS) applied when a truncating mode names **neither**
/// ceiling. See [`DEFAULT_MAX_LINES`].
pub const DEFAULT_MAX_CHARS: usize = 4096;

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
    /// Offloading, decided per command by whether it worked: a command that **failed** comes back
    /// exactly as it would under [`Offload`](Self::Offload), and a command that **succeeded** comes
    /// back as its exit code alone, with a note naming the file pair its output went to.
    ///
    /// The default. A successful command's output is the bulk of what a run's shell calls produce
    /// and the part an agent least often reads — `cargo build` printing forty lines of `Compiling`
    /// says nothing that the exit code did not. A failed one is the opposite: it is read closely, and
    /// the tail is where the error is.
    Adaptive(OffloadLimits),
}

impl Default for OffloadPolicy {
    fn default() -> Self {
        Self::Adaptive(OffloadLimits::default())
    }
}

impl OffloadPolicy {
    /// Resolve the policy from the shell capability's `implementation` and `params`.
    ///
    /// An absent implementation resolves to [`Adaptive`](Self::Adaptive), the default — as does an
    /// unrecognized one, which is a misconfiguration rather than an instruction and so falls back to
    /// the same mode a config that said nothing would have got. `inline` and `offload` are the two
    /// explicit alternatives.
    /// This policy under an explicit `mode` — one of [`SHELL_OUTPUT_MODES`](test_cabinet_core::gg::SHELL_OUTPUT_MODES) — keeping whatever
    /// [limits](OffloadLimits) `fallback` carries.
    ///
    /// What a [hook](crate::hooks) reads its own `output` override through. The limits come from
    /// the agent rather than from the hook because they are a property of the *window* the output
    /// lands in, not of the command that produced it: an operator overriding the mode is saying
    /// "keep this one inline", not "and size it differently from everything else".
    pub fn for_mode(mode: &str, fallback: &Self) -> Self {
        let limits = fallback.offload_limits().cloned().unwrap_or_default();
        match mode.trim() {
            SHELL_OUTPUT_INLINE => Self::Inline,
            SHELL_OUTPUT_OFFLOAD => Self::Offload(limits),
            _ => Self::Adaptive(limits),
        }
    }

    /// The [limits](OffloadLimits) this policy carries, or `None` under
    /// [`Inline`](Self::Inline), which has none to carry.
    fn offload_limits(&self) -> Option<&OffloadLimits> {
        match self {
            Self::Inline => None,
            Self::Offload(limits) | Self::Adaptive(limits) => Some(limits),
        }
    }

    pub fn resolve(implementation: Option<&str>, params: &Value) -> Self {
        match implementation.map(str::trim) {
            Some(SHELL_OUTPUT_INLINE) => Self::Inline,
            Some(SHELL_OUTPUT_OFFLOAD) => Self::Offload(OffloadLimits::from_params(params)),
            Some(SHELL_OUTPUT_ADAPTIVE) | Some(_) | None => {
                Self::Adaptive(OffloadLimits::from_params(params))
            }
        }
    }

    /// The limits in force, or `None` under [`Inline`](Self::Inline). Read by the tool itself and by
    /// the [system prompt](crate::prompts), which states them up front so the model is not left to
    /// discover the ceiling one truncated command at a time.
    pub fn limits(&self) -> Option<&OffloadLimits> {
        match self {
            Self::Inline => None,
            Self::Offload(limits) | Self::Adaptive(limits) => Some(limits),
        }
    }

    /// Whether a **successful** command's output is withheld entirely — true only under
    /// [`Adaptive`](Self::Adaptive).
    pub fn withholds_on_success(&self) -> bool {
        matches!(self, Self::Adaptive(_))
    }
}

/// How much of an offloaded command's output comes back inline, and where the whole of it is
/// written. At least one of the two ceilings is always set — a config that names neither takes the
/// [defaults](DEFAULT_MAX_LINES) — and when both are, the output satisfies **both**.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OffloadLimits {
    /// The most trailing lines that come back inline, or `None` for no line ceiling.
    pub max_lines: Option<usize>,
    /// The most trailing characters that come back inline, or `None` for no character ceiling.
    pub max_chars: Option<usize>,
    /// The directory the file pair is written to — [`OFFLOAD_DIR`] for every resolved policy, and a
    /// temporary directory under test.
    pub dir: PathBuf,
}

impl Default for OffloadLimits {
    fn default() -> Self {
        Self {
            max_lines: Some(DEFAULT_MAX_LINES),
            max_chars: Some(DEFAULT_MAX_CHARS),
            dir: PathBuf::from(OFFLOAD_DIR),
        }
    }
}

impl OffloadLimits {
    /// Read both ceilings out of the shell capability's `params`.
    ///
    /// Either one alone is a complete instruction — "the last 200 lines, however long they are" is a
    /// thing to ask for — so a config that names one and omits the other gets exactly that, with no
    /// ceiling on the axis it left out. Only a config that names **neither** takes the
    /// [defaults](DEFAULT_MAX_LINES), since a truncating mode with nothing to truncate past would
    /// silently be the inline mode wearing another name.
    fn from_params(params: &Value) -> Self {
        let max_lines = positive_param(params, PARAM_MAX_LINES);
        let max_chars = positive_param(params, PARAM_MAX_CHARS);
        match (max_lines, max_chars) {
            (None, None) => Self::default(),
            _ => Self {
                max_lines,
                max_chars,
                dir: PathBuf::from(OFFLOAD_DIR),
            },
        }
    }
}

/// One `params` entry read as a positive count, or `None` when it is absent, non-numeric, or zero
/// (a zero ceiling would return no output at all, which is not a thing anybody configures on
/// purpose).
fn positive_param(params: &Value, key: &str) -> Option<usize> {
    params
        .get(key)
        .and_then(Value::as_u64)
        .filter(|&n| n > 0)
        .map(|n| usize::try_from(n).unwrap_or(usize::MAX))
}

/// Runs a shell command in the workspace via `sh -c`, under an [output policy](OffloadPolicy).
#[derive(Default)]
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
        let mut description =
            "Run a shell command with `sh -c` in the workspace directory. Returns the merged \
             stdout+stderr (truncated if very long) and the exit code. Use it to build, run, and \
             inspect the project."
                .to_string();
        if let Some(limits) = self.offload.limits() {
            // The ceiling is stated on the tool itself as well as in the system prompt: a model
            // reading the definition of the tool it is about to call should not have to remember a
            // paragraph from the top of the session to know that what comes back is a tail.
            if self.offload.withholds_on_success() {
                description.push_str(&format!(
                    " A command that succeeds returns only its exit code — none of its output. A \
                     command that fails returns the {} of its output. Either way the full stdout \
                     and stderr of every command are written to a file pair under `{}`, named in \
                     the result, which you can `grep` when you need more than what came back.",
                    limits.describe(),
                    limits.dir.display(),
                ));
            } else {
                description.push_str(&format!(
                    " Only the {} of the output is returned; the full stdout and stderr of every \
                     command are written to a file pair under `{}`, named in the result, which you \
                     can `grep` when you need more than the tail.",
                    limits.describe(),
                    limits.dir.display(),
                ));
            }
        }
        ToolDefinition::new(
            SHELL_TOOL,
            description,
            json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command line to run via `sh -c`."
                    },
                    "timeout_secs": {
                        "type": "number",
                        "description": "Optional per-command timeout in seconds \
                            (default 120). The command is killed if it exceeds this."
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

    // What the command exited with, or `None` when it never got that far — a timeout kill and a
    // failed `wait()` both count as "did not succeed": in either case the agent is about to be told
    // something went wrong, and the output is the part that says what. Read here, ahead of the
    // terminal branches below, because the output policy needs it: a withheld body reports the exit
    // code, since the exit code is the only thing it reports.
    let exit_code = match &status {
        ShellStatus::Exited { code } => *code,
        _ => None,
    };
    // What comes back inline, under whichever output policy is in force. Computed before the
    // terminal branches so a killed command's partial output is offloaded on the same terms a
    // completed one's is — a command that hung after printing a hundred megabytes is exactly the
    // case offloading exists for.
    let Captured {
        body,
        truncated,
        explained,
        withheld,
    } = capture_output(&stdout, &stderr, offload, exit_code).await;

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
    // A withheld body opens with the exit code itself — it has to, because it is handed to a
    // [responses-as-code](crate::sandbox) program without this header around it — so adding the
    // header here would print the same fact twice.
    let mut output = if withheld {
        String::new()
    } else {
        format!("exit code: {}\n", describe_exit_code(code))
    };
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
        data: Some(ToolData::Shell(ShellData {
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
    /// Whether [`body`](Self::body) is the withheld-output note rather than any of the command's
    /// own output — which also means it states the exit code itself, so the caller does not head it
    /// with one.
    withheld: bool,
}

/// The file pair one offloaded command's streams were written to.
struct OffloadPaths {
    /// Everything the command wrote to stdout.
    stdout: PathBuf,
    /// Everything it wrote to stderr.
    stderr: PathBuf,
}

/// Apply `offload` to a finished command's streams: merge them, keep whatever the policy permits
/// inline, and — under a [truncating](OffloadPolicy::Offload) policy — write the whole of both
/// streams to a file pair first. `exit_code` is what the command exited with — `None` when it never
/// got a status — which decides both whether the [adaptive](OffloadPolicy::Adaptive) policy withholds
/// the output and what the withheld body reports in its place.
///
/// The pair is written for **every** command, not only a chatty one, because "the full output is on
/// disk" is only useful if it is true unconditionally: an agent that has to guess whether this
/// command's log exists is back to re-running the command to find out. The note that names the pair
/// is added only when something was actually dropped, so a two-line command costs no context.
async fn capture_output(
    stdout: &str,
    stderr: &str,
    offload: &OffloadPolicy,
    exit_code: Option<i32>,
) -> Captured {
    let merged = merge_output(stdout, stderr);
    let Some(limits) = offload.limits() else {
        let (body, truncated) = truncate(&merged, MAX_OUTPUT_BYTES);
        return Captured {
            body,
            truncated,
            explained: false,
            withheld: false,
        };
    };
    // Under the adaptive policy a command that worked is reported by its exit code alone. A command
    // that printed nothing is left as the empty body the caller renders as "(no output)": there is
    // nothing on disk worth pointing at, and the note would be the only thing the agent read.
    let withhold = exit_code == Some(0) && offload.withholds_on_success();
    if withhold && merged.is_empty() {
        return Captured {
            body: String::new(),
            truncated: false,
            explained: false,
            withheld: false,
        };
    }

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
                withheld: false,
            };
        }
    };

    if withhold {
        // "Only the exit code" as far as the command's own output goes — but the paths come with it.
        // Withholding output the agent has no way to ask for again would not be offloading, it would
        // be discarding, and the agent would be left re-running the command to see what it printed.
        //
        // Three lines of facts, and no sentence explaining them: the model is told what the file
        // pair is in the tool's own description and in the system prompt, and repeating it in the
        // result of every successful command spends context on a thing it has already read.
        return Captured {
            body: format!(
                "Exit code: {}\nstdout: {}\nstderr: {}",
                describe_exit_code(exit_code),
                paths.stdout.display(),
                paths.stderr.display(),
            ),
            truncated: true,
            explained: true,
            withheld: true,
        };
    }

    let (tail, cut) = limits.tail(&merged);
    // gg's byte cap still applies behind the configured ceiling: a `maxLines` generous enough to
    // admit a megabyte of output would otherwise defeat the very thing offloading is for.
    let (mut body, byte_cut) = truncate(tail, MAX_OUTPUT_BYTES);
    let truncated = cut || byte_cut;
    if truncated {
        body.push_str(&separator(&body));
        body.push_str(&format!(
            "[Output truncated: {}{}]\nstdout: {}\nstderr: {}",
            limits.describe(),
            if byte_cut {
                format!(", capped at {MAX_OUTPUT_BYTES} bytes")
            } else {
                String::new()
            },
            paths.stdout.display(),
            paths.stderr.display(),
        ));
    }
    Captured {
        body,
        truncated,
        explained: true,
        withheld: false,
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
    /// The tail of `text` that satisfies **every** configured ceiling, and whether anything was
    /// dropped to get there. With both ceilings set the tighter one decides, since the result has to
    /// satisfy both.
    fn tail<'a>(&self, text: &'a str) -> (&'a str, bool) {
        let start = [
            self.max_lines.map(|lines| line_tail_start(text, lines)),
            self.max_chars.map(|chars| char_tail_start(text, chars)),
        ]
        .into_iter()
        .flatten()
        .max()
        .unwrap_or(0);
        (&text[start..], start > 0)
    }

    /// How the ceilings read in prose — "last 200 lines", "last 4000 characters", or both — for the
    /// tool description, the system prompt, and the truncation note.
    pub fn describe(&self) -> String {
        match (self.max_lines, self.max_chars) {
            (Some(lines), Some(chars)) => {
                format!("last {lines} lines and {chars} characters")
            }
            (Some(lines), None) => format!("last {lines} lines"),
            (None, Some(chars)) => format!("last {chars} characters"),
            // Unreachable: a policy that resolved neither ceiling is `Inline` and has no limits.
            (None, None) => "whole".to_string(),
        }
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
