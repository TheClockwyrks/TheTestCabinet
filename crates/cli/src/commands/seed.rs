//! `tcab seed` — materialize a run's seeded repository for inspection.
//!
//! A run normally seeds a fresh git repository, mounts it into a container, and
//! tears everything down when the run finishes, so there is no easy way to see
//! exactly what the harness was handed. This command runs the very same seeding
//! step and leaves the result on disk, so the inputs — the specification, the
//! seeded assets, and the fresh git history — can be examined directly.

use std::path::PathBuf;

use anyhow::Context;
use test_cabinet_core::{FsRepoSeeder, RepoSeeder, SeedRequest, TestCaseCatalog};

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
        "tcab seed: {}@{} into {}",
        args.test_case,
        args.version,
        args.out_dir.display(),
    );

    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        .resolve(&args.test_case, &args.version)
        .with_context(|| format!("resolving {}@{}", args.test_case, args.version))?;

    std::fs::create_dir_all(&args.out_dir)
        .with_context(|| format!("creating output directory {}", args.out_dir.display()))?;

    let seeder = FsRepoSeeder::new(&args.out_dir);
    let seeded = seeder
        .seed(&SeedRequest {
            test_case: &test_case,
        })
        .context("seeding the run repository")?;

    let spec_name = test_case
        .spec_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("specification");

    println!("\nseeded repository: {}", seeded.path.display());
    println!("  initial commit: {}", seeded.initial_commit);
    println!("  specification:  {spec_name}");
    println!("  assets:         {}", test_case.asset_paths.len());
    println!(
        "\nThis mirrors what the harness receives. Reference visuals are \
         validation-only and are never seeded."
    );

    Ok(())
}

/// Locate the test case catalog root (see `tcab run`).
fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}
