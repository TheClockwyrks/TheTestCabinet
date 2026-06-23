//! Shared OpenTelemetry foundation for the Test Cabinet workspace.
//!
//! This crate has two layers, split by Cargo feature:
//!
//! - **[`propagation`]** (default features): light W3C TraceContext helpers for
//!   libraries. It pulls in only the OpenTelemetry *API*, the HTTP header glue,
//!   and the `tracing` bridge — **no** exporter and **no** SDK. `crates/core`
//!   depends on this crate with `default-features = false` and uses it to carry
//!   trace context across HTTP and subprocess boundaries.
//!
//! - **[`init`]** (the `otlp` feature): the binary-facing initializer. It builds
//!   the SDK providers (traces + metrics + logs), exports them over vendor-
//!   neutral OTLP (HTTP/protobuf), and returns a [`TelemetryGuard`] that flushes
//!   on drop. Binaries enable `features = ["otlp"]`.
//!
//! Telemetry is **opt-in**: if `OTEL_EXPORTER_OTLP_ENDPOINT` is unset/blank,
//! [`init`] installs only the existing fmt logger (no exporter, no panic).
//!
//! # Binary call site
//!
//! ```ignore
//! #[tokio::main]
//! async fn main() -> std::process::ExitCode {
//!     // Bind the guard for the whole program; it flushes telemetry on drop.
//!     let _telemetry = test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
//!         "tcab-dispatcher",
//!         env!("CARGO_PKG_VERSION"),
//!         "info,test_cabinet_dispatcher=info",
//!     ))
//!     .expect("initialize telemetry");
//!
//!     // ... run the server ...
//!     std::process::ExitCode::SUCCESS
//! }
//! ```

pub mod propagation;

#[cfg(feature = "otlp")]
mod init;

#[cfg(feature = "otlp")]
pub use init::{Config, TelemetryGuard, init};
