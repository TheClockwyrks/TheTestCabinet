//! `tcab test-case-groups` — list the test-case groups and their member cases.
//!
//! A test-case group is a repo-defined, ordered set of related test-case or
//! game-jam slugs, walked from `test-case-groups/<slug>/test-case-group.toml`;
//! the home page renders one cross-case leaderboard per group. Unlike the
//! harness/orchestrator/engine listings nothing here is embedded: the catalogue
//! is read from the checkout at run time, like the test-case catalog, so this
//! listing shows exactly what an ingest of the same checkout would serve.

use anyhow::{Context, Result};
use test_cabinet_core::{TestCaseGroup, TestCaseGroupCatalog};

use crate::cli::TestCaseGroupsArgs;

/// List every test-case group alongside its name and member cases.
pub async fn execute(args: TestCaseGroupsArgs) -> Result<()> {
    let listing = TestCaseGroupCatalog::new(groups_root())
        .list()
        .context("loading the test-case-group catalogue")?;

    if args.json {
        println!("{}", render_json(&listing));
    } else {
        print!("{}", render_table(&listing));
    }

    Ok(())
}

/// Locate the group catalogue root: the `test-case-groups/` **sibling** of the
/// test case catalog (the same relationship `game-jams/` has to `test-cases/`),
/// so honoring `TCAB_TEST_CASES_DIR` like the other local commands relocates
/// this catalogue along with the cases it names.
fn groups_root() -> std::path::PathBuf {
    let cases_root = std::env::var_os("TCAB_TEST_CASES_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("test-cases"));
    match cases_root.parent() {
        // A bare relative `test-cases` has the empty path as its parent, which
        // joins back to a bare relative `test-case-groups` — the default.
        Some(parent) => parent.join("test-case-groups"),
        None => std::path::PathBuf::from("test-case-groups"),
    }
}

/// Render the listing as an aligned, human-readable table, in the catalogue's
/// display order (rank ascending then name, unranked last). One line per group,
/// each line newline-terminated.
fn render_table(listing: &[TestCaseGroup]) -> String {
    let slug_width = listing
        .iter()
        .map(|group| group.slug.len())
        .max()
        .unwrap_or(0);
    let name_width = listing
        .iter()
        .map(|group| group.name.len())
        .max()
        .unwrap_or(0);

    let mut out = String::new();
    for group in listing {
        out.push_str(&format!(
            "{:<slug_width$}  {:<name_width$}  {}\n",
            group.slug,
            group.name,
            group.cases.join(", "),
        ));
    }
    out
}

/// Render the listing as a JSON array of `{ "slug", "name", "summary", "cases" }`
/// objects, in display order.
///
/// `rank` is deliberately left out: it is how the listing is *ordered*, not part
/// of what a group is, and the backend's `GET /test-case-groups` makes the same
/// call — the order carries it.
fn render_json(listing: &[TestCaseGroup]) -> String {
    let entries: Vec<String> = listing
        .iter()
        .map(|group| {
            let cases: Vec<String> = group.cases.iter().map(|slug| json_str(slug)).collect();
            format!(
                "  {{ \"slug\": {}, \"name\": {}, \"summary\": {}, \"cases\": [{}] }}",
                json_str(&group.slug),
                json_str(&group.name),
                group
                    .summary
                    .as_deref()
                    .map_or_else(|| "null".to_string(), json_str),
                cases.join(", "),
            )
        })
        .collect();

    format!("[\n{}\n]", entries.join(",\n"))
}

/// Encode a string as a JSON string literal.
///
/// Hand-built so the CLI does not need a serialization dependency for what is a
/// tiny, fixed shape, exactly as the other listing commands do. The escaping
/// covers the characters that can appear in a JSON string literal.
fn json_str(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(test)]
#[path = "test_case_groups.test.rs"]
mod tests;
