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

/// The desktop application's version string (the crate version).
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Whether a backend is configured (`TCAB_BACKEND_URL`), which the UI uses to
/// gate the publish action and to label where definitions resolve from.
#[tauri::command]
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
    // overrides already-set variables.
    let _ = dotenvy::from_filename(".env.runner");
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_version,
            backend_configured,
            commands::list_harnesses,
            commands::list_models,
            commands::list_test_cases,
            commands::list_versions,
            commands::resolve_version,
            commands::read_specs,
            commands::launch_run,
            commands::list_runs,
            commands::read_run,
            commands::read_review_items,
            commands::save_review,
            commands::publish_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Test Cabinet desktop application");
}
