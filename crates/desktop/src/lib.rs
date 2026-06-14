//! The Test Cabinet desktop shell.
//!
//! This crate is the graphical shell over [`test_cabinet_core`]. It is kept
//! deliberately thin: it owns no orchestration logic of its own. Instead it
//! exposes a small set of `#[tauri::command]`s that delegate to the core and
//! surfaces the results to the React UI loaded from `apps/desktop`.
//!
//! Following Tauri v2 conventions, the real entrypoint is [`run`], which is
//! invoked both by the binary (`src/main.rs`) and, on mobile targets, by the
//! generated platform entry point.

use serde::Serialize;
use test_cabinet_core::HarnessSlug;

/// A single supported agent harness, as surfaced to the UI.
///
/// The slug is sourced from the core's [`HarnessSlug`] catalog so the desktop
/// shell never drifts from the canonical list. The display name is a
/// presentation concern owned here.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInfo {
    /// Stable slug used throughout run records and the site.
    pub slug: String,
    /// Human readable display name.
    pub display_name: String,
}

/// A human readable display name for a harness slug.
///
/// STUB: hard-coded presentation labels. These could later move into the core's
/// harness catalog if display metadata becomes shared.
fn display_name_for(slug: HarnessSlug) -> &'static str {
    match slug {
        HarnessSlug::Claude => "Anthropic Claude Code",
        HarnessSlug::Codex => "OpenAI Codex",
        HarnessSlug::Cline => "Cline",
        HarnessSlug::Antigravity => "Google Antigravity",
        HarnessSlug::Goose => "Goose",
        HarnessSlug::Kilo => "Kilo Code",
        HarnessSlug::Opencode => "OpenCode",
        HarnessSlug::Pi => "Pi",
    }
}

/// Returns the catalog of agent harnesses the application can drive.
///
/// Delegates to the core's [`HarnessSlug::ALL`] for the canonical slug list and
/// pairs each with a display name for the UI.
#[tauri::command]
fn list_harnesses() -> Vec<HarnessInfo> {
    HarnessSlug::ALL
        .into_iter()
        .map(|slug| HarnessInfo {
            slug: slug.as_str().to_string(),
            display_name: display_name_for(slug).to_string(),
        })
        .collect()
}

/// Returns the desktop application's version string.
///
/// STUB: returns the crate version. Once the core exposes its own version
/// surface this command will delegate to it.
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Builds and runs the Tauri application.
///
/// This is the shared entrypoint used by the desktop binary and, on mobile
/// targets, by the generated platform entry point (hence the
/// `mobile_entry_point` attribute).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_harnesses, app_version])
        .run(tauri::generate_context!())
        .expect("error while running The Test Cabinet desktop application");
}
