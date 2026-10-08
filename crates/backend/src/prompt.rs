//! Rendering a stored test-case version's prompt the way a run of it receives it.
//!
//! The two shapes of test case expose different contexts to their templates. An
//! authored case's template sees its variant, its seeded specs, its bounding volume
//! and its time budget, with the standing preamble of its test type prepended. A
//! suite-defined case's template sees exactly the context the
//! [definition page](https://docs.testcabinet.ai/test-suites/test-case-definition/#prompt-template)
//! documents — `workspace`, `engine` and the `specifications` it covers — and is
//! handed over bare. Which one a stored version renders against follows the
//! [suite coordinate](crate::store::StoredSuiteCoordinate) it carries, and this is
//! the one place that decision is made for every reader of the store: the version
//! detail the consoles fetch and the case documents the gallery snapshot bakes.

use test_cabinet_core::engine::ResolvedEngine;
use test_cabinet_core::error::{Error, Result};
use test_cabinet_core::test_suite::{SpecificationManifest, render_suite_definition_prompt};

use crate::store::{StoredManifest, StoredVariant};
use crate::suite_store::StoredSuite;

/// Render `variant`'s prompt off the stored `manifest` for `engine`, exactly as a
/// run on that engine receives it. `None` renders the engineless form.
///
/// `suite` is the stored record of the suite version a suite-defined manifest was
/// lowered from (see [`crate::store::DefinitionStore::read_suite_of`]), and is
/// ignored for an authored one. A suite-defined manifest handed no record, or the
/// record of a suite version other than the one it names, is refused rather than
/// rendered against the authored context, which would describe a different prompt
/// from the one its runs receive.
///
/// A version's prompt is the standing one: prior game-jam entries are a property of
/// the run, seeded from earlier entries by the same model, so no distinctness section
/// is ever rendered here.
pub fn render_stored_prompt(
    manifest: &StoredManifest,
    variant: &StoredVariant,
    suite: Option<&StoredSuite>,
    engine: Option<&ResolvedEngine>,
) -> Result<String> {
    match &manifest.suite {
        Some(coordinate) => {
            let suite = suite
                .filter(|record| {
                    record.slug == coordinate.suite && record.version == coordinate.suite_version
                })
                .ok_or_else(|| Error::PromptRender {
                    slug: manifest.slug.clone(),
                    version: manifest.version.clone(),
                    detail: format!(
                        "the suite version `{}@{}` it was lowered from is not ingested",
                        coordinate.suite, coordinate.suite_version
                    ),
                })?;
            let definition = suite
                .test_cases
                .iter()
                .find(|case| case.slug == coordinate.definition)
                .ok_or_else(|| Error::InvalidTestSuite {
                    suite: suite.slug.clone(),
                    version: suite.version.clone(),
                    file: "test-cases".to_string(),
                    detail: format!(
                        "the suite version declares no definition `{}`",
                        coordinate.definition
                    ),
                })?;
            let declared: Vec<&SpecificationManifest> = suite
                .specifications
                .iter()
                .map(|spec| &spec.manifest)
                .collect();
            render_suite_definition_prompt(
                &suite.slug,
                &manifest.version,
                &definition.slug,
                &definition.definition,
                &declared,
                &manifest.prompt_template,
                engine,
            )
        }
        None => render_authored_prompt(manifest, variant, engine),
    }
}

/// An authored case's prompt: the template rendered against the variant, its seeded
/// specs (the common specs followed by the variant's own, matching seed order) and
/// the standing preamble of its test type.
fn render_authored_prompt(
    manifest: &StoredManifest,
    variant: &StoredVariant,
    engine: Option<&ResolvedEngine>,
) -> Result<String> {
    let spec_dests: Vec<String> = manifest
        .common_specs
        .iter()
        .chain(variant.specs.iter())
        .map(|spec| spec.dest.clone())
        .collect();
    test_cabinet_core::render_prompt_from_template(
        &manifest.slug,
        &manifest.version,
        &manifest.prompt_template,
        &variant.slug,
        &variant.name,
        variant.description.as_deref(),
        &spec_dests,
        manifest.test_type,
        // The dimension decides which asset-generation binaries the standing
        // full-stack directive names, so the rendering reads as the run's own.
        manifest.asset_dimension,
        manifest.max_runtime_seconds,
        // The variant's own volume overrides the case's for its prompt, so each
        // size variant's brief renders at its actual dimensions.
        variant.voxel.as_ref().or(manifest.voxel.as_ref()),
        0,
        engine,
    )
}

#[cfg(test)]
#[path = "prompt.fixture.test.rs"]
pub(crate) mod fixture;

#[cfg(test)]
#[path = "prompt.test.rs"]
mod tests;
