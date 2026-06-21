//! `tcab orchestrators` — list the built-in orchestrators and what each does.

use test_cabinet_core::{BUILT_IN_SLUGS, OrchestratorCatalog, OrchestratorSelection};

use crate::cli::OrchestratorsArgs;

/// List every built-in orchestrator alongside its name and description.
///
/// An orchestrator decides how a test case's harness sessions are conducted (a
/// single session for `one-shot`, a multi-session loop for `ralph`). The built-ins
/// are embedded at build time, so this resolves each from the catalog without any
/// filesystem access. External orchestrators (`--orchestrator-dir`) are resolved
/// purely at run time and are deliberately never enumerated here.
pub async fn execute(args: OrchestratorsArgs) -> anyhow::Result<()> {
    let catalog = OrchestratorCatalog::new();

    let mut listing: Vec<(String, String, String)> = Vec::with_capacity(BUILT_IN_SLUGS.len());
    for slug in BUILT_IN_SLUGS {
        let orchestrator = catalog.resolve(&OrchestratorSelection::builtin(*slug))?;
        let manifest = &orchestrator.manifest;
        listing.push((
            manifest.slug.clone(),
            manifest.name.clone(),
            manifest.description.clone(),
        ));
    }

    if args.json {
        print_json(&listing);
    } else {
        print_table(&listing);
    }

    Ok(())
}

/// Render the listing as an aligned, human-readable table.
fn print_table(listing: &[(String, String, String)]) {
    let slug_width = listing
        .iter()
        .map(|(slug, _, _)| slug.len())
        .max()
        .unwrap_or(0);
    let name_width = listing
        .iter()
        .map(|(_, name, _)| name.len())
        .max()
        .unwrap_or(0);

    for (slug, name, description) in listing {
        println!("{slug:<slug_width$}  {name:<name_width$}  {description}");
    }
}

/// Render the listing as a JSON array of `{ "slug", "name", "description" }`
/// objects.
fn print_json(listing: &[(String, String, String)]) {
    let entries: Vec<String> = listing
        .iter()
        .map(|(slug, name, description)| {
            format!(
                "  {{ \"slug\": {}, \"name\": {}, \"description\": {} }}",
                json_str(slug),
                json_str(name),
                json_str(description),
            )
        })
        .collect();

    println!("[\n{}\n]", entries.join(",\n"));
}

/// Encode a string as a JSON string literal.
///
/// Hand-built so the CLI does not need a serialization dependency for what is a
/// tiny, fixed shape. The escaping covers the characters that can appear in a JSON
/// string literal.
fn json_str(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}
