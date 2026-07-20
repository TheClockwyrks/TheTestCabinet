//! `tcab prompt` — print the prompt a run hands to the harness.
//!
//! The instruction a harness receives is rendered from a test case's
//! `prompt.hbs` template, with the in-container workspace and the selected
//! variant's seeded spec paths interpolated in. Unlike `tcab seed`, nothing is
//! written to disk: the prompt is passed to the harness at run time, not seeded
//! into the repository, so it is printed to stdout for inspection instead.

use std::path::PathBuf;

use anyhow::Context;
use test_cabinet_core::{TestCaseCatalog, render_prompt};

use crate::cli::PromptArgs;

/// Resolve the test case version and variant, render the prompt, and print it.
pub async fn execute(args: PromptArgs) -> anyhow::Result<()> {
    let catalog = TestCaseCatalog::new(catalog_root());
    let test_case = catalog
        .resolve(&args.test_case, &args.version)
        .with_context(|| format!("resolving {}@{}", args.test_case, args.version))?;
    let variant = test_case
        .variant(&args.variant)
        .with_context(|| format!("selecting variant `{}`", args.variant))?;

    // A locally-inspected prompt has no backend to source earlier game-jam entries
    // from, so it renders with none (and thus never the distinctness section).
    let prompt = render_prompt(&test_case, variant, &[])
        .with_context(|| format!("rendering prompt for variant `{}`", args.variant))?;

    // The rendered prompt is the entire output, with no decoration, so it can be
    // piped or diffed directly.
    println!("{prompt}");
    Ok(())
}

/// Locate the test case catalog root, honoring `TCAB_TEST_CASES_DIR` like the
/// other commands and otherwise defaulting to `test-cases`.
fn catalog_root() -> PathBuf {
    std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test-cases"))
}
