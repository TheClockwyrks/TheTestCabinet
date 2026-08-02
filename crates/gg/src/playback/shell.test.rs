//! The recorded shell seam.
//!
//! Every test here asserts the same underlying thing from a different direction: **no command line
//! becomes a process**. The commands are deliberately ones whose real execution would be visible —
//! writing a file into the workspace — so a runner that ever shelled out fails an assertion rather
//! than passing quietly.

use std::path::Path;
use std::time::Duration;

use tempfile::TempDir;
use test_cabinet_core::gg::GgCapabilitySet;
use test_cabinet_core::gg_replay::{
    GgReplayAgent, GgReplayAgentOrigin, GgReplayCommand, GgReplayEntry, GgReplayEntryKind,
    GgReplayInterner, GgReplayPools, GgReplayRecord, GgShellOrigin,
};

use super::*;

/// A record carrying `commands` — `(command, cwd, exit code, stdout)` — on `agent`'s queue, plus
/// the provenance row that makes it an agent the record knows.
fn record_with(agent: &str, commands: &[(&str, GgShellCwd, i32, &str)]) -> GgReplayRecord {
    let mut pools = GgReplayPools::new();
    let entries: Vec<GgReplayEntry> = commands
        .iter()
        .enumerate()
        .map(|(seq, (command, cwd, exit_code, stdout))| GgReplayEntry {
            agent_id: agent.to_string(),
            seq: seq as u64,
            kind: GgReplayEntryKind::Shell {
                origin: GgShellOrigin::CompletionValidation,
                command: GgReplayCommand {
                    command: (*command).to_string(),
                    cwd: cwd.clone(),
                    exit_code: *exit_code,
                    stdout: pools.intern_text(stdout),
                    stderr: pools.intern_text(""),
                },
            },
        })
        .collect();
    let pooled = pools.into_parts();
    let mut record = GgReplayRecord::new("run-shell", GgCapabilitySet::minimal("mock/echo"));
    record.agents = vec![GgReplayAgent {
        agent_id: agent.to_string(),
        profile: "Root".to_string(),
        origin: GgReplayAgentOrigin::Root,
        terminal_status: None,
        limit_hit: None,
    }];
    record.texts = pooled.texts;
    record.clips = pooled.clips;
    record.entries = entries;
    record
}

/// A runner over `record`, building in `workspace`, with the ledger it reports into.
fn runner(record: GgReplayRecord, workspace: &Path) -> (RecordedShellRunner, Arc<DriftLedger>) {
    let inputs = Arc::new(ReplayInputs::new(record).expect("the record indexes"));
    let ledger = Arc::new(DriftLedger::new());
    (
        RecordedShellRunner::new(inputs, Arc::clone(&ledger), workspace.to_path_buf()),
        ledger,
    )
}

/// A request from `agent` to run `command` in `cwd`.
fn request(agent: &str, command: &str, cwd: &Path) -> ShellRequest {
    ShellRequest {
        command: command.to_string(),
        cwd: cwd.to_path_buf(),
        timeout: Duration::from_secs(60),
        agent_id: agent.to_string(),
    }
}

/// A command line that would be unmistakable if it ever ran.
const SIDE_EFFECT: &str = "echo ran > ran.txt";

/// The head of the agent's queue answers, with the exit code and the streams the run recorded —
/// and nothing runs.
#[tokio::test]
async fn the_head_of_the_queue_answers_and_no_process_starts() {
    let dir = TempDir::new().unwrap();
    let (runner, ledger) = runner(
        record_with(
            "root",
            &[(SIDE_EFFECT, GgShellCwd::Workspace, 2, "the recorded output")],
        ),
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

/// Position is the key and content is the check: the head still answers, and the difference is
/// reported rather than silently accepted.
#[tokio::test]
async fn a_different_command_at_this_position_is_reported_and_still_answered() {
    let dir = TempDir::new().unwrap();
    let (runner, ledger) = runner(
        record_with(
            "root",
            &[("npm run build", GgShellCwd::Workspace, 0, "built")],
        ),
        dir.path(),
    );

    let execution = runner
        .run(request("root", "npm run test", dir.path()))
        .await;

    assert_eq!(execution.stdout, "built", "position was the key");
    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::CommandMismatch);
    assert!(drifts[0].detail.contains("npm run build"), "{drifts:?}");
    assert!(drifts[0].detail.contains("npm run test"), "{drifts:?}");
}

/// The same command in a different tree is a **different command**, and comes out as a mismatch
/// rather than as a match.
#[tokio::test]
async fn the_same_command_in_a_different_directory_is_a_mismatch() {
    let dir = TempDir::new().unwrap();
    let (runner, ledger) = runner(
        record_with(
            "root",
            &[(
                "npm run build",
                GgShellCwd::Relative {
                    path: "web".to_string(),
                },
                0,
                "built",
            )],
        ),
        dir.path(),
    );

    // The workspace root, not `web/` — an identical command line in a different tree.
    runner
        .run(request("root", "npm run build", dir.path()))
        .await;

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::CommandMismatch);
    assert!(
        drifts[0].detail.contains("`web` (workspace-relative)"),
        "the recorded directory reads as a place, not a debug dump: {}",
        drifts[0].detail,
    );
}

/// A directory *inside the playback's own workspace* matches the recorded relative one, because
/// the live path is relativized against the workspace before it is compared. This is the whole
/// reason the record stores a relationship rather than an absolute path: a playback deliberately
/// builds somewhere else, and every command of every record would otherwise mismatch.
#[tokio::test]
async fn a_directory_inside_the_playback_workspace_matches_the_recorded_relative_one() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("web")).unwrap();
    let (runner, ledger) = runner(
        record_with(
            "root",
            &[(
                "npm run build",
                GgShellCwd::Relative {
                    path: "web".to_string(),
                },
                0,
                "built",
            )],
        ),
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

/// A command with no recorded answer comes back as a **launch failure** — the command did nothing,
/// which is a different fact from a command that ran and failed, and the model is told them
/// differently.
#[tokio::test]
async fn an_unrecorded_command_never_ran_rather_than_failed() {
    let dir = TempDir::new().unwrap();
    let (runner, ledger) = runner(record_with("root", &[]), dir.path());

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
    assert_eq!(
        ledger.drifts().first().map(|drift| &drift.kind),
        Some(&DriftKind::CommandNotRecorded),
    );
}

/// A command with **no agent behind it** is refused rather than guessed at: picking a queue for it
/// would be exactly the mis-attribution the per-agent keying exists to prevent.
#[tokio::test]
async fn a_command_with_no_agent_behind_it_is_refused_rather_than_guessed() {
    let dir = TempDir::new().unwrap();
    let (runner, ledger) = runner(
        record_with("root", &[(SIDE_EFFECT, GgShellCwd::Workspace, 0, "output")]),
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

/// An agent the record does not know gets a reported miss, not another agent's commands.
#[tokio::test]
async fn an_agent_the_record_does_not_know_gets_a_miss_and_not_a_guess() {
    let dir = TempDir::new().unwrap();
    let (runner, ledger) = runner(
        record_with(
            "root",
            &[("npm run build", GgShellCwd::Workspace, 0, "the root's")],
        ),
        dir.path(),
    );

    let execution = runner
        .run(request("agent-9", "npm run build", dir.path()))
        .await;

    assert_ne!(
        execution.stdout, "the root's",
        "an unknown agent must never be served another agent's queue",
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

/// The guard against the one shape this module must never take: a fallback to a real process. Every
/// path through the runner — a hit, a miss, an unattributed call, an unknown agent — is driven with
/// a command that would leave a file behind, in a workspace that is then checked.
#[tokio::test]
async fn nothing_the_runner_does_reaches_a_process() {
    let dir = TempDir::new().unwrap();
    let (runner, _ledger) = runner(
        record_with(
            "root",
            &[(SIDE_EFFECT, GgShellCwd::Workspace, 0, "recorded")],
        ),
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
