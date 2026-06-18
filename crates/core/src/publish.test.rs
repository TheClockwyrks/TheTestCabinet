//! Tests for run publishing: slug derivation, repository URLs, wrangler URL
//! capture, and the publish orchestration (driven through a mock command runner
//! and a mock backend client so no real `gh`/`git`/`wrangler`/network is
//! touched).

use std::sync::Mutex;

use super::*;
use crate::backend_client::{
    BackendClient, PublishAck, PublishedRun, ResolvedArtifact, ResolvedReference, RunPage,
};
use crate::event::{EventKind, HarnessEvent};
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::review::Rating;
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
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Codex,
            harness_version: Some("0.139.0".to_string()),
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
        },
        metrics: RunMetrics {
            run_time_seconds: 258.4,
            tokens: TokenCounts {
                uncached_input: 41403,
                cached_input: 940416,
                output: 28733,
                reasoning: 7974,
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
        rating: Rating::Great,
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
    calls: Mutex<Vec<String>>,
}

impl MockRunner {
    fn new(repo_exists: bool) -> Self {
        Self {
            repo_exists,
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
        // deployment URL; everything else simply "succeeds".
        let is_repo_view =
            program == "gh" && args.first() == Some(&"repo") && args.get(1) == Some(&"view");
        let is_wrangler = program == "wrangler";
        Ok(CommandOutput {
            success: if is_repo_view { self.repo_exists } else { true },
            stdout: if is_wrangler {
                "✨ Deployment complete! https://abc123.test-cabinet-runs.pages.dev\n".to_string()
            } else {
                String::new()
            },
            stderr: String::new(),
        })
    }
}

/// A [`BackendClient`] that records each published run and reports whether it was
/// newly recorded, so the submit half can be asserted without a real backend.
struct MockBackend {
    already_published: bool,
    submitted: Mutex<Vec<(RunRecord, Writeup, RunLinks, Vec<HarnessEvent>)>>,
}

impl MockBackend {
    fn new(already_published: bool) -> Self {
        Self {
            already_published,
            submitted: Mutex::new(Vec::new()),
        }
    }

    fn submitted(&self) -> Vec<(RunRecord, Writeup, RunLinks, Vec<HarnessEvent>)> {
        self.submitted.lock().expect("lock").clone()
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
    async fn publish_run(
        &self,
        record: &RunRecord,
        review: &Writeup,
        links: &RunLinks,
        events: &[HarnessEvent],
    ) -> Result<PublishAck> {
        self.submitted.lock().expect("lock").push((
            record.clone(),
            review.clone(),
            links.clone(),
            events.to_vec(),
        ));
        Ok(PublishAck {
            id: record.id.clone(),
            newly_published: !self.already_published,
        })
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
async fn publish_creates_public_repo_deploys_build_and_submits_to_backend() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) =
        publisher_for(dir.path(), MockRunner::new(false), MockBackend::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let writeup = sample_writeup();
    let events = vec![HarnessEvent {
        timestamp: "2026-06-17T20:41:00Z".to_string(),
        session_id: None,
        kind: EventKind::Agent {
            message: "thinking".to_string(),
        },
    }];
    let request = PublishRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
        writeup: &writeup,
        events: &events,
    };

    let outcome = publisher.publish(&request).await.expect("publish");

    assert!(outcome.newly_published);
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
    // No GitHub Pages workflow / no dataset commit anymore.
    assert!(!calls.iter().any(|c| c.contains("git commit")));

    // The record was submitted to the backend with its links filled in, and the
    // review traveled with it.
    let submitted = publisher.backend().submitted();
    assert_eq!(submitted.len(), 1);
    let (stored, review, links, submitted_events) = &submitted[0];
    assert_eq!(stored.id, record.id);
    assert_eq!(review, &writeup);
    // The recorded event stream travels with the publish.
    assert_eq!(submitted_events, &events);
    assert_eq!(
        links.source_repo.as_deref(),
        Some(outcome.source_repo.as_str())
    );
    assert_eq!(
        links.playable_build.as_deref(),
        Some("https://abc123.test-cabinet-runs.pages.dev")
    );
    // The links are also written onto the submitted record blob.
    assert_eq!(
        stored.links.source_repo.as_deref(),
        Some(outcome.source_repo.as_str())
    );
}

#[tokio::test]
async fn publish_is_idempotent_when_already_released() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Repo already exists; backend reports the run as already published.
    let (publisher, impl_dir, build_dir) =
        publisher_for(dir.path(), MockRunner::new(true), MockBackend::new(true));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let writeup = sample_writeup();
    let request = PublishRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
        writeup: &writeup,
        events: &[],
    };
    let outcome = publisher.publish(&request).await.expect("publish");

    assert!(!outcome.newly_published);
    let calls = publisher.runner().calls();
    // The existing repo is left in place — no create.
    assert!(!calls.iter().any(|c| c.contains("gh repo create")));
}

#[tokio::test]
async fn publish_without_a_build_dir_skips_the_deploy() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) =
        publisher_for(dir.path(), MockRunner::new(false), MockBackend::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let writeup = sample_writeup();
    let request = PublishRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
        writeup: &writeup,
        events: &[],
    };
    let outcome = publisher.publish(&request).await.expect("publish");

    assert!(outcome.playable_build.is_none());
    let calls = publisher.runner().calls();
    assert!(!calls.iter().any(|c| c.contains("wrangler")));
    // The run is still submitted, with no playable-build link.
    let submitted = publisher.backend().submitted();
    assert_eq!(submitted.len(), 1);
    assert!(submitted[0].2.playable_build.is_none());
}
