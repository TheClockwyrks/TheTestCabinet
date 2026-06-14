//! `tcab harnesses` — list supported harnesses and their availability.

use test_cabinet_core::{
    Availability, CliContainerRuntime, DefaultHarnessRegistry, HarnessRegistry, HarnessSlug,
};

use crate::cli::HarnessesArgs;

/// List every supported agent harness alongside whether it is available.
///
/// Availability runs a cost-free `--version` probe of each harness's container
/// image. It must **never** start a session or take any action that could incur
/// cost. A missing container runtime or image is reported as unavailable with a
/// reason rather than failing the command.
pub async fn execute(args: HarnessesArgs) -> anyhow::Result<()> {
    let registry = DefaultHarnessRegistry::new();
    let runtime = CliContainerRuntime::detect();

    let mut listing: Vec<(HarnessSlug, Availability)> = Vec::with_capacity(HarnessSlug::ALL.len());
    for slug in HarnessSlug::ALL {
        let availability = match &runtime {
            Ok(runtime) => match registry.get(slug) {
                Some(harness) => harness
                    .check_availability(runtime)
                    .await
                    .unwrap_or_else(|err| Availability {
                        available: false,
                        version: None,
                        detail: Some(err.to_string()),
                    }),
                None => Availability {
                    available: false,
                    version: None,
                    detail: Some("no adapter registered".to_string()),
                },
            },
            Err(err) => Availability {
                available: false,
                version: None,
                detail: Some(err.to_string()),
            },
        };
        listing.push((slug, availability));
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
fn print_table(listing: &[(HarnessSlug, Availability)]) {
    let width = listing
        .iter()
        .map(|(slug, _)| slug.as_str().len())
        .max()
        .unwrap_or(0);

    for (slug, availability) in listing {
        println!(
            "{:<width$}  {}",
            slug.as_str(),
            label(availability),
            width = width
        );
    }
}

/// Render the listing as a JSON array of `{ "slug", "available", "version",
/// "detail" }` objects.
fn print_json(listing: &[(HarnessSlug, Availability)]) {
    let entries: Vec<String> = listing
        .iter()
        .map(|(slug, availability)| {
            format!(
                "  {{ \"slug\": \"{}\", \"available\": {}, \"version\": {}, \"detail\": {} }}",
                slug.as_str(),
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
