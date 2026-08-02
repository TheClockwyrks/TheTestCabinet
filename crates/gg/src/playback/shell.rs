//! The **recorded shell seam**: the runner a playback installs so that no command line a
//! reconstruction reaches ever becomes a process.
//!
//! This is the second of the two seams, and the one that carries ~all of a run's wall clock. It
//! starts nothing — not on a miss, not on a mismatch, not for an unattributed call — unless the
//! operator explicitly asked for it with [`MissPolicy::Execute`]. A reconstruction that ran a real
//! `npm install` against a scratch tree while claiming to replay a session would be worse than no
//! reconstruction at all, so there is no path to a process that can be taken by accident.
//!
//! # Position is the key; content is the check
//!
//! A run runs `npm run build` five times and gets five different answers, so the command text is
//! not an identity — the order is. Keying on a hash of command plus prior state would need the
//! state, which is the thing being reconstructed. So the head of the agent's recorded queue is
//! tried first, and the pair (command, directory) is what decides whether it is the right answer.
//!
//! The recorded directory is stored as a [`GgShellCwd`] — a *relationship* to the workspace rather
//! than an absolute path — precisely so this comparison is possible at all: a playback builds in a
//! deliberately different, empty directory, and a recorded `/work/impl/web` would otherwise fail to
//! match on every command of every record.
//!
//! # The lookup ladder
//!
//! Four rungs, in order, each reported so a reader knows which one answered:
//!
//! 1. **Head match** — the head of the agent's queue is the command, in the same directory. The
//!    overwhelmingly common case, and under the [ordering barrier](ReplayInputs::await_turn) it is
//!    essentially always this one.
//! 2. **Out-of-order, same agent** — the pair occurs later in the agent's own queue. What was
//!    stepped over is consumed and reported, which covers the benign case where gg's own machinery
//!    stopped issuing a command. Consuming rather than leaving it matters twice: a skipped entry
//!    left in the queue would answer some *later* command by accident, and it would block the
//!    barrier behind an entry nobody will ever take.
//! 3. **Cross-agent** — the pair occurs in another agent's remaining commands. The safety net for
//!    an imperfect [agent binding](super::binding), and reporting it is what makes the binding
//!    auditable rather than merely lucky.
//! 4. **Miss** — nothing anywhere matches. What happens then is the [`MissPolicy`], and its default
//!    starts no process.
//!
//! A directory mismatch on an otherwise-identical command falls to rung 2 or 3 and is reported,
//! never silently accepted: the same command in a different tree is a different command.
//!
//! # What a served command cannot give back
//!
//! A [standard](test_cabinet_core::gg_replay::GgReplayFidelity::Standard) capture clips an
//! over-long stream, and unlike a re-executed [tool](super::binding) there is no live payload to
//! prefer instead — the command did not run. So a clipped stream is served as the tail it is and
//! reported as a [`ClippedRecord`](DriftKind::ClippedRecord), because the conversation drift it
//! causes a turn or two later is otherwise inexplicable. Its answer is to re-record at full
//! fidelity.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use test_cabinet_core::gg_replay::GgShellCwd;

use super::binding::AgentBindings;
use super::drift::{Drift, DriftKind, DriftLedger, DriftVerdict};
use crate::replay::shell_cwd;
use crate::replay_inputs::{ReplayInputs, ShellLookup};
use crate::tools::{ShellExecution, ShellRequest, ShellRunner, ShellStatus, ToolFailure};

/// What a [playback](super) does with a command line the record has no answer for anywhere.
///
/// The default starts no process, and the one setting that does is not reachable without saying so:
/// the whole value of a playback is that it costs nothing and touches nothing, and a mode that
/// quietly ran an unrecognized `rm -rf build && npm ci` against the reconstruction's tree would
/// give that up for the convenience of not having to pass a flag.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MissPolicy {
    /// Answer with a classified failure whose text says the command was not recorded, report the
    /// miss, and carry on. The default.
    ///
    /// Reported rather than fatal even though the command's output is genuinely unknown, because
    /// the *model's* next answer still comes from the record and the fingerprint check on the very
    /// next turn is what actually settles whether the session diverged. Stopping here instead would
    /// throw away a reconstruction that is about to say something much more precise.
    #[default]
    Synthesize,
    /// Treat the miss as fatal: the agent ends on it and the report carries it as what
    /// [stopped](super::PlaybackReport::stopped_on) the reconstruction.
    ///
    /// For a caller that would rather have nothing than a session in which a build's output was
    /// invented.
    Stop,
    /// **Actually run the command**, for real, in the reconstruction's workspace — and report that
    /// it did.
    ///
    /// The escape hatch for reconstructing a session recorded before the shell seam captured every
    /// path, where the alternative is a reconstruction whose every command is a miss. It is never
    /// the default and never inferred: a front end has to ask for it by name.
    Execute,
}

/// The `ShellRunner` a playback installs: every command line is answered from the record, and
/// none is run unless the [miss policy](MissPolicy) explicitly says so.
#[derive(Debug)]
pub struct RecordedShellRunner {
    /// The record, transposed per agent — where the answers come from.
    inputs: Arc<ReplayInputs>,
    /// Live agent id → recorded agent id. The queues are keyed by the **recorded** id, and a
    /// reconstruction assigns live ones off its own counter.
    bindings: Arc<AgentBindings>,
    /// Where every miss, mismatch and out-of-order hit is written down.
    ledger: Arc<DriftLedger>,
    /// The playback's workspace root, for relativizing a live directory into the
    /// [portable form](GgShellCwd) the record stores.
    workspace: PathBuf,
    /// What to do with a command the record has no answer for.
    miss: MissPolicy,
    /// The runner an [`Execute`](MissPolicy::Execute) miss falls through to. `None` under every
    /// other policy, so the ability to start a process does not merely go unused — it is absent.
    fallback: Option<Arc<dyn ShellRunner>>,
}

impl RecordedShellRunner {
    /// A runner answering from `inputs`, binding through `bindings`, reporting into `ledger`, with
    /// live directories measured against `workspace`. Misses are
    /// [synthesized](MissPolicy::Synthesize).
    pub fn new(
        inputs: Arc<ReplayInputs>,
        bindings: Arc<AgentBindings>,
        ledger: Arc<DriftLedger>,
        workspace: PathBuf,
    ) -> Self {
        Self {
            inputs,
            bindings,
            ledger,
            workspace,
            miss: MissPolicy::Synthesize,
            fallback: None,
        }
    }

    /// The same runner under `miss`.
    ///
    /// [`Execute`](MissPolicy::Execute) is the only setting that gives this runner a way to start a
    /// process, and it is given one *here* rather than held unconditionally: under every other
    /// policy the field is `None`, so a future code path that reached for a fallback would find
    /// nothing to reach for.
    #[must_use]
    pub fn miss_policy(mut self, miss: MissPolicy, real: Arc<dyn ShellRunner>) -> Self {
        self.fallback = matches!(miss, MissPolicy::Execute).then_some(real);
        self.miss = miss;
        self
    }

    /// The execution a command with no recorded answer gets under the default policy: a classified
    /// failure that says so, and no process.
    ///
    /// A [`LaunchFailed`](ShellStatus::LaunchFailed) rather than a non-zero exit, because those are
    /// different facts and the model is told them differently: an exit code is something the
    /// command *did*, and this command did nothing. `Unavailable` is the classification — the tool
    /// exists and the call was well-formed; what is missing is gg's ability to answer it here.
    fn unanswered(&self, agent_id: &str, detail: String, verdict: DriftVerdict) -> ShellExecution {
        self.ledger.record(
            Drift::reported(DriftKind::CommandNotRecorded, agent_id, detail.clone())
                .with_verdict(verdict),
        );
        ShellExecution {
            status: ShellStatus::LaunchFailed {
                failure: ToolFailure::Unavailable,
                message: format!("playback: {detail}"),
            },
            stdout: String::new(),
            stderr: String::new(),
        }
    }

    /// Turn a recorded command into the execution the caller gets, reporting any stream the record
    /// could only carry a tail of.
    fn serve(
        &self,
        agent_id: &str,
        recorded: crate::replay_inputs::RecordedSubprocess,
    ) -> ShellExecution {
        for (stream, clip) in [
            ("stdout", &recorded.stdout_clip),
            ("stderr", &recorded.stderr_clip),
        ] {
            if let Some(clip) = clip {
                self.ledger.record(Drift::reported(
                    DriftKind::ClippedRecord,
                    agent_id,
                    format!(
                        "the recorded `{}` (seq {}) printed {} byte(s) on {stream} and the record \
                         holds only the last of them, so this reconstruction fed a tail of it \
                         forward. Re-record at full fidelity to close the gap.",
                        recorded.command, recorded.seq, clip.original_bytes,
                    ),
                ));
            }
        }
        ShellExecution {
            // The record stores a plain exit code (a signalled process, a timeout kill and a launch
            // failure are all recorded as `-1`), so every recorded command comes back as one that
            // *ran*. That is the honest shape: gg's own timeout kill and a failed `wait` are
            // properties of running a process, and this runner ran none.
            status: ShellStatus::Exited {
                code: Some(recorded.exit_code),
            },
            stdout: recorded.stdout,
            stderr: recorded.stderr,
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
                DriftVerdict::Reported,
            );
        }
        // Live id → recorded id. An agent the binding table could not place has already had its
        // failure reported once, at its creation, and its client is unbound — so this says only
        // what it can: there is no queue.
        let Some(agent_id) = self.bindings.recorded_for_live(&request.agent_id) else {
            return self.unanswered(
                &request.agent_id,
                format!(
                    "the command `{}` was issued by an agent this reconstruction could not bind to \
                     the record, so it has no recorded commands",
                    request.command
                ),
                DriftVerdict::Reported,
            );
        };

        // **The ordering barrier**, for the same reason the model seam waits at one: a command
        // served ahead of its turn is a run-global state change (a build that a *different* agent's
        // next pinned block reports on) landing at a moment the run never saw. A deadlock is fatal
        // — there is no order in which this command can be answered truthfully.
        if let Err(err) = self.inputs.await_turn(&agent_id).await {
            return self.unanswered(
                &agent_id,
                format!(
                    "the command `{}` cannot be answered in the order the run consumed its inputs \
                     ({err})",
                    request.command
                ),
                DriftVerdict::Fatal,
            );
        }

        let cwd = shell_cwd(&self.workspace, &request.cwd);
        match self.inputs.take_shell(&agent_id, &request.command, &cwd) {
            ShellLookup::Head(recorded) => self.serve(&agent_id, recorded),
            ShellLookup::OutOfOrder { found, skipped } => {
                self.ledger.record(Drift::reported(
                    DriftKind::CommandOutOfOrder,
                    &agent_id,
                    format!(
                        "`{}` in {} is recorded at seq {}, and this build reached it having \
                         skipped {} recorded command(s) it no longer runs (first: `{}`)",
                        request.command,
                        describe_cwd(&cwd),
                        found.seq,
                        skipped.len(),
                        skipped
                            .first()
                            .map(|run| run.command.as_str())
                            .unwrap_or_default(),
                    ),
                ));
                self.serve(&agent_id, found)
            }
            ShellLookup::CrossAgent {
                found,
                agent_id: owner,
            } => {
                self.ledger.record(Drift::reported(
                    DriftKind::CommandOutOfOrder,
                    &agent_id,
                    format!(
                        "`{}` in {} was answered from agent `{owner}`'s recorded queue (seq {}) — \
                         this reconstruction and the record disagree about which agent ran it, so \
                         the agent binding is worth checking",
                        request.command,
                        describe_cwd(&cwd),
                        found.seq,
                    ),
                ));
                self.serve(&agent_id, found)
            }
            ShellLookup::Miss { head } => {
                let detail = format!(
                    "the command `{}` in {} has no recorded answer{}",
                    request.command,
                    describe_cwd(&cwd),
                    match &head {
                        Some(head) => format!(
                            "; the record's next command for this agent is `{}` in {} (seq {})",
                            head.command,
                            describe_cwd(&head.cwd),
                            head.seq,
                        ),
                        None => ", and the agent has no recorded commands left".to_string(),
                    },
                );
                match (self.miss, &self.fallback) {
                    (MissPolicy::Synthesize, _) => {
                        self.unanswered(&agent_id, detail, DriftVerdict::Reported)
                    }
                    (MissPolicy::Stop, _) => {
                        self.unanswered(&agent_id, detail, DriftVerdict::Fatal)
                    }
                    (MissPolicy::Execute, Some(real)) => {
                        self.ledger.record(Drift::reported(
                            DriftKind::CommandNotRecorded,
                            &agent_id,
                            format!(
                                "{detail}. `--execute-unrecorded` was set, so it was **run for \
                                 real** in the playback workspace and its output is this \
                                 machine's rather than the run's."
                            ),
                        ));
                        real.run(request).await
                    }
                    // Unreachable by construction — `miss_policy` is the only way to set
                    // `Execute` and it is the only thing that supplies a fallback — but the
                    // alternative to answering it is starting a process this runner was never
                    // given, so it answers as the default rather than panicking.
                    (MissPolicy::Execute, None) => {
                        self.unanswered(&agent_id, detail, DriftVerdict::Reported)
                    }
                }
            }
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
