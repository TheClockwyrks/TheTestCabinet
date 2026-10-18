//! Tests for materializing a remote test-case resolution onto disk through a mock
//! client.

use super::*;
// The stubs answer as a backend client does, with its error.
use crate::reference::ReferenceRenderer;
use crate::test_case::{
    BuildCommands, ReferenceView, ReviewItem, SpecFile, TestCaseVersion, Variant, WorkspaceFile,
};
use test_cabinet_backend_client::Result;

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
            engine_format: false,
            toolchain: None,
            // The debug-API handle plus a common item with an auto-validation driver
            // exercise the reporter-side validation path through materialization: the
            // handle is carried and the script is fetched, written beside the version,
            // and rooted at a host path (but never seeded).
            instrumentation: Some(crate::test_case::Instrumentation {
                handle: "__pong".to_string(),
                tick_hz: Some(120),
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
            asset_dimension: crate::test_case::AssetDimension::TwoD,
            sheet: None,
            voxel: None,
            model: None,
            ui: None,
            material: None,
            particle: None,
            audio: None,
            audio_packs: Vec::new(),
            common_specs: vec![SpecFile {
                source_path: std::path::PathBuf::from("specs/overview.md"),
                dest: std::path::PathBuf::from("specs/overview.md"),
                kind: Default::default(),
            }],
            common_workspace: EngineWorkspaces::from_iter([(
                crate::engine::NONE_SLUG.to_string(),
                vec![WorkspaceFile {
                    source_path: std::path::PathBuf::from("workspaces/base/package.json"),
                    dest: std::path::PathBuf::from("package.json"),
                }],
            )]),
            init: Some("npm install".to_string()),
            asset_paths: vec![std::path::PathBuf::from("assets/ball.png")],
            packages: Vec::new(),
            engines: vec![crate::EngineSupport::unbounded(crate::engine::NONE_SLUG)],
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
                reference_impls: Default::default(),
                showcase: None,
            }],
            common_references: vec![ReferenceView {
                view: "title".to_string(),
                kind: crate::test_case::ReferenceKind::Rendered,
                source_path: std::path::PathBuf::from(
                    "/test-cases/carom/versions/v1.0.0/references/_common/title.png",
                ),
            }],
            common_proofs: vec![],
            checks: vec![],
            common_review_items: vec![ReviewItem {
                failure_cap: None,
                domains: Vec::new(),
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
                scored: true,
                validation: Some(crate::test_case::ReviewValidation {
                    // Store-relative until materialization roots it on disk.
                    script: Some(std::path::PathBuf::from("validation/ball-spin.mjs")),
                    script_rel: "validation/ball-spin.mjs".to_string(),
                    engines: Vec::new(),
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
                fuel_ceiling: 5_000_000_000,
                kind: crate::validation::PerformanceCaseKind::Stress,
            }],
            errata: Vec::new(),
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
        version.common_workspace.get(crate::engine::NONE_SLUG)[0].source_path,
        store.join("workspaces/base/package.json")
    );
    assert_eq!(
        version.common_workspace.get(crate::engine::NONE_SLUG)[0].dest,
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
        item_validation.script.as_deref(),
        Some(store.join("validation/ball-spin.mjs").as_path())
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

// --- A suite-defined version -------------------------------------------------

/// The fixture suites checkout: one complete suite, `carom/versions/v1.0.0/`.
fn fixture_suites_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(crate::test_support::CONTRACT_FIXTURES)
        .join("test-suite")
}

/// Every file of the fixture suite version the store would list on
/// `suite-files`: `suite.toml`, `version.toml`, the specification folders, the definition files,
/// the validator project and the debug API declaration.
fn fixture_suite_files() -> Vec<std::path::PathBuf> {
    let root = fixture_suites_root().join("carom/versions/v1.0.0");
    let mut keys = vec![
        std::path::PathBuf::from("suite.toml"),
        std::path::PathBuf::from("version.toml"),
        std::path::PathBuf::from("debug-api.toml"),
    ];
    for dir in ["specifications", "test-cases", "validators", "debug-api"] {
        let mut stack = vec![root.join(dir)];
        while let Some(next) = stack.pop() {
            for entry in std::fs::read_dir(&next).expect("read the fixture suite") {
                let path = entry.expect("entry").path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    keys.push(
                        path.strip_prefix(&root)
                            .expect("inside the fixture")
                            .to_path_buf(),
                    );
                }
            }
        }
    }
    keys.sort();
    keys
}

/// A [`BackendClient`] serving one lowered suite definition the way the backend
/// serves a stored suite-derived version: the resolved record carries
/// store-relative keys, `artifact` serves the bytes standing at those keys, and
/// `suite_files` lists the suite's own declaration.
struct SuiteStubBackend {
    /// Where the rendered specification documents were written by lowering; they
    /// are the one input with no path inside the version folder.
    materials: std::path::PathBuf,
    /// A key the store refuses to serve, standing in for a definition referencing
    /// a file the store does not hold.
    withhold: Option<&'static str>,
}

impl SuiteStubBackend {
    /// Lower the fixture definition, then rewrite its path fields to the
    /// store-relative keys the backend serves — which is exactly what ingest
    /// stores and what `VersionBody::into_version` hands back.
    fn lowered(&self) -> TestCaseVersion {
        let catalog = crate::test_suite::TestSuiteCatalog::with_materials(
            fixture_suites_root(),
            self.materials.clone(),
        );
        let mut resolved = catalog
            .resolve_with(
                "carom",
                "v1.0.0",
                "end-to-end",
                &crate::engine::built_in_catalog(),
            )
            .expect("the fixture definition lowers");
        let root = fixture_suites_root().join("carom/versions/v1.0.0");
        resolved.root = std::path::PathBuf::new();
        resolved.prompt_path = std::path::PathBuf::from("prompt.hbs");
        for spec in &mut resolved.common_specs {
            spec.source_path = spec.dest.clone();
        }
        for file in resolved.common_workspace.files_mut() {
            file.source_path = file
                .source_path
                .strip_prefix(&root)
                .expect("a workspace file inside the version folder")
                .to_path_buf();
        }
        resolved
    }
}

#[async_trait::async_trait]
impl BackendClient for SuiteStubBackend {
    async fn catalog(&self) -> Result<Vec<crate::test_case::TestCase>> {
        Ok(vec![])
    }
    async fn versions(&self, _slug: &str) -> Result<Vec<String>> {
        Ok(vec!["v1.0.0".to_string()])
    }
    async fn resolve_version(&self, _slug: &str, _version: &str) -> Result<TestCaseVersion> {
        Ok(self.lowered())
    }
    async fn artifact(
        &self,
        _slug: &str,
        _version: &str,
        source: &std::path::Path,
    ) -> Result<ResolvedArtifact> {
        // A rendered specification stands in the materials directory; everything
        // else stands in the version folder, which is how the store holds them.
        let base = if source.starts_with("specs") {
            // Lowering writes a version's rendered documents under
            // `<materials>/<suite>/<version>/`.
            self.materials.join("carom").join("v1.0.0")
        } else if source == std::path::Path::new("suite.toml") {
            // The store holds a copy of the suite manifest beside the version's own,
            // taken from the suite folder the version sits in.
            fixture_suites_root().join("carom")
        } else {
            fixture_suites_root().join("carom/versions/v1.0.0")
        };
        // The key as the HTTP client sends it, '/'-separated on every host.
        if self.withhold == Some(forward_slash(source).as_str()) {
            return Err(Error::Publish("404 not found".to_string()));
        }
        let bytes = std::fs::read(base.join(source))
            .map_err(|err| Error::Publish(format!("404 not found: {err}")))?;
        Ok(ResolvedArtifact {
            source: source.to_path_buf(),
            bytes,
        })
    }
    async fn suite_files(&self, _slug: &str, _version: &str) -> Result<Vec<std::path::PathBuf>> {
        Ok(fixture_suite_files())
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
        Ok(std::fs::read_to_string(
            fixture_suites_root().join("carom/versions/v1.0.0/prompts/end-to-end.hbs"),
        )
        .expect("the fixture prompt template"))
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
async fn materialize_rebuilds_the_suite_version_a_definition_was_lowered_from() {
    let dir = tempfile::tempdir().expect("tempdir");
    let materials = dir.path().join("materials");
    let store = dir.path().join("carom-end-to-end-v1.0.0");
    let client = SuiteStubBackend {
        materials: materials.clone(),
        withhold: None,
    };
    let (version, _references) = materialize_version(
        &client,
        "carom-end-to-end",
        "v1.0.0",
        crate::test_suite::SUITE_VARIANT_SLUG,
        &store,
    )
    .await
    .expect("materialize");

    // Everything a run of a suite-defined case reads is on disk: the rendered
    // prompt template, the rendered specification documents the definition
    // selects, the starter workspace for each engine plus the bundled assets, and
    // the validator project the requirement outcomes come from.
    assert!(store.join("prompt.hbs").is_file());
    assert!(store.join("specs/ball-physics.md").is_file());
    assert!(store.join("specs/ball-physics/spin.md").is_file());
    assert!(store.join("workspaces/none/package.json").is_file());
    assert!(store.join("assets/player-ship/player-ship.png").is_file());
    assert!(store.join("validators/vitest.config.ts").is_file());
    assert!(store.join("validators/ball/constant-speed.ts").is_file());

    // And the suite's own declaration, so the store directory reads back as the
    // version folder it was lowered from.
    assert!(store.join("suite.toml").is_file());
    assert!(store.join("version.toml").is_file());
    assert!(store.join("test-cases/end-to-end.toml").is_file());
    assert!(
        store
            .join("specifications/ball-physics/specification.toml")
            .is_file()
    );
    assert!(store.join("debug-api.toml").is_file());

    // Which is exactly what the run path asks of it: the case reads as
    // suite-defined, and the prompt handed to the harness is the one the
    // definition renders — naming the specification documents seeding wrote.
    assert!(crate::test_suite::is_suite_defined(&version));
    let engine = crate::engine::built_in_catalog()
        .resolve(&crate::engine::EngineSelection::new("none".to_string()))
        .expect("the engineless run");
    let variant = version
        .variant(crate::test_suite::SUITE_VARIANT_SLUG)
        .expect("the implicit variant");
    let prompt = crate::render_case_prompt(&version, variant, &[], Some(&engine))
        .expect("the definition's prompt renders");
    assert!(prompt.contains("Build Carom"));
}

#[tokio::test]
async fn materialize_names_the_key_the_store_cannot_serve() {
    let dir = tempfile::tempdir().expect("tempdir");
    let materials = dir.path().join("materials");
    let store = dir.path().join("carom-end-to-end-v1.0.0");
    // The validator project is part of what a suite-derived version references, so
    // a store that cannot serve one of its files must fail the run naming it.
    let client = SuiteStubBackend {
        materials: materials.clone(),
        withhold: Some("validators/ball/constant-speed.ts"),
    };
    let err = materialize_version(
        &client,
        "carom-end-to-end",
        "v1.0.0",
        crate::test_suite::SUITE_VARIANT_SLUG,
        &store,
    )
    .await
    .expect_err("a version referencing an unservable file fails");
    let message = err.to_string();
    assert!(
        message.contains("validators/ball/constant-speed.ts"),
        "the failure should name the missing key, got: {message}"
    );
}
