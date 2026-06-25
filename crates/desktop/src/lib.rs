//! The Test Cabinet desktop shell.
//!
//! This crate is the graphical shell over [`test_cabinet_core`]. It is kept
//! deliberately thin: it owns no orchestration logic of its own.
//!
//! Runs are no longer executed in-process here. Like the web console, the desktop
//! webview talks to the backend directly over HTTP — it enqueues a run on the
//! backend's `/jobs` queue, watches the live stream, and reads/reviews/publishes
//! produced runs — so this shell exposes only the handful of commands that are
//! genuinely host concerns: its resolved service URLs ([`backend_url`] /
//! [`auth_url`], which the webview builds its HTTP transports against) and the
//! **local arena** (in [`arena`]), whose adversarial matches and tournaments run
//! in the embedded core in-process. A locally-run tournament's per-match replays
//! are served to the webview over the [`tournament`] URI scheme.
//!
//! Following Tauri v2 conventions, the real entrypoint is [`run`], which is
//! invoked both by the binary (`src/main.rs`) and, on mobile targets, by the
//! generated platform entry point.

mod arena;
mod config;
mod tournament;

/// The desktop application's version string (the crate version).
#[tauri::command]
#[tracing::instrument]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// The backend base URL the shell is configured for (`TCAB_BACKEND_URL`), or
/// `None` when unset. The webview builds its HTTP transports against this — the
/// same `createHttpBackend`/`createBackendExec` the web console uses — so a
/// missing backend leaves the console unconfigured (an empty catalog/gallery)
/// rather than erroring.
#[tauri::command]
#[tracing::instrument]
fn backend_url() -> Option<String> {
    config::backend_url()
}

/// The auth service base URL the shell registers/logs in against (`TCAB_AUTH_URL`,
/// falling back to the loopback default). The webview's execution transport posts
/// register/login here directly.
#[tauri::command]
#[tracing::instrument]
fn auth_url() -> String {
    config::auth_url()
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
        // Serve a locally-run tournament's per-match replays to the webview so the
        // arena can play back an individual match (see `tournament`). This is the
        // only host-served media scheme left: produced runs' builds, proofs, and
        // asset media are served by the artifact service over HTTP now (the webview
        // resolves those URLs the same way the web console does).
        .register_uri_scheme_protocol(tournament::SCHEME, |_app, request| {
            tournament::handle_request(&request)
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            backend_url,
            auth_url,
            arena::run_adversarial_match,
            arena::list_adversarial_controllers,
            arena::run_tournament_match,
            arena::list_tournaments,
            arena::read_tournament,
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Test Cabinet desktop application");
}
