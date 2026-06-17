//! Rendering reference mockups to screenshots.
//!
//! A test case's reference views are authored as static HTML mockups. Those are
//! never seeded directly; instead they are rendered to screenshots that serve
//! two purposes: they are seeded into a run as visual targets for the model, and
//! they are the baselines a declared [validation check](crate::test_case::Check)
//! compares against.
//!
//! Screenshots are a regenerated build output, written under the test case's
//! git-ignored `reference/screenshots/` cache. The HTML mockups remain the
//! source of truth.

use std::path::{Path, PathBuf};

use crate::browser;
use crate::error::Result;
use crate::test_case::{TestCaseVersion, Variant};

/// A reference view rendered to a screenshot on the host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedReference {
    /// The view slug this screenshot corresponds to.
    pub view: String,
    /// Path to the rendered screenshot on the host.
    pub image_path: PathBuf,
}

/// Renders a test case version's reference mockups to screenshots.
pub trait ReferenceRenderer: Send + Sync {
    /// Render the selected variant's reference views — the common references plus
    /// the variant's own (see [`TestCaseVersion::references_for`]) — to
    /// screenshots, returning the successful renders. A view that cannot be
    /// rendered (for example, no browser is available) is skipped rather than
    /// failing the whole call, so seeding and validation degrade to whatever could
    /// be produced.
    fn render_references(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
    ) -> Result<Vec<RenderedReference>>;
}

/// Renders reference mockups with the bundled headless-browser driver.
#[derive(Debug, Clone, Default)]
pub struct BrowserRenderer;

impl BrowserRenderer {
    /// Create a renderer backed by the bundled browser driver.
    pub fn new() -> Self {
        Self
    }
}

impl ReferenceRenderer for BrowserRenderer {
    fn render_references(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
    ) -> Result<Vec<RenderedReference>> {
        // Screenshots are cached per variant so a view slug shared across variants
        // (for example a `title` menu that differs per variant) does not clobber
        // another variant's render. The cache is a git-ignored build output.
        let cache = test_case
            .root
            .join("reference")
            .join("screenshots")
            .join(&variant.slug);
        let views = test_case.references_for(variant);
        let mut rendered = Vec::with_capacity(views.len());
        for view in &views {
            let out = cache.join(format!("{}.png", view.view));
            let url = file_url(&view.source_path);
            match browser::capture(&url, &[], &out) {
                Ok(()) => rendered.push(RenderedReference {
                    view: view.view.clone(),
                    image_path: out,
                }),
                Err(detail) => {
                    eprintln!(
                        "warning: could not render reference `{}` ({detail})",
                        view.view
                    );
                }
            }
        }
        Ok(rendered)
    }
}

/// Build a `file://` URL for a local mockup, resolving it to an absolute path so
/// the browser can load it regardless of the process working directory.
fn file_url(path: &Path) -> String {
    let absolute = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    path_to_file_url(&absolute)
}

#[cfg(windows)]
fn path_to_file_url(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let without_verbatim = raw
        .strip_prefix(r"\\?\")
        .or_else(|| raw.strip_prefix(r"\??\"))
        .unwrap_or(&raw);
    format!("file:///{}", without_verbatim.replace('\\', "/"))
}

#[cfg(not(windows))]
fn path_to_file_url(path: &Path) -> String {
    format!("file://{}", path.display())
}
