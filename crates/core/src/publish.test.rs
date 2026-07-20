//! Tests for run publishing: slug derivation, repository URLs, wrangler URL
//! capture, and the publish orchestration (driven through a mock command runner
//! and a mock backend client so no real `gh`/`git`/`wrangler`/network is
//! touched).

use std::sync::Mutex;

use super::*;
use crate::backend_client::{
    BackendClient, PublishAck, PublishedRun, ResolvedArtifact, ResolvedReference, RunPage,
};
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::review::Writeup;
use crate::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunState, RunStatus, RunSubject, RunTooling,
};
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
                comparable: Some(0.2667),
                actual: Some(0.2667),
            },
        },
        validation: ValidationSummary {
            debug_scripts: Vec::new(),
            loaded: true,
            detail: None,
            install: None,
            build: None,
            checks: vec![],
            proofs: vec![],
            asset: None,
            voxel: None,
            ui: None,
            material: None,
            particle: None,
            audio: None,
            adversarial: None,
            performance: None,
        },
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
        game_jam_readme: None,
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

/// A publish configuration matching the production publish targets, for the tests
/// that assert repository addresses and drive the release orchestration.
/// [`PublishConfig`] has no `Default` and no compiled-in fallback: every
/// environment sets its org and Pages project explicitly (see
/// [`PublishConfig::from_env`]), so the tests spell the targets out here.
fn sample_config() -> PublishConfig {
    PublishConfig {
        github_org: "TheClockwyrks".to_string(),
        repo_prefix: "tcab-".to_string(),
        pages_project: "test-cabinet-runs".to_string(),
    }
}

#[test]
fn config_derives_repo_addresses() {
    let config = sample_config();
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
fn from_env_requires_org_and_pages_project() {
    let _guard = ENV_GUARD
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());

    // With neither variable set there is no compiled-in fallback: resolution fails
    // loudly rather than publishing into a default org and project.
    unsafe {
        std::env::remove_var("TCAB_GITHUB_ORG");
        std::env::remove_var("TCAB_PAGES_PROJECT");
    }
    assert!(matches!(PublishConfig::from_env(), Err(Error::Publish(_))));

    // Both set: the org and Pages project come from the environment; the prefix is
    // the fixed compiled-in constant.
    unsafe {
        std::env::set_var("TCAB_GITHUB_ORG", "Acme");
        std::env::set_var("TCAB_PAGES_PROJECT", "acme-runs");
    }
    let resolved = PublishConfig::from_env().expect("both variables set");
    assert_eq!(resolved.github_org, "Acme");
    assert_eq!(resolved.pages_project, "acme-runs");
    assert_eq!(resolved.repo_prefix, "tcab-");

    // A blank value is treated as unset, so a half-configured environment still
    // fails rather than publishing to a surprising target.
    unsafe {
        std::env::set_var("TCAB_GITHUB_ORG", "");
        std::env::remove_var("TCAB_PAGES_PROJECT");
    }
    assert!(matches!(PublishConfig::from_env(), Err(Error::Publish(_))));

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
    /// How many leading `git push` invocations should fail before one succeeds,
    /// so the propagation-lag retry path can be exercised. Counts down as pushes
    /// are attempted.
    push_failures: Mutex<u32>,
    calls: Mutex<Vec<String>>,
}

impl MockRunner {
    /// A runner whose implementation working tree carries the model's
    /// uncommitted changes — the common case the push must commit.
    fn new(repo_exists: bool) -> Self {
        Self {
            repo_exists,
            working_tree_dirty: true,
            push_failures: Mutex::new(0),
            calls: Mutex::new(Vec::new()),
        }
    }

    /// A runner whose implementation working tree is already clean (nothing to
    /// commit), so the push proceeds against the existing commits.
    fn with_clean_tree(repo_exists: bool) -> Self {
        Self {
            repo_exists,
            working_tree_dirty: false,
            push_failures: Mutex::new(0),
            calls: Mutex::new(Vec::new()),
        }
    }

    /// Make the first `n` `git push` attempts fail before one succeeds, modelling
    /// GitHub rejecting the push until the new repo's write grant propagates.
    fn failing_first_pushes(mut self, n: u32) -> Self {
        self.push_failures = Mutex::new(n);
        self
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
        let is_git_push = program == "git" && args.contains(&"push");
        let stdout = if is_wrangler {
            "✨ Deployment complete! https://abc123.test-cabinet-runs.pages.dev\n".to_string()
        } else if is_git_status && self.working_tree_dirty {
            " M controller/src/lib.rs\n".to_string()
        } else {
            String::new()
        };
        // A push fails while there are scripted failures left (the propagation
        // lag); `gh repo view` reports existence; everything else succeeds.
        let push_fails = is_git_push && {
            let mut remaining = self.push_failures.lock().expect("lock");
            (*remaining > 0).then(|| *remaining -= 1).is_some()
        };
        let success = if is_repo_view {
            self.repo_exists
        } else {
            !push_fails
        };
        Ok(CommandOutput {
            success,
            stdout,
            stderr: if push_fails {
                "remote: Permission denied. fatal: unable to access ... 403\n".to_string()
            } else {
                String::new()
            },
        })
    }
}

/// A trivial [`BackendClient`] stub. `release_code`/`release_playable_build` never
/// touch the backend, so the release tests need only something that satisfies the
/// [`BackendPublisher`] type bound.
struct MockBackend;

#[async_trait::async_trait]
impl BackendClient for MockBackend {
    async fn catalog(&self) -> Result<Vec<TestCase>> {
        Ok(vec![])
    }
    async fn versions(&self, _slug: &str) -> Result<Vec<String>> {
        Ok(vec![])
    }
    async fn resolve_version(&self, _slug: &str, _version: &str) -> Result<TestCaseVersion> {
        unimplemented!("not exercised by release tests")
    }
    async fn artifact(
        &self,
        _slug: &str,
        _version: &str,
        _source: &Path,
    ) -> Result<ResolvedArtifact> {
        unimplemented!("not exercised by release tests")
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
    async fn submit_review(&self, _run_id: &str, _review: &Writeup) -> Result<()> {
        Ok(())
    }
    async fn publish_run(&self, run_id: &str) -> Result<PublishAck> {
        Ok(PublishAck {
            publish_job_id: format!("pj-{run_id}"),
            live_url: format!("/publish-jobs/pj-{run_id}/live"),
        })
    }
    async fn list_runs(&self, _before: Option<&str>, _limit: Option<usize>) -> Result<RunPage> {
        unimplemented!("not exercised by release tests")
    }
    async fn read_run(&self, _id: &str) -> Result<PublishedRun> {
        unimplemented!("not exercised by release tests")
    }
}

fn publisher_for(
    dir: &Path,
    runner: MockRunner,
) -> (BackendPublisher<MockRunner, MockBackend>, PathBuf, PathBuf) {
    let impl_dir = dir.join("implementation");
    let build_dir = dir.join("dist");
    std::fs::create_dir_all(&impl_dir).expect("impl dir");
    std::fs::create_dir_all(&build_dir).expect("build dir");
    // Zero out the propagation-lag delays so the release tests never actually
    // sleep; the retry *count* is preserved so the retry path stays exercised.
    let publisher =
        BackendPublisher::new(sample_config(), runner, MockBackend).with_push_retry(PushRetry {
            attempts: 5,
            initial_delay: Duration::ZERO,
            backoff: Duration::ZERO,
        });
    (publisher, impl_dir, build_dir)
}

#[tokio::test]
async fn release_code_creates_a_public_repo_and_commits_before_the_push() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let source_repo = publisher
        .release_code(&request)
        .await
        .expect("release code");

    assert_eq!(
        source_repo.as_deref(),
        Some("https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9")
    );

    let calls = publisher.runner().calls();
    // The repo was created public and empty — the push is a separate step (not
    // `gh repo create --push`) so it can retry through GitHub's permission lag.
    assert!(
        calls
            .iter()
            .any(|c| c.contains("gh repo create") && c.contains("--public")),
        "{calls:?}"
    );
    assert!(
        !calls
            .iter()
            .any(|c| c.contains("gh repo create") && c.contains("--push")),
        "create and push must be separate: {calls:?}"
    );
    // The implementation is pushed, authenticated through `gh`'s credential
    // helper (the pod configures no git credential helper of its own).
    assert!(
        calls.iter().any(|c| c.contains("git ")
            && c.contains(" push ")
            && c.contains("gh auth git-credential")),
        "{calls:?}"
    );
    // The model's uncommitted work is committed before the push, so the public
    // repo carries the implementation and not just the "Seed test case" commit.
    // Staging uses a blanket add — the seeded `.gitignore` keeps build artifacts
    // (e.g. `target/`) out.
    assert!(calls.iter().any(|c| c == "git add --all"), "{calls:?}");
    let commit_pos = calls.iter().position(|c| c.contains("git commit"));
    let push_pos = calls.iter().position(|c| c.contains(" push "));
    assert!(
        matches!((commit_pos, push_pos), (Some(commit), Some(push)) if commit < push),
        "implementation must be committed before the push: {calls:?}"
    );
}

#[tokio::test]
async fn release_playable_build_deploys_and_captures_the_wrangler_url() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
    };

    let playable_build = publisher
        .release_playable_build(&request)
        .await
        .expect("release build");

    // The playable build URL is the one wrangler reported, not a constructed host.
    assert_eq!(
        playable_build.as_deref(),
        Some("https://abc123.test-cabinet-runs.pages.dev")
    );
    // The build was deployed to Cloudflare Pages under the run-id branch alias.
    let calls = publisher.runner().calls();
    assert!(
        calls.iter().any(|c| c.contains("wrangler pages deploy")
            && c.contains(&format!("--branch={}", record.id)))
    );
}

#[tokio::test]
async fn release_code_skips_the_commit_when_the_working_tree_is_already_clean() {
    // A re-release (or a run the model never modified) finds nothing to commit:
    // staging still runs, but no commit is attempted, and the push proceeds
    // against the existing commits. This is what keeps releasing idempotent.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) =
        publisher_for(dir.path(), MockRunner::with_clean_tree(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    publisher
        .release_code(&request)
        .await
        .expect("release code");

    let calls = publisher.runner().calls();
    // Staging still happens, but a clean tree means no commit is made...
    assert!(calls.iter().any(|c| c == "git add --all"), "{calls:?}");
    assert!(!calls.iter().any(|c| c.contains("git commit")), "{calls:?}");
    // ...and the repo is still created and the existing commits pushed.
    assert!(
        calls
            .iter()
            .any(|c| c.contains("gh repo create") && c.contains("--public")),
        "{calls:?}"
    );
    assert!(calls.iter().any(|c| c.contains(" push ")), "{calls:?}");
}

#[tokio::test]
async fn release_code_of_an_asset_generation_run_creates_no_repo() {
    // Asset-generation runs produce no code — their output is the recorded drawing
    // operations, uploaded separately. Releasing one must NOT create a GitHub repo
    // (or touch git at all), and the run carries no source link.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let mut record = sample_record();
    record.subject.test_type = crate::test_case::TestType::AssetGeneration;
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let source_repo = publisher
        .release_code(&request)
        .await
        .expect("release code");

    // No source repo is returned.
    assert_eq!(source_repo, None);
    // Neither `git` nor `gh` was invoked — not even the repo-existence probe.
    let calls = publisher.runner().calls();
    assert!(
        !calls
            .iter()
            .any(|c| c.starts_with("gh ") || c.starts_with("git ")),
        "asset-generation release must not touch git/gh: {calls:?}"
    );
}

#[tokio::test]
async fn release_code_of_a_harness_error_run_creates_no_repo() {
    // A harness-error run is recorded only as a per-model statistic — it produced no
    // evaluable output worth releasing — so releasing one must NOT create a GitHub
    // repo (or touch git at all), even though its (code-writing) test type otherwise
    // would. The run carries no source link.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let mut record = sample_record();
    record.status.state = RunState::HarnessError;
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let source_repo = publisher
        .release_code(&request)
        .await
        .expect("release code");

    assert_eq!(source_repo, None);
    let calls = publisher.runner().calls();
    assert!(
        !calls
            .iter()
            .any(|c| c.starts_with("gh ") || c.starts_with("git ")),
        "harness-error release must not touch git/gh: {calls:?}"
    );
}

#[tokio::test]
async fn release_playable_build_of_a_harness_error_run_deploys_nothing() {
    // Even if a partial tree happened to build, a harness-error run deploys no
    // playable build — it is a per-model statistic only.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let mut record = sample_record();
    record.status.state = RunState::HarnessError;
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
    };

    let playable_build = publisher
        .release_playable_build(&request)
        .await
        .expect("release build");

    assert_eq!(playable_build, None);
    let calls = publisher.runner().calls();
    assert!(
        !calls.iter().any(|c| c.contains("wrangler")),
        "harness-error release must not deploy a build: {calls:?}"
    );
}

#[tokio::test]
async fn release_code_reuses_an_existing_repo_but_still_pushes() {
    let dir = tempfile::tempdir().expect("tempdir");
    // The repo already exists, so the existence probe reports it present.
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(true));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let source_repo = publisher
        .release_code(&request)
        .await
        .expect("release code");

    // The existing repo's URL is still returned and the repo is left in place — no
    // re-create.
    assert_eq!(
        source_repo.as_deref(),
        Some("https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9")
    );
    let calls = publisher.runner().calls();
    assert!(
        !calls.iter().any(|c| c.contains("gh repo create")),
        "{calls:?}"
    );
    // But the push still runs: this is what recovers a repo whose first push never
    // landed (created but left empty by an earlier failure). A re-push of an
    // already-complete repo is a clean no-op.
    assert!(calls.iter().any(|c| c.contains(" push ")), "{calls:?}");
}

#[tokio::test]
async fn release_code_retries_the_push_through_the_propagation_lag() {
    // GitHub rejects the first two pushes (the new org repo's write grant has not
    // propagated yet), then accepts the third. The publish must ride this out
    // rather than fail.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) =
        publisher_for(dir.path(), MockRunner::new(false).failing_first_pushes(2));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let source_repo = publisher
        .release_code(&request)
        .await
        .expect("release code should succeed once the push lands");

    assert_eq!(
        source_repo.as_deref(),
        Some("https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9")
    );
    // Three push attempts: two rejected, the third accepted.
    let calls = publisher.runner().calls();
    let pushes = calls.iter().filter(|c| c.contains(" push ")).count();
    assert_eq!(pushes, 3, "{calls:?}");
}

#[tokio::test]
async fn release_code_fails_when_the_push_never_succeeds() {
    // If every attempt is rejected, the publish surfaces the failure (with the
    // push's own diagnostics) rather than reporting a success that left an empty
    // repo. `attempts` is 5 in the test publisher, so 99 scripted failures exhaust
    // the budget.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) =
        publisher_for(dir.path(), MockRunner::new(false).failing_first_pushes(99));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let err = publisher
        .release_code(&request)
        .await
        .expect_err("release code should fail when the push never lands");
    let message = err.to_string();
    assert!(message.contains("after 5 attempt"), "{message}");
    assert!(message.contains("403"), "{message}");

    // The push was attempted exactly `attempts` times before giving up.
    let calls = publisher.runner().calls();
    let pushes = calls.iter().filter(|c| c.contains(" push ")).count();
    assert_eq!(pushes, 5, "{calls:?}");
}

#[tokio::test]
async fn release_playable_build_without_a_build_dir_skips_the_deploy() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let playable_build = publisher
        .release_playable_build(&request)
        .await
        .expect("release build");

    assert!(playable_build.is_none());
    let calls = publisher.runner().calls();
    assert!(!calls.iter().any(|c| c.contains("wrangler")));
}

#[test]
fn failure_details_prefers_stdout_when_stderr_is_empty() {
    // `wrangler` writes its diagnostics to stdout, leaving stderr empty — the
    // exact case that previously rendered the error as `… failed: ` with nothing
    // after it.
    let output = CommandOutput {
        success: false,
        stdout: "  Authentication error [code: 10000]\n".to_string(),
        stderr: String::new(),
    };
    assert_eq!(
        output.failure_details(),
        "Authentication error [code: 10000]"
    );
}

#[test]
fn failure_details_prefers_stderr_when_stdout_is_empty() {
    let output = CommandOutput {
        success: false,
        stdout: String::new(),
        stderr: "  fatal: repository not found\n".to_string(),
    };
    assert_eq!(output.failure_details(), "fatal: repository not found");
}

#[test]
fn failure_details_combines_both_streams_when_present() {
    let output = CommandOutput {
        success: false,
        stdout: "deploy output\n".to_string(),
        stderr: "a warning\n".to_string(),
    };
    assert_eq!(output.failure_details(), "a warning\ndeploy output");
}

#[test]
fn failure_details_reports_when_no_output_was_captured() {
    let output = CommandOutput {
        success: false,
        stdout: "   \n".to_string(),
        stderr: String::new(),
    };
    assert_eq!(output.failure_details(), "(no output captured)");
}

#[test]
fn scrub_build_dir_redacts_keys_in_nested_text_files_only() {
    let key = "sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01";
    let dir = tempfile::tempdir().expect("tempdir");
    let nested = dir.path().join("assets");
    std::fs::create_dir_all(&nested).expect("nested dir");

    // A bundled JS chunk that captured the key, a clean HTML file, and a binary
    // asset that merely contains the key bytes (and must be left untouched).
    let leaky = nested.join("app.js");
    std::fs::write(&leaky, format!("const K=\"{key}\";export default K;")).expect("js");
    let clean = dir.path().join("index.html");
    std::fs::write(&clean, "<!doctype html><title>play</title>").expect("html");
    let binary = nested.join("logo.png");
    let binary_bytes = [0x89, b'P', b'N', b'G', 0x00, 0xFF, 0xFE];
    std::fs::write(&binary, binary_bytes).expect("png");

    scrub_build_dir(dir.path()).expect("scrub");

    let scrubbed = std::fs::read_to_string(&leaky).expect("read js");
    assert!(!scrubbed.contains(key), "the key must be gone");
    assert!(scrubbed.contains(crate::redact::PLACEHOLDER));
    // Untouched files keep their exact bytes.
    assert_eq!(
        std::fs::read_to_string(&clean).expect("read html"),
        "<!doctype html><title>play</title>"
    );
    assert_eq!(std::fs::read(&binary).expect("read png"), binary_bytes);
}
