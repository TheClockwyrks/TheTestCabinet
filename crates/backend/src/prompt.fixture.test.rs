//! A store holding a suite-defined version whose prompt uses the whole documented
//! suite context, ingested both as an exported version and as a preview, for the
//! tests of every reader that renders a stored version's prompt.
//!
//! The suite is the committed fixture at `crates/contracts/fixtures/test-suite/carom/`,
//! with the `end-to-end` definition's template replaced by one naming `workspace`,
//! `engine` and every covered specification — the shape a wizard-authored prompt
//! takes, and the one the authored-case context cannot render.

use std::path::{Path, PathBuf};

use tempfile::TempDir;
use test_cabinet_core::TestCaseVersion;
use test_cabinet_core::engine::{EngineCatalog, EngineSelection, ResolvedEngine};
use test_cabinet_core::test_suite::{PREVIEWS_DIR, TEST_SUITES_DIR, TestSuiteCatalog};

use crate::ingest::{IngestRequest, Ingestor, copy_tree};
use crate::store::DefinitionStore;

/// The suite the fixture ingests.
pub const SUITE: &str = "carom";

/// The exported suite version.
pub const EXPORTED: &str = "v1.0.0";

/// The preview of the suite's `main` draft.
pub const PREVIEW: &str = "v0.0.0-preview.main";

/// The catalog identity of the definition whose template uses the whole context.
pub const CASE: &str = "carom-end-to-end";

/// The template the `end-to-end` definition is given.
pub const TEMPLATE: &str = "Build Carom in the workspace at `{{workspace}}`.\n\
\n\
The specifications describing what to build are seeded into the workspace:\n\
\n\
{{#each specifications}}\n\
- {{this.name}} (`{{this.id}}`, {{this.summary}}): `{{this.path}}`\n\
{{/each}}\n\
\n\
{{#if engine.docs}}\n\
The build runs on the {{engine.name}} engine (`{{engine.slug}}`), documented at `{{engine.docs}}`.\n\
{{else}}\n\
The build runs on no engine, so its runtime is its own work.\n\
{{/if}}\n";

/// A checkout and the store it was ingested into.
pub struct IngestedSuite {
    /// Holds the checkout, the store and the rendered specification materials.
    pub dir: TempDir,
    /// The store every version was ingested into.
    pub store: DefinitionStore,
}

impl IngestedSuite {
    /// Ingest the fixture suite, with its preview, into a fresh store.
    pub fn new() -> Self {
        let dir = TempDir::new().expect("a temporary directory");
        let checkout = dir.path().join("checkout");
        std::fs::create_dir_all(checkout.join("test-cases")).expect("the authored tree");
        let suites = checkout.join(TEST_SUITES_DIR);
        copy_tree(&fixture(), &suites).expect("the fixture copies");
        let exported = suites.join(SUITE).join("versions").join(EXPORTED);
        write_template(&exported);
        write_preview(&suites, &exported);

        let store = DefinitionStore::open(dir.path().join("store")).expect("the store opens");
        let report = Ingestor::new(&checkout, &store)
            .with_previews(true)
            .scan(&IngestRequest::default())
            .expect("the scan succeeds");
        for version in [EXPORTED, PREVIEW] {
            assert!(
                report
                    .test_case_versions
                    .iter()
                    .any(|case| case.slug == CASE && case.version == version && case.ingested),
                "{CASE}@{version} was not ingested: {report:?}"
            );
        }
        Self { dir, store }
    }

    /// Resolve the fixture definition at `version` straight off the checkout, as the
    /// run path resolves the case it runs.
    pub fn resolve(&self, version: &str) -> TestCaseVersion {
        let suites = self.dir.path().join("checkout").join(TEST_SUITES_DIR);
        let materials = self.dir.path().join(format!("materials-{version}"));
        TestSuiteCatalog::with_materials(&suites, materials)
            .with_previews(suites.join(PREVIEWS_DIR))
            .resolve(SUITE, version, "end-to-end")
            .unwrap_or_else(|err| panic!("{CASE}@{version} should resolve: {err}"))
    }
}

/// The engine a run selected.
pub fn engine(slug: &str) -> ResolvedEngine {
    EngineCatalog::new()
        .resolve(&EngineSelection::new(slug))
        .unwrap_or_else(|err| panic!("the {slug} engine resolves: {err}"))
}

/// The committed fixture suites checkout — the directory holding `carom/`.
fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/test-suite")
}

/// Give the `end-to-end` definition of the version folder at `version` the template.
fn write_template(version: &Path) {
    std::fs::write(version.join("prompts/end-to-end.hbs"), TEMPLATE)
        .expect("the template is written");
}

/// Write the preview of `main`, as The Spec Cabinet does: the suite manifest copy,
/// and the tree carrying the preview version and `experimental`.
fn write_preview(suites: &Path, exported: &Path) {
    let dir = suites.join(PREVIEWS_DIR).join(SUITE);
    let tree = dir.join(PREVIEW);
    copy_tree(exported, &tree).expect("the tree copies");
    std::fs::copy(
        suites.join(SUITE).join("suite.toml"),
        dir.join("suite.toml"),
    )
    .expect("the suite manifest copies");
    let manifest = tree.join("version.toml");
    let text = std::fs::read_to_string(&manifest).expect("the version manifest reads");
    let text = text.replace("version = \"1.0.0\"", "version = \"0.0.0-preview.main\"")
        + "experimental = true\n";
    std::fs::write(&manifest, text).expect("the version manifest writes");
}
