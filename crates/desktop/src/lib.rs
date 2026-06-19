//! The Test Cabinet desktop shell.
//!
//! This crate is the graphical shell over [`test_cabinet_core`]. It is kept
//! deliberately thin: it owns no orchestration logic of its own. Instead it
//! exposes a set of `#[tauri::command]`s (in [`commands`]) that delegate to the
//! core — resolving the test-case catalog, launching a run and streaming its live
//! [event](test_cabinet_core::HarnessEvent) feed to the webview, reading the
//! seeded specification, recording a review, and publishing a reviewed run — and
//! surfaces the results to the React UI loaded from `apps/desktop`.
//!
//! Following Tauri v2 conventions, the real entrypoint is [`run`], which is
//! invoked both by the binary (`src/main.rs`) and, on mobile targets, by the
//! generated platform entry point.

mod commands;
mod config;
mod events;
mod playable;

/// The desktop application's version string (the crate version).
#[tauri::command]
#[tracing::instrument]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Whether a backend is configured (`TCAB_BACKEND_URL`), which the UI uses to
/// gate the publish action and to label where definitions resolve from.
#[tauri::command]
#[tracing::instrument]
fn backend_configured() -> bool {
    config::backend_url().is_some()
}

/// Builds and runs the Tauri application.
///
/// This is the shared entrypoint used by the desktop binary and, on mobile
/// targets, by the generated platform entry point (hence the
/// `mobile_entry_point` attribute).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load harness API keys and TCAB_* configuration from `.env.runner` beside
    // the project, matching the CLI (with a legacy `.env` as a fallback). A
    // missing file is fine (variables can be exported instead); `dotenvy` never
    // overrides already-set variables. Loading happens first so the telemetry
    // init below sees `OTEL_*`/`TCAB_ENV` from the env file.
    let _ = dotenvy::from_filename(".env.runner");
    let _ = dotenvy::dotenv();

    // Opt-in telemetry. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set the init builds
    // OTLP exporters whose batch/periodic readers spawn background tasks on a
    // Tokio runtime; unlike the worker/backend binaries this entrypoint is *not*
    // `#[tokio::main]` (Tauri owns the event loop), so there is no ambient runtime
    // when `init()` runs. We stand up a small multi-thread runtime and enter it
    // for the lifetime of the app so those exporter tasks have somewhere to live,
    // and so the guard's flush-on-drop (below) runs with the runtime still up.
    //
    // In the common no-collector case `init()` installs only the fmt layer and
    // returns an inert guard — the runtime is then merely idle, never fatal.
    let telemetry_runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build the telemetry Tokio runtime");
    let _telemetry_runtime_guard = telemetry_runtime.enter();
    let _telemetry = test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-desktop",
        env!("CARGO_PKG_VERSION"),
        "info,test_cabinet_desktop_lib=info",
    ))
    .expect("initialize telemetry");

    tauri::Builder::default()
        // Serve produced runs' playable builds to the webview so a reviewer can
        // play an unpublished run (see `playable`). The build's HTML and assets
        // are read from disk per request and relocated under the run's base URL.
        .register_uri_scheme_protocol(playable::SCHEME, |_app, request| {
            playable::handle_request(&request)
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            backend_configured,
            commands::list_models,
            commands::list_test_cases,
            commands::list_versions,
            commands::resolve_version,
            commands::read_specs,
            commands::launch_run,
            commands::list_runs,
            commands::read_run,
            commands::read_run_events,
            commands::list_published_runs,
            commands::read_published_run,
            commands::read_review_items,
            commands::save_review,
            commands::publish_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Test Cabinet desktop application");
}
