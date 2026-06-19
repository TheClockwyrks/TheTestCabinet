//! Template rendering: turn a test case's `prompt.hbs` into the harness
//! instruction, and render any `.hbs` spec into the file seeded into the run.
//!
//! The instruction handed to the harness is not hard-coded; each test case
//! version ships a `prompt.hbs` template that is rendered with the run's
//! in-container workspace path and the seeded spec paths for the selected
//! variant. Rendering through Handlebars keeps absolute container paths out of
//! the specifications themselves — they come from The Test Cabinet, not the
//! authored spec — and lets a case word its own instruction. See
//! `docs/test-cases.md#prompt-template`.
//!
//! A spec whose source is a Handlebars template (a `.hbs` extension) is rendered
//! the same way at seed time, so a spec can state facts that depend on the
//! selected variant — for example which configuration this build is — without
//! the authored text having to hedge about what a run "may" contain. A spec with
//! any other extension is seeded verbatim. See `docs/test-cases.md#spec-templates`.

use std::path::Path;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::execution::WORKSPACE_DIR;
use crate::test_case::{TestCaseVersion, Variant};

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
    variant: TemplateVariant<'a>,
    /// The seeded specs for the selected variant, in seed order, each with an
    /// absolute in-container path.
    specs: Vec<PromptSpec>,
}

/// The Handlebars context exposed to a test case's spec `.hbs` template.
///
/// A spec template is rendered into the file seeded into the run, so — unlike
/// the prompt — it is handed neither the in-container workspace path nor the
/// spec manifest: those belong to the prompt, and keeping them out of specs is
/// what lets a specification stay free of container paths. A spec template sees
/// only the selected variant and the version. These are the only variables it
/// may reference (rendering runs in strict mode); they are documented for
/// authors in `docs/test-cases.md#spec-templates`.
#[derive(Debug, Serialize)]
struct SpecContext<'a> {
    /// The exact test case version string (for example `v1.0.0`).
    version: &'a str,
    /// The selected variant.
    variant: TemplateVariant<'a>,
}

/// The selected variant, as exposed to a prompt or spec template.
#[derive(Debug, Serialize)]
struct TemplateVariant<'a> {
    /// The variant slug (for example `frenzy`).
    slug: &'a str,
    /// The variant display name.
    name: &'a str,
    /// The optional variant description, or `null` when none is declared.
    description: Option<&'a str>,
}

impl<'a> TemplateVariant<'a> {
    /// Build the template view of a resolved [`Variant`].
    fn new(variant: &'a Variant) -> Self {
        Self {
            slug: &variant.slug,
            name: &variant.name,
            description: variant.description.as_deref(),
        }
    }
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
    let template =
        std::fs::read_to_string(&test_case.prompt_path).map_err(|err| Error::PromptRender {
            slug: test_case.slug.clone(),
            version: test_case.version.clone(),
            detail: format!("could not read {}: {err}", test_case.prompt_path.display()),
        })?;

    let dests: Vec<String> = test_case
        .seeded_specs(variant)
        .iter()
        .map(|spec| unix_path(&spec.dest))
        .collect();

    render_prompt_from_template(
        &test_case.slug,
        &test_case.version,
        &template,
        &variant.slug,
        &variant.name,
        variant.description.as_deref(),
        &dests,
    )
}

/// Render a prompt from its already-loaded template text and resolved variant
/// inputs, without reading a manifest from disk.
///
/// This is the rendering core that [`render_prompt`] delegates to once it has
/// read the template and resolved the seeded specs off a [`TestCaseVersion`]. It
/// is exposed for callers that hold those pieces directly — notably the backend
/// and desktop catalog APIs, which render a variant's prompt for the gallery's
/// Specifications tab from stored manifest fields rather than a disk checkout.
/// `spec_dests` are the seeded specs' workspace-relative destination paths in
/// seed order (the common specs first, then the variant's own), exactly as
/// [`TestCaseVersion::seeded_specs`] orders them. Rendering uses the same strict,
/// no-escape engine as a real run, so the output matches what the harness
/// receives.
pub fn render_prompt_from_template(
    slug: &str,
    version: &str,
    template: &str,
    variant_slug: &str,
    variant_name: &str,
    variant_description: Option<&str>,
    spec_dests: &[String],
) -> Result<String> {
    let context = PromptContext {
        workspace: WORKSPACE_DIR,
        variant: TemplateVariant {
            slug: variant_slug,
            name: variant_name,
            description: variant_description,
        },
        specs: spec_dests.iter().map(|dest| prompt_spec(dest)).collect(),
    };

    template_engine()
        .render_template(template, &context)
        .map_err(|err| Error::PromptRender {
            slug: slug.to_string(),
            version: version.to_string(),
            detail: err.to_string(),
        })
}

/// Render a `.hbs` spec into the text seeded into the run for the selected
/// variant.
///
/// Seeding calls this for any spec whose source is a Handlebars template; the
/// rendered text is written to the spec's `dest`. The template is read from
/// `source_path` and rendered with the [`SpecContext`] under the same rules as
/// the prompt — strict mode (an unknown variable is an error rather than a
/// silent blank) and HTML escaping disabled, since a spec is plain text.
pub(crate) fn render_spec(
    test_case: &TestCaseVersion,
    variant: &Variant,
    source_path: &Path,
) -> Result<String> {
    let render_err = |detail: String| Error::SpecRender {
        slug: test_case.slug.clone(),
        version: test_case.version.clone(),
        spec: source_path.display().to_string(),
        detail,
    };

    let template = std::fs::read_to_string(source_path)
        .map_err(|err| render_err(format!("could not read {}: {err}", source_path.display())))?;

    let context = SpecContext {
        version: &test_case.version,
        variant: TemplateVariant::new(variant),
    };

    template_engine()
        .render_template(&template, &context)
        .map_err(|err| render_err(err.to_string()))
}

/// A Handlebars engine configured the way every test case template is rendered:
/// strict mode so referencing an undefined variable is an error rather than a
/// silent empty value, and HTML escaping disabled because the rendered output
/// (a prompt or a spec) is plain text, not HTML.
fn template_engine() -> handlebars::Handlebars<'static> {
    let mut handlebars = handlebars::Handlebars::new();
    handlebars.set_strict_mode(true);
    handlebars.register_escape_fn(handlebars::no_escape);
    handlebars
}

/// Turn a seeded spec's workspace-relative dest into its prompt-facing form: the
/// dest (unix-normalized), its absolute in-container path, and its file stem as a
/// label.
fn prompt_spec(dest: &str) -> PromptSpec {
    let dest = unix_path(Path::new(dest));
    let path = format!("{WORKSPACE_DIR}/{dest}");
    let name = Path::new(&dest)
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
