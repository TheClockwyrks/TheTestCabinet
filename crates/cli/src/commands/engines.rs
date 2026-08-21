//! `tcab engines` — list the built-in engines and what each one provides.
//!
//! This module also owns the little bit of engine resolution the *other* local
//! commands share (see [`resolve_for_case`]): `tcab seed`, `tcab validate`, and
//! `tcab prompt` each take an `--engine`, and each has to answer the same two
//! questions before it does anything — is the slug one this build carries, and is
//! it one the case declares support for. `tcab run` asks neither, because a
//! backend-driven run is gated by the core the driver executes; a local command
//! has no such gate and must do it itself.

use anyhow::Result;
use test_cabinet_core::{
    EngineCatalog, EngineManifest, EngineSelection, ResolvedEngine, TestCaseVersion,
    ensure_engine_supported,
};

use crate::cli::EnginesArgs;

/// List every built-in engine alongside its name and description.
///
/// An engine is the runtime a produced game is built on — its frame loop and the
/// delta time it hands the game, its input actions, its audio bus, its asset
/// loader, and its diagnostics overlay. The catalogue is **closed**: unlike an
/// orchestrator there is no external-directory escape hatch, because an engine is
/// a package that must already be staged into the host package store, so this
/// listing is the complete set of values `--engine` accepts. The manifests are
/// embedded at build time, so nothing here touches the filesystem.
pub async fn execute(args: EnginesArgs) -> Result<()> {
    let listing = EngineCatalog::new().all();

    if args.json {
        print_json(&listing);
    } else {
        print_table(&listing);
    }

    Ok(())
}

/// Resolve an `--engine` slug for a specific test case version, refusing an
/// engine the case does not support.
///
/// The two failures are reported in this order deliberately, matching the core's
/// own gate: an unresolvable slug is a typo on the flag and is reported as the
/// unknown engine it is — naming every engine that would have worked — rather
/// than as an engine this case happens not to support, which would send the user
/// looking in the wrong place. Only a slug that *is* an engine is then held
/// against the case's declared set.
///
/// The case-side half is the core's own
/// [`ensure_engine_supported`] rather than a re-statement of it, so a local
/// `tcab seed` and a backend-driven run refuse the same pairing with the same
/// words — and so the *version* half of the gate (a case's declared
/// `[[engine]]` range against the version the host package store holds) applies
/// here too, without this module having to know it exists.
pub fn resolve_for_case(slug: &str, test_case: &TestCaseVersion) -> Result<ResolvedEngine> {
    let engine = EngineCatalog::new().resolve(&EngineSelection::new(slug))?;
    ensure_engine_supported(test_case, &engine)?;
    Ok(engine)
}

/// Render the listing as an aligned, human-readable table.
fn print_table(listing: &[EngineManifest]) {
    let slug_width = listing
        .iter()
        .map(|engine| engine.slug.len())
        .max()
        .unwrap_or(0);
    let name_width = listing
        .iter()
        .map(|engine| engine.name.len())
        .max()
        .unwrap_or(0);

    for engine in listing {
        println!(
            "{:<slug_width$}  {:<name_width$}  {}",
            engine.slug, engine.name, engine.description,
        );
    }
}

/// Render the listing as a JSON array of `{ "slug", "name", "description" }`
/// objects.
///
/// The manifest's remaining fields — the npm package and the documentation
/// directory — are how the engine is *delivered*, not how it is chosen, so they
/// are deliberately left out of a listing whose job is to show what `--engine`
/// accepts.
fn print_json(listing: &[EngineManifest]) {
    let entries: Vec<String> = listing
        .iter()
        .map(|engine| {
            format!(
                "  {{ \"slug\": {}, \"name\": {}, \"description\": {} }}",
                json_str(&engine.slug),
                json_str(&engine.name),
                json_str(&engine.description),
            )
        })
        .collect();

    println!("[\n{}\n]", entries.join(",\n"));
}

/// Encode a string as a JSON string literal.
///
/// Hand-built so the CLI does not need a serialization dependency for what is a
/// tiny, fixed shape, exactly as the harness and orchestrator listings do. The
/// escaping covers the characters that can appear in a JSON string literal.
fn json_str(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(test)]
#[path = "engines.test.rs"]
mod tests;
