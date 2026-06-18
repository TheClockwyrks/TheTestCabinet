//! Tests for the backend client: parsing a resolved container image reference
//! and materializing a remote test-case resolution onto disk through a mock
//! client.

use super::*;
use crate::reference::ReferenceRenderer;
use crate::test_case::{BuildCommands, ReferenceView, SpecFile, TestCaseVersion, Variant};

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
            build: BuildCommands {
                install: "npm ci".to_string(),
                build: "npm run build".to_string(),
            },
            common_specs: vec![SpecFile {
                source_path: std::path::PathBuf::from("specs/overview.md"),
                dest: std::path::PathBuf::from("specs/overview.md"),
            }],
            asset_paths: vec![std::path::PathBuf::from("assets/ball.png")],
            variants: vec![Variant {
                slug: "base".to_string(),
                name: "Base".to_string(),
                description: None,
                specs: vec![],
                references: vec![],
                review_items: vec![],
            }],
            common_references: vec![ReferenceView {
                view: "title".to_string(),
                source_path: std::path::PathBuf::from(
                    "/test-cases/pong/v1.0.0/references/_common/title.png",
                ),
            }],
            checks: vec![],
            common_review_items: vec![],
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
            png_bytes: b"\x89PNG\r\n".to_vec(),
        }])
    }
    async fn prompt_template(&self, _slug: &str, _version: &str) -> Result<String> {
        Ok("Build {{variant.name}} at {{workspace}}".to_string())
    }
    async fn resolve_container(&self, harness: &str) -> Result<ContainerImage> {
        Ok(ContainerImage {
            harness: harness.to_string(),
            reference: format!("ghcr.io/example/test-cabinet-{harness}@sha256:deadbeef"),
        })
    }
    async fn publish_run(
        &self,
        record: &crate::run_record::RunRecord,
        _review: &crate::review::Writeup,
        _links: &crate::run_record::RunLinks,
    ) -> Result<PublishAck> {
        Ok(PublishAck {
            id: record.id.clone(),
            newly_published: true,
        })
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
    assert_eq!(
        version.common_references[0].source_path,
        store.join("references/_common/title.png")
    );

    // The returned rendered references point at the materialized PNGs.
    assert_eq!(references.len(), 1);
    assert_eq!(references[0].view, "title");
    assert_eq!(
        references[0].image_path,
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
/// a single `resolve_container` call makes.
async fn serve_once(json: &'static str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
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

#[tokio::test]
async fn resolve_container_parses_harness_and_reference() {
    let base = serve_once(
        r#"{"harness":"claude","reference":"ghcr.io/theclockwyrks/test-cabinet-claude@sha256:1a7b"}"#,
    )
    .await;
    let client = HttpBackendClient::new(base);
    let image = client.resolve_container("claude").await.expect("resolve");
    assert_eq!(image.harness, "claude");
    assert_eq!(
        image.reference,
        "ghcr.io/theclockwyrks/test-cabinet-claude@sha256:1a7b"
    );
}
