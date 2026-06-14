//! `tcab harnesses` — list supported harnesses and their availability.

use test_cabinet_core::{Availability, HarnessSlug};

use crate::cli::HarnessesArgs;

/// List every supported agent harness alongside whether it is available on this
/// host.
///
/// Availability resolves the harness's binary and confirms it can be invoked
/// (for example with a `--version` check). It must **never** start a session or
/// take any action that could incur cost.
pub async fn execute(args: HarnessesArgs) -> anyhow::Result<()> {
    let mut listing: Vec<(HarnessSlug, Availability)> = Vec::with_capacity(HarnessSlug::ALL.len());
    for slug in HarnessSlug::ALL {
        listing.push((slug, check_availability(slug).await?));
    }

    if args.json {
        print_json(&listing);
    } else {
        print_table(&listing);
    }

    Ok(())
}

/// Probe a single harness for availability without ever starting a session.
///
/// This delegates to the core harness layer, which resolves the harness binary
/// and runs a no-cost probe such as `--version`. It must never start a session
/// or otherwise incur cost.
async fn check_availability(_slug: HarnessSlug) -> anyhow::Result<Availability> {
    // TODO: look the harness up in a `HarnessRegistry` and call
    // `AgentHarness::check_availability().await`, which is contractually
    // session-free.
    todo!("query the core harness layer's no-session availability check");
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
