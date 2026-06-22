//! Shared arena helpers: resolving controller wasm for matches/tournaments and
//! listing the controllers a host can pit.
//!
//! Controllers are resolved **local-only** (the decided scope): a baseline from
//! the backend-served `references/<id>.wasm`, a prior run's module from this
//! worker's own run output dir. The worker never reaches into another host's runs.

use std::path::Path;

use std::collections::HashSet;

use test_cabinet_core::match_play::{
    ARENA_OPPONENT_IDS, ControllerKind, ControllerRef, ResolvedController,
};
use test_cabinet_core::{BackendClient, RunRecord, TestCaseVersion};

/// Reject an id that is unsafe to use as a path segment (a run id is used as a
/// directory name when resolving its module).
fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id != "." && id != ".." && !id.contains('/') && !id.contains('\\')
}

/// Resolve one controller's wasm bytes for `test_case`.
///
/// A baseline is fetched from the backend's served `references/<id>.wasm` (the
/// worker's materialized version omits those, so it is fetched on demand); a run's
/// module is read from `<out_dir>/<run_id>/implementation/<build.module>`.
pub async fn resolve_controller(
    client: &dyn BackendClient,
    out_dir: &Path,
    slug: &str,
    version: &str,
    test_case: &TestCaseVersion,
    controller: &ControllerRef,
) -> Result<ResolvedController, String> {
    if !is_safe_id(&controller.id) {
        return Err(format!("invalid controller id `{}`", controller.id));
    }
    let wasm = match controller.kind {
        ControllerKind::Baseline => {
            // The arena offers a wider opponent set than the model-facing baselines
            // (it includes the hidden references like `fuel-probe`), so resolve
            // against `ARENA_OPPONENT_IDS`.
            if !ARENA_OPPONENT_IDS.contains(&controller.id.as_str()) {
                return Err(format!("unknown baseline `{}`", controller.id));
            }
            let source = format!("references/{}.wasm", controller.id);
            client
                .artifact(slug, version, Path::new(&source))
                .await
                .map_err(|err| format!("fetching baseline `{}`: {err}", controller.id))?
                .bytes
        }
        ControllerKind::Run => {
            let module_rel = test_case
                .build
                .as_ref()
                .and_then(|build| build.module.as_ref())
                .ok_or_else(|| "the case declares no build.module".to_string())?;
            let path = out_dir
                .join(&controller.id)
                .join("implementation")
                .join(module_rel);
            std::fs::read(&path).map_err(|err| {
                format!(
                    "reading controller for run `{}` at `{}`: {err}",
                    controller.id,
                    path.display()
                )
            })?
        }
        ControllerKind::PushedRun => {
            // A pushed run's controller lives on the backend (uploaded at push), so
            // any host can resolve it — not just the one that produced it.
            client
                .controller_artifact(&controller.id)
                .await
                .map_err(|err| {
                    format!(
                        "fetching pushed controller for run `{}`: {err}",
                        controller.id
                    )
                })?
        }
    };
    Ok(ResolvedController {
        controller: controller.clone(),
        wasm,
    })
}

/// The locally-resolvable controllers to pit for `slug`: the committed arena
/// opponents (the model-facing baselines plus the hidden references like
/// `fuel-probe`) plus every adversarial run this worker has produced for the case.
/// Pushed controllers (resolved from the backend) are merged on top by
/// [`with_pushed_controllers`].
pub fn list_controllers(out_dir: &Path, slug: &str) -> Vec<ControllerRef> {
    let mut controllers: Vec<ControllerRef> = ARENA_OPPONENT_IDS
        .iter()
        .map(|id| ControllerRef {
            id: id.to_string(),
            kind: ControllerKind::Baseline,
            label: None,
        })
        .collect();
    controllers.extend(adversarial_runs(out_dir, slug));
    controllers
}

/// Extend the locally-resolved `controllers` with the case's **pushed** adversarial
/// controllers from the backend, so a pushed implementation is selectable here even
/// when this worker did not produce it. A run that is both local and pushed keeps
/// its local entry (resolved from disk, no backend round-trip); a backend that is
/// unreachable or has none simply contributes nothing.
pub async fn with_pushed_controllers(
    client: &dyn BackendClient,
    slug: &str,
    mut controllers: Vec<ControllerRef>,
) -> Vec<ControllerRef> {
    let known: HashSet<String> = controllers.iter().map(|c| c.id.clone()).collect();
    if let Ok(pushed) = client.list_adversarial_controllers(slug).await {
        for controller in pushed {
            if !known.contains(&controller.id) {
                controllers.push(controller);
            }
        }
    }
    controllers
}

/// Enumerate this worker's produced adversarial runs for `slug` as controllers,
/// labelled by their model id. A missing output dir or unparsable record is
/// skipped rather than failing.
fn adversarial_runs(out_dir: &Path, slug: &str) -> Vec<ControllerRef> {
    let mut runs = Vec::new();
    let entries = match std::fs::read_dir(out_dir) {
        Ok(entries) => entries,
        Err(_) => return runs,
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path().join("run-record.json")) else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<RunRecord>(&text) else {
            continue;
        };
        // Only adversarial runs for this case can be pitted, and only ones that
        // produced a controller (the run loaded).
        if record.subject.test_case_slug != slug || record.validation.adversarial.is_none() {
            continue;
        }
        runs.push(ControllerRef {
            id: record.id.clone(),
            kind: ControllerKind::Run,
            label: Some(record.subject.model_id.clone()),
        });
    }
    runs
}
