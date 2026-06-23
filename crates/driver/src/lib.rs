//! The Test Cabinet driver: a one-shot run executor that streams to the backend.
//!
//! The driver is the per-run-Job counterpart of the [worker](test_cabinet_worker):
//! where the worker is a long-lived HTTP server with an in-memory job registry,
//! the driver executes **exactly one** run and exits. The dispatcher creates a
//! driver Job per claimed run; the driver resolves the definition from the
//! backend, runs it through [`test_cabinet_core::RunEngine`] (creating an
//! untrusted sandbox pod or shelling out to a host runtime), streams the run's
//! live [events](test_cabinet_core::HarnessEvent) and asset-preview frames back to
//! the backend as it goes, and reports its terminal status — carrying the produced
//! [run record](test_cabinet_core::RunRecord) — when it finishes.
//!
//! It re-implements **none** of a run's behavior: every piece is the same
//! [`RunEngine`](test_cabinet_core::RunEngine) a local `tcab run` assembles (see
//! [`run`]), only the in-process sinks are swapped for backend-streaming ones (see
//! [`sink`]) and the outcome is streamed back rather than served locally.
//!
//! There is no app-level auth on the driver itself — it is a client, not a server.
//! Its streaming calls authenticate to the backend with the per-job token the
//! dispatcher passed in (see [`client`]).

pub mod artifacts;
pub mod client;
pub mod config;
pub mod kubernetes;
pub mod run;
pub mod sink;
