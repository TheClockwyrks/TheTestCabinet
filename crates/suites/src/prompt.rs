//! The prompt helpers an authored case and a suite definition share, and a suite
//! definition's prompt.
//!
//! An authored test case's `prompt.hbs` and `.hbs` specs are rendered by core
//! (`test_cabinet_core::prompt`), which prepends the standing preambles. A
//! [test suite](crate::test_suite) definition's prompt is rendered here, against its
//! own context ([`render_suite_prompt`]). Both render through the one strict,
//! no-escape registry ([`handlebars_registry`]) and expose the run's engine the same
//! way ([`TemplateEngine`]), so the helpers are here and core imports them.
//!
//! Every context carries the run's selected [engine](crate::engine), always present:
//! an engineless run renders the sentinel `none` engine, which a template branches on
//! with the registered equality helpers (`{{#if (ne engine.slug "none")}}`). Core's
//! module documentation states why.

use std::path::Path;

use serde::Serialize;

use crate::engine::{NONE_SLUG, ResolvedEngine};
use crate::error::{Error, Result};
use crate::execution::{ENGINE_DOCS_DIR, WORKSPACE_DIR};

/// The display name of the sentinel [`NONE_SLUG`] engine, mirroring the `name` in
/// `engines/none/engine.toml`.
///
/// A run that selected no engine still renders an `engine` context (see
/// [`TemplateEngine`]), and it renders this name rather than resolving the
/// catalogue for it. Rendering is pure and infallible, and its callers include
/// ones that hold no engine at all — the backend catalog API renders
/// a case's prompt for the gallery from stored manifest fields — so making them
/// carry an [`EngineCatalog`](crate::engine::EngineCatalog) just to name the
/// absence of an engine would be a resolution step with exactly one possible
/// answer. `engineless_context_matches_the_none_engine` in the tests is what
/// keeps this in step with the manifest.
const NONE_NAME: &str = "None";

/// The selected engine, as exposed to a prompt or spec template.
///
/// Unlike every other optional piece of context this is never omitted: see the
/// module documentation. An engineless run renders the sentinel values
/// `{ slug: "none", name: "None", docs: "" }`, which is exactly what the built-in
/// `none` engine resolves to, so a template needs one branch — on the slug — and
/// not two.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateEngine<'a> {
    /// The engine's slug (for example `simple-2d`), or [`NONE_SLUG`] when the run
    /// selected no engine. This is what a template branches on.
    slug: &'a str,
    /// The engine's display name (for example `Simple 2D`), for prose.
    name: &'a str,
    /// The absolute in-container path of the engine's seeded documentation (for
    /// example `/work/engine`), or the empty string when there is none to read —
    /// which is every engineless run, and any engine that ships no documentation
    /// tree. Derived exactly as a spec's `path` is, from the workspace root and
    /// the seeded destination.
    docs: &'a str,
}

impl<'a> TemplateEngine<'a> {
    /// Build the template view of the run's selected engine.
    ///
    /// `docs` is passed in rather than derived here because it is an owned path
    /// built by [`engine_docs_path`], and the borrow has to outlive the context
    /// this is embedded in.
    pub fn new(engine: Option<&'a ResolvedEngine>, docs: &'a str) -> Self {
        match engine {
            Some(engine) => Self {
                slug: engine.slug(),
                name: &engine.manifest.name,
                docs,
            },
            // No engine selected. This is deliberately identical to what the
            // built-in `none` engine resolves to, so a run that named `none`
            // explicitly and a run that named nothing render the same prompt.
            None => Self {
                slug: NONE_SLUG,
                name: NONE_NAME,
                docs,
            },
        }
    }
}

/// The absolute in-container path of the selected engine's seeded documentation,
/// or the empty string when there is nothing seeded to point at.
///
/// Built the same way [`prompt_spec`] builds a spec's `path` — the workspace root
/// joined to the workspace-relative destination seeding wrote — so the two can
/// never disagree about where the run's files live. An engine that declares no
/// `docs` directory (and the absence of an engine altogether) seeds nothing, and
/// the empty string is what a template sees; it should be guarding on
/// `engine.slug` rather than on this, which is why the empty value is left as a
/// blank rather than an invented path.
pub fn engine_docs_path(engine: Option<&ResolvedEngine>) -> String {
    match engine {
        Some(engine) if engine.docs().is_some() => format!("{WORKSPACE_DIR}/{ENGINE_DOCS_DIR}"),
        _ => String::new(),
    }
}

/// The selected engine's seeded documentation directory relative to the workspace,
/// or the empty string when there is nothing seeded to point at.
///
/// What a spec gets in place of [`engine_docs_path`]. A spec is rendered into a
/// file that sits beside the build, and a container path written into it would be
/// the one absolute path in a document otherwise entirely about the build's own
/// tree — which is why core's spec context is handed no workspace path at all.
pub fn engine_docs_dir(engine: Option<&ResolvedEngine>) -> String {
    match engine {
        Some(engine) if engine.docs().is_some() => format!("{ENGINE_DOCS_DIR}/"),
        _ => String::new(),
    }
}

/// The Handlebars context exposed to a [test suite](crate::test_suite) test case
/// definition's prompt template.
///
/// A suite definition declares no variants, no bounding volume and no time budget,
/// so it shares none of an authored case's prompt context beyond the workspace and the
/// engine. What it exposes instead is the specifications the definition covers,
/// each with the identity and prose a template introduces it by. These are exactly
/// the variables the
/// [definition page](https://docs.testcabinet.ai/test-suites/test-case-definition/)
/// documents, and rendering runs through the same strict, no-escape registry, so a
/// reference to anything outside this set is a render error rather than a blank.
#[derive(Debug, Serialize)]
struct SuitePromptContext<'a> {
    /// Absolute in-container path of the run workspace, where the starter
    /// workspace is seeded and the harness builds.
    workspace: &'a str,
    /// The engine this run selected, always present — the sentinel `none` engine
    /// when the run selected none, exactly as for an authored case.
    engine: TemplateEngine<'a>,
    /// The specifications this test case covers, in the order the definition lists
    /// them.
    specifications: Vec<SuitePromptSpec>,
}

/// One covered specification, as exposed to a suite definition's prompt template.
#[derive(Debug, Serialize)]
struct SuitePromptSpec {
    /// The specification's suite-wide id (for example `ball-physics`).
    id: String,
    /// The specification's display name.
    name: String,
    /// The specification's one-line abstract.
    summary: String,
    /// The absolute in-container path of the seeded specification document (for
    /// example `/work/specs/ball-physics.md`).
    path: String,
}

/// One covered specification as the caller hands it to [`render_suite_prompt`].
///
/// The seeded destination is passed rather than the in-container path so this
/// module stays the single place a workspace-relative dest becomes an absolute
/// container path, exactly as it is for an authored case's specs.
#[derive(Debug, Clone)]
pub struct SuiteSpecification {
    /// The specification's suite-wide id.
    pub id: String,
    /// The specification's display name.
    pub name: String,
    /// The specification's one-line abstract.
    pub summary: String,
    /// The seeded document's destination relative to the workspace root (for
    /// example `specs/ball-physics.md`).
    pub dest: String,
}

/// Render a [test suite](crate::test_suite) test case definition's prompt template
/// into the instruction handed to the harness.
///
/// `suite` and `version` name the suite coordinate a failure is reported against.
/// `engine` is the run's resolved engine, or `None` for a run that selected none —
/// either way the template sees an `engine`, because strict mode makes an absent
/// field a hard error rather than a blank.
///
/// No standing preamble is prepended: the preambles above are authored against the
/// authored test case types, and a suite definition's template is handed over
/// exactly as it renders.
pub fn render_suite_prompt(
    suite: &str,
    version: &str,
    template: &str,
    specifications: &[SuiteSpecification],
    engine: Option<&ResolvedEngine>,
) -> Result<String> {
    // Built before the context so the borrow outlives it, exactly as in
    // core's `render_prompt_from_template`.
    let engine_docs = engine_docs_path(engine);
    let context = SuitePromptContext {
        workspace: WORKSPACE_DIR,
        engine: TemplateEngine::new(engine, &engine_docs),
        specifications: specifications
            .iter()
            .map(|spec| SuitePromptSpec {
                id: spec.id.clone(),
                name: spec.name.clone(),
                summary: spec.summary.clone(),
                path: prompt_spec(&spec.dest).path,
            })
            .collect(),
    };
    handlebars_registry()
        .render_template(template, &context)
        .map_err(|err| Error::PromptRender {
            slug: suite.to_string(),
            version: version.to_string(),
            detail: err.to_string(),
        })
}

/// A single seeded spec, as exposed to a prompt template.
#[derive(Debug, Serialize)]
pub struct PromptSpec {
    /// The spec's destination relative to the workspace (for example
    /// `specs/overview.md`).
    pub dest: String,
    /// The spec's absolute in-container path (for example
    /// `/work/specs/overview.md`).
    pub path: String,
    /// The destination file stem (for example `overview`), handy for labeling.
    pub name: String,
}

/// A Handlebars registry configured the way every test case template is
/// rendered: strict mode so referencing an undefined variable is an error rather
/// than a silent empty value, and HTML escaping disabled because the rendered
/// output (a prompt or a spec) is plain text, not HTML.
///
/// Named for the registry rather than "the template engine" because *engine* now
/// names a run dimension in this module — the runtime a produced game is built on
/// — and the two have nothing to do with each other.
pub fn handlebars_registry() -> handlebars::Handlebars<'static> {
    let mut handlebars = handlebars::Handlebars::new();
    handlebars.set_strict_mode(true);
    handlebars.register_escape_fn(handlebars::no_escape);
    // Value-equality helpers so a template can branch on a value rather than only
    // on truthiness — most often a variant slug, as in
    // `{{#if (eq variant.slug "multi")}}`. Handlebars ships no equality helper, and
    // strict mode rules out the usual truthy workarounds, so register the pair here.
    // They compare the raw JSON values and so work for the strings, numbers, and
    // booleans a template context carries.
    handlebars::handlebars_helper!(eq: |a: Json, b: Json| a == b);
    handlebars::handlebars_helper!(ne: |a: Json, b: Json| a != b);
    handlebars.register_helper("eq", Box::new(eq));
    handlebars.register_helper("ne", Box::new(ne));
    handlebars
}

/// Turn a seeded spec's workspace-relative dest into its prompt-facing form: the
/// dest (unix-normalized), its absolute in-container path, and its file stem as a
/// label.
pub fn prompt_spec(dest: &str) -> PromptSpec {
    let dest = unix_path(Path::new(dest));
    let path = format!("{WORKSPACE_DIR}/{dest}");
    let name = Path::new(&dest)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default()
        .to_string();
    PromptSpec { dest, path, name }
}

/// Format a wall-clock cap in seconds as a human hours string for a prompt: whole
/// hours render without a decimal (`8`), fractional hours keep the smallest needed
/// precision (`1.5`, `0.5`). Used for `{{time_limit_hours}}`.
pub fn format_hours(seconds: u64) -> String {
    let hours = seconds as f64 / 3600.0;
    let formatted = format!("{hours:.2}");
    let trimmed = formatted.trim_end_matches('0').trim_end_matches('.');
    trimmed.to_string()
}

/// Render a relative path with forward slashes so in-container paths are stable
/// regardless of the host that resolved them.
pub fn unix_path(path: &std::path::Path) -> String {
    path.components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/")
}
