//! Shared headless-browser plumbing: [`test_cabinet_suites::browser`], re-exported
//! at its old path, with trace context propagated to the driver process.
//!
//! The suites crate links no OpenTelemetry, so its [`capture`], [`drive_script`] and
//! [`smoke_check`] take the function that names the current span's `traceparent`.
//! The three here are the same calls with the signatures they always had, passing
//! [`current_traceparent`].
//! Everything else in the module is the suites crate's item, unchanged.

use std::path::Path;

pub use test_cabinet_suites::browser::*;
use test_cabinet_telemetry::propagation::current_traceparent;

use crate::test_case::CheckAction;

/// Open `url` in the headless browser, run `actions`, and screenshot to `out`.
///
/// `url` may be a `file://` mockup or an `http://` served build. Returns a
/// human-readable error when the driver is missing or the capture fails, so the
/// caller can record a degraded signal instead of failing the run. See
/// [`test_cabinet_suites::browser::capture`].
pub fn capture(url: &str, actions: &[CheckAction], out: &Path) -> std::result::Result<(), String> {
    test_cabinet_suites::browser::capture(url, actions, out, current_traceparent)
}

/// Drive a served build through a validation `script` against its debug-API
/// `handle`, capturing the declared `outputs` into `out_dir`. See
/// [`test_cabinet_suites::browser::drive_script`].
pub fn drive_script(
    url: &str,
    script: &Path,
    handle: &str,
    tick_hz: Option<u32>,
    out_dir: &Path,
    outputs: &[ScriptOutputSpec],
) -> std::result::Result<ScriptDriveResult, String> {
    test_cabinet_suites::browser::drive_script(
        url,
        script,
        handle,
        tick_hz,
        out_dir,
        outputs,
        current_traceparent,
    )
}

/// Open a served build in the headless browser and report whether it boots. See
/// [`test_cabinet_suites::browser::smoke_check`].
pub fn smoke_check(url: &str) -> std::result::Result<SmokeDriveResult, String> {
    test_cabinet_suites::browser::smoke_check(url, current_traceparent)
}
