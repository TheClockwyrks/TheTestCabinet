//! Controller resolution for matches and tournaments, and listing the controllers
//! a case can pit.
//!
//! Unlike the deleted worker — which also resolved a *run-local* controller
//! (`ControllerKind::Run`) from its own output dir — the arena service is
//! **stateless** and decoupled over HTTP: it holds no run output and reaches no
//! local disk. So only two controller kinds are resolvable here:
//!
//! - a [`Baseline`](ControllerKind::Baseline), fetched from the backend's served
//!   `references/<id>.wasm` (guarded by the [`ARENA_OPPONENT_IDS`] allowlist), and
//! - a [`PushedRun`](ControllerKind::PushedRun), fetched from the backend's stored
//!   per-run `controller.wasm`.
//!
//! A `Run` (local-out-dir) controller is **not** resolvable in this topology and is
//! rejected as a `400` — the console offers only baselines and pushed controllers
//! against the arena service.

use std::collections::HashSet;
use std::path::Path;

use test_cabinet_core::BackendClient;
use test_cabinet_core::match_play::{
    ARENA_OPPONENT_IDS, ControllerKind, ControllerRef, ResolvedController,
};

/// Reject an id that is unsafe to use as a path segment (a baseline id is used to
/// address its served `references/<id>.wasm`).
fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id != "." && id != ".." && !id.contains('/') && !id.contains('\\')
}

/// Resolve one controller's wasm bytes for `slug`@`version` against the backend.
///
/// A baseline is fetched from the backend's served `references/<id>.wasm`; a pushed
/// run's module from its stored `controller.wasm`. A run-local controller has no
/// home in the stateless service topology — there is no per-host output dir to read
/// — so it is rejected.
pub async fn resolve_controller(
    client: &dyn BackendClient,
    slug: &str,
    version: &str,
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
            // A run-local controller lives in a host's run output dir, which the
            // stateless arena service does not have — only the backend-stored pushed
            // controllers and baselines are resolvable here. The console never offers
            // a `Run` controller against the service; reject defensively if one
            // arrives.
            return Err(format!(
                "run-local controllers are not resolvable in the service topology (run `{}`); \
                 push the run first",
                controller.id
            ));
        }
        ControllerKind::PushedRun => {
            // A pushed run's controller lives on the backend (uploaded at push), so
            // the stateless service can resolve it over HTTP.
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

/// The committed arena opponents for `slug`: the model-facing baselines plus the
/// hidden references (like `fuel-probe`). The case's **pushed** adversarial
/// controllers are merged on top by [`with_pushed_controllers`].
pub fn list_controllers(slug: &str) -> Vec<ControllerRef> {
    let _ = slug;
    ARENA_OPPONENT_IDS
        .iter()
        .map(|id| ControllerRef {
            id: id.to_string(),
            kind: ControllerKind::Baseline,
            label: None,
        })
        .collect()
}

/// Extend the baseline `controllers` with the case's **pushed** adversarial
/// controllers from the backend, so a pushed implementation is selectable here. A
/// backend that is unreachable or has none simply contributes nothing.
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
