//! The Test Cabinet dispatcher: queued jobs → Kubernetes driver `Job`s.
//!
//! The dispatcher is a thin, stateless controller — the one piece in the
//! per-run-Job topology that talks to the Kubernetes API for `Job` creation, so the
//! backend stays k8s-agnostic. Its loop (see [`controller`]):
//!
//! 1. **Claims** the oldest queued job from the backend's run queue
//!    (`POST /jobs/next`, the shared service token; see [`client`]).
//! 2. **Creates one Kubernetes `Job`** per claimed run whose pod runs the
//!    **driver** image with exactly the env the driver reads (see [`job`]) — the
//!    driver then executes the run, creating the untrusted sandbox pod itself.
//! 3. **Bounds concurrency** with a configurable in-flight cap, recomputed each
//!    tick from the live cluster (the backend's `job` table is the source of
//!    truth, so a restart reconciles rather than assuming zero in-flight).
//! 4. **Watches** the `Job`s it created and, when one fails terminally before its
//!    driver could report, reports a **specific** death reason to the backend
//!    (see [`kubernetes`]) so an infra failure never leaves a job hung with no
//!    diagnostic.
//!
//! It holds no durable state: only an in-memory `{job_id → job_token}` map for the
//! death-detection report, which a restart safely loses.

pub mod client;
pub mod config;
pub mod controller;
pub mod job;
pub mod kubernetes;
