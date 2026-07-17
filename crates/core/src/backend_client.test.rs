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
    BuildCommands, ReferenceView, ReviewItem, SpecFile, TestCaseVersion, Variant, WorkspaceFile,
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
            // The debug-API handle plus a common item with an auto-validation driver
            // exercise the reporter-side validation path through materialization: the
            // handle is carried and the script is fetched, written beside the version,
            // and rooted at a host path (but never seeded).
            instrumentation: Some(crate::test_case::Instrumentation {
                handle: "__pong".to_string(),
            }),
            slug: slug.to_string(),
            version: version.to_string(),
            experimental: false,
            name: "Pong".to_string(),
            difficulty: "easy".to_string(),
            tags: vec![],
            summary: None,
            description_path: None,
            changelog_path: std::path::PathBuf::new(),
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
            asset_kind: crate::test_case::AssetKind::Sprite,
            sheet: None,
            voxel: None,
            model: None,
            ui: None,
            material: None,
            particle: None,
            audio: None,
            common_specs: vec![SpecFile {
                source_path: std::path::PathBuf::from("specs/overview.md"),
                dest: std::path::PathBuf::from("specs/overview.md"),
                kind: Default::default(),
            }],
            common_workspace: vec![WorkspaceFile {
                source_path: std::path::PathBuf::from("workspaces/base/package.json"),
                dest: std::path::PathBuf::from("package.json"),
            }],
            init: Some("npm install".to_string()),
            asset_paths: vec![std::path::PathBuf::from("assets/ball.png")],
            packages: Vec::new(),
            variants: vec![Variant {
                slug: "base".to_string(),
                name: "Base".to_string(),
                description: None,
                specs: vec![],
                workspace: None,
                references: vec![],
                proofs: vec![],
                review_items: vec![],
                domains: vec![],
                voxel: None,
                reference_impl: None,
            }],
            common_references: vec![ReferenceView {
                view: "title".to_string(),
                kind: crate::test_case::ReferenceKind::Rendered,
                source_path: std::path::PathBuf::from(
                    "/test-cases/carom/v1.0.0/references/_common/title.png",
                ),
            }],
            common_proofs: vec![],
            checks: vec![],
            common_review_items: vec![ReviewItem {
                id: "ball-spin".to_string(),
                title: "Ball spin".to_string(),
                text: "The ball spins.".to_string(),
                reference: None,
                proof: None,
                sequences: vec![],
                frames: vec![],
                weight: 1,
                graded: false,
                domain: None,
                sub_items: vec![],
                validation: Some(crate::test_case::ReviewValidation {
                    // Store-relative until materialization roots it on disk.
                    script: std::path::PathBuf::from("validation/ball-spin.mjs"),
                    script_rel: "validation/ball-spin.mjs".to_string(),
                    outputs: vec![crate::test_case::ReviewOutput {
                        id: "spin".to_string(),
                        name: "Spin".to_string(),
                        kind: crate::test_case::MediaKind::Image,
                    }],
                }),
            }],
            domains: vec![],
            cases: vec![crate::test_case::PerformanceCase {
                input: std::path::PathBuf::from("cases/small.json"),
                expected: std::path::PathBuf::from("cases/small.out"),
            }],
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
    async fn validation_files(
        &self,
        _slug: &str,
        _version: &str,
    ) -> Result<Vec<std::path::PathBuf>> {
        // The `validation/` directory holds the named driver plus a shared helper module
        // no review item names; materialization must fetch the whole set so the helper
        // lands beside the script and its `import` resolves at run time.
        Ok(vec![
            std::path::PathBuf::from("validation/ball-spin.mjs"),
            std::path::PathBuf::from("validation/_helpers.mjs"),
        ])
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
    async fn submit_review(&self, _run_id: &str, _review: &crate::review::Writeup) -> Result<()> {
        Ok(())
    }
    async fn publish_run(&self, run_id: &str) -> Result<PublishAck> {
        Ok(PublishAck {
            publish_job_id: format!("pj-{run_id}"),
            live_url: format!("/publish-jobs/pj-{run_id}/live"),
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

    // The held-out `[[case]]` scored set (input scenario + expected oracle state) is
    // materialized too, so the performance validator reads it from the store dir.
    assert!(store.join("cases/small.json").is_file());
    assert!(store.join("cases/small.out").is_file());
    assert_eq!(version.cases[0].input, store.join("cases/small.json"));
    assert_eq!(version.cases[0].expected, store.join("cases/small.out"));

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

    // Reporter-side auto-validation: the case's debug-API handle survives, the item's
    // validation driver landed on disk (fetched like an asset, never seeded), and its
    // `script` is rooted at a host path the validator runs.
    assert_eq!(
        version.instrumentation.as_ref().map(|i| i.handle.as_str()),
        Some("__pong")
    );
    assert!(store.join("validation/ball-spin.mjs").is_file());
    // The whole `validation/` bundle is materialized, not just the named driver: the
    // shared helper the script imports (`validation/_helpers.mjs`) — which no review item
    // names — must also land on disk, or the import fails when the validator runs.
    assert!(store.join("validation/_helpers.mjs").is_file());
    let item_validation = version.common_review_items[0]
        .validation
        .as_ref()
        .expect("the item carries its validation driver");
    assert_eq!(
        item_validation.script,
        store.join("validation/ball-spin.mjs")
    );
    assert_eq!(item_validation.script_rel, "validation/ball-spin.mjs");
    assert_eq!(item_validation.outputs[0].id, "spin");

    // The prerendered renderer returns exactly that set for the variant.
    let variant = version.variant("base").expect("variant");
    let renderer = PrerenderedReferenceRenderer::new(references);
    let rendered = renderer
        .render_references(&version, variant)
        .expect("render");
    assert_eq!(rendered.len(), 1);
    assert_eq!(rendered[0].view, "title");
}

/// An adversarial [`BackendClient`]: a minimal version whose only job is to drive
/// the adversarial branch of [`materialize_version`]. Its `artifact` serves bytes
/// for any key (including the `references/<id>.wasm` opponents), mirroring how the
/// real backend serves the verbatim-copied version folder.
struct AdversarialStubBackend;

#[async_trait::async_trait]
impl BackendClient for AdversarialStubBackend {
    async fn catalog(&self) -> Result<Vec<crate::test_case::TestCase>> {
        Ok(vec![])
    }
    async fn versions(&self, _slug: &str) -> Result<Vec<String>> {
        Ok(vec!["v1.0.0".to_string()])
    }
    async fn resolve_version(&self, slug: &str, version: &str) -> Result<TestCaseVersion> {
        let mut base = StubBackend.resolve_version(slug, version).await?;
        base.test_type = crate::test_case::TestType::Adversarial;
        Ok(base)
    }
    async fn artifact(
        &self,
        slug: &str,
        version: &str,
        source: &std::path::Path,
    ) -> Result<ResolvedArtifact> {
        StubBackend.artifact(slug, version, source).await
    }
    async fn references(
        &self,
        slug: &str,
        version: &str,
        variant: &str,
    ) -> Result<Vec<ResolvedReference>> {
        StubBackend.references(slug, version, variant).await
    }
    async fn prompt_template(&self, slug: &str, version: &str) -> Result<String> {
        StubBackend.prompt_template(slug, version).await
    }
    async fn submit_review(&self, run_id: &str, review: &crate::review::Writeup) -> Result<()> {
        StubBackend.submit_review(run_id, review).await
    }
    async fn publish_run(&self, run_id: &str) -> Result<PublishAck> {
        StubBackend.publish_run(run_id).await
    }
    async fn list_runs(&self, before: Option<&str>, limit: Option<usize>) -> Result<RunPage> {
        StubBackend.list_runs(before, limit).await
    }
    async fn read_run(&self, id: &str) -> Result<PublishedRun> {
        StubBackend.read_run(id).await
    }
}

#[tokio::test]
async fn materialize_writes_adversarial_opponent_wasm_to_disk() {
    let dir = tempfile::tempdir().expect("tempdir");
    let store = dir.path().join("foray-v1.0.0");
    let (version, _references) =
        materialize_version(&AdversarialStubBackend, "foray", "v1.0.0", "base", &store)
            .await
            .expect("materialize");

    // Every arena opponent (model-facing baselines plus the hidden references like
    // `fuel-probe`) is materialized under `references/<id>.wasm`, so the validator's
    // disk-based `resolve_baseline` resolves them on a backend-driven host exactly as
    // it does against a local checkout.
    for id in crate::match_play::ARENA_OPPONENT_IDS {
        assert!(
            store.join(format!("references/{id}.wasm")).is_file(),
            "opponent `{id}` wasm should be materialized"
        );
    }
    // And the validator's own resolver finds the canonical opponent.
    assert!(crate::match_play::resolve_baseline(&version, "border-soldier").is_ok());
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

/// Serve a single fixed response with a custom status line and content type, for
/// the publish-path tests (a `202` enqueue ack and an `x-ndjson` live stream),
/// returning the bound base URL.
async fn serve_once_raw(status: &str, content_type: &str, body: impl Into<String>) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let status = status.to_string();
    let content_type = content_type.to_string();
    let body = body.into();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut buf = [0u8; 1024];
        let _ = socket.read(&mut buf).await;
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
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
            orchestrator_slug: "one-shot".to_string(),
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
                comparable: Some(0.0),
                actual: Some(0.0),
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

#[tokio::test]
async fn list_runs_parses_page_cursor_links_and_reviews() {
    // The backend names the cursor `nextBefore`, serves the reviews array (with
    // reviewer identity), and serves the resolved links separately from the blob.
    let record = serde_json::to_value(sample_record("run-1")).expect("serialize");
    let body = serde_json::json!({
        "runs": [{
            "record": record,
            "published": true,
            "reviews": [{
                "reviewerId": "u1",
                "reviewer": "Ada L.",
                "username": "ada",
                "ratings": [{ "domain": "gameplay", "rating": "great" }],
                "writeup": "Plays well.",
                "checklist": [],
                "reviewedAt": "2026-06-14T11:00:00Z",
            }],
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
    assert!(run.published);
    assert_eq!(run.reviews.len(), 1);
    assert_eq!(run.reviews[0].reviewer, "Ada L.");
    assert_eq!(
        run.reviews[0].ratings,
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
        "published": true,
        "reviews": [{
            "reviewerId": "u2",
            "reviewer": "Grace H.",
            "username": "grace",
            "ratings": [{ "domain": "gameplay", "rating": "scuffed" }],
            "writeup": "Janky.",
            "checklist": [],
            "reviewedAt": "2026-06-14T12:00:00Z",
        }],
        "links": { "sourceRepo": null, "playableBuild": null },
    });
    let base = serve_once(body.to_string()).await;

    let run = HttpBackendClient::new(base)
        .read_run("run-9")
        .await
        .expect("read run");

    assert_eq!(run.record.id, "run-9");
    assert_eq!(run.reviews.len(), 1);
    assert_eq!(
        run.reviews[0].ratings,
        vec![crate::review::DomainRating {
            domain: "gameplay".to_string(),
            rating: crate::review::Rating::Scuffed,
        }]
    );
    assert_eq!(run.reviews[0].writeup, "Janky.");
    assert!(run.links.source_repo.is_none());
}

#[tokio::test]
async fn publish_run_parses_the_async_enqueue_ack() {
    // Publishing is async: the backend answers `202` with the enqueued publish
    // job's id and the live URL to observe it on.
    let body = serde_json::json!({
        "publishJobId": "pj-42",
        "liveUrl": "/publish-jobs/pj-42/live",
    });
    let base = serve_once_raw("202 Accepted", "application/json", body.to_string()).await;

    let ack = HttpBackendClient::new(base)
        .publish_run("run-42")
        .await
        .expect("publish run");

    assert_eq!(ack.publish_job_id, "pj-42");
    assert_eq!(ack.live_url, "/publish-jobs/pj-42/live");
}

#[tokio::test]
async fn watch_publish_job_streams_progress_then_the_terminal_result() {
    // The live stream is NDJSON, each line tagged with a `type` discriminator:
    // `progress` lines, then the terminal `result`.
    let stream = "\
{\"type\":\"progress\",\"message\":\"creating repository\"}\n\
{\"type\":\"progress\",\"message\":\"deploying build\"}\n\
{\"type\":\"result\",\"state\":\"succeeded\",\"sourceRepo\":\"https://example.com/repo\",\"playableBuild\":\"https://abc.pages.dev\"}\n";
    let base = serve_once_raw("200 OK", "application/x-ndjson", stream).await;

    let client = HttpBackendClient::new(base);
    let mut items = Vec::new();
    let mut on_item = |item: PublishLiveItem| items.push(item);
    client
        .watch_publish_job("pj-42", &mut on_item)
        .await
        .expect("watch publish job");

    assert_eq!(items.len(), 3);
    assert_eq!(
        items[0],
        PublishLiveItem::Progress(crate::publish_job_api::PublishProgress {
            message: "creating repository".to_string(),
        })
    );
    assert_eq!(
        items[2],
        PublishLiveItem::Result(PublishResult {
            state: crate::publish_job_api::PublishState::Succeeded,
            source_repo: Some("https://example.com/repo".to_string()),
            playable_build: Some("https://abc.pages.dev".to_string()),
            detail: None,
        })
    );
}

#[test]
fn emit_publish_line_surfaces_a_malformed_line_as_a_failure_result() {
    // A line that is neither a tagged progress nor result item ends the watch with
    // a legible failure rather than being silently dropped.
    let mut items = Vec::new();
    let mut on_item = |item: PublishLiveItem| items.push(item);
    emit_publish_line("{\"type\":\"mystery\"}", &mut on_item);
    emit_publish_line("", &mut on_item); // empty lines are skipped

    assert_eq!(items.len(), 1);
    match &items[0] {
        PublishLiveItem::Result(result) => {
            assert_eq!(result.state, crate::publish_job_api::PublishState::Failed);
            assert!(result.detail.as_deref().unwrap().contains("mystery"));
        }
        other => panic!("expected a failure result, got {other:?}"),
    }
}

#[tokio::test]
async fn resolve_version_carries_voxel_volume_and_rig() {
    // The resolved-version wire body carries a voxel case's `[voxel]` bounding
    // volume and a voxel-animation case's required `[model]` rig through to the
    // reconstructed `TestCaseVersion`. These are the twin of the backend's
    // `VersionResponse`; if `into_version` drops them (it once hardcoded both to
    // `None`), the runner seeds a voxel run with no volume and seeding fails with
    // "voxel case has no [voxel]". A voxel-animation body exercises both fields.
    let body = serde_json::json!({
        "slug": "ironward",
        "version": "v1.0.0",
        "name": "Ironward",
        "difficulty": "medium",
        "tags": ["voxel"],
        "summary": null,
        "description": null,
        "maxRuntimeSeconds": 3600,
        "testType": "asset-generation",
        "assetKind": "voxel-animation",
        "tool": { "binary": "voxel-anim", "preview": "{part}.png" },
        "output": { "actions": "{part}.actions.json" },
        "voxel": { "width": 24, "height": 12, "depth": 24, "background": "transparent" },
        "model": {
            "parts": [
                { "name": "chassis", "pivot": [12, 0, 12] },
                { "name": "turret", "parent": "chassis", "pivot": [12, 6, 12] }
            ],
            "joints": [{
                "name": "turret_yaw",
                "part": "turret",
                "kind": "rotation",
                "axis": "y",
                "pivot": [12, 6, 12],
                "min": -3.0,
                "max": 3.0,
                "rest": 0.0,
                "drive": "caller"
            }]
        },
        "promptTemplate": "",
        "commonSpecs": [],
        "assets": [],
        "variants": [],
        "commonReferences": [],
        "checks": []
    });
    let base = serve_once(body.to_string()).await;

    let version = HttpBackendClient::new(base)
        .resolve_version("ironward", "v1.0.0")
        .await
        .expect("resolve version");

    let voxel = version.voxel.expect("voxel volume survives the wire");
    assert_eq!((voxel.width, voxel.height, voxel.depth), (24, 12, 24));
    let model = version.model.expect("required rig survives the wire");
    assert_eq!(model.parts.len(), 2);
    assert_eq!(model.joints.len(), 1);
    assert_eq!(model.joints[0].name, "turret_yaw");
}

#[tokio::test]
async fn resolve_version_carries_instrumentation_and_item_validation() {
    // The resolved-version wire body carries the case's `[instrumentation]` handle and
    // each auto-validated review item's `validation` (script key + outputs) through to
    // the reconstructed `TestCaseVersion`. These are reporter-side and host-only, but
    // the validator drives them; if `into_version` drops them (it once hardcoded both
    // to `None`), auto-validation silently never runs in the deployed flow. The
    // script's `source_path` arrives as the store-relative key, which
    // `materialize_version` later roots on disk.
    let body = serde_json::json!({
        "slug": "carom",
        "version": "v2.0.0",
        "name": "Carom",
        "difficulty": "easy",
        "tags": ["end-to-end"],
        "summary": null,
        "description": null,
        "maxRuntimeSeconds": 1800,
        "testType": "end-to-end",
        "instrumentation": { "handle": "__carom" },
        "promptTemplate": "",
        "commonSpecs": [],
        "assets": [],
        "variants": [],
        "commonReferences": [],
        "commonReviewItems": [{
            "id": "ball-spin",
            "title": "Ball spin",
            "text": "The ball spins.",
            "weight": 1,
            "validation": {
                "script": "validation/ball-spin.mjs",
                "outputs": [
                    { "id": "spin", "name": "Spin", "kind": "image" }
                ]
            }
        }],
        "checks": []
    });
    let base = serve_once(body.to_string()).await;

    let version = HttpBackendClient::new(base)
        .resolve_version("carom", "v2.0.0")
        .await
        .expect("resolve version");

    assert_eq!(
        version.instrumentation.as_ref().map(|i| i.handle.as_str()),
        Some("__carom"),
        "the `[instrumentation]` handle survives the wire"
    );
    let validation = version.common_review_items[0]
        .validation
        .as_ref()
        .expect("the item's validation driver survives the wire");
    assert_eq!(
        validation.script,
        std::path::PathBuf::from("validation/ball-spin.mjs"),
        "the script is the store-relative key until materialization roots it"
    );
    assert_eq!(validation.script_rel, "validation/ball-spin.mjs");
    assert_eq!(validation.outputs.len(), 1);
    assert_eq!(validation.outputs[0].id, "spin");
    assert_eq!(validation.outputs[0].name, "Spin");
    assert_eq!(
        validation.outputs[0].kind,
        crate::test_case::MediaKind::Image
    );
}

#[tokio::test]
async fn resolve_version_decodes_object_shaped_packages() {
    // The backend serves each shipped package as a `{ name, description }` object
    // (the description is gallery-only). If the client decodes `packages` as bare
    // strings, the whole body fails with "error decoding response body" and every
    // case that declares `packages` — all full-stack cases do — refuses to resolve.
    // Keep the name, drop the description.
    let body = serde_json::json!({
        "slug": "junction",
        "version": "v1.0.0",
        "name": "Junction",
        "difficulty": "hard",
        "tags": ["simulation"],
        "summary": null,
        "description": null,
        "maxRuntimeSeconds": 3600,
        "testType": "full-stack",
        "packages": [
            { "name": "@test-cabinet/particle-runtime", "description": "produced-effect runtime" }
        ],
        "promptTemplate": "",
        "commonSpecs": [],
        "assets": [],
        "variants": [],
        "commonReferences": [],
        "checks": []
    });
    let base = serve_once(body.to_string()).await;

    let version = HttpBackendClient::new(base)
        .resolve_version("junction", "v1.0.0")
        .await
        .expect("resolve version");

    assert_eq!(version.packages, vec!["@test-cabinet/particle-runtime"]);
}
