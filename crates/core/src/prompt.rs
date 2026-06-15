//! Prompt rendering: turn a test case's `prompt.hbs` into the harness
//! instruction.
//!
//! The instruction handed to the harness is not hard-coded; each test case
//! version ships a `prompt.hbs` template that is rendered with the run's
//! in-container workspace path and the seeded spec paths for the selected
//! variant. Rendering through Handlebars keeps absolute container paths out of
//! the specifications themselves — they come from The Test Cabinet, not the
//! authored spec — and lets a case word its own instruction. See
//! `docs/test-cases.md#prompt-template`.

use serde::Serialize;

use crate::error::{Error, Result};
use crate::execution::WORKSPACE_DIR;
use crate::test_case::{SpecFile, TestCaseVersion, Variant};

/// The Handlebars context exposed to a test case's `prompt.hbs`.
///
/// These are the only variables a template may reference (rendering runs in
/// strict mode, so an unknown reference is an error). They are documented for
/// authors in `docs/test-cases.md#prompt-template`.
#[derive(Debug, Serialize)]
struct PromptContext<'a> {
    /// Absolute in-container path of the run workspace, where the seeded
    /// repository is mounted and the harness builds (for example `/work`).
    workspace: &'a str,
    /// The selected variant.
    variant: PromptVariant<'a>,
    /// The seeded specs for the selected variant, in seed order, each with an
    /// absolute in-container path.
    specs: Vec<PromptSpec>,
}

/// The selected variant, as exposed to a prompt template.
#[derive(Debug, Serialize)]
struct PromptVariant<'a> {
    /// The variant slug (for example `frenzy`).
    slug: &'a str,
    /// The variant display name.
    name: &'a str,
    /// The optional variant description, or `null` when none is declared.
    description: Option<&'a str>,
}

/// A single seeded spec, as exposed to a prompt template.
#[derive(Debug, Serialize)]
struct PromptSpec {
    /// The spec's destination relative to the workspace (for example
    /// `specs/overview.md`).
    dest: String,
    /// The spec's absolute in-container path (for example
    /// `/work/specs/overview.md`).
    path: String,
    /// The destination file stem (for example `overview`), handy for labeling.
    name: String,
}

/// Render a test case's prompt template for the selected variant into the
/// instruction handed to the harness.
///
/// The template is read from [`TestCaseVersion::prompt_path`] and rendered with
/// the [`PromptContext`]. Rendering uses strict mode, so a template that
/// references an unknown variable fails rather than silently producing an empty
/// value, and HTML escaping is disabled because the output is plain text.
pub fn render_prompt(test_case: &TestCaseVersion, variant: &Variant) -> Result<String> {
    let render_err = |detail: String| Error::PromptRender {
        slug: test_case.slug.clone(),
        version: test_case.version.clone(),
        detail,
    };

    let template = std::fs::read_to_string(&test_case.prompt_path).map_err(|err| {
        render_err(format!(
            "could not read {}: {err}",
            test_case.prompt_path.display()
        ))
    })?;

    let specs = test_case.seeded_specs(variant);
    let context = PromptContext {
        workspace: WORKSPACE_DIR,
        variant: PromptVariant {
            slug: &variant.slug,
            name: &variant.name,
            description: variant.description.as_deref(),
        },
        specs: specs.iter().map(prompt_spec).collect(),
    };

    let mut handlebars = handlebars::Handlebars::new();
    handlebars.set_strict_mode(true);
    handlebars.register_escape_fn(handlebars::no_escape);
    handlebars
        .render_template(&template, &context)
        .map_err(|err| render_err(err.to_string()))
}

/// Turn a seeded spec into its prompt-facing form: a workspace-relative dest, an
/// absolute in-container path, and the dest's file stem as a label.
fn prompt_spec(spec: &SpecFile) -> PromptSpec {
    let dest = unix_path(&spec.dest);
    let path = format!("{WORKSPACE_DIR}/{dest}");
    let name = spec
        .dest
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default()
        .to_string();
    PromptSpec { dest, path, name }
}

/// Render a relative path with forward slashes so in-container paths are stable
/// regardless of the host that resolved them.
fn unix_path(path: &std::path::Path) -> String {
    path.components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
#[path = "prompt.test.rs"]
mod tests;
