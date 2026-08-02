//! The **recorded shell seam**: the runner a playback installs so that no command line a
//! reconstruction reaches ever becomes a process.
//!
//! This is the second of the two seams, and the one that carries ~all of a run's wall clock. It
//! starts nothing, ever — not on a miss, not on a mismatch, not for an unattributed call. A
//! reconstruction that ran a real `npm install` against a scratch tree while claiming to replay a
//! session would be worse than no reconstruction at all, so the runner has no path to a process to
//! take by accident.
//!
//! # Position is the key; content is the check
//!
//! A run runs `npm run build` five times and gets five different answers, so the command text is not
//! an identity — the order is. The head of the agent's recorded queue answers, and the command line
//! and the directory are compared against it and reported when they differ. A directory mismatch on
//! an otherwise-identical command is a real difference, never silently accepted: the same command in
//! a different tree is a different command.
//!
//! The recorded directory is stored as a [`GgShellCwd`] — a *relationship* to the workspace rather
//! than an absolute path — precisely so this comparison is possible at all: a playback builds in a
//! deliberately different, empty directory, and a recorded `/work/impl/web` would otherwise fail to
//! match on every command of every record.
//!
//! # What this milestone's runner does **not** do
//!
//! Two things, both named here because a silent partial implementation of a safety seam is the
//! worst shape it could take:
//!
//! - **Only the head match.** The design's lookup ladder continues past it — out-of-order within
//!   one agent, then across agents, each consuming what it stepped over and reporting it. Those
//!   steps are the multi-agent milestone's, and under the ordering barrier (also that milestone's)
//!   the head match is essentially always the one that fires anyway.
//! - **The queue is keyed by the live agent id.** Exact for the root — and for every agent whose id
//!   a reconstruction reproduces — but a subagent's id comes off a global counter, so the general
//!   mapping is the binding table the multi-agent milestone owns. Until then an id the record does
//!   not know is a reported [miss](DriftKind::CommandNotRecorded), not a guess.
//!
//! # The capture gap this seam is currently reading around
//!
//! Only the completion gate's validation commands are recorded as
//! [`Shell`](test_cabinet_core::gg_replay::GgReplayEntryKind::Shell) entries today. The `shell`
//! **tool**'s commands and a responses-as-code program's `system.shell(…)` reach
//! `sh -c` through this same seam but call no recorder — `GgShellOrigin::Tool` and
//! `GgShellOrigin::Program` are constructed nowhere in the crate — so a recorded session that used
//! the shell tool has no answer here and every such command is reported as a miss. Closing that is a
//! **capture** change (recording at the seam, with the origin on the request) and is a prerequisite
//! for the multi-agent milestone's recorded shell.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use test_cabinet_core::gg_replay::GgShellCwd;

use super::drift::{Drift, DriftKind, DriftLedger};
use crate::replay::shell_cwd;
use crate::replay_inputs::ReplayInputs;
use crate::tools::{ShellExecution, ShellRequest, ShellRunner, ShellStatus, ToolFailure};

/// The `ShellRunner` a playback installs: every command line is answered from the record, and
/// none is run.
#[derive(Debug)]
pub struct RecordedShellRunner {
    /// The record, transposed per agent — where the answers come from.
    inputs: Arc<ReplayInputs>,
    /// Where every miss and mismatch is written down.
    ledger: Arc<DriftLedger>,
    /// The playback's workspace root, for relativizing a live directory into the
    /// [portable form](GgShellCwd) the record stores.
    workspace: PathBuf,
}

impl RecordedShellRunner {
    /// A runner answering from `inputs`, reporting into `ledger`, with live directories measured
    /// against `workspace`.
    pub fn new(inputs: Arc<ReplayInputs>, ledger: Arc<DriftLedger>, workspace: PathBuf) -> Self {
        Self {
            inputs,
            ledger,
            workspace,
        }
    }

    /// The execution a command with no recorded answer gets: a classified failure that says so, and
    /// no process.
    ///
    /// A [`LaunchFailed`](ShellStatus::LaunchFailed) rather than a non-zero exit, because those are
    /// different facts and the model is told them differently: an exit code is something the
    /// command *did*, and this command did nothing. `Unavailable` is the classification — the tool
    /// exists and the call was well-formed; what is missing is gg's ability to answer it here.
    fn unanswered(&self, agent_id: &str, detail: String) -> ShellExecution {
        self.ledger.record(Drift::reported(
            DriftKind::CommandNotRecorded,
            agent_id,
            detail.clone(),
        ));
        ShellExecution {
            status: ShellStatus::LaunchFailed {
                failure: ToolFailure::Unavailable,
                message: format!("playback: {detail}"),
            },
            stdout: String::new(),
            stderr: String::new(),
        }
    }
}

#[async_trait]
impl ShellRunner for RecordedShellRunner {
    async fn run(&self, request: ShellRequest) -> ShellExecution {
        // A call that names no agent has no queue to draw from, and guessing one would be the
        // mis-attribution the whole per-agent keying exists to prevent. It is possible only through
        // a bare `ToolContext::new`, which no live loop path builds — but the constructor exists,
        // so the answer is written down rather than left to whichever call site takes it first.
        if request.agent_id.is_empty() {
            return self.unanswered(
                "",
                format!(
                    "the command `{}` reached the shell seam with no agent behind it, so there is \
                     no recorded queue it could come from",
                    request.command
                ),
            );
        }
        if !self
            .inputs
            .agent_ids()
            .iter()
            .any(|agent_id| agent_id == &request.agent_id)
        {
            return self.unanswered(
                &request.agent_id,
                format!(
                    "the command `{}` was issued by an agent the record does not know, so it has \
                     no recorded commands",
                    request.command
                ),
            );
        }

        let recorded = match self.inputs.next_shell(&request.agent_id) {
            Ok(recorded) => recorded,
            Err(err) => {
                return self.unanswered(
                    &request.agent_id,
                    format!(
                        "the command `{}` has no recorded answer ({err}). Only a completion gate's \
                         validation commands are captured today, so a `shell` tool call reaches \
                         this every time.",
                        request.command
                    ),
                );
            }
        };

        // Position was the key; this is the check. Both halves are reported together, because
        // "a different command" and "the same command somewhere else" are the same class of
        // finding and a report that split them would make a reader chase two lists.
        let cwd = shell_cwd(&self.workspace, &request.cwd);
        if recorded.command != request.command || recorded.cwd != cwd {
            self.ledger.record(Drift::reported(
                DriftKind::CommandMismatch,
                &request.agent_id,
                format!(
                    "the recorded command at this position (seq {}) is `{}` in {}, and this build \
                     ran `{}` in {}",
                    recorded.seq,
                    recorded.command,
                    describe_cwd(&recorded.cwd),
                    request.command,
                    describe_cwd(&cwd),
                ),
            ));
        }

        ShellExecution {
            // The record stores a plain exit code (a signalled process is recorded as `-1`), so
            // every recorded command comes back as one that *ran*. That is the honest shape: gg's
            // own timeout kill and a failed `wait` are properties of running a process, and this
            // runner ran none.
            status: ShellStatus::Exited {
                code: Some(recorded.exit_code),
            },
            stdout: recorded.stdout,
            stderr: recorded.stderr,
        }
    }
}

/// How a [recorded directory](GgShellCwd) reads in a mismatch a human has to act on.
fn describe_cwd(cwd: &GgShellCwd) -> String {
    match cwd {
        GgShellCwd::Workspace => "the workspace root".to_string(),
        GgShellCwd::Relative { path } => format!("`{path}` (workspace-relative)"),
        GgShellCwd::Absolute { path } => format!("`{path}` (absolute)"),
    }
}

#[cfg(test)]
#[path = "shell.test.rs"]
mod tests;
