//! Tests for the backend client: the content-hash recipe (which must agree with
//! the backend's), the image tag derivation, and materializing a remote
//! resolution onto disk through a mock client.

use super::*;
use crate::reference::ReferenceRenderer;
use crate::test_case::{BuildCommands, ReferenceView, SpecFile, TestCaseVersion, Variant};

/// The §4 recipe, recomputed independently here so a regression in
/// `container_content_hash` is caught without importing the backend.
fn expected_hash(files: &[(&str, &[u8])]) -> String {
    use sha2::{Digest, Sha256};
    let mut pairs: Vec<(String, String)> = files
        .iter()
        .map(|(path, bytes)| (path.to_string(), hex::encode(Sha256::digest(bytes))))
        .collect();
    pairs.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut hasher = Sha256::new();
    for (path, sha) in &pairs {
        hasher.update(path.as_bytes());
        hasher.update(b"\n");
        hasher.update(sha.as_bytes());
        hasher.update(b"\n");
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

#[test]
fn content_hash_matches_the_recipe_and_is_order_independent() {
    let def_a = ContainerDefinition {
        harness: "claude".to_string(),
        content_hash: String::new(),
        builds_from: Some("base".to_string()),
        files: vec![
            ContainerFile {
                path: std::path::PathBuf::from("Dockerfile"),
                bytes: b"FROM test-cabinet/base\n".to_vec(),
            },
            ContainerFile {
                path: std::path::PathBuf::from("entrypoint.sh"),
                bytes: b"#!/bin/sh\n".to_vec(),
            },
        ],
    };
    // Same files, different traversal order — the hash must agree.
    let mut def_b = def_a.clone();
    def_b.files.reverse();

    let expected = expected_hash(&[
        ("Dockerfile", b"FROM test-cabinet/base\n"),
        ("entrypoint.sh", b"#!/bin/sh\n"),
    ]);
    assert_eq!(container_content_hash(&def_a), expected);
    assert_eq!(container_content_hash(&def_b), expected);
}

#[test]
fn image_tag_strips_the_sha256_prefix() {
    let def = ContainerDefinition {
        harness: "claude".to_string(),
        content_hash: "sha256:1a7bdeadbeef".to_string(),
        builds_from: Some("base".to_string()),
        files: vec![],
    };
    assert_eq!(image_tag(&def), "test-cabinet/claude:1a7bdeadbeef");
}

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
            }],
            common_references: vec![ReferenceView {
                view: "title".to_string(),
                source_path: std::path::PathBuf::from(
                    "/test-cases/pong/v1.0.0/references/_common/title.png",
                ),
            }],
            checks: vec![],
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
    async fn resolve_container(&self, _harness: &str) -> Result<ContainerDefinition> {
        unimplemented!()
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
