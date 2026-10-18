//! The run engine's extensions of the backend client: materializing a
//! backend-resolved version onto disk, and the renderer that hands a run the
//! references the backend already rendered.
//!
//! The client itself is `test-cabinet-backend-client`, re-exported here at its old
//! paths. A resolved [`TestCaseVersion`] carries store-relative keys in its path
//! fields (it has no host checkout); [`materialize_version`] turns a remote
//! resolution into the on-disk inputs the seeder, prompt renderer and validator
//! consume unchanged.

use std::path::{Path, PathBuf};

pub use test_cabinet_backend_client::*;

use crate::error::{Error as RunError, Result as RunResult};
use crate::match_play::ARENA_OPPONENT_IDS;
use crate::reference::RenderedReference;
use crate::test_case::{EngineWorkspaces, ReviewItem, TestCaseVersion, TestType, Variant};

/// Materialize a backend-resolved version onto disk so the existing seeder,
/// prompt renderer, and validator — all of which read host paths — work
/// unchanged against a remote definition.
///
/// Writes the prompt template, every spec source, every starter workspace file,
/// every asset, and the backend-rendered reference screenshots under
/// `store_dir`, then returns a
/// [`TestCaseVersion`] whose path fields point inside `store_dir`, together with
/// the [`RenderedReference`]s for `variant` (the common references plus that
/// variant's own). Pair the returned references with a
/// [`PrerenderedReferenceRenderer`] so [`crate::RunEngine::run`] reuses them
/// rather than re-rendering from mockup HTML the runner never receives.
pub async fn materialize_version(
    client: &dyn BackendClient,
    slug: &str,
    version: &str,
    variant: &str,
    store_dir: &Path,
) -> RunResult<(TestCaseVersion, Vec<RenderedReference>)> {
    let mut resolved = client.resolve_version(slug, version).await?;
    let root = store_dir.to_path_buf();
    std::fs::create_dir_all(&root)?;

    // The prompt template is served inline; write it to disk so `render_prompt`
    // (which reads `prompt_path`) keeps working without a special case.
    let prompt_path = root.join("prompt.hbs");
    let template = client.prompt_template(slug, version).await?;
    write_at(&prompt_path, template.as_bytes())?;

    // Fetch and write every spec source (common + each variant's own) and asset
    // by its store-relative key, then rewrite the version's path fields to point
    // at the materialized copies.
    let mut sources: std::collections::BTreeSet<PathBuf> = std::collections::BTreeSet::new();
    for spec in resolved.common_specs.iter().chain(
        resolved
            .variants
            .iter()
            .flat_map(|variant| variant.specs.iter()),
    ) {
        sources.insert(spec.source_path.clone());
    }
    let mut assets: std::collections::BTreeSet<PathBuf> = std::collections::BTreeSet::new();
    for asset in &resolved.asset_paths {
        assets.insert(asset.clone());
    }
    // Starter workspace files (common + each variant's override) are fetched by
    // their store-relative key the same way, then rewritten to host paths below.
    let mut workspace: std::collections::BTreeSet<PathBuf> = std::collections::BTreeSet::new();
    for file in resolved.common_workspace.files().chain(
        resolved
            .variants
            .iter()
            .filter_map(|variant| variant.workspace.as_ref())
            .flat_map(EngineWorkspaces::files),
    ) {
        workspace.insert(file.source_path.clone());
    }
    for key in sources.iter().chain(assets.iter()).chain(workspace.iter()) {
        fetch_into(client, slug, version, key, &root).await?;
    }

    // The suite a suite-defined version was lowered from. A run of one is judged
    // against its suite rather than only seeded from it: the prompt handed to the
    // harness is rendered from the definition and the specifications it selects, and
    // one requirement outcome is recorded per requirement those specifications
    // declare, decided by the suite's `validators/` project. None of that is
    // reachable from the lowered manifest, so the version folder is rebuilt here out
    // of the keys the store lists — `suite.toml`, the specification folders, the
    // definition files, the validator project and the debug API declaration — and the
    // suite model is read back out of the store directory, exactly as it is read out
    // of a local checkout. An authored version lists none of this and the loop is
    // empty.
    for key in &client.suite_files(slug, version).await? {
        fetch_into(client, slug, version, key, &root).await?;
    }

    // Reference screenshots: the backend renders them at ingest. Write each PNG
    // under `references/<scope>/<view>.png` and point the version's reference
    // views at those files so seeding and validation use them as host paths.
    let common: std::collections::HashSet<&str> = resolved
        .common_references
        .iter()
        .map(|r| r.view.as_str())
        .collect();
    let common: std::collections::HashSet<String> = common.iter().map(|s| s.to_string()).collect();
    let media = client.references(slug, version, variant).await?;
    let mut rendered = Vec::with_capacity(media.len());
    for item in &media {
        let scope = if common.contains(&item.view) {
            "_common".to_string()
        } else {
            variant.to_string()
        };
        let media_path = root
            .join("references")
            .join(&scope)
            .join(format!("{}.{}", item.view, item.extension));
        write_at(&media_path, &item.bytes)?;
        rendered.push(RenderedReference {
            view: item.view.clone(),
            kind: item.kind,
            media_path,
        });
    }

    // Adversarial opponent controllers: the case commits its baselines and hidden
    // references as `references/<id>.wasm`, but those are *not* manifest reference
    // views, so the screenshot loop above never fetches them. The
    // [`AdversarialValidator`](crate::AdversarialValidator) (and the arena's
    // disk-resolved paths) load them straight from `references/<id>.wasm` under the
    // version root, so materialize them here for an adversarial case — otherwise a
    // backend-driven run validates against a hole and forfeits with "the case ships
    // no opponent". The ids are the full arena set (model-facing baselines plus the
    // hidden references like `fuel-probe`); they live on disk only, never seeded
    // into the run container, exactly as a local checkout already has them.
    if resolved.test_type == TestType::Adversarial {
        for id in ARENA_OPPONENT_IDS {
            let key = PathBuf::from("references").join(format!("{id}.wasm"));
            fetch_into(client, slug, version, &key, &root).await?;
        }
    }

    // Performance `[[case]]` files: the held-out scored set — each case's `input`
    // scenario and its `expected` oracle state — lives in the version folder but is
    // neither a spec, an asset, nor a reference view, so the loops above never fetch
    // it. The [`PerformanceValidator`](crate::PerformanceValidator) reads both from
    // `test_case.root` per case, so a backend-driven run needs them materialized
    // exactly as a local checkout already ships them.
    for case in &resolved.cases {
        for key in [&case.input, &case.expected] {
            fetch_into(client, slug, version, key, &root).await?;
        }
    }

    // Automated-validation debug scripts: a review item's `validation.script` names a
    // reporter-side driver (`validation/<item>.mjs`) under the version folder that is
    // never a spec, asset, or workspace file, so the loops above never fetch it. The
    // [`Validator`](crate::Validator) runs it from the item's resolved
    // [`ReviewValidation::script`] host path to auto-decide the item and synthesize its
    // media, so a backend-driven run needs it materialized — exactly as a local
    // checkout already ships it, and, like a reference mockup, never seeded into the
    // model's run container.
    //
    // Materialize the **whole** `validation/` directory, not just the named scripts: a
    // driver typically imports shared modules (for example `validation/_helpers.mjs`)
    // that no review item names, and those siblings must be on disk beside the script or
    // its `import` fails at run time. `validation_files` enumerates the directory; union
    // it with the named scripts so the drivers are always present even if a client
    // serves no directory listing. Dedup by key so a shared file is fetched once.
    let mut scripts: std::collections::BTreeSet<PathBuf> = std::collections::BTreeSet::new();
    let mut scripted = false;
    for item in resolved.common_review_items.iter().chain(
        resolved
            .variants
            .iter()
            .flat_map(|variant| variant.review_items.iter()),
    ) {
        // Validation lives on the item when it has no sub-items, otherwise on each
        // sub-item — gather both so a sub-item-only case still triggers the directory
        // listing below (its `scripts` set would otherwise be empty).
        for validation in item.validation.iter().chain(
            item.sub_items
                .iter()
                .filter_map(|sub| sub.validation.as_ref()),
        ) {
            scripted = true;
            // A per-engine validator's declared path is relative to a validator
            // project, not to the version folder, so it is not an artifact key. Its
            // project comes down whole in the directory listing below, which is the
            // only way to fetch it and the reason the listing is asked for whenever
            // the case has a scripted point at all.
            if validation.script.is_some() {
                scripts.insert(PathBuf::from(&validation.script_rel));
            }
        }
    }
    // Only ask the backend for the directory listing when the case actually has scripted
    // items — a case with none has no `validation/` directory, and this avoids a
    // needless request (and a spurious empty-list round-trip) on every other run.
    if scripted {
        for key in client.validation_files(slug, version).await? {
            scripts.insert(key);
        }
    }
    for key in &scripts {
        fetch_into(client, slug, version, key, &root).await?;
    }

    // Rewrite path fields from store-relative keys to materialized host paths.
    resolved.root = root.clone();
    resolved.prompt_path = prompt_path;
    for spec in &mut resolved.common_specs {
        spec.source_path = root.join(&spec.source_path);
    }
    resolved.asset_paths = resolved.asset_paths.iter().map(|a| root.join(a)).collect();
    for case in &mut resolved.cases {
        case.input = root.join(&case.input);
        case.expected = root.join(&case.expected);
    }
    for file in resolved.common_workspace.files_mut() {
        file.source_path = root.join(&file.source_path);
    }
    // Point each auto-validated unit's debug script at its materialized copy (its
    // `script_rel` under the version root), so the validator runs the on-disk file.
    // Validation sits on the item (no sub-items) or on each sub-item, so rewrite both.
    let root_scripts = |item: &mut ReviewItem| {
        for validation in item.validation.iter_mut().chain(
            item.sub_items
                .iter_mut()
                .filter_map(|sub| sub.validation.as_mut()),
        ) {
            validation.script = validation
                .script
                .as_ref()
                .map(|_| root.join(&validation.script_rel));
        }
    };
    for item in &mut resolved.common_review_items {
        root_scripts(item);
    }
    for variant in &mut resolved.variants {
        for spec in &mut variant.specs {
            spec.source_path = root.join(&spec.source_path);
        }
        if let Some(workspaces) = &mut variant.workspace {
            for file in workspaces.files_mut() {
                file.source_path = root.join(&file.source_path);
            }
        }
        for item in &mut variant.review_items {
            root_scripts(item);
        }
        // Point each reference view at its materialized media (scope = variant);
        // a rendered reference is a `.png`, a static reference keeps its extension.
        for reference in &mut variant.references {
            let file = format!("{}.{}", reference.view, reference.extension());
            reference.source_path = root.join("references").join(&variant.slug).join(file);
        }
    }
    for reference in &mut resolved.common_references {
        let file = format!("{}.{}", reference.view, reference.extension());
        reference.source_path = root.join("references").join("_common").join(file);
    }

    Ok((resolved, rendered))
}

/// Fetch one store-relative key into the definition store, naming the key when the
/// store cannot serve it.
///
/// A version that references a file the store does not hold fails the run in setup,
/// and the one thing that failure has to say is which key was missing: the transport
/// error alone names a percent-encoded URL, which is not the key a definition
/// declares.
async fn fetch_into(
    client: &dyn BackendClient,
    slug: &str,
    version: &str,
    key: &Path,
    root: &Path,
) -> RunResult<()> {
    let artifact = client.artifact(slug, version, key).await.map_err(|err| {
        RunError::Seeding(format!(
            "the definition store cannot serve `{}` of `{slug}@{version}`: {err}",
            forward_slash(key)
        ))
    })?;
    write_at(&root.join(key), &artifact.bytes)?;
    Ok(())
}

/// A [`crate::ReferenceRenderer`] that returns references already rendered by the
/// backend, rather than rendering mockup HTML the runner never receives.
///
/// Pair it with [`materialize_version`]'s returned references so
/// [`crate::RunEngine::run`] — which calls `render_references` — reuses the
/// backend's screenshots as both the seeded visual targets and the validation
/// baselines.
#[derive(Debug, Clone, Default)]
pub struct PrerenderedReferenceRenderer {
    /// The references the backend rendered, by view slug.
    rendered: Vec<RenderedReference>,
}

impl PrerenderedReferenceRenderer {
    /// Build a renderer over the references materialized for the selected
    /// variant.
    pub fn new(rendered: Vec<RenderedReference>) -> Self {
        Self { rendered }
    }
}

impl crate::reference::ReferenceRenderer for PrerenderedReferenceRenderer {
    fn render_references(
        &self,
        test_case: &TestCaseVersion,
        variant: &Variant,
    ) -> RunResult<Vec<RenderedReference>> {
        // Return only the views this variant declares, matching the on-disk set
        // the backend rendered for it; a view the backend did not render is
        // simply absent, which `RunEngine::run` then reports as incomplete.
        let wanted: std::collections::HashSet<String> = test_case
            .references_for(variant)
            .into_iter()
            .map(|view| view.view)
            .collect();
        Ok(self
            .rendered
            .iter()
            .filter(|reference| wanted.contains(&reference.view))
            .cloned()
            .collect())
    }
}

/// Render a path with forward slashes so store keys are stable across hosts.
fn forward_slash(path: &Path) -> String {
    path.components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/")
}

/// Write `bytes` to `path`, creating parent directories as needed.
fn write_at(path: &Path, bytes: &[u8]) -> RunResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

#[cfg(test)]
#[path = "backend_client.test.rs"]
mod tests;
