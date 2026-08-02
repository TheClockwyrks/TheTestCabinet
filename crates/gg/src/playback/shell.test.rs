//! The recorded shell seam: the lookup ladder, the miss policy, and the invariant underneath all
//! of it.
//!
//! Every test here asserts the same underlying thing from a different direction: **no command line
//! becomes a process** unless [`MissPolicy::Execute`] was asked for by name. The commands are
//! deliberately ones whose real execution would be visible — writing a file into the workspace — so
//! a runner that ever shelled out fails an assertion rather than passing quietly.

use std::path::Path;
use std::time::Duration;

use tempfile::TempDir;
use test_cabinet_core::gg::GgCapabilitySet;
use test_cabinet_core::gg_replay::{
    GgReplayAgent, GgReplayAgentOrigin, GgReplayCommand, GgReplayEntry, GgReplayEntryKind,
    GgReplayInterner, GgReplayPools, GgReplayRecord, GgShellOrigin,
};

use super::*;
use crate::observer::SessionObserver;
use crate::tools::real_shell;

/// One recorded command, as the helpers below take it: which agent ran it, its line, its directory,
/// its exit code, and what it printed on stdout.
type Recorded<'a> = (&'a str, &'a str, GgShellCwd, i32, &'a str);

/// A record carrying `commands` across the named agents, plus one provenance row per agent so every
/// one of them is an agent the record knows.
///
/// The first agent named is the [root](GgReplayAgentOrigin::Root); every later one is a spawn of
/// it, which is all the ladder's cross-agent rung needs to be exercised.
fn record_with(commands: &[Recorded<'_>]) -> GgReplayRecord {
    let mut pools = GgReplayPools::new();
    let entries: Vec<GgReplayEntry> = commands
        .iter()
        .enumerate()
        .map(
            |(seq, (agent, command, cwd, exit_code, stdout))| GgReplayEntry {
                agent_id: (*agent).to_string(),
                seq: seq as u64,
                kind: GgReplayEntryKind::Shell {
                    origin: GgShellOrigin::Tool,
                    command: GgReplayCommand {
                        command: (*command).to_string(),
                        cwd: cwd.clone(),
                        exit_code: *exit_code,
                        stdout: pools.intern_text(stdout),
                        stderr: pools.intern_text(""),
                    },
                },
            },
        )
        .collect();
    let pooled = pools.into_parts();
    let mut record = GgReplayRecord::new("run-shell", GgCapabilitySet::minimal("mock/echo"));
    let mut named: Vec<&str> = Vec::new();
    for (agent, ..) in commands {
        if !named.contains(agent) {
            named.push(agent);
        }
    }
    if named.is_empty() {
        named.push("root");
    }
    record.agents = named
        .iter()
        .enumerate()
        .map(|(index, agent)| GgReplayAgent {
            agent_id: (*agent).to_string(),
            profile: "Root".to_string(),
            origin: match index {
                0 => GgReplayAgentOrigin::Root,
                ordinal => GgReplayAgentOrigin::Spawn {
                    parent: named[0].to_string(),
                    ordinal: ordinal as u32 - 1,
                },
            },
            terminal_status: None,
            limit_hit: None,
        })
        .collect();
    record.texts = pooled.texts;
    record.clips = pooled.clips;
    record.entries = entries;
    record
}

/// A runner over `record`, building in `workspace`, with every recorded agent bound to a live agent
/// of the **same id** and the ledger it reports into.
///
/// Binding the ids one-to-one is what keeps these tests about the ladder rather than about the
/// [binding table](super::binding), which has its own suite. A live id the table was never told
/// about is exercised deliberately, in its own test.
fn runner(
    record: GgReplayRecord,
    workspace: &Path,
) -> (RecordedShellRunner, Arc<AgentBindings>, Arc<DriftLedger>) {
    let inputs = Arc::new(ReplayInputs::new(record).expect("the record indexes"));
    let ledger = Arc::new(DriftLedger::new());
    let bindings = Arc::new(AgentBindings::new(Arc::clone(&inputs), Arc::clone(&ledger)));
    for agent in inputs.record().agents.clone() {
        bindings.agent_created(&agent.agent_id, &agent.origin);
    }
    let runner = RecordedShellRunner::new(
        Arc::clone(&inputs),
        Arc::clone(&bindings),
        Arc::clone(&ledger),
        workspace.to_path_buf(),
    );
    (runner, bindings, ledger)
}

/// A request from `agent` to run `command` in `cwd`.
fn request(agent: &str, command: &str, cwd: &Path) -> ShellRequest {
    ShellRequest {
        command: command.to_string(),
        cwd: cwd.to_path_buf(),
        timeout: Duration::from_secs(60),
        agent_id: agent.to_string(),
        origin: GgShellOrigin::Tool,
    }
}

/// A command line that would be unmistakable if it ever ran.
const SIDE_EFFECT: &str = "echo ran > ran.txt";

// ---------------------------------------------------------------------------
// Rung 1: the head match
// ---------------------------------------------------------------------------

/// The head of the agent's queue answers, with the exit code and the streams the run recorded —
/// and nothing runs.
#[tokio::test]
async fn the_head_of_the_queue_answers_and_no_process_starts() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, ledger) = runner(
        record_with(&[(
            "root",
            SIDE_EFFECT,
            GgShellCwd::Workspace,
            2,
            "the recorded output",
        )]),
        dir.path(),
    );

    let execution = runner.run(request("root", SIDE_EFFECT, dir.path())).await;

    assert_eq!(execution.status, ShellStatus::Exited { code: Some(2) });
    assert_eq!(execution.stdout, "the recorded output");
    assert!(
        !dir.path().join("ran.txt").exists(),
        "the recorded commands did not run — that is the whole seam",
    );
    assert!(ledger.drifts().is_empty(), "{:?}", ledger.drifts());
}

/// A directory *inside the playback's own workspace* matches the recorded relative one, because
/// the live path is relativized against the workspace before it is compared. This is the whole
/// reason the record stores a relationship rather than an absolute path: a playback deliberately
/// builds somewhere else, and every command of every record would otherwise mismatch.
#[tokio::test]
async fn a_directory_inside_the_playback_workspace_matches_the_recorded_relative_one() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("web")).unwrap();
    let (runner, _bindings, ledger) = runner(
        record_with(&[(
            "root",
            "npm run build",
            GgShellCwd::Relative {
                path: "web".to_string(),
            },
            0,
            "built",
        )]),
        dir.path(),
    );

    let execution = runner
        .run(request("root", "npm run build", &dir.path().join("web")))
        .await;

    assert_eq!(execution.stdout, "built");
    assert!(
        ledger.drifts().is_empty(),
        "the playback's own tree is not a divergence: {:?}",
        ledger.drifts(),
    );
}

// ---------------------------------------------------------------------------
// Rung 2: out of order, same agent
// ---------------------------------------------------------------------------

/// A command gg no longer runs is **stepped over**: the later match answers, what was skipped is
/// consumed so it cannot answer some unrelated later command, and the whole thing is reported.
#[tokio::test]
async fn a_command_found_later_in_the_queue_answers_and_consumes_what_it_skipped() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, ledger) = runner(
        record_with(&[
            ("root", "git status", GgShellCwd::Workspace, 0, "clean"),
            ("root", "npm run build", GgShellCwd::Workspace, 0, "built"),
        ]),
        dir.path(),
    );

    let execution = runner
        .run(request("root", "npm run build", dir.path()))
        .await;

    assert_eq!(execution.stdout, "built", "the later match answered");
    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::CommandOutOfOrder);
    assert!(drifts[0].detail.contains("git status"), "{drifts:?}");

    // The skipped command was consumed rather than left to answer something else later.
    let second = runner.run(request("root", "git status", dir.path())).await;
    assert!(
        matches!(second.status, ShellStatus::LaunchFailed { .. }),
        "a stepped-over command must not still be sitting in the queue: {second:?}",
    );
}

/// The same command in a different tree is a **different command**: it does not match the recorded
/// entry, so the ladder falls through it rather than silently accepting it.
#[tokio::test]
async fn the_same_command_in_a_different_directory_does_not_match() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, ledger) = runner(
        record_with(&[(
            "root",
            "npm run build",
            GgShellCwd::Relative {
                path: "web".to_string(),
            },
            0,
            "built",
        )]),
        dir.path(),
    );

    // The workspace root, not `web/` — an identical command line in a different tree.
    let execution = runner
        .run(request("root", "npm run build", dir.path()))
        .await;

    assert!(
        matches!(execution.status, ShellStatus::LaunchFailed { .. }),
        "the same command elsewhere is not the recorded command: {execution:?}",
    );
    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::CommandNotRecorded);
    assert!(
        drifts[0].detail.contains("`web` (workspace-relative)"),
        "the recorded directory reads as a place, not a debug dump: {}",
        drifts[0].detail,
    );
}

// ---------------------------------------------------------------------------
// Rung 3: across agents
// ---------------------------------------------------------------------------

/// The safety net for an imperfect agent binding: a command recorded on **another** agent's queue
/// still answers, and the crossing is reported — which is what makes the binding auditable rather
/// than merely lucky.
#[tokio::test]
async fn a_command_recorded_for_another_agent_answers_and_is_reported() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, ledger) = runner(
        record_with(&[
            ("root", "echo root", GgShellCwd::Workspace, 0, "the root's"),
            (
                "agent-1",
                "npm run build",
                GgShellCwd::Workspace,
                0,
                "built",
            ),
        ]),
        dir.path(),
    );

    let execution = runner
        .run(request("root", "npm run build", dir.path()))
        .await;

    assert_eq!(execution.stdout, "built");
    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::CommandOutOfOrder);
    assert!(
        drifts[0].detail.contains("agent `agent-1`"),
        "the report names whose queue answered: {}",
        drifts[0].detail,
    );
    // The root's own queue is untouched: a cross-agent hit consumes only the entry it matched.
    assert_eq!(
        runner
            .run(request("root", "echo root", dir.path()))
            .await
            .stdout,
        "the root's",
    );
}

// ---------------------------------------------------------------------------
// Rung 4: the miss, and its policies
// ---------------------------------------------------------------------------

/// A command with no recorded answer comes back as a **launch failure** — the command did nothing,
/// which is a different fact from a command that ran and failed, and the model is told them
/// differently.
#[tokio::test]
async fn an_unrecorded_command_never_ran_rather_than_failed() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, ledger) = runner(record_with(&[]), dir.path());

    let execution = runner.run(request("root", SIDE_EFFECT, dir.path())).await;

    match &execution.status {
        ShellStatus::LaunchFailed { failure, message } => {
            assert_eq!(*failure, ToolFailure::Unavailable);
            assert!(message.starts_with("playback:"), "{message}");
        }
        other => panic!("a command that did not run is not an exit code, got {other:?}"),
    }
    assert!(execution.stdout.is_empty() && execution.stderr.is_empty());
    assert!(!dir.path().join("ran.txt").exists(), "still no process");
    let drifts = ledger.drifts();
    assert_eq!(
        drifts.first().map(|drift| &drift.kind),
        Some(&DriftKind::CommandNotRecorded)
    );
    assert!(
        !drifts[0].fatal,
        "the default carries on: the model's own next answer still comes from the record, and the \
         fingerprint check is what settles whether the session diverged",
    );
}

/// [`MissPolicy::Stop`] makes the same miss **fatal**, for a caller that would rather have nothing
/// than a session in which a build's output was invented.
#[tokio::test]
async fn the_stop_policy_makes_a_miss_fatal() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, ledger) = runner(record_with(&[]), dir.path());
    let runner = runner.miss_policy(MissPolicy::Stop, real_shell());

    runner.run(request("root", SIDE_EFFECT, dir.path())).await;

    assert_eq!(
        ledger.stopped_on().map(|drift| drift.kind),
        Some(DriftKind::CommandNotRecorded),
    );
    assert!(!dir.path().join("ran.txt").exists(), "and still no process");
}

/// [`MissPolicy::Execute`] is the one setting that reaches a process — and it says so.
#[tokio::test]
async fn the_execute_policy_runs_an_unrecorded_command_and_reports_that_it_did() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, ledger) = runner(record_with(&[]), dir.path());
    let runner = runner.miss_policy(MissPolicy::Execute, real_shell());

    let execution = runner.run(request("root", SIDE_EFFECT, dir.path())).await;

    assert_eq!(execution.status, ShellStatus::Exited { code: Some(0) });
    assert!(
        dir.path().join("ran.txt").exists(),
        "the escape hatch really executes — that is what makes it an escape hatch",
    );
    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert!(
        drifts[0].detail.contains("run for real"),
        "a reader must not mistake this output for the run's: {}",
        drifts[0].detail,
    );
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/// A command with **no agent behind it** is refused rather than guessed at: picking a queue for it
/// would be exactly the mis-attribution the per-agent keying exists to prevent.
#[tokio::test]
async fn a_command_with_no_agent_behind_it_is_refused_rather_than_guessed() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, ledger) = runner(
        record_with(&[("root", SIDE_EFFECT, GgShellCwd::Workspace, 0, "output")]),
        dir.path(),
    );

    let execution = runner.run(request("", SIDE_EFFECT, dir.path())).await;

    assert!(matches!(execution.status, ShellStatus::LaunchFailed { .. }));
    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::CommandNotRecorded);
    assert!(
        drifts[0].detail.contains("no agent behind it"),
        "{}",
        drifts[0].detail,
    );
    assert!(
        drifts[0].agent_id.is_empty(),
        "attributed to nobody, because nobody claimed it",
    );
    assert_eq!(
        runner
            .run(request("root", SIDE_EFFECT, dir.path()))
            .await
            .stdout,
        "output",
        "and the unattributed call consumed nothing from anybody's queue",
    );
}

/// A live agent the [binding table](super::binding) never placed gets a reported miss, not some
/// other agent's commands.
#[tokio::test]
async fn an_unbound_agent_gets_a_miss_and_not_a_guess() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, ledger) = runner(
        record_with(&[(
            "root",
            "npm run build",
            GgShellCwd::Workspace,
            0,
            "the root's",
        )]),
        dir.path(),
    );

    let execution = runner
        .run(request("agent-9", "npm run build", dir.path()))
        .await;

    assert_ne!(
        execution.stdout, "the root's",
        "an unbound agent must never be served another agent's queue",
    );
    assert_eq!(
        ledger.drifts().first().map(|drift| &drift.kind),
        Some(&DriftKind::CommandNotRecorded),
    );
    // And the root's queue is untouched, so the agent it does belong to still gets it.
    assert_eq!(
        runner
            .run(request("root", "npm run build", dir.path()))
            .await
            .stdout,
        "the root's",
    );
}

/// The guard against the one shape this module must never take: a fallback to a real process under
/// the **default** policy. Every path through the runner — a hit, a miss, an unattributed call, an
/// unbound agent — is driven with a command that would leave a file behind, in a workspace that is
/// then checked.
#[tokio::test]
async fn nothing_the_runner_does_reaches_a_process() {
    let dir = TempDir::new().unwrap();
    let (runner, _bindings, _ledger) = runner(
        record_with(&[("root", SIDE_EFFECT, GgShellCwd::Workspace, 0, "recorded")]),
        dir.path(),
    );

    for agent in ["root", "", "agent-9"] {
        for command in [SIDE_EFFECT, "touch also-ran.txt"] {
            runner.run(request(agent, command, dir.path())).await;
        }
    }

    let left_behind: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        left_behind.is_empty(),
        "a recorded runner starts nothing, ever — found {left_behind:?}",
    );
}
