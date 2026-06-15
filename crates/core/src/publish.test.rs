//! Tests for run publishing: slug derivation, hosting URLs, the deploy
//! workflow, dataset appends, and the GitHub publish orchestration (driven
//! through a mock command runner so no real `gh`/`git`/network is touched).

use std::sync::Mutex;

use super::*;
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::review::Rating;
use crate::run_record::{HarnessSlug, RunEnvironment, RunState, RunStatus, RunSubject};
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
            // Dots are not DNS-label-safe; the slug must reduce them to hyphens.
            model_id: "gpt-5.4-mini".to_string(),
        },
        environment: RunEnvironment {
            os: "Debian GNU/Linux 12 (bookworm)".to_string(),
            container_image: "test-cabinet/codex:latest".to_string(),
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
fn subdomain_label_respects_the_dns_limit_without_a_trailing_hyphen() {
    // A slug whose 63rd character is a hyphen must not leave one dangling.
    let slug = format!("{}-{}", "a".repeat(62), "bcd");
    let label = subdomain_label(&slug);
    assert!(label.len() <= 63);
    assert!(!label.ends_with('-'));
    assert_eq!(label, "a".repeat(62));
}

#[test]
fn config_derives_repo_and_build_addresses() {
    let config = PublishConfig::default();
    let record = sample_record();

    assert_eq!(
        config.repo_name(&record),
        "tcab-pong-codex-gpt-5-4-mini-d483a2f9"
    );
    assert_eq!(
        config.repo_url(&record),
        "https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9"
    );
    assert_eq!(
        config.build_url(&record),
        "https://pong-codex-gpt-5-4-mini-d483a2f9.testcabinet.ai/"
    );
}

#[test]
fn deploy_workflow_is_manual_and_pins_the_custom_domain() {
    let yaml = deploy_workflow_yaml("pong-codex-d483a2f9.testcabinet.ai");
    assert!(yaml.contains("workflow_dispatch:"));
    assert!(!yaml.contains("push:"));
    assert!(yaml.contains("echo \"pong-codex-d483a2f9.testcabinet.ai\""));
    assert!(!yaml.contains("__FQDN__"));
}

#[test]
fn dataset_append_is_idempotent() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("runs.json");
    let record = sample_record();

    assert!(append_record_to_dataset(&path, &record).expect("first append"));
    // A second append of the same id is a no-op.
    assert!(!append_record_to_dataset(&path, &record).expect("second append"));

    let stored: Vec<RunRecord> =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("read")).expect("parse");
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].id, record.id);
}

/// A [`CommandRunner`] that records every invocation and returns canned results,
/// so publish orchestration can be asserted without a real `gh`/`git`.
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
        // `gh repo view` is the existence probe; everything else "succeeds".
        let is_repo_view =
            program == "gh" && args.first() == Some(&"repo") && args.get(1) == Some(&"view");
        Ok(CommandOutput {
            success: if is_repo_view { self.repo_exists } else { true },
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}

fn publisher_for(dir: &Path, runner: MockRunner) -> (GitHubPublisher<MockRunner>, PathBuf) {
    let impl_dir = dir.join("implementation");
    std::fs::create_dir_all(&impl_dir).expect("impl dir");
    let config = PublishConfig {
        dataset_path: dir.join("runs.json"),
        writeups_dir: dir.join("writeups"),
        site_repo_root: dir.to_path_buf(),
        ..PublishConfig::default()
    };
    (GitHubPublisher::new(config, runner), impl_dir)
}

#[tokio::test]
async fn publish_creates_private_repo_fills_links_and_records_dataset() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (publisher, impl_dir) = publisher_for(dir.path(), MockRunner::new(false));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir.clone(),
    };
    let record = sample_record();
    let writeup = sample_writeup();
    let request = PublishRequest {
        record: &record,
        artifacts: &artifacts,
        writeup: &writeup,
    };

    let outcome = publisher.publish(&request).await.expect("publish");

    assert!(outcome.newly_published);
    assert_eq!(
        outcome.source_repo,
        "https://github.com/TheClockwyrks/tcab-pong-codex-gpt-5-4-mini-d483a2f9"
    );
    assert_eq!(
        outcome.playable_build,
        "https://pong-codex-gpt-5-4-mini-d483a2f9.testcabinet.ai/"
    );

    // The manual deploy workflow was seeded into the implementation.
    let workflow = impl_dir.join(".github/workflows/deploy.yml");
    let yaml = std::fs::read_to_string(&workflow).expect("workflow written");
    assert!(yaml.contains("pong-codex-gpt-5-4-mini-d483a2f9.testcabinet.ai"));

    // The repo was created private and pushed; the dataset commit was staged
    // locally but never pushed.
    let calls = publisher.runner().calls();
    assert!(
        calls.iter().any(|c| c.contains("gh repo create")
            && c.contains("--private")
            && c.contains("--push"))
    );
    assert!(
        !calls
            .iter()
            .any(|c| c.starts_with("git push") || c.contains("gh repo edit"))
    );
    assert!(
        calls
            .iter()
            .any(|c| c.starts_with("git commit") && c.contains("Publish run"))
    );

    // The writeup was published to the site in canonical form, carrying its
    // rating, and staged in the publish commit.
    let writeup_file = dir
        .path()
        .join("writeups")
        .join(format!("{}.md", record.id));
    let written = std::fs::read_to_string(&writeup_file).expect("writeup written");
    assert_eq!(written, writeup.to_file_string());
    assert!(written.contains("rating: great"));
    assert!(
        calls
            .iter()
            .any(|c| c.starts_with("git add") && c.contains(".md"))
    );

    // The record landed in the dataset with its links filled in.
    let stored: Vec<RunRecord> =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("runs.json")).expect("read"))
            .expect("parse");
    assert_eq!(stored.len(), 1);
    assert_eq!(
        stored[0].links.source_repo.as_deref(),
        Some(outcome.source_repo.as_str())
    );
    assert_eq!(
        stored[0].links.playable_build.as_deref(),
        Some(outcome.playable_build.as_str())
    );
}

#[tokio::test]
async fn publish_is_idempotent_when_already_released() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Repo already exists and the dataset already holds the record.
    let (publisher, impl_dir) = publisher_for(dir.path(), MockRunner::new(true));
    let artifacts = ArtifactCollection {
        repo_path: impl_dir,
    };
    let mut record = sample_record();
    record.links = RunLinks {
        source_repo: Some(publisher.config().repo_url(&record)),
        playable_build: Some(publisher.config().build_url(&record)),
    };
    append_record_to_dataset(&publisher.config().dataset_path, &record).expect("seed dataset");

    let writeup = sample_writeup();
    let request = PublishRequest {
        record: &record,
        artifacts: &artifacts,
        writeup: &writeup,
    };
    let outcome = publisher.publish(&request).await.expect("publish");

    assert!(!outcome.newly_published);
    let calls = publisher.runner().calls();
    assert!(!calls.iter().any(|c| c.contains("gh repo create")));
}
