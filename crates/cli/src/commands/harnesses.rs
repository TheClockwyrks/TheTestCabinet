//! `tcab harnesses` — list supported harnesses and their availability.

use test_cabinet_core::{
    Availability, DefaultHarnessRegistry, HarnessRegistry, HarnessSlug, auth_readiness,
};

use crate::cli::HarnessesArgs;

/// List every supported agent harness alongside whether it is ready to run.
///
/// Each harness installs its CLI into the run container **at run time**, so this
/// cannot cheaply probe an installed binary without launching a run. Instead it
/// reports readiness from configuration alone (see [`auth_readiness`]): a harness
/// is available when the credentials its resolved authentication mode needs are
/// present — an API key in the environment, or subscription credential files on
/// disk. This is cost-free and never starts a container.
pub async fn execute(args: HarnessesArgs) -> anyhow::Result<()> {
    let registry = DefaultHarnessRegistry::new();

    let mut listing: Vec<(HarnessSlug, String, Availability)> =
        Vec::with_capacity(HarnessSlug::ALL.len());
    for slug in HarnessSlug::ALL {
        let (name, availability) = match registry.get(slug) {
            Some(harness) => (harness.name().to_string(), auth_readiness(harness)),
            None => (
                slug.as_str().to_string(),
                Availability {
                    available: false,
                    version: None,
                    detail: Some("no adapter registered".to_string()),
                },
            ),
        };
        listing.push((slug, name, availability));
    }

    if args.json {
        print_json(&listing);
    } else {
        print_table(&listing);
    }

    Ok(())
}

/// A short, stable label for an availability result.
fn label(availability: &Availability) -> String {
    if availability.available {
        match &availability.version {
            Some(version) => format!("available ({version})"),
            None => "available".to_string(),
        }
    } else {
        match &availability.detail {
            Some(detail) => format!("unavailable: {detail}"),
            None => "unavailable".to_string(),
        }
    }
}

/// Render the listing as an aligned, human-readable table.
fn print_table(listing: &[(HarnessSlug, String, Availability)]) {
    let slug_width = listing
        .iter()
        .map(|(slug, _, _)| slug.as_str().len())
        .max()
        .unwrap_or(0);
    let name_width = listing
        .iter()
        .map(|(_, name, _)| name.len())
        .max()
        .unwrap_or(0);

    for (slug, name, availability) in listing {
        println!(
            "{:<slug_width$}  {:<name_width$}  {}",
            slug.as_str(),
            name,
            label(availability),
        );
    }
}

/// Render the listing as a JSON array of `{ "slug", "name", "available",
/// "version", "detail" }` objects.
fn print_json(listing: &[(HarnessSlug, String, Availability)]) {
    let entries: Vec<String> = listing
        .iter()
        .map(|(slug, name, availability)| {
            format!(
                "  {{ \"slug\": \"{}\", \"name\": {}, \"available\": {}, \"version\": {}, \"detail\": {} }}",
                slug.as_str(),
                json_opt(Some(name)),
                availability.available,
                json_opt(availability.version.as_deref()),
                json_opt(availability.detail.as_deref()),
            )
        })
        .collect();

    println!("[\n{}\n]", entries.join(",\n"));
}

/// Encode an optional string as a JSON string or `null`.
///
/// Hand-built so the CLI does not need a serialization dependency for what is a
/// tiny, fixed shape. The escaping covers the characters that can appear in a
/// JSON string literal.
fn json_opt(value: Option<&str>) -> String {
    match value {
        None => "null".to_string(),
        Some(s) => {
            let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
            format!("\"{escaped}\"")
        }
    }
}
