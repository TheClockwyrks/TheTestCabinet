//! Tests for the release orchestration, driven through a stub [`CommandRunner`] so
//! no real `gh`/`git`/`wrangler`/network is touched.
//!
//! The orchestration itself (commit-before-push, the `gh repo view` idempotency
//! gate, wrangler URL capture, secret scrubbing) is exhaustively covered by
//! `BackendPublisher`'s own tests in core; these assert the *publisher's* wiring: it
//! loads the record from the downloaded tree, finds the build, runs both release
//! steps in order, and returns the produced links — and that a missing record fails
//! cleanly.

use super::*;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use test_cabinet_core::{
    AuthMode, CommandOutput, CommandRunner, Cost, HarnessSlug, RunEnvironment, RunLinks,
    RunMetrics, RunRecord, RunState, RunStatus, RunSubject, RunTooling, TestType, TokenCounts,
    ValidationSummary,
};

/// A [`CommandRunner`] standing in for `gh`/`git`/`wrangler`: it records every call
/// and answers each tool the way the release path expects — `gh repo view` reports
/// the repo absent (so the create path runs), `git status` reports a dirty tree (so
/// the commit runs), `wrangler pages deploy` prints a deployment URL, and everything
/// else simply succeeds. Mirrors core's `MockRunner`. The call log lives behind a
/// shared handle so a [`Clone`] of the runner can be moved into the release while the
/// test keeps a clone to read the recorded calls.
#[derive(Clone, Default)]
struct StubRunner {
    calls: Arc<Mutex<Vec<String>>>,
}

impl StubRunner {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("lock").clone()
    }
}

#[async_trait::async_trait]
impl CommandRunner for StubRunner {
    async fn run(
        &self,
        program: &str,
        args: &[&str],
        _cwd: Option<&std::path::Path>,
    ) -> test_cabinet_core::Result<CommandOutput> {
        self.calls
            .lock()
            .expect("lock")
            .push(format!("{program} {}", args.join(" ")));
        let is_repo_view =
            program == "gh" && args.first() == Some(&"repo") && args.get(1) == Some(&"view");
        let is_wrangler = program == "wrangler";
        let is_git_status = program == "git" && args.first() == Some(&"status");
        let stdout = if is_wrangler {
            "✨ Deployment complete! https://abc123.test-cabinet-runs.pages.dev\n".to_string()
        } else if is_git_status {
            " M src/main.rs\n".to_string()
        } else {
            String::new()
        };
        Ok(CommandOutput {
            // `gh repo view` is the existence probe; reporting failure means "absent",
            // so the create-and-push path runs.
            success: !is_repo_view,
            stdout,
            stderr: String::new(),
        })
    }
}

/// A minimal code-releasing run record for the fixture tree.
fn sample_record() -> RunRecord {
    RunRecord {
        id: "d483a2f9-7bda-4018-a27f-586ccdf31a9e".to_string(),
        started_at: "2026-06-15T01:36:06Z".to_string(),
        finished_at: "2026-06-15T01:40:25Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Codex,
            harness_version: Some("0.139.0".to_string()),
            orchestrator_slug: "one-shot".to_string(),
            model_id: "gpt-5.4-mini".to_string(),
        },
        tooling: RunTooling {
            test_cabinet_commit: Some("0d60bc1deadbeef".to_string()),
        },
        environment: RunEnvironment {
            os: "Debian GNU/Linux 12 (bookworm)".to_string(),
            container_image: "test-cabinet/codex:1a7b".to_string(),
            node_version: Some("v22.11.0".to_string()),
            auth_mode: AuthMode::ApiKey,
        },
        metrics: RunMetrics {
            run_time_seconds: 258.4,
            tokens: TokenCounts {
                uncached_input: Some(41403),
                cached_input: Some(940416),
                output: Some(28733),
                reasoning: Some(7974),
            },
            cost: Cost {
                comparable: Some(0.2667),
                actual: Some(0.2667),
            },
        },
        validation: ValidationSummary {
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: vec![],
            proofs: vec![],
            asset: None,
            adversarial: None,
            performance: None,
            voxel: None,
            ui: None,
            material: None,
            particle: None,
            audio: None,
        },
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
    }
}

/// Lay down a run directory under a temp dir: `run-record.json`, an
/// `implementation/` tree with a `dist/` build, and an `events.jsonl`. Returns the
/// temp dir (kept alive by the caller) and the run directory within it.
fn fixture_run_dir(record: &RunRecord) -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().expect("tempdir");
    let run_dir = temp.path().join(&record.id);
    let impl_dir = run_dir.join("implementation");
    std::fs::create_dir_all(impl_dir.join("dist")).expect("mkdir build");
    std::fs::write(
        run_dir.join("run-record.json"),
        serde_json::to_vec(record).expect("serialize record"),
    )
    .expect("write record");
    std::fs::write(impl_dir.join("dist/index.html"), b"<!doctype html>").expect("write build");
    std::fs::write(run_dir.join("events.jsonl"), b"").expect("write events");
    (temp, run_dir)
}

#[tokio::test]
async fn releases_source_then_build_and_returns_both_links() {
    let record = sample_record();
    let (_temp, run_dir) = fixture_run_dir(&record);
    let runner = StubRunner::default();

    let links = release_with_runner(&run_dir, runner.clone())
        .await
        .expect("release should succeed");

    assert_eq!(
        links.source_repo.as_deref(),
        Some("https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9")
    );
    assert_eq!(
        links.playable_build.as_deref(),
        Some("https://abc123.test-cabinet-runs.pages.dev")
    );

    // The two steps ran in order, committing the implementation before the push and
    // releasing the code before deploying the build.
    let calls = runner.calls();
    let commit = calls.iter().position(|c| c.contains("git commit"));
    let create = calls.iter().position(|c| c.contains("gh repo create"));
    let deploy = calls
        .iter()
        .position(|c| c.contains("wrangler pages deploy"));
    assert!(
        commit.is_some() && create.is_some() && deploy.is_some(),
        "{calls:?}"
    );
    assert!(commit < create, "commit before push: {calls:?}");
    assert!(create < deploy, "code released before the build: {calls:?}");
}

#[tokio::test]
async fn a_missing_record_fails_cleanly() {
    let temp = tempfile::tempdir().expect("tempdir");
    let run_dir = temp.path().join("no-such-run");
    std::fs::create_dir_all(&run_dir).expect("mkdir");

    let err = release_with_runner(&run_dir, StubRunner::default())
        .await
        .expect_err("a missing record must fail");
    assert!(
        matches!(err, ReleaseError::Record { .. }),
        "expected a Record error, got {err:?}"
    );
}
