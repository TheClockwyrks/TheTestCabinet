//! The Test Cabinet worker: the core run lifecycle exposed over an HTTP API.
//!
//! See `apps/docs/src/content/docs/components/worker/overview.md`. The worker is
//! effectively the [CLI](test_cabinet_core) with a web API in front of it: it
//! accepts a run request (a version, a variant, a harness, and a model), drives
//! it through [`test_cabinet_core::Orchestrator`], and streams the run's live
//! [harness events](test_cabinet_core::HarnessEvent) back to the caller. It
//! produces the same [run record](test_cabinet_core::RunRecord) a local run would
//! and can publish on the same terms.
//!
//! It re-implements **none** of a run's behavior — every endpoint translates HTTP
//! to a core call (see [`runner`]). Because a run can last up to an hour, the
//! worker uses an **async job model**: `POST /runs` returns a job id immediately;
//! the live event stream and the status endpoint are separate (see [`jobs`]).
//!
//! Like the backend, there is **no app-level auth**: the worker sits on a private
//! network (a Tailscale IP) and trusts every caller that can reach it. Bind it to
//! that interface via `TCAB_WORKER_BIND`.

pub mod api;
pub mod config;
pub mod error;
pub mod jobs;
pub mod metrics;
pub mod notify;
pub mod runner;

use std::sync::Arc;

use crate::api::AppState;
use crate::config::Config;
use crate::jobs::JobRegistry;
use crate::notify::WorkerNotifier;

/// A fully wired, runnable worker: the Axum router plus the resolved bind address.
pub struct Worker {
    /// The Axum router, ready to be served.
    pub router: axum::Router,
    /// The bind address resolved from configuration.
    pub bind: String,
}

/// Assemble a worker from a configuration: create the job registry and construct
/// the router. The worker is stateless beyond its in-memory job registry; it
/// resolves definitions from, and publishes runs to, the backend per request.
pub fn build(config: Config) -> Worker {
    let bind = config.bind.clone();
    let state = AppState {
        config: Arc::new(config),
        jobs: JobRegistry::new(),
        notifier: WorkerNotifier::new(),
        metrics: crate::metrics::Metrics::new(),
    };
    let router = api::router(state);
    Worker { router, bind }
}
