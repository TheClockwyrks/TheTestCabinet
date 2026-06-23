//! The job-API wire types shared between the backend, the dispatcher, and the
//! driver.
//!
//! These are the request/response shapes of the backend's run-queue control
//! plane that more than one component speaks. They live here, in `core`, rather
//! than in the backend crate so the driver and dispatcher — both clients of the
//! backend's job API — can name them without depending on the heavy backend
//! crate (and its SeaORM/SQLite footprint). The backend imports them from here
//! for its server side.
//!
//! Only the types crossing a crate boundary live here:
//!
//! - [`LaunchBody`] — the body of `POST /jobs`, stored verbatim at enqueue and
//!   handed back to the driver when the dispatcher claims the job.
//! - [`ClaimedJob`] — what the dispatcher receives from `POST /jobs/next`.
//! - [`StatusUpdate`] / [`DriverState`] — the body of `POST /jobs/{id}/status`,
//!   how the driver advances a job and hands back the record it produced.
//!
//! The server-only output types (`LaunchAck`, `JobState`, `ActiveJobOut`,
//! `JobStatusOut`) stay in the backend: nothing else constructs them.
//!
//! The contract `cfg_attr` derives are preserved so the `contract-codegen`
//! generator still emits these types' TypeScript bindings and JSON Schemas from
//! here once the console is rewired (the bindings are deferred to that pass).

use serde::{Deserialize, Serialize};

use crate::run_record::{HarnessSlug, RunRecord};

/// The body of `POST /jobs`: what to run, with what, against which model. The
/// canonical launch shape — stored verbatim and handed to the driver when the job
/// is claimed.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct LaunchBody {
    /// Test-case slug to run (e.g. `pong`).
    pub test_case: String,
    /// Exact, immutable test-case version (e.g. `v1.0.0`).
    pub version: String,
    /// Variant to run (e.g. `base`).
    pub variant: String,
    /// Agent harness to drive.
    pub harness: HarnessSlug,
    /// Opaque model id passed to the harness.
    pub model: String,
    /// Built-in orchestrator slug that conducts the harness sessions (e.g.
    /// `one-shot` or `ralph`). Omit for the `one-shot` default.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub orchestrator: Option<String>,
    /// Optional override for the maximum harness runtime, in seconds.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_runtime_seconds: Option<u64>,
    /// Optional harness authentication mode for this run (`auto`, `subscription`,
    /// or `api-key`). Omitted keeps the default behavior (API-key, preferring a
    /// subscription only when its credentials are available). The driver applies
    /// it by setting `TCAB_AUTH_MODE` before the engine resolves auth, so a console
    /// can request subscription mode for a backend-driven run (the only way to run
    /// the subscription-only Antigravity harness on the cluster path).
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub auth_mode: Option<String>,
}

/// The claimed job the dispatcher receives from `POST /jobs/next`: the id, the
/// per-job driver token, and the launch request to run.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct ClaimedJob {
    /// The claimed job's id.
    pub job_id: String,
    /// The per-job token the driver presents to stream this job's progress back.
    pub job_token: String,
    /// The launch request to run.
    pub request: LaunchBody,
}

/// The state a driver reports for a job via `POST /jobs/{id}/status`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum DriverState {
    /// Execution has begun.
    Running,
    /// The run produced a record (carried in the same update).
    Succeeded,
    /// The run could not be driven to a record (reason in `detail`).
    Failed,
}

/// The body of `POST /jobs/{id}/status`: the new driver state, plus the produced
/// record on success or the reason on failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct StatusUpdate {
    /// The state the driver is reporting.
    pub state: DriverState,
    /// The produced run record, required when `state` is `succeeded`. Its `links`
    /// are authoritative and stored with it.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub record: Option<RunRecord>,
    /// A human-readable failure reason, used when `state` is `failed`.
    #[serde(default)]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub detail: Option<String>,
}
