//! Shared arena helpers: resolving controller wasm for matches/tournaments and
//! listing the controllers a host can pit.
//!
//! Controllers are resolved **local-only** (the decided scope): a baseline from
//! the backend-served `references/<id>.wasm`, a prior run's module from this
//! worker's own run output dir. The worker never reaches into another host's runs.

use std::path::Path;

use test_cabinet_core::match_play::{
    BASELINE_IDS, ControllerKind, ControllerRef, ResolvedController,
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
            if !BASELINE_IDS.contains(&controller.id.as_str()) {
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
    };
    Ok(ResolvedController {
        controller: controller.clone(),
        wasm,
    })
}

/// The controllers available to pit for `slug`: the committed baselines plus every
/// adversarial run this worker has produced for the case.
pub fn list_controllers(out_dir: &Path, slug: &str) -> Vec<ControllerRef> {
    let mut controllers: Vec<ControllerRef> = BASELINE_IDS
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
