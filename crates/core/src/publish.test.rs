//! Tests for run publishing: slug derivation, repository URLs, wrangler URL
//! capture, and the publish orchestration (driven through a mock command runner
//! and a mock backend client so no real `gh`/`git`/`wrangler`/network is
//! touched).

use std::sync::Mutex;

use super::*;
use crate::backend_client::{
    BackendClient, PublishAck, PublishedRun, PushAck, ResolvedArtifact, ResolvedReference, RunPage,
};
use crate::event::{EventKind, HarnessEvent};
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::review::{DomainRating, Rating, Writeup};
use crate::run_record::{HarnessSlug, RunEnvironment, RunState, RunStatus, RunSubject, RunTooling};
use crate::test_case::{TestCase, TestCaseVersion};
use crate::validation::ValidationSummary;

fn sample_record() -> RunRecord {
    RunRecord {
        id: "d483a2f9-7bda-4018-a27f-586ccdf31a9e".to_string(),
        started_at: "2026-06-15T01:36:06Z".to_string(),
        finished_at: "2026-06-15T01:40:25Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: crate::test_case::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Codex,
            harness_version: Some("0.139.0".to_string()),
            orchestrator_slug: "one-shot".to_string(),
            // Dots are not repo-name-safe; the slug must reduce them to hyphens.
            model_id: "gpt-5.4-mini".to_string(),
        },
        tooling: RunTooling {
            test_cabinet_commit: Some("0d60bc1deadbeef".to_string()),
        },
        environment: RunEnvironment {
            os: "Debian GNU/Linux 12 (bookworm)".to_string(),
            container_image: "test-cabinet/codex:1a7b".to_string(),
            node_version: Some("v22.11.0".to_string()),
            auth_mode: crate::run_record::AuthMode::ApiKey,
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
                comparable: 0.2667,
                actual: 0.2667,
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
        },
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
    }
}

fn sample_writeup() -> Writeup {
    Writeup {
        ratings: vec![DomainRating {
            domain: "gameplay".to_string(),
            rating: Rating::Great,
        }],
        body: "Plays well; the pause menu doesn't restore focus.".to_string(),
        checklist: vec![],
    }
}

#[test]
fn slug_is_hosting_safe_and_carries_identity() {
    let slug = run_slug(&sample_record());
    assert_eq!(slug, "pong-codex-gpt-5-4-mini-d483a2f9");
}

#[test]
fn sanitize_label_collapses_and_trims_non_alphanumerics() {
    assert_eq!(sanitize_label("Foo..Bar / Baz--"), "foo-bar-baz");
    assert_eq!(
        sanitize_label("--leading.and.trailing--"),
        "leading-and-trailing"
    );
}

#[test]
fn config_derives_repo_addresses() {
    let config = PublishConfig::default();
    let record = sample_record();

    assert_eq!(
        config.repo_name(&record),
        "tcab-pong-codex-gpt-5-4-mini-d483a2f9"
    );
    assert_eq!(
        config.repo_qualified(&record),
        "TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9"
    );
    assert_eq!(
        config.repo_url(&record),
        "https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9"
    );
}

/// Serializes the env-mutating test below so it cannot race other tests that
/// read `TCAB_GITHUB_ORG` / `TCAB_PAGES_PROJECT` from the process environment.
static ENV_GUARD: Mutex<()> = Mutex::new(());

#[test]
fn from_env_honors_overrides_and_falls_back_to_defaults() {
    let _guard = ENV_GUARD
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());

    // Unset (or empty) variables fall back to the compiled-in defaults.
    unsafe {
        std::env::remove_var("TCAB_GITHUB_ORG");
        std::env::remove_var("TCAB_PAGES_PROJECT");
    }
    let defaulted = PublishConfig::from_env();
    assert_eq!(defaulted, PublishConfig::default());

    // Set variables override the org and Pages project; the prefix is fixed.
    unsafe {
        std::env::set_var("TCAB_GITHUB_ORG", "Acme");
        std::env::set_var("TCAB_PAGES_PROJECT", "acme-runs");
    }
    let overridden = PublishConfig::from_env();
    assert_eq!(overridden.github_org, "Acme");
    assert_eq!(overridden.pages_project, "acme-runs");
    assert_eq!(overridden.repo_prefix, PublishConfig::default().repo_prefix);

    // An empty value is treated as unset and falls back to the default.
    unsafe {
        std::env::set_var("TCAB_GITHUB_ORG", "");
        std::env::remove_var("TCAB_PAGES_PROJECT");
    }
    let blank = PublishConfig::from_env();
    assert_eq!(blank, PublishConfig::default());

    // Restore a clean environment for any test ordering.
    unsafe {
        std::env::remove_var("TCAB_GITHUB_ORG");
        std::env::remove_var("TCAB_PAGES_PROJECT");
    }
}

#[test]
fn wrangler_url_is_captured_not_constructed() {
    // The deployment URL is whatever wrangler reports — a sanitized/truncated
    // branch-alias host, not `https://<run-id>.<project>.pages.dev`.
    let stdout = "Uploading... (3/3)\n\
         ✨ Deployment complete! Take a peek over at https://abc123.test-cabinet-runs.pages.dev\n";
    assert_eq!(
        parse_wrangler_url(stdout).as_deref(),
        Some("https://abc123.test-cabinet-runs.pages.dev")
    );
    // Trailing sentence punctuation is trimmed.
    assert_eq!(
        parse_wrangler_url("Deployed to https://x.pages.dev.").as_deref(),
        Some("https://x.pages.dev")
    );
    // A line without a pages.dev URL yields nothing.
    assert_eq!(parse_wrangler_url("nothing here"), None);
}

/// A [`CommandRunner`] that records every invocation and returns canned results,
/// so publish orchestration can be asserted without a real `gh`/`git`/`wrangler`.
struct MockRunner {
    repo_exists: bool,
    /// Whether `git status --porcelain` should report uncommitted work, so the
    /// commit-before-push path either commits (dirty) or skips the commit (clean).
    working_tree_dirty: bool,
    calls: Mutex<Vec<String>>,
}

impl MockRunner {
    /// A runner whose implementation working tree carries the model's
    /// uncommitted changes — the common case the push must commit.
    fn new(repo_exists: bool) -> Self {
        Self {
            repo_exists,
            working_tree_dirty: true,
            calls: Mutex::new(Vec::new()),
        }
    }

    /// A runner whose implementation working tree is already clean (nothing to
    /// commit), so the push proceeds against the existing commits.
    fn with_clean_tree(repo_exists: bool) -> Self {
        Self {
            repo_exists,
            working_tree_dirty: false,
            calls: Mutex::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("lock").clone()
    }
}

#[async_trait::async_trait]
impl CommandRunner for MockRunner {
    async fn run(
        &self,
        program: &str,
        args: &[&str],
        _cwd: Option<&Path>,
    ) -> Result<CommandOutput> {
        self.calls
            .lock()
            .expect("lock")
            .push(format!("{program} {}", args.join(" ")));
        // `gh repo view` is the existence probe; `wrangler pages deploy` prints a
        // deployment URL; `git status --porcelain` reports the model's
        // uncommitted work so the commit-before-push path runs; everything else
        // simply "succeeds".
        let is_repo_view =
            program == "gh" && args.first() == Some(&"repo") && args.get(1) == Some(&"view");
        let is_wrangler = program == "wrangler";
        let is_git_status = program == "git" && args.first() == Some(&"status");
        let stdout = if is_wrangler {
            "✨ Deployment complete! https://abc123.test-cabinet-runs.pages.dev\n".to_string()
        } else if is_git_status && self.working_tree_dirty {
            " M controller/src/lib.rs\n".to_string()
        } else {
            String::new()
        };
        Ok(CommandOutput {
            success: if is_repo_view { self.repo_exists } else { true },
            stdout,
            stderr: String::new(),
        })
    }
}

/// One run as captured by [`MockBackend`]: the stored record, the resolved links,
/// and the harness events pushed alongside it.
type PushedRun = (RunRecord, RunLinks, Vec<HarnessEvent>);

/// A [`BackendClient`] that records each pushed run, each submitted review, and
/// each publish, so the push/review/publish split can be asserted without a real
/// backend.
struct MockBackend {
    already_pushed: bool,
    pushed: Mutex<Vec<PushedRun>>,
    reviews: Mutex<Vec<(String, Writeup)>>,
    published: Mutex<Vec<String>>,
    /// `(run_id, file)` for every uploaded run asset (replays travel this path).
    assets: Mutex<Vec<(String, String)>>,
    /// `(run_id, byte_len)` for every uploaded controller wasm.
    controllers: Mutex<Vec<(String, usize)>>,
}

impl MockBackend {
    fn new(already_pushed: bool) -> Self {
        Self {
            already_pushed,
            pushed: Mutex::new(Vec::new()),
            reviews: Mutex::new(Vec::new()),
            published: Mutex::new(Vec::new()),
            assets: Mutex::new(Vec::new()),
            controllers: Mutex::new(Vec::new()),
        }
    }

    fn pushed(&self) -> Vec<PushedRun> {
        self.pushed.lock().expect("lock").clone()
    }

    fn reviews(&self) -> Vec<(String, Writeup)> {
        self.reviews.lock().expect("lock").clone()
    }

    fn published(&self) -> Vec<String> {
        self.published.lock().expect("lock").clone()
    }

    fn assets(&self) -> Vec<(String, String)> {
        self.assets.lock().expect("lock").clone()
    }

    fn controllers(&self) -> Vec<(String, usize)> {
        self.controllers.lock().expect("lock").clone()
    }
}

#[async_trait::async_trait]
impl BackendClient for MockBackend {
    async fn catalog(&self) -> Result<Vec<TestCase>> {
        Ok(vec![])
    }
    async fn versions(&self, _slug: &str) -> Result<Vec<String>> {
        Ok(vec![])
    }
    async fn resolve_version(&self, _slug: &str, _version: &str) -> Result<TestCaseVersion> {
        unimplemented!("not exercised by publish tests")
    }
    async fn artifact(
        &self,
        _slug: &str,
        _version: &str,
        _source: &Path,
    ) -> Result<ResolvedArtifact> {
        unimplemented!("not exercised by publish tests")
    }
    async fn references(
        &self,
        _slug: &str,
        _version: &str,
        _variant: &str,
    ) -> Result<Vec<ResolvedReference>> {
        Ok(vec![])
    }
    async fn prompt_template(&self, _slug: &str, _version: &str) -> Result<String> {
        Ok(String::new())
    }
    async fn push_run(
        &self,
        record: &RunRecord,
        links: &RunLinks,
        events: &[HarnessEvent],
    ) -> Result<PushAck> {
        self.pushed
            .lock()
            .expect("lock")
            .push((record.clone(), links.clone(), events.to_vec()));
        Ok(PushAck {
            id: record.id.clone(),
            newly_pushed: !self.already_pushed,
        })
    }
    async fn submit_review(&self, run_id: &str, review: &Writeup) -> Result<()> {
        self.reviews
            .lock()
            .expect("lock")
            .push((run_id.to_string(), review.clone()));
        Ok(())
    }
    async fn publish_run(&self, run_id: &str) -> Result<PublishAck> {
        self.published
            .lock()
            .expect("lock")
            .push(run_id.to_string());
        Ok(PublishAck {
            id: run_id.to_string(),
            newly_published: true,
        })
    }
    async fn publish_run_asset(&self, run_id: &str, file: &str, _bytes: Vec<u8>) -> Result<()> {
        self.assets
            .lock()
            .expect("lock")
            .push((run_id.to_string(), file.to_string()));
        Ok(())
    }
    async fn publish_run_controller(&self, run_id: &str, bytes: Vec<u8>) -> Result<()> {
        self.controllers
            .lock()
            .expect("lock")
            .push((run_id.to_string(), bytes.len()));
        Ok(())
    }
    async fn list_runs(&self, _before: Option<&str>, _limit: Option<usize>) -> Result<RunPage> {
        unimplemented!("not exercised by publish tests")
    }
    async fn read_run(&self, _id: &str) -> Result<PublishedRun> {
        unimplemented!("not exercised by publish tests")
    }
}

fn publisher_for(
    dir: &Path,
    runner: MockRunner,
    backend: MockBackend,
) -> (BackendPublisher<MockRunner, MockBackend>, PathBuf, PathBuf) {
    let impl_dir = dir.join("implementation");
    let build_dir = dir.join("dist");
    std::fs::create_dir_all(&impl_dir).expect("impl dir");
    std::fs::create_dir_all(&build_dir).expect("build dir");
    (
        BackendPublisher::new(PublishConfig::default(), runner, backend),
        impl_dir,
        build_dir,
    )
}

#[tokio::test]
async fn push_creates_public_repo_deploys_build_and_stores_on_backend() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) =
        publisher_for(dir.path(), MockRunner::new(false), MockBackend::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let events = vec![HarnessEvent {
        timestamp: "2026-06-17T20:41:00Z".to_string(),
        session_id: None,
        kind: EventKind::Agent {
            message: "thinking".to_string(),
        },
    }];
    let request = PushRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
        events: &events,
    };

    let outcome = publisher.push(&request).await.expect("push");

    assert!(outcome.newly_pushed);
    assert_eq!(
        outcome.source_repo,
        "https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9"
    );
    // The playable build URL is the one wrangler reported, not a constructed host.
    assert_eq!(
        outcome.playable_build.as_deref(),
        Some("https://abc123.test-cabinet-runs.pages.dev")
    );

    let calls = publisher.runner().calls();
    // The repo was created public and pushed.
    assert!(
        calls.iter().any(|c| c.contains("gh repo create")
            && c.contains("--public")
            && c.contains("--push"))
    );
    // The build was deployed to Cloudflare Pages under the run-id branch alias.
    assert!(
        calls.iter().any(|c| c.contains("wrangler pages deploy")
            && c.contains(&format!("--branch={}", record.id)))
    );
    // The model's uncommitted work is committed before the push, so the public
    // repo carries the implementation and not just the "Seed test case" commit.
    // Staging uses a blanket add — the seeded `.gitignore` keeps build artifacts
    // (e.g. `target/`) out.
    assert!(calls.iter().any(|c| c == "git add --all"), "{calls:?}");
    let commit_pos = calls.iter().position(|c| c.contains("git commit"));
    let create_pos = calls.iter().position(|c| c.contains("gh repo create"));
    assert!(
        matches!((commit_pos, create_pos), (Some(commit), Some(create)) if commit < create),
        "implementation must be committed before the push: {calls:?}"
    );

    // The record was stored on the backend with its links filled in — but no
    // review traveled with it (pushing carries no review).
    let pushed = publisher.backend().pushed();
    assert_eq!(pushed.len(), 1);
    let (stored, links, pushed_events) = &pushed[0];
    assert_eq!(stored.id, record.id);
    assert_eq!(pushed_events, &events);
    assert_eq!(
        links.source_repo.as_deref(),
        Some(outcome.source_repo.as_str())
    );
    assert_eq!(
        links.playable_build.as_deref(),
        Some("https://abc123.test-cabinet-runs.pages.dev")
    );
    // The links are also written onto the stored record blob.
    assert_eq!(
        stored.links.source_repo.as_deref(),
        Some(outcome.source_repo.as_str())
    );
}

#[tokio::test]
async fn push_skips_the_commit_when_the_working_tree_is_already_clean() {
    // A re-push (or a run the model never modified) finds nothing to commit:
    // staging still runs, but no commit is attempted, and the push proceeds
    // against the existing commits. This is what keeps committing idempotent.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) = publisher_for(
        dir.path(),
        MockRunner::with_clean_tree(false),
        MockBackend::new(false),
    );
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = PushRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
        events: &[],
    };

    publisher.push(&request).await.expect("push");

    let calls = publisher.runner().calls();
    // Staging still happens, but a clean tree means no commit is made...
    assert!(calls.iter().any(|c| c == "git add --all"), "{calls:?}");
    assert!(!calls.iter().any(|c| c.contains("git commit")), "{calls:?}");
    // ...and the push still creates and pushes the repo from what is committed.
    assert!(
        calls
            .iter()
            .any(|c| c.contains("gh repo create") && c.contains("--push")),
        "{calls:?}"
    );
}

#[tokio::test]
async fn push_uploads_adversarial_replays_and_the_controller() {
    use crate::validation::{
        AdversarialOutcome, AdversarialReplay, AdversarialResult, AdversarialTeam,
    };

    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) =
        publisher_for(dir.path(), MockRunner::new(false), MockBackend::new(false));

    // The produced tree holds the controller wasm and the two proof replays at the
    // run-root-relative paths the record names.
    std::fs::write(impl_dir.join("controller.wasm"), b"\0asm-bytes").expect("wasm");
    std::fs::write(impl_dir.join("replay.json"), b"{}").expect("replay");
    std::fs::write(impl_dir.join("replay-1.json"), b"{}").expect("replay-1");

    let replay = |opponent: &str, file: &str| AdversarialReplay {
        opponent: opponent.to_string(),
        replay_json: file.to_string(),
        winner: Some(AdversarialTeam::Red),
        red_score: 1,
        blue_score: 0,
        ended: "swept".to_string(),
        ticks: 10,
        outcome: AdversarialOutcome::Win,
        scored: true,
    };
    let mut record = sample_record();
    record.subject.test_type = crate::test_case::TestType::Adversarial;
    record.validation.adversarial = Some(AdversarialResult {
        replay_json: "replay.json".to_string(),
        opponent: "border-soldier".to_string(),
        submission_team: AdversarialTeam::Red,
        winner: Some(AdversarialTeam::Red),
        red_score: 1,
        blue_score: 0,
        ended: "swept".to_string(),
        ticks: 10,
        outcome: AdversarialOutcome::Win,
        detail: None,
        controller_module: "controller.wasm".to_string(),
        replays: vec![
            replay("border-soldier", "replay.json"),
            replay("greedy-raider", "replay-1.json"),
        ],
    });

    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let request = PushRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
        events: &[],
    };
    publisher.push(&request).await.expect("push");

    // Every proof replay is uploaded under its own filename (served back through
    // the asset plumbing), and the controller wasm is uploaded for the arena.
    let assets = publisher.backend().assets();
    assert!(assets.contains(&(record.id.clone(), "replay.json".to_string())));
    assert!(assets.contains(&(record.id.clone(), "replay-1.json".to_string())));
    assert_eq!(
        publisher.backend().controllers(),
        vec![(record.id.clone(), b"\0asm-bytes".len())],
    );
}

#[tokio::test]
async fn review_then_publish_are_separate_backend_calls() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) =
        publisher_for(dir.path(), MockRunner::new(false), MockBackend::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = PushRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
        events: &[],
    };
    publisher.push(&request).await.expect("push");

    // A separate review submission, then the publish gate — the operator-release
    // half (`push`) is done; these are pure backend calls.
    let writeup = sample_writeup();
    publisher
        .backend()
        .submit_review(&record.id, &writeup)
        .await
        .expect("submit review");
    let ack = publisher
        .backend()
        .publish_run(&record.id)
        .await
        .expect("publish");
    assert!(ack.newly_published);

    let reviews = publisher.backend().reviews();
    assert_eq!(reviews.len(), 1);
    assert_eq!(reviews[0].0, record.id);
    assert_eq!(reviews[0].1, writeup);
    assert_eq!(publisher.backend().published(), vec![record.id]);
}

#[tokio::test]
async fn push_is_idempotent_when_already_released() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Repo already exists; backend reports the run as already stored.
    let (publisher, impl_dir, build_dir) =
        publisher_for(dir.path(), MockRunner::new(true), MockBackend::new(true));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = PushRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
        events: &[],
    };
    let outcome = publisher.push(&request).await.expect("push");

    assert!(!outcome.newly_pushed);
    let calls = publisher.runner().calls();
    // The existing repo is left in place — no create.
    assert!(!calls.iter().any(|c| c.contains("gh repo create")));
}

#[tokio::test]
async fn push_without_a_build_dir_skips_the_deploy() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) =
        publisher_for(dir.path(), MockRunner::new(false), MockBackend::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = PushRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
        events: &[],
    };
    let outcome = publisher.push(&request).await.expect("push");

    assert!(outcome.playable_build.is_none());
    let calls = publisher.runner().calls();
    assert!(!calls.iter().any(|c| c.contains("wrangler")));
    // The run is still stored, with no playable-build link.
    let pushed = publisher.backend().pushed();
    assert_eq!(pushed.len(), 1);
    assert!(pushed[0].1.playable_build.is_none());
}
