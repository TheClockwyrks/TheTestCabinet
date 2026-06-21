//! `tcab seed` — materialize a run's seeded repository for inspection.
//!
//! A run normally seeds a fresh git repository, mounts it into a container, and
//! tears everything down when the run finishes, so there is no easy way to see
//! exactly what the harness was handed. This command runs the very same seeding
//! step and leaves the result on disk, so the inputs — the specification, the
//! seeded assets, and the fresh git history — can be examined directly.

use std::path::PathBuf;

use anyhow::Context;
use test_cabinet_core::{
    BrowserRenderer, FsRepoSeeder, ReferenceRenderer, RepoSeeder, SeedRequest, TestCaseCatalog,
};

use crate::cli::SeedArgs;

/// Seed the selected test case version into `out_dir` and report where it landed.
///
/// This deliberately reuses the production [`FsRepoSeeder`] rather than
/// re-implementing the copy, so the materialized folder stays a faithful mirror
/// of what a real run mounts into the container: the specification at the
/// repository root, assets under their version-relative paths, and a single
/// clean initial commit. Reference visuals are withheld here exactly as they are
/// for a run.
pub async fn execute(args: SeedArgs) -> anyhow::Result<()> {
    println!(
        "tcab seed: {}@{} [{}] into {}",
        args.test_case,
        args.version,
        args.variant,
        args.out_dir.display(),
    );

    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        .resolve(&args.test_case, &args.version)
        .with_context(|| format!("resolving {}@{}", args.test_case, args.version))?;
    let variant = test_case
        .variant(&args.variant)
        .with_context(|| format!("selecting variant `{}`", args.variant))?;
    let specs = test_case.seeded_specs(variant);
    let workspace = test_case.workspace_for(variant);

    std::fs::create_dir_all(&args.out_dir)
        .with_context(|| format!("creating output directory {}", args.out_dir.display()))?;

    // Render the selected variant's reference mockups to screenshots so the
    // materialized folder includes the seeded visual targets exactly as a run
    // would. A host without a browser renders nothing and seeds no reference
    // images, which is reported below rather than treated as an error.
    let references = BrowserRenderer::new()
        .render_references(&test_case, variant)
        .context("rendering reference screenshots")?;

    let seeder = FsRepoSeeder::new(&args.out_dir);
    let seeded = seeder
        .seed(&SeedRequest {
            test_case: &test_case,
            variant,
            specs: &specs,
            workspace,
            references: &references,
            // `tcab seed` only materializes a run's repository for inspection; it
            // drives no run, so there is no live viewer to stream frames to.
            live_preview: None,
        })
        .context("seeding the run repository")?;

    println!("\nseeded repository: {}", seeded.path.display());
    println!("  initial commit: {}", seeded.initial_commit);
    println!("  variant:        {}", variant.slug);
    println!("  specs:          {}", specs.len());
    for spec in &specs {
        println!("    {}", spec.dest.display());
    }
    println!("  workspace:      {}", workspace.len());
    for file in workspace {
        println!("    {}", file.dest.display());
    }
    println!("  assets:         {}", test_case.asset_paths.len());
    // The init command runs only in a real run's container, not during `tcab
    // seed`, so note it here rather than executing it against the host.
    if let Some(init) = &test_case.init {
        println!("  init (run-only): {init}");
    }
    let reference_count = test_case.references_for(variant).len();
    println!(
        "  reference imgs: {} of {}",
        references.len(),
        reference_count
    );
    if references.len() < reference_count {
        println!(
            "    (some references did not render; a headless browser is required \
             to produce the seeded reference images)"
        );
    }
    println!(
        "\nThis mirrors what the harness receives: the variant's specs, assets, and \
         rendered reference images. The reference source mockups are not seeded, \
         and the prompt is rendered separately (see `tcab prompt`)."
    );

    Ok(())
}

/// Locate the test case catalog root (see `tcab run`).
fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}
