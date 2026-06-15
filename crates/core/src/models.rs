//! Model catalog: a curated list of the models runs are evaluated against.
//!
//! Mirrors [`TestCaseCatalog`](crate::test_case::TestCaseCatalog) in style. Each
//! model is declared in a `models/<slug>.toml` file describing how it is named,
//! who provides it, how it maps onto OpenRouter for pricing, and which model IDs
//! identify it in run records. The catalog is site-facing metadata; it has no
//! bearing on how a run is executed.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The on-disk `models/<slug>.toml` declaration for a single model.
///
/// The `description` is a path, relative to the catalog directory, to a
/// site-facing Markdown file; it is resolved and validated to exist on the
/// resolved [`Model`].
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ModelManifest {
    /// Human-readable display name.
    name: String,
    /// The provider that serves the model (for example `OpenAI`, `Anthropic`).
    provider: String,
    /// The slug OpenRouter lists the model under, when it is on OpenRouter. Used
    /// to build the model's OpenRouter URL and to look up comparable pricing.
    openrouter_slug: Option<String>,
    /// Optional site-facing prose, relative to the catalog directory, pointing
    /// at a Markdown file (for example `gpt-5.md`).
    description: Option<PathBuf>,
    /// The model ID strings as they appear in run records, used to map a run's
    /// `subject.modelId` back to this model.
    #[serde(default)]
    model_ids: Vec<String>,
}

/// The file extension every model declaration uses.
const MODEL_EXT: &str = "toml";

/// A curated model the benchmark evaluates, resolved from its declaration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    /// The stable slug naming this model (the `<slug>` of `models/<slug>.toml`).
    pub slug: String,
    /// Human-readable display name.
    pub name: String,
    /// The provider that serves the model.
    pub provider: String,
    /// The slug OpenRouter lists the model under, when it is on OpenRouter.
    pub openrouter_slug: Option<String>,
    /// Path to the optional site-facing description Markdown, resolved inside
    /// the catalog directory. `None` when the declaration names none.
    pub description_path: Option<PathBuf>,
    /// The model ID strings as they appear in run records.
    pub model_ids: Vec<String>,
}

/// Resolves model slugs against an on-disk catalog.
///
/// The catalog is a `models/` directory holding one `<slug>.toml` per model.
#[derive(Debug, Clone)]
pub struct ModelCatalog {
    /// Root of the catalog (the `models/` directory).
    root: PathBuf,
}

impl ModelCatalog {
    /// Open a catalog rooted at the given `models/` directory.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The catalog root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// List every model in the catalog, ordered by slug. A missing catalog
    /// directory yields an empty list rather than an error, so the catalog is
    /// optional.
    pub fn list(&self) -> Result<Vec<Model>> {
        if !self.root.is_dir() {
            return Ok(Vec::new());
        }
        let mut models = Vec::new();
        for slug in self.slugs()? {
            models.push(self.resolve(&slug)?);
        }
        models.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok(models)
    }

    /// Resolve a single model slug into a [`Model`], reading its declaration and
    /// validating that any declared description exists.
    pub fn resolve(&self, slug: &str) -> Result<Model> {
        let manifest = self.read_manifest(slug)?;

        // The description path is validated to exist when declared, with the
        // same self-containment guard the test case catalog applies.
        let description_path = match &manifest.description {
            Some(description) => {
                if escapes_folder(description) {
                    return Err(Error::Validation(format!(
                        "model `{slug}` description path `{}` escapes the catalog folder",
                        description.display()
                    )));
                }
                let path = self.root.join(description);
                if !path.is_file() {
                    return Err(Error::Validation(format!(
                        "model `{slug}` description `{}` does not exist",
                        description.display()
                    )));
                }
                Some(path)
            }
            None => None,
        };

        Ok(Model {
            slug: slug.to_string(),
            name: manifest.name,
            provider: manifest.provider,
            openrouter_slug: manifest.openrouter_slug,
            description_path,
            model_ids: manifest.model_ids,
        })
    }

    /// List the model slugs declared in the catalog, ignoring hidden files and
    /// any file that is not a `.toml`.
    fn slugs(&self) -> Result<Vec<String>> {
        let mut slugs = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some(MODEL_EXT) {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str())
                && !stem.starts_with('.')
            {
                slugs.push(stem.to_string());
            }
        }
        Ok(slugs)
    }

    /// Read and parse a single `models/<slug>.toml` declaration.
    fn read_manifest(&self, slug: &str) -> Result<ModelManifest> {
        let path = self.root.join(format!("{slug}.{MODEL_EXT}"));
        let raw = fs::read_to_string(&path)
            .map_err(|err| Error::Validation(format!("could not read model `{slug}`: {err}")))?;
        toml::from_str(&raw)
            .map_err(|err| Error::Validation(format!("invalid model `{slug}`: {err}")))
    }
}

/// Whether a relative path would escape the catalog folder it is resolved
/// against. Absolute paths and `..` components that rise above the root escape;
/// `.` components are ignored.
fn escapes_folder(rel: &Path) -> bool {
    use std::path::Component;

    let mut depth: i32 = 0;
    for component in rel.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => return true,
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return true;
                }
            }
            Component::CurDir => {}
            Component::Normal(_) => depth += 1,
        }
    }
    false
}

#[cfg(test)]
#[path = "models.test.rs"]
mod tests;
