//! Test case catalog: slugs, versions, and resolution.
//!
//! See `docs/test-cases.md`. Test cases live under a top-level `test-cases/`
//! folder laid out as `test-cases/<slug>/<version>/`. Each version is
//! self-contained and immutable.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The on-disk `test-case.toml` manifest for a single version.
///
/// This is the machine-readable declaration of what a version contains: the
/// specification and assets that are seeded, the reference views (rendered to
/// screenshots and seeded as visual targets), and the opt-in validation checks.
/// See `docs/test-cases.md#manifest`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct Manifest {
    /// Human-readable display name, surfaced on the site.
    name: String,
    /// Relative difficulty of the case, surfaced on the site (for example
    /// `easy`, `medium`, `hard`). Defaults to `medium`.
    #[serde(default = "default_difficulty")]
    difficulty: String,
    /// Free-form classification tags surfaced on the site (for example
    /// `arcade`, `2d`).
    #[serde(default)]
    tags: Vec<String>,
    /// Optional site-facing prose, relative to the version folder, pointing at a
    /// Markdown file (for example `description.md`). This is **not** seeded into
    /// runs; it exists only to describe the case on the site.
    #[serde(default)]
    description: Option<PathBuf>,
    /// The prompt template handed to the harness, relative to the version folder.
    /// Rendered through Handlebars with the run's workspace and seeded spec paths;
    /// see [`crate::prompt`].
    prompt: PathBuf,
    /// Specs seeded for **every** variant. Each maps a `source` inside the
    /// version folder to a `dest` in the run's workspace. Declared as repeated
    /// `[[spec]]` tables.
    #[serde(default, rename = "spec")]
    specs: Vec<ManifestSpec>,
    /// Asset files or directories, relative to the version folder (seeded).
    #[serde(default)]
    assets: Vec<PathBuf>,
    /// The variants this case offers. Each seeds the common `specs` plus its own
    /// additional specs; exactly one variant runs per run. At least one variant
    /// must be declared.
    #[serde(default)]
    variant: Vec<ManifestVariant>,
    /// Reference views. Each is rendered to a screenshot and seeded as a visual
    /// target; the reference source is not seeded.
    #[serde(default)]
    reference: Vec<ManifestReference>,
    /// Opt-in validation checks. Only declared checks run.
    #[serde(default)]
    check: Vec<ManifestCheck>,
}

/// A single spec mapping in the manifest (`[[spec]]` or a variant's `spec`
/// array): a `source` file inside the version folder seeded to a `dest` path in
/// the run's workspace.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestSpec {
    /// Source path, relative to the version folder.
    source: PathBuf,
    /// Destination path, relative to the run's workspace root.
    dest: PathBuf,
}

/// A single `[[variant]]` entry in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestVariant {
    /// The stable slug naming this variant (recorded in run records).
    slug: String,
    /// Human-readable display name. Defaults to a humanized form of `slug`.
    name: Option<String>,
    /// Optional site-facing prose describing what the variant changes.
    #[serde(default)]
    description: Option<String>,
    /// Specs this variant seeds in addition to the common `specs`. Declared as a
    /// `spec` array of inline `{ source, dest }` tables.
    #[serde(default, rename = "spec")]
    specs: Vec<ManifestSpec>,
    /// Reference views this variant declares in addition to the common
    /// references. Declared as a `reference` array of inline `{ view, path }`
    /// tables. A variant-specific reference lets one view (for example the title
    /// menu) differ per variant; its view slug must not collide with a common
    /// reference or another of this variant's references.
    #[serde(default, rename = "reference")]
    references: Vec<ManifestReference>,
}

/// A single `[[reference]]` entry in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestReference {
    /// The view slug.
    view: String,
    /// The reference source path, relative to the version folder.
    path: PathBuf,
}

/// A single `[[check]]` entry in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ManifestCheck {
    /// The view slug this check records its result under.
    view: String,
    /// Human-readable display name for the check. Defaults to a humanized form
    /// of `view` (for example `game-over` becomes `Game Over`) when omitted.
    name: Option<String>,
    /// The reference view whose rendered screenshot is the comparison baseline.
    /// Defaults to `view` when omitted.
    reference: Option<String>,
    /// The actions that drive the implementation into the view before capture.
    /// Empty means the view is whatever the implementation shows on load.
    #[serde(default)]
    actions: Vec<CheckAction>,
}

/// The manifest file name expected in every version folder.
const MANIFEST_FILE: &str = "test-case.toml";

/// A test case: a single game a model is asked to build, identified by a stable
/// slug and offering one or more independently versioned revisions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    /// The stable slug naming this test case (the `<slug>` directory).
    pub slug: String,
    /// The versions available for this test case.
    pub versions: Vec<String>,
}

/// A spec file seeded into a run.
///
/// Each spec is copied from its [`Self::source_path`] on the host into the run's
/// fresh repository at [`Self::dest`] (a path relative to the workspace root). A
/// case's common specs are seeded for every variant; a variant may seed
/// additional specs, and may even map a different source onto the same `dest` so
/// the model always sees a stable path regardless of variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecFile {
    /// Source path on the host, inside the version folder.
    pub source_path: PathBuf,
    /// Destination path relative to the run's workspace root, where the spec is
    /// seeded and where the rendered prompt points the model.
    pub dest: PathBuf,
}

/// A named build target of a test case.
///
/// A variant seeds the case's common specs plus its own additional specs, so one
/// case can define multiple builds (for example, the same game with or without an
/// extra mode). Exactly one variant is selected per run and recorded in the run
/// record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    /// The stable slug naming this variant.
    pub slug: String,
    /// Human-readable display name, surfaced on the site.
    pub name: String,
    /// Optional site-facing prose describing what the variant changes.
    pub description: Option<String>,
    /// Specs this variant seeds in addition to the case's common specs.
    pub specs: Vec<SpecFile>,
    /// Reference views this variant declares in addition to the case's common
    /// references. Rendered and seeded only when this variant is selected, so a
    /// view such as the title menu can differ per variant.
    pub references: Vec<ReferenceView>,
}

/// A reference view a test case declares as a visual target.
///
/// The reference is rendered to a screenshot which is **seeded** into a run so
/// the model can see what the screen should look like. The reference *source*
/// (the HTML/CSS mockup at [`Self::source_path`]) is never seeded — handing it
/// over would let a model copy the intended UI instead of building it from the
/// specification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceView {
    /// The view name (for example, `title`), matched against a declared
    /// [`Check`]'s baseline.
    pub view: String,
    /// Path to the reference source mockup on the host, relative to the version
    /// folder. Rendered to a screenshot; never seeded directly.
    pub source_path: PathBuf,
}

/// A single action that drives a served implementation toward a view.
///
/// Serializes to the JSON shape the browser driver consumes (an internally
/// tagged `{ "type": … }` object); see `packages/browser-driver/driver.mjs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CheckAction {
    /// Pause for `ms` milliseconds.
    Wait {
        /// Duration to wait, in milliseconds.
        ms: u64,
    },
    /// Press and release a key (Playwright key name, e.g. `Enter`, `ArrowUp`).
    Key {
        /// The key to press.
        key: String,
    },
    /// Hold a key down for `ms` milliseconds, then release it.
    Hold {
        /// The key to hold.
        key: String,
        /// How long to hold it, in milliseconds.
        ms: u64,
    },
    /// Click a logical-pixel point on the page.
    Click {
        /// Horizontal position, in logical pixels.
        x: f64,
        /// Vertical position, in logical pixels.
        y: f64,
    },
}

/// An opt-in validation check.
///
/// A check drives a produced implementation through [`Self::actions`],
/// screenshots it, and compares that capture against the screenshot rendered
/// from the [`Self::reference_view`] reference. Validation runs only the checks
/// a test case declares; a reference is not validated unless a check names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    /// The view slug this check records its result under.
    pub view: String,
    /// Human-readable display name for the check.
    pub name: String,
    /// The reference view whose rendered screenshot is the comparison baseline.
    pub reference_view: String,
    /// The actions that drive the implementation into the view before capture.
    pub actions: Vec<CheckAction>,
}

// `Check` derives `Eq`, so its actions must too; the `Click` coordinates are the
// only floats. They originate as exact TOML literals and are only ever compared,
// never arithmetic'd, so treating them as `Eq` is sound here.
impl Eq for CheckAction {}

/// A resolved, exact test case version.
///
/// Holds the on-disk location and the manifest of what the version contains.
/// The specification, assets, and the *rendered* reference screenshots are
/// seeded into a run; the reference *source* mockups are not. The declared
/// [`Self::checks`] drive validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaseVersion {
    /// The owning test case slug.
    pub slug: String,
    /// The exact version string (the `<version>` directory).
    pub version: String,
    /// Human-readable display name, surfaced on the site.
    pub name: String,
    /// Relative difficulty of the case, surfaced on the site.
    pub difficulty: String,
    /// Free-form classification tags surfaced on the site.
    pub tags: Vec<String>,
    /// Path to the optional site-facing description Markdown, resolved inside
    /// the version folder. `None` when the manifest declares none. This is
    /// **not** seeded into runs.
    pub description_path: Option<PathBuf>,
    /// The version folder on the host: `test-cases/<slug>/<version>/`.
    pub root: PathBuf,
    /// Host path to the prompt template handed to the harness. Rendered through
    /// Handlebars with the run's workspace and seeded spec paths.
    pub prompt_path: PathBuf,
    /// Specs seeded for every variant (the common set).
    pub common_specs: Vec<SpecFile>,
    /// Paths to assets the model should use (seeded).
    pub asset_paths: Vec<PathBuf>,
    /// The variants this case offers, in declared order. At least one is always
    /// present.
    pub variants: Vec<Variant>,
    /// Common reference views: rendered and seeded for **every** variant. A
    /// variant may declare additional references of its own (see
    /// [`Variant::references`]); the full set for a variant is
    /// [`Self::references_for`].
    pub common_references: Vec<ReferenceView>,
    /// Opt-in validation checks declared by this version.
    pub checks: Vec<Check>,
}

impl TestCaseVersion {
    /// Resolve a variant by its slug.
    pub fn variant(&self, slug: &str) -> Result<&Variant> {
        self.variants
            .iter()
            .find(|variant| variant.slug == slug)
            .ok_or_else(|| Error::VariantNotFound {
                slug: self.slug.clone(),
                version: self.version.clone(),
                variant: slug.to_string(),
            })
    }

    /// The full set of specs seeded for a variant: the common specs followed by
    /// the variant's own additional specs. Resolution forbids two specs sharing a
    /// `dest`, so the order is stable and unambiguous.
    pub fn seeded_specs(&self, variant: &Variant) -> Vec<SpecFile> {
        self.common_specs
            .iter()
            .chain(variant.specs.iter())
            .cloned()
            .collect()
    }

    /// The full set of reference views for a variant: the common references
    /// followed by the variant's own additional references. These are the views
    /// rendered to screenshots, seeded as visual targets, and used as validation
    /// baselines when this variant runs. Resolution forbids two references sharing
    /// a `view`, so the order is stable and each view slug is unambiguous.
    pub fn references_for(&self, variant: &Variant) -> Vec<ReferenceView> {
        self.common_references
            .iter()
            .chain(variant.references.iter())
            .cloned()
            .collect()
    }
}

/// Resolves test case slugs and versions against an on-disk catalog.
///
/// The catalog is the `test-cases/` directory laid out as
/// `test-cases/<slug>/<version>/`.
#[derive(Debug, Clone)]
pub struct TestCaseCatalog {
    /// Root of the catalog (the `test-cases/` directory).
    root: PathBuf,
}

impl TestCaseCatalog {
    /// Open a catalog rooted at the given `test-cases/` directory.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The catalog root directory.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// List every test case slug in the catalog, each with its versions newest
    /// first. Slugs with no version folders are skipped.
    pub fn list(&self) -> Result<Vec<TestCase>> {
        let mut cases = Vec::new();
        for slug in read_dir_names(&self.root)? {
            let versions = self.versions(&slug)?;
            if !versions.is_empty() {
                cases.push(TestCase { slug, versions });
            }
        }
        cases.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok(cases)
    }

    /// List the versions available for a slug, newest first.
    pub fn versions(&self, slug: &str) -> Result<Vec<String>> {
        let slug_dir = self.root.join(slug);
        if !slug_dir.is_dir() {
            return Err(Error::TestCaseNotFound {
                slug: slug.to_string(),
            });
        }
        let mut versions = read_dir_names(&slug_dir)?;
        // Newest first. Versions are compared component-wise so `v1.10.0` sorts
        // after `v1.9.0` rather than lexically before it.
        versions.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
        Ok(versions)
    }

    /// Resolve an exact `<slug>@<version>` into a [`TestCaseVersion`], reading
    /// its manifest and validating that it is self-contained.
    pub fn resolve(&self, slug: &str, version: &str) -> Result<TestCaseVersion> {
        let slug_dir = self.root.join(slug);
        if !slug_dir.is_dir() {
            return Err(Error::TestCaseNotFound {
                slug: slug.to_string(),
            });
        }
        let root = slug_dir.join(version);
        if !root.is_dir() {
            return Err(Error::TestCaseVersionNotFound {
                slug: slug.to_string(),
                version: version.to_string(),
            });
        }

        let manifest = self.read_manifest(slug, version, &root)?;
        let invalid = |detail: String| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail,
        };

        // Every declared path must stay inside the version folder, keeping the
        // version self-contained.
        let resolve_inside = |rel: &Path, kind: &str| -> Result<PathBuf> {
            if escapes_folder(rel) {
                return Err(invalid(format!(
                    "{kind} path `{}` escapes the version folder",
                    rel.display()
                )));
            }
            Ok(root.join(rel))
        };

        // The prompt template is required. It is handed to the harness in
        // rendered form rather than copied into the run, but it is validated to
        // exist and to stay inside the version folder like every other path.
        let prompt_path = resolve_inside(&manifest.prompt, "prompt")?;
        if !prompt_path.is_file() {
            return Err(invalid(format!(
                "prompt `{}` does not exist",
                manifest.prompt.display()
            )));
        }

        // Resolve one spec mapping: the source must exist inside the version
        // folder, and the dest must be a relative path that stays inside the
        // run's workspace.
        let resolve_spec = |spec: &ManifestSpec| -> Result<SpecFile> {
            let source_path = resolve_inside(&spec.source, "spec source")?;
            if !source_path.is_file() {
                return Err(invalid(format!(
                    "spec source `{}` does not exist",
                    spec.source.display()
                )));
            }
            if escapes_folder(&spec.dest) {
                return Err(invalid(format!(
                    "spec dest `{}` escapes the run workspace",
                    spec.dest.display()
                )));
            }
            Ok(SpecFile {
                source_path,
                dest: spec.dest.clone(),
            })
        };

        let mut common_specs = Vec::with_capacity(manifest.specs.len());
        for spec in &manifest.specs {
            common_specs.push(resolve_spec(spec)?);
        }

        // The site-facing description is validated to exist when declared, with
        // the same self-containment guard as every other path, but it is never
        // seeded into a run.
        let description_path = match &manifest.description {
            Some(description) => {
                let path = resolve_inside(description, "description")?;
                if !path.is_file() {
                    return Err(invalid(format!(
                        "description `{}` does not exist",
                        description.display()
                    )));
                }
                Some(path)
            }
            None => None,
        };

        let mut asset_paths = Vec::with_capacity(manifest.assets.len());
        for asset in &manifest.assets {
            let path = resolve_inside(asset, "asset")?;
            if !path.exists() {
                return Err(invalid(format!(
                    "asset `{}` does not exist",
                    asset.display()
                )));
            }
            asset_paths.push(path);
        }

        // Resolve one reference mapping: the source mockup must exist inside the
        // version folder. Shared by the common references and each variant's own.
        let resolve_reference = |reference: &ManifestReference| -> Result<ReferenceView> {
            let path = resolve_inside(&reference.path, "reference")?;
            if !path.is_file() {
                return Err(invalid(format!(
                    "reference `{}` for view `{}` does not exist",
                    reference.path.display(),
                    reference.view
                )));
            }
            Ok(ReferenceView {
                view: reference.view.clone(),
                source_path: path,
            })
        };

        let mut common_references = Vec::with_capacity(manifest.reference.len());
        for reference in &manifest.reference {
            common_references.push(resolve_reference(reference)?);
        }

        // A case must offer at least one variant; a run always selects exactly
        // one. Variant slugs must be unique so a run records an unambiguous
        // choice.
        if manifest.variant.is_empty() {
            return Err(invalid(
                "at least one [[variant]] must be declared".to_string(),
            ));
        }
        let mut variants: Vec<Variant> = Vec::with_capacity(manifest.variant.len());
        for variant in &manifest.variant {
            if variants
                .iter()
                .any(|resolved| resolved.slug == variant.slug)
            {
                return Err(invalid(format!(
                    "duplicate variant slug `{}`",
                    variant.slug
                )));
            }
            let mut specs = Vec::with_capacity(variant.specs.len());
            for spec in &variant.specs {
                specs.push(resolve_spec(spec)?);
            }
            // The common specs and the variant's own specs are seeded together;
            // two specs landing on the same dest would clobber each other, so a
            // collision is rejected rather than silently resolved.
            let mut seen = std::collections::BTreeSet::new();
            for spec in common_specs.iter().chain(specs.iter()) {
                if !seen.insert(&spec.dest) {
                    return Err(invalid(format!(
                        "variant `{}` seeds two specs to the same dest `{}`",
                        variant.slug,
                        spec.dest.display()
                    )));
                }
            }

            let mut references = Vec::with_capacity(variant.references.len());
            for reference in &variant.references {
                references.push(resolve_reference(reference)?);
            }
            // The common references and the variant's own are rendered and seeded
            // together under one view slug each; two references sharing a view
            // would clobber each other (a view is either common or owned by this
            // variant, never both), so a collision is rejected.
            let mut seen_views = std::collections::BTreeSet::new();
            for reference in common_references.iter().chain(references.iter()) {
                if !seen_views.insert(&reference.view) {
                    return Err(invalid(format!(
                        "variant `{}` declares two references for the same view `{}`",
                        variant.slug, reference.view
                    )));
                }
            }

            let name = variant
                .name
                .clone()
                .unwrap_or_else(|| humanize(&variant.slug));
            variants.push(Variant {
                slug: variant.slug.clone(),
                name,
                description: variant.description.clone(),
                specs,
                references,
            });
        }

        // Every check must name a reference view that resolves for **every**
        // variant — either a common reference or one each variant declares — so
        // its baseline can always be rendered whichever variant runs. This keeps
        // validation declarations honest across variant-specific references.
        let mut checks = Vec::with_capacity(manifest.check.len());
        for check in &manifest.check {
            let reference_view = check
                .reference
                .clone()
                .unwrap_or_else(|| check.view.clone());
            let common = common_references.iter().any(|r| r.view == reference_view);
            if let Some(missing) = variants.iter().find(|variant| {
                !common && !variant.references.iter().any(|r| r.view == reference_view)
            }) {
                return Err(invalid(format!(
                    "check `{}` references reference view `{}`, which variant `{}` does not declare",
                    check.view, reference_view, missing.slug
                )));
            }
            let name = check.name.clone().unwrap_or_else(|| humanize(&check.view));
            checks.push(Check {
                view: check.view.clone(),
                name,
                reference_view,
                actions: check.actions.clone(),
            });
        }

        Ok(TestCaseVersion {
            slug: slug.to_string(),
            version: version.to_string(),
            name: manifest.name,
            difficulty: manifest.difficulty,
            tags: manifest.tags,
            description_path,
            root,
            prompt_path,
            common_specs,
            asset_paths,
            variants,
            common_references,
            checks,
        })
    }

    /// Resolve the latest version of a slug.
    pub fn resolve_latest(&self, slug: &str) -> Result<TestCaseVersion> {
        let version = self.versions(slug)?.into_iter().next().ok_or_else(|| {
            Error::TestCaseVersionNotFound {
                slug: slug.to_string(),
                version: "latest".to_string(),
            }
        })?;
        self.resolve(slug, &version)
    }

    /// Read and parse a version's `test-case.toml` manifest.
    fn read_manifest(&self, slug: &str, version: &str, root: &Path) -> Result<Manifest> {
        let manifest_path = root.join(MANIFEST_FILE);
        let raw = fs::read_to_string(&manifest_path).map_err(|err| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail: format!("could not read {MANIFEST_FILE}: {err}"),
        })?;
        toml::from_str(&raw).map_err(|err| Error::InvalidTestCase {
            slug: slug.to_string(),
            version: version.to_string(),
            detail: format!("invalid {MANIFEST_FILE}: {err}"),
        })
    }
}

/// Read the immediate subdirectory names of a directory, ignoring files and
/// hidden entries.
fn read_dir_names(dir: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Some(name) = entry.file_name().to_str()
            && !name.starts_with('.')
        {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

/// A comparable key for a version string so versions order component-wise.
///
/// Leading `v` is ignored and dot-separated numeric components are compared
/// numerically; any non-numeric tail is ignored for ordering. Versions that do
/// not parse sort before those that do.
fn version_key(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().unwrap_or(0)
        })
        .collect()
}

/// The default difficulty applied when a manifest omits one.
fn default_difficulty() -> String {
    "medium".to_string()
}

/// Humanize a slug into a display name by splitting on `-`/`_` and capitalizing
/// each word (for example `game-over` becomes `Game Over`).
fn humanize(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether a relative path would escape the folder it is resolved against.
///
/// A path escapes if it is absolute, or if its `..` components ever rise above
/// its starting point. `.` components are ignored.
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
