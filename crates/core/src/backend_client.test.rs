//! Tests for the backend client: parsing a resolved container image reference
//! and materializing a remote test-case resolution onto disk through a mock
//! client.

use super::*;
use crate::metrics::{Cost, RunMetrics, TokenCounts};
use crate::reference::ReferenceRenderer;
use crate::run_record::{
    HarnessSlug, RunEnvironment, RunLinks, RunRecord, RunState, RunStatus, RunSubject, RunTooling,
};
use crate::test_case::{
    BuildCommands, ReferenceView, SpecFile, TestCaseVersion, Variant, WorkspaceFile,
};
use crate::validation::ValidationSummary;

/// A minimal in-memory [`BackendClient`] returning a one-spec, one-asset,
/// one-common-reference version so materialization can be exercised end to end.
struct StubBackend;

#[async_trait::async_trait]
impl BackendClient for StubBackend {
    async fn catalog(&self) -> Result<Vec<crate::test_case::TestCase>> {
        Ok(vec![])
    }
    async fn versions(&self, _slug: &str) -> Result<Vec<String>> {
        Ok(vec!["v1.0.0".to_string()])
    }
    async fn resolve_version(&self, slug: &str, version: &str) -> Result<TestCaseVersion> {
        Ok(TestCaseVersion {
            slug: slug.to_string(),
            version: version.to_string(),
            name: "Pong".to_string(),
            difficulty: "easy".to_string(),
            tags: vec![],
            summary: None,
            description_path: None,
            root: std::path::PathBuf::new(),
            prompt_path: std::path::PathBuf::from("prompt.hbs"),
            max_runtime_seconds: 1800,
            test_type: crate::test_case::TestType::EndToEnd,
            build: Some(BuildCommands {
                install: "npm ci".to_string(),
                build: "npm run build".to_string(),
                module: None,
            }),
            canvas: None,
            tool: None,
            output: None,
            contract: None,
            sandbox: None,
            simulation: None,
            r#match: None,
            replay: None,
            common_specs: vec![SpecFile {
                source_path: std::path::PathBuf::from("specs/overview.md"),
                dest: std::path::PathBuf::from("specs/overview.md"),
            }],
            common_workspace: vec![WorkspaceFile {
                source_path: std::path::PathBuf::from("workspaces/base/package.json"),
                dest: std::path::PathBuf::from("package.json"),
            }],
            init: Some("npm install".to_string()),
            asset_paths: vec![std::path::PathBuf::from("assets/ball.png")],
            variants: vec![Variant {
                slug: "base".to_string(),
                name: "Base".to_string(),
                description: None,
                specs: vec![],
                workspace: None,
                references: vec![],
                proofs: vec![],
                review_items: vec![],
            }],
            common_references: vec![ReferenceView {
                view: "title".to_string(),
                kind: crate::test_case::ReferenceKind::Rendered,
                source_path: std::path::PathBuf::from(
                    "/test-cases/pong/v1.0.0/references/_common/title.png",
                ),
            }],
            common_proofs: vec![],
            checks: vec![],
            common_review_items: vec![],
            domains: vec![],
        })
    }
    async fn artifact(
        &self,
        _slug: &str,
        _version: &str,
        source: &std::path::Path,
    ) -> Result<ResolvedArtifact> {
        Ok(ResolvedArtifact {
            source: source.to_path_buf(),
            bytes: format!("body of {}", source.display()).into_bytes(),
        })
    }
    async fn references(
        &self,
        _slug: &str,
        _version: &str,
        _variant: &str,
    ) -> Result<Vec<ResolvedReference>> {
        Ok(vec![ResolvedReference {
            view: "title".to_string(),
            kind: crate::test_case::MediaKind::Image,
            extension: "png".to_string(),
            bytes: b"\x89PNG\r\n".to_vec(),
        }])
    }
    async fn prompt_template(&self, _slug: &str, _version: &str) -> Result<String> {
        Ok("Build {{variant.name}} at {{workspace}}".to_string())
    }
    async fn publish_run(
        &self,
        record: &crate::run_record::RunRecord,
        _review: &crate::review::Writeup,
        _links: &crate::run_record::RunLinks,
        _events: &[crate::event::HarnessEvent],
    ) -> Result<PublishAck> {
        Ok(PublishAck {
            id: record.id.clone(),
            newly_published: true,
        })
    }
    async fn list_runs(&self, _before: Option<&str>, _limit: Option<usize>) -> Result<RunPage> {
        Ok(RunPage {
            runs: vec![],
            next_before: None,
        })
    }
    async fn read_run(&self, _id: &str) -> Result<PublishedRun> {
        unimplemented!("not exercised by materialize tests")
    }
}

#[tokio::test]
async fn materialize_writes_inputs_to_disk_and_roots_paths() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = dir.path().join("pong-v1.0.0");
    let (version, references) = materialize_version(&StubBackend, "pong", "v1.0.0", "base", &store)
        .await
        .expect("materialize");

    // The prompt template, spec source, asset, and rendered reference all landed
    // on disk under the store dir.
    assert!(store.join("prompt.hbs").is_file());
    assert!(store.join("specs/overview.md").is_file());
    assert!(store.join("workspaces/base/package.json").is_file());
    assert!(store.join("assets/ball.png").is_file());
    assert!(store.join("references/_common/title.png").is_file());

    // The version's path fields are rooted at the store dir (host paths now), so
    // the existing seeder/prompt-renderer/validator read them unchanged.
    assert_eq!(version.root, store);
    assert_eq!(version.prompt_path, store.join("prompt.hbs"));
    assert_eq!(
        version.common_specs[0].source_path,
        store.join("specs/overview.md")
    );
    // The workspace file is rooted at the store dir too, with its run-relative
    // dest preserved, and the init command carried through.
    assert_eq!(
        version.common_workspace[0].source_path,
        store.join("workspaces/base/package.json")
    );
    assert_eq!(
        version.common_workspace[0].dest,
        std::path::PathBuf::from("package.json")
    );
    assert_eq!(version.init.as_deref(), Some("npm install"));
    assert_eq!(
        version.common_references[0].source_path,
        store.join("references/_common/title.png")
    );

    // The returned rendered references point at the materialized PNGs.
    assert_eq!(references.len(), 1);
    assert_eq!(references[0].view, "title");
    assert_eq!(
        references[0].media_path,
        store.join("references/_common/title.png")
    );

    // The prerendered renderer returns exactly that set for the variant.
    let variant = version.variant("base").expect("variant");
    let renderer = PrerenderedReferenceRenderer::new(references);
    let rendered = renderer
        .render_references(&version, variant)
        .expect("render");
    assert_eq!(rendered.len(), 1);
    assert_eq!(rendered[0].view, "title");
}

/// Serve a single fixed `200` JSON response on a fresh local port, returning the
/// bound base URL. The one-shot server answers exactly one request, which is all
/// a single `list_runs` / `read_run` call makes.
async fn serve_once(json: impl Into<String>) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let json = json.into();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
        // Drain the request headers (we don't route on them — one endpoint).
        let mut buf = [0u8; 1024];
        let _ = socket.read(&mut buf).await;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            json.len(),
            json
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.flush().await;
    });
    format!("http://{addr}")
}

/// A minimal valid run record whose `links` are empty, so a test can prove the
/// backend's separately-served links are what end up on the resolved run.
fn sample_record(id: &str) -> RunRecord {
    RunRecord {
        id: id.to_string(),
        started_at: "2026-06-14T10:00:00Z".to_string(),
        finished_at: "2026-06-14T10:05:00Z".to_string(),
        subject: RunSubject {
            test_case_slug: "pong".to_string(),
            test_case_version: "v1.0.0".to_string(),
            test_type: crate::test_case::TestType::EndToEnd,
            variant: "base".to_string(),
            harness_slug: HarnessSlug::Claude,
            harness_version: None,
            model_id: "anthropic/claude-opus-4".to_string(),
        },
        tooling: RunTooling {
            test_cabinet_commit: None,
        },
        environment: RunEnvironment {
            os: "Debian GNU/Linux 12".to_string(),
            container_image: "ghcr.io/example/test-cabinet-claude@sha256:abc".to_string(),
            node_version: None,
            auth_mode: crate::run_record::AuthMode::ApiKey,
        },
        metrics: RunMetrics {
            run_time_seconds: 300.0,
            tokens: TokenCounts {
                uncached_input: Some(1),
                cached_input: Some(0),
                output: Some(1),
                reasoning: Some(0),
            },
            cost: Cost {
                comparable: 0.0,
                actual: 0.0,
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
        },
        links: RunLinks::default(),
        status: RunStatus {
            state: RunState::Completed,
            detail: None,
        },
    }
}

#[tokio::test]
async fn list_runs_parses_page_cursor_links_and_review() {
    // The backend names the cursor `nextBefore`, serves the review's per-domain
    // ratings, and serves the resolved links separately from the record blob.
    let record = serde_json::to_value(sample_record("run-1")).expect("serialize");
    let body = serde_json::json!({
        "runs": [{
            "record": record,
            "review": {
                "ratings": [{ "domain": "gameplay", "rating": "great" }],
                "writeup": "Plays well.",
                "checklist": [],
            },
            "links": {
                "sourceRepo": "https://example.com/repo",
                "playableBuild": "https://abc.pages.dev",
            },
        }],
        "nextBefore": "2026-06-14T10:00:00Z",
    });
    let base = serve_once(body.to_string()).await;

    let page = HttpBackendClient::new(base)
        .list_runs(None, Some(10))
        .await
        .expect("list runs");

    assert_eq!(page.next_before.as_deref(), Some("2026-06-14T10:00:00Z"));
    assert_eq!(page.runs.len(), 1);
    let run = &page.runs[0];
    assert_eq!(run.record.id, "run-1");
    assert_eq!(
        run.review.ratings,
        vec![crate::review::DomainRating {
            domain: "gameplay".to_string(),
            rating: crate::review::Rating::Great,
        }]
    );
    // The separately-served links win and are merged onto the record blob (whose
    // own links were empty), so both views agree.
    assert_eq!(
        run.links.source_repo.as_deref(),
        Some("https://example.com/repo")
    );
    assert_eq!(
        run.record.links.playable_build.as_deref(),
        Some("https://abc.pages.dev")
    );
}

#[tokio::test]
async fn read_run_parses_a_single_stored_run() {
    let record = serde_json::to_value(sample_record("run-9")).expect("serialize");
    let body = serde_json::json!({
        "record": record,
        "review": {
            "ratings": [{ "domain": "gameplay", "rating": "scuffed" }],
            "writeup": "Janky.",
            "checklist": [],
        },
        "links": { "sourceRepo": null, "playableBuild": null },
    });
    let base = serve_once(body.to_string()).await;

    let run = HttpBackendClient::new(base)
        .read_run("run-9")
        .await
        .expect("read run");

    assert_eq!(run.record.id, "run-9");
    assert_eq!(
        run.review.ratings,
        vec![crate::review::DomainRating {
            domain: "gameplay".to_string(),
            rating: crate::review::Rating::Scuffed,
        }]
    );
    assert_eq!(run.review.writeup, "Janky.");
    assert!(run.links.source_repo.is_none());
}
