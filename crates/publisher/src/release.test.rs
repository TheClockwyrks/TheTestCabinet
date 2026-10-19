//! Tests for run publishing: slug derivation, repository URLs, wrangler URL
//! capture, and the publish orchestration (driven through a mock command runner
//! and a mock backend client so no real `gh`/`git`/`wrangler`/network is
//! touched).

use std::sync::Mutex;

use super::*;
use crate::pages::tests::{StubPagesApi, deployment};
use test_cabinet_backend_client::{
    BackendClient, ResolvedArtifact, ResolvedReference, Result as ClientResult,
};
use test_cabinet_contracts::metrics::{Cost, RunMetrics, TokenCounts};
use test_cabinet_contracts::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunState, RunStatus, RunSubject, RunTooling,
};
use test_cabinet_contracts::test_case::{TestCase, TestCaseVersion};
use test_cabinet_contracts::validation::ValidationSummary;

pub(super) fn sample_record() -> RunRecord {
    RunRecord {
        id: "d483a2f9-7bda-4018-a27f-586ccdf31a9e".to_string(),
        started_at: "2026-06-15T01:36:06Z".to_string(),
        finished_at: "2026-06-15T01:40:25Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: test_cabinet_contracts::test_case::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Codex,
            harness_version: Some("0.139.0".to_string()),
            orchestrator_slug: "one-shot".to_string(),
            engine_slug: "none".to_string(),
            engine_version: None,
            // Dots are not repo-name-safe; the slug must reduce them to hyphens.
            model_id: "gpt-5.4-mini".to_string(),
            gg_capability_set: None,
            gg_summary: None,
        },
        tooling: RunTooling {
            test_cabinet_commit: Some("0d60bc1deadbeef".to_string()),
        },
        environment: RunEnvironment {
            os: "Debian GNU/Linux 12 (bookworm)".to_string(),
            container_image: "test-cabinet/codex:1a7b".to_string(),
            node_version: Some("v22.11.0".to_string()),
            auth_mode: test_cabinet_contracts::run_record::AuthMode::ApiKey,
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
            ..RunMetrics::default()
        },
        validation: ValidationSummary {
            debug_scripts: Vec::new(),
            loaded: true,
            requirements: Vec::new(),
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
        tool_calls: Default::default(),
        game_jam_prior_entries: Vec::new(),
        seed_commit: None,
        code_analysis: None,
        toolchain: None,
        showcase: None,
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
pub(super) fn sample_config() -> PublishConfig {
    PublishConfig {
        github_org: "TheClockwyrks".to_string(),
        repo_prefix: "tcab-".to_string(),
        pages_project: "test-cabinet-runs".to_string(),
        git_remote_base: DEFAULT_GIT_REMOTE_BASE.to_string(),
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
    assert_eq!(
        config.remote_url(&record),
        "https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9.git"
    );
}

#[test]
fn remote_url_follows_the_remote_base_but_the_public_url_does_not() {
    let config = PublishConfig {
        git_remote_base: "/srv/remotes/".to_string(),
        ..sample_config()
    };
    let record = sample_record();
    assert_eq!(
        config.remote_url(&record),
        "/srv/remotes/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9.git"
    );
    assert_eq!(
        config.repo_url(&record),
        "https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9"
    );
}

#[test]
fn commit_date_is_the_end_time_in_seconds_at_utc() {
    assert_eq!(
        commit_date("2026-06-15T01:40:25Z").expect("date"),
        "1781487625 +0000"
    );
    // The same instant written with an offset gives the same date.
    assert_eq!(
        commit_date("2026-06-15T03:40:25+02:00").expect("date"),
        "1781487625 +0000"
    );
    assert!(matches!(commit_date("yesterday"), Err(Error::Publish(_))));
    assert!(matches!(commit_date(""), Err(Error::Publish(_))));
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

/// The tree `git rev-parse HEAD^{tree}` reports in the mock's implementation repo.
const LOCAL_TREE: &str = "1111111111111111111111111111111111111111";

/// A [`CommandRunner`] that records every invocation and returns canned results,
/// so publish orchestration can be asserted without a real `gh`/`git`/`wrangler`.
struct MockRunner {
    repo_exists: bool,
    /// How many leading `git push` invocations should fail before one succeeds,
    /// so the propagation-lag retry path can be exercised. Counts down as pushes
    /// are attempted.
    push_failures: Mutex<u32>,
    /// How many leading `wrangler` runs fail before one succeeds.
    wrangler_failures: Mutex<u32>,
    /// The tree the remote's `main` holds after a refused push, or `None` when
    /// the remote has no `main` (the fetch fails), as a freshly created and still
    /// empty repository does.
    remote_tree: Option<String>,
    calls: Mutex<Vec<String>>,
    /// The environment each `git commit` was given, in order.
    commit_envs: Mutex<Vec<Vec<(String, String)>>>,
}

impl MockRunner {
    fn new(repo_exists: bool) -> Self {
        Self {
            repo_exists,
            push_failures: Mutex::new(0),
            wrangler_failures: Mutex::new(0),
            remote_tree: None,
            calls: Mutex::new(Vec::new()),
            commit_envs: Mutex::new(Vec::new()),
        }
    }

    /// Make the first `n` `git push` attempts fail before one succeeds, modelling
    /// GitHub rejecting the push until the new repo's write grant propagates.
    fn failing_first_pushes(mut self, n: u32) -> Self {
        self.push_failures = Mutex::new(n);
        self
    }

    /// Make the first `n` `wrangler` runs fail before one succeeds.
    fn failing_first_deploys(mut self, n: u32) -> Self {
        self.wrangler_failures = Mutex::new(n);
        self
    }

    /// Make the remote's `main` hold `tree`, so a refused push compares it.
    fn with_remote_tree(mut self, tree: &str) -> Self {
        self.remote_tree = Some(tree.to_string());
        self
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("lock").clone()
    }

    fn commit_envs(&self) -> Vec<Vec<(String, String)>> {
        self.commit_envs.lock().expect("lock").clone()
    }
}

/// Whether a recorded call is the implementation commit (`git -c … commit …`).
fn is_commit(call: &str) -> bool {
    call.starts_with("git ") && call.contains(" commit ")
}

/// Whether a recorded call is the implementation push.
fn is_push(call: &str) -> bool {
    call.starts_with("git ") && call.contains(" push ")
}

/// Whether a recorded call is the fetch of the remote's `main`.
fn is_fetch(call: &str) -> bool {
    call.starts_with("git ") && call.contains(" fetch ")
}

#[async_trait::async_trait]
impl CommandRunner for MockRunner {
    async fn run_with_env(
        &self,
        program: &str,
        args: &[&str],
        _cwd: Option<&Path>,
        env: &[(&str, &str)],
    ) -> Result<CommandOutput> {
        let call = format!("{program} {}", args.join(" "));
        self.calls.lock().expect("lock").push(call.clone());
        if is_commit(&call) {
            self.commit_envs.lock().expect("lock").push(
                env.iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            );
        }
        let is_repo_view =
            program == "gh" && args.first() == Some(&"repo") && args.get(1) == Some(&"view");
        let is_wrangler = program == "wrangler";
        // A push fails while there are scripted failures left (the propagation
        // lag or a remote holding another commit).
        let push_fails = is_push(&call) && {
            let mut remaining = self.push_failures.lock().expect("lock");
            (*remaining > 0).then(|| *remaining -= 1).is_some()
        };
        let wrangler_fails = is_wrangler && {
            let mut remaining = self.wrangler_failures.lock().expect("lock");
            (*remaining > 0).then(|| *remaining -= 1).is_some()
        };
        let (success, stdout) = if is_repo_view {
            (self.repo_exists, String::new())
        } else if wrangler_fails {
            (
                false,
                "✘ [ERROR] A request to the Cloudflare API failed.\n".to_string(),
            )
        } else if is_wrangler {
            (
                true,
                "✨ Deployment complete! https://abc123.test-cabinet-runs.pages.dev\n".to_string(),
            )
        } else if is_fetch(&call) {
            (self.remote_tree.is_some(), String::new())
        } else if call.contains("FETCH_HEAD^{tree}") {
            match &self.remote_tree {
                Some(tree) => (true, format!("{tree}\n")),
                None => (false, String::new()),
            }
        } else if call.contains("HEAD^{tree}") {
            (true, format!("{LOCAL_TREE}\n"))
        } else {
            (!push_fails, String::new())
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
pub(super) struct MockBackend;

#[async_trait::async_trait]
impl BackendClient for MockBackend {
    async fn catalog(&self) -> ClientResult<Vec<TestCase>> {
        Ok(vec![])
    }
    async fn versions(&self, _slug: &str) -> ClientResult<Vec<String>> {
        Ok(vec![])
    }
    async fn resolve_version(&self, _slug: &str, _version: &str) -> ClientResult<TestCaseVersion> {
        unimplemented!("not exercised by release tests")
    }
    async fn artifact(
        &self,
        _slug: &str,
        _version: &str,
        _source: &Path,
    ) -> ClientResult<ResolvedArtifact> {
        unimplemented!("not exercised by release tests")
    }
    async fn references(
        &self,
        _slug: &str,
        _version: &str,
        _variant: &str,
    ) -> ClientResult<Vec<ResolvedReference>> {
        Ok(vec![])
    }
    async fn prompt_template(&self, _slug: &str, _version: &str) -> ClientResult<String> {
        Ok(String::new())
    }
}

/// Five attempts with no pause between them, so the retry paths run without
/// sleeping.
pub(super) fn instant_backoff() -> Backoff {
    Backoff {
        attempts: 5,
        initial_delay: Duration::ZERO,
        max_delay: Duration::ZERO,
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
    // Zero out the delays so the release tests never actually sleep; the retry
    // *count* is kept so the retry paths stay exercised.
    let publisher = BackendPublisher::new(sample_config(), runner, MockBackend)
        .with_backoff(instant_backoff())
        .with_create_settle(Duration::ZERO);
    (publisher, impl_dir, build_dir)
}

#[tokio::test]
async fn release_code_creates_a_public_repo_and_commits_before_the_push() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection::new(impl_dir);
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
    let commit_pos = calls.iter().position(|c| is_commit(c));
    let push_pos = calls.iter().position(|c| is_push(c));
    assert!(
        matches!((commit_pos, push_pos), (Some(commit), Some(push)) if commit < push),
        "implementation must be committed before the push: {calls:?}"
    );
}

/// Release `build_dir`'s playable build through `publisher`, looking its
/// deployment up in `stub`.
async fn release_build_against(
    publisher: BackendPublisher<MockRunner, MockBackend>,
    stub: &StubPagesApi,
    impl_dir: PathBuf,
    build_dir: &Path,
) -> (Result<Option<String>>, Vec<String>) {
    let publisher = publisher.with_pages_api(stub.api());
    let artifacts = ArtifactCollection::new(impl_dir);
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(build_dir),
    };
    let result = publisher.release_playable_build(&request).await;
    (result, publisher.runner().calls())
}

#[tokio::test]
async fn release_playable_build_deploys_with_the_digest_and_captures_the_wrangler_url() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    std::fs::write(build_dir.join("index.html"), b"<!doctype html>").expect("write build");
    let digest = build_digest(&build_dir).expect("digest");
    let record = sample_record();
    // The project holds deployments of this run's branch with another build and
    // of this build on another branch; neither is reused.
    let stub = StubPagesApi::with(vec![
        deployment(
            "https://other.test-cabinet-runs.pages.dev",
            &record.id,
            &"0".repeat(64),
        ),
        deployment(
            "https://elsewhere.test-cabinet-runs.pages.dev",
            "another-run",
            &digest,
        ),
    ])
    .await;

    let (playable_build, calls) =
        release_build_against(publisher, &stub, impl_dir, &build_dir).await;

    // The playable build URL is the one wrangler reported, not a constructed host.
    assert_eq!(
        playable_build.expect("release build").as_deref(),
        Some("https://abc123.test-cabinet-runs.pages.dev")
    );
    // The build was looked up, then deployed to Cloudflare Pages under the run-id
    // branch alias, carrying the scrubbed build's digest as its commit hash.
    assert_eq!(stub.requests().len(), 1);
    let deploys: Vec<_> = calls
        .iter()
        .filter(|c| c.contains("wrangler pages deploy"))
        .collect();
    assert_eq!(deploys.len(), 1, "{calls:?}");
    assert!(
        deploys[0].contains(&format!("--branch={}", record.id))
            && deploys[0].contains(&format!("--commit-hash={digest}"))
            && deploys[0].contains("--project-name test-cabinet-runs"),
        "{calls:?}"
    );
}

#[tokio::test]
async fn release_playable_build_reuses_the_deployment_of_the_same_build() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    std::fs::write(build_dir.join("index.html"), b"<!doctype html>").expect("write build");
    let digest = build_digest(&build_dir).expect("digest");
    let record = sample_record();
    let stub = StubPagesApi::with(vec![deployment(
        "https://3f6fa159.test-cabinet-runs.pages.dev",
        &record.id,
        &digest,
    )])
    .await;

    let (playable_build, calls) =
        release_build_against(publisher, &stub, impl_dir, &build_dir).await;

    // The deployment an earlier attempt made is reported, and nothing is deployed.
    assert_eq!(
        playable_build.expect("release build").as_deref(),
        Some("https://3f6fa159.test-cabinet-runs.pages.dev")
    );
    assert!(!calls.iter().any(|c| c.contains("wrangler")), "{calls:?}");
}

#[tokio::test]
async fn release_playable_build_digests_the_scrubbed_build() {
    // A leaked key is scrubbed before the digest is taken, so the digest the
    // lookup searches for is that of the tree actually deployed.
    let key = "sk-proj-DATA4digestSCRUBtest0123456789abcdefABCDEF";
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    std::fs::write(build_dir.join("app.js"), format!("const k = \"{key}\";")).expect("write");
    let stub = StubPagesApi::with(Vec::new()).await;

    let (playable_build, calls) =
        release_build_against(publisher, &stub, impl_dir, &build_dir).await;
    playable_build.expect("release build");

    let scrubbed = std::fs::read_to_string(build_dir.join("app.js")).expect("read");
    assert!(!scrubbed.contains(key), "{scrubbed}");
    let digest = build_digest(&build_dir).expect("digest");
    assert!(
        calls
            .iter()
            .any(|c| c.contains(&format!("--commit-hash={digest}"))),
        "{calls:?}"
    );
}

#[tokio::test]
async fn release_playable_build_fails_when_the_lookup_fails() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let stub = StubPagesApi::serve(Vec::new(), axum::http::StatusCode::BAD_GATEWAY).await;

    let (playable_build, calls) =
        release_build_against(publisher, &stub, impl_dir, &build_dir).await;

    assert!(
        matches!(
            playable_build,
            Err(Error::PagesApi {
                status: Some(502),
                ..
            })
        ),
        "{playable_build:?}"
    );
    assert!(!calls.iter().any(|c| c.contains("wrangler")), "{calls:?}");
    // A 502 is transient: the lookup was made once per attempt.
    assert_eq!(stub.requests().len(), 5);
}

#[tokio::test]
async fn release_playable_build_fails_at_once_when_the_lookup_is_refused() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let stub = StubPagesApi::serve(Vec::new(), axum::http::StatusCode::FORBIDDEN).await;

    let (playable_build, calls) =
        release_build_against(publisher, &stub, impl_dir, &build_dir).await;

    assert!(
        matches!(
            playable_build,
            Err(Error::PagesApi {
                status: Some(403),
                ..
            })
        ),
        "{playable_build:?}"
    );
    assert_eq!(stub.requests().len(), 1, "a 403 is not retried");
    assert!(!calls.iter().any(|c| c.contains("wrangler")), "{calls:?}");
}

#[tokio::test]
async fn a_failed_wrangler_run_is_retried_after_looking_again() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) =
        publisher_for(dir.path(), MockRunner::new(false).failing_first_deploys(1));
    let stub = StubPagesApi::with(Vec::new()).await;

    let (playable_build, calls) =
        release_build_against(publisher, &stub, impl_dir, &build_dir).await;

    assert_eq!(
        playable_build.expect("the second deploy lands").as_deref(),
        Some("https://abc123.test-cabinet-runs.pages.dev")
    );
    assert_eq!(
        calls.iter().filter(|c| c.starts_with("wrangler ")).count(),
        2,
        "{calls:?}"
    );
    // Each attempt looked the deployment up before deploying.
    assert_eq!(stub.requests().len(), 2);
}

#[tokio::test]
async fn a_wrangler_run_that_keeps_failing_is_bounded_by_the_attempts() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) =
        publisher_for(dir.path(), MockRunner::new(false).failing_first_deploys(99));
    let stub = StubPagesApi::with(Vec::new()).await;

    let (playable_build, calls) =
        release_build_against(publisher, &stub, impl_dir, &build_dir).await;

    let err = playable_build.expect_err("every deploy fails");
    assert!(matches!(err, Error::Command(_)), "{err}");
    assert!(err.to_string().contains("Cloudflare API failed"), "{err}");
    assert_eq!(
        calls.iter().filter(|c| c.starts_with("wrangler ")).count(),
        5,
        "{calls:?}"
    );
}

#[tokio::test]
async fn release_playable_build_without_a_pages_api_deploys_nothing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection::new(impl_dir);
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: Some(&build_dir),
    };

    let playable_build = publisher.release_playable_build(&request).await;

    assert!(
        matches!(playable_build, Err(Error::Publish(_))),
        "{playable_build:?}"
    );
    assert!(
        !publisher
            .runner()
            .calls()
            .iter()
            .any(|c| c.contains("wrangler"))
    );
}

#[tokio::test]
async fn release_code_always_commits_with_the_fixed_identity_and_end_time() {
    // The commit is deterministic: always made (empty when the model changed
    // nothing), unsigned, without hooks, with the fixed message, and with the
    // identity and both dates given through the environment, the dates being the
    // record's end time. No repository-local identity is configured.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection::new(impl_dir);
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
    let commits: Vec<&String> = calls.iter().filter(|c| is_commit(c)).collect();
    assert_eq!(
        commits,
        vec![
            "git -c commit.gpgSign=false commit --quiet --allow-empty --no-verify \
             --message Publish the run's implementation"
        ],
        "{calls:?}"
    );
    assert!(!calls.iter().any(|c| c.contains("git config")), "{calls:?}");
    assert!(!calls.iter().any(|c| c.contains("git status")), "{calls:?}");
    let date = "1781487625 +0000".to_string();
    let identity = |k: &str, v: &str| (k.to_string(), v.to_string());
    assert_eq!(
        publisher.runner().commit_envs(),
        vec![vec![
            identity("GIT_AUTHOR_NAME", "Clockwyrks"),
            identity("GIT_AUTHOR_EMAIL", "runs@clockwyrks.invalid"),
            ("GIT_AUTHOR_DATE".to_string(), date.clone()),
            identity("GIT_COMMITTER_NAME", "Clockwyrks"),
            identity("GIT_COMMITTER_EMAIL", "runs@clockwyrks.invalid"),
            ("GIT_COMMITTER_DATE".to_string(), date),
        ]]
    );
}

#[tokio::test]
async fn release_code_with_an_unusable_end_time_fails_before_touching_git() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection::new(impl_dir);
    let mut record = sample_record();
    record.finished_at = "not a time".to_string();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let err = publisher
        .release_code(&request)
        .await
        .expect_err("an unusable end time fails");
    assert!(err.to_string().contains("not a time"), "{err}");
    let calls = publisher.runner().calls();
    assert!(calls.is_empty(), "nothing may run: {calls:?}");
}

#[tokio::test]
async fn a_refused_push_whose_remote_holds_the_same_tree_is_a_success() {
    // The remote's `main` carries the run's tree under another commit (an earlier
    // publish with another message or date): the push is refused, the fetched
    // tree matches, and the publish succeeds without retrying.
    let dir = tempfile::tempdir().expect("tempdir");
    let runner = MockRunner::new(true)
        .failing_first_pushes(99)
        .with_remote_tree(LOCAL_TREE);
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), runner);
    let artifacts = ArtifactCollection::new(impl_dir);
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let source_repo = publisher
        .release_code(&request)
        .await
        .expect("the same tree is a success");
    assert_eq!(
        source_repo.as_deref(),
        Some("https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9")
    );
    let calls = publisher.runner().calls();
    assert_eq!(calls.iter().filter(|c| is_push(c)).count(), 1, "{calls:?}");
    let fetch = calls
        .iter()
        .find(|c| is_fetch(c))
        .expect("the remote's main is fetched");
    assert!(fetch.contains("gh auth git-credential"), "{fetch}");
    assert!(fetch.ends_with("origin refs/heads/main"), "{fetch}");
}

#[tokio::test]
async fn a_refused_push_whose_remote_holds_another_tree_fails_without_retrying() {
    let dir = tempfile::tempdir().expect("tempdir");
    let runner = MockRunner::new(true)
        .failing_first_pushes(99)
        .with_remote_tree("2222222222222222222222222222222222222222");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), runner);
    let artifacts = ArtifactCollection::new(impl_dir);
    let record = sample_record();
    let request = ReleaseRequest {
        record: &record,
        artifacts: &artifacts,
        build_dir: None,
    };

    let err = publisher
        .release_code(&request)
        .await
        .expect_err("another tree is a failure");
    assert!(
        matches!(&err, Error::Diverged(repo)
            if repo == "TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9"),
        "{err}"
    );
    let calls = publisher.runner().calls();
    assert_eq!(calls.iter().filter(|c| is_push(c)).count(), 1, "{calls:?}");
    // Nothing forces the remote: every push is a plain one.
    assert!(!calls.iter().any(|c| c.contains("--force")), "{calls:?}");
}

#[tokio::test]
async fn release_code_of_an_asset_generation_run_creates_no_repo() {
    // Asset-generation runs produce no code — their output is the recorded drawing
    // operations, uploaded separately. Releasing one must NOT create a GitHub repo
    // (or touch git at all), and the run carries no source link.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection::new(impl_dir);
    let mut record = sample_record();
    record.subject.test_type = test_cabinet_contracts::test_case::TestType::AssetGeneration;
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
async fn release_code_of_an_artifactless_failure_creates_no_repo() {
    // A harness-error or hung run is recorded only as a per-model statistic — it
    // produced no evaluable output worth releasing — so releasing one must NOT
    // create a GitHub repo (or touch git at all), even though its (code-writing)
    // test type otherwise would. The run carries no source link.
    for state in [RunState::HarnessError, RunState::Hung] {
        let dir = tempfile::tempdir().expect("tempdir");
        let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
        let artifacts = ArtifactCollection::new(impl_dir);
        let mut record = sample_record();
        record.status.state = state;
        let request = ReleaseRequest {
            record: &record,
            artifacts: &artifacts,
            build_dir: None,
        };

        let source_repo = publisher
            .release_code(&request)
            .await
            .expect("release code");

        assert_eq!(source_repo, None, "{state:?} released a source repo");
        let calls = publisher.runner().calls();
        assert!(
            !calls
                .iter()
                .any(|c| c.starts_with("gh ") || c.starts_with("git ")),
            "{state:?} release must not touch git/gh: {calls:?}"
        );
    }
}

#[tokio::test]
async fn release_playable_build_of_an_artifactless_failure_deploys_nothing() {
    // Even if a partial tree happened to build, a harness-error or hung run deploys
    // no playable build — it is a per-model statistic only.
    for state in [RunState::HarnessError, RunState::Hung] {
        let dir = tempfile::tempdir().expect("tempdir");
        let (publisher, impl_dir, build_dir) = publisher_for(dir.path(), MockRunner::new(false));
        let artifacts = ArtifactCollection::new(impl_dir);
        let mut record = sample_record();
        record.status.state = state;
        let request = ReleaseRequest {
            record: &record,
            artifacts: &artifacts,
            build_dir: Some(&build_dir),
        };

        let playable_build = publisher
            .release_playable_build(&request)
            .await
            .expect("release build");

        assert_eq!(playable_build, None, "{state:?} deployed a build");
        let calls = publisher.runner().calls();
        assert!(
            !calls.iter().any(|c| c.contains("wrangler")),
            "{state:?} release must not deploy a build: {calls:?}"
        );
    }
}

#[tokio::test]
async fn release_code_reuses_an_existing_repo_but_still_pushes() {
    let dir = tempfile::tempdir().expect("tempdir");
    // The repo already exists, so the existence probe reports it present.
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(true));
    let artifacts = ArtifactCollection::new(impl_dir);
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
    assert!(calls.iter().any(|c| is_push(c)), "{calls:?}");
}

#[tokio::test]
async fn release_code_retries_the_push_through_the_propagation_lag() {
    // GitHub rejects the first two pushes (the new org repo's write grant has not
    // propagated yet), then accepts the third. The publish must ride this out
    // rather than fail.
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) =
        publisher_for(dir.path(), MockRunner::new(false).failing_first_pushes(2));
    let artifacts = ArtifactCollection::new(impl_dir);
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
    let pushes = calls.iter().filter(|c| is_push(c)).count();
    assert_eq!(pushes, 3, "{calls:?}");
    // Every attempt asked whether the repository exists before pushing.
    assert_eq!(
        calls
            .iter()
            .filter(|c| c.starts_with("gh repo view"))
            .count(),
        3,
        "{calls:?}"
    );
    // Each refused push looked at the remote, which had no `main` yet.
    assert_eq!(calls.iter().filter(|c| is_fetch(c)).count(), 2, "{calls:?}");
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
    let artifacts = ArtifactCollection::new(impl_dir);
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
    assert!(matches!(err, Error::Command(_)), "{err}");
    let message = err.to_string();
    assert!(message.contains("403"), "{message}");

    // The push was attempted exactly `attempts` times before giving up.
    let calls = publisher.runner().calls();
    let pushes = calls.iter().filter(|c| is_push(c)).count();
    assert_eq!(pushes, 5, "{calls:?}");
}

#[tokio::test]
async fn release_playable_build_without_a_build_dir_skips_the_deploy() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir, _build_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection::new(impl_dir);
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
    assert!(scrubbed.contains(test_cabinet_redact::PLACEHOLDER));
    // Untouched files keep their exact bytes.
    assert_eq!(
        std::fs::read_to_string(&clean).expect("read html"),
        "<!doctype html><title>play</title>"
    );
    assert_eq!(std::fs::read(&binary).expect("read png"), binary_bytes);
}
