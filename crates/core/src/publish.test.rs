//! Tests for the Pages deploy helper: wrangler URL capture, the failure
//! diagnostics a failed command surfaces, and the build-tree secret scrub.

use super::*;

#[test]
fn wrangler_url_is_captured_not_constructed() {
    // The deployment URL is whatever wrangler reports — a sanitized/truncated
    // branch-alias host, not `https://<run-id>.<project>.pages.dev`.
    let stdout = "Uploading... (3/3)\n\
         ✨ Deployment complete! Take a peek over at https://abc123.test-cabinet-runs.pages.dev\n";
    assert_eq!(
        parse_wrangler_url(stdout).as_deref(),
        Some("https://abc123.test-cabinet-runs.pages.dev")
    );
    // Trailing sentence punctuation is trimmed.
    assert_eq!(
        parse_wrangler_url("Deployed to https://x.pages.dev.").as_deref(),
        Some("https://x.pages.dev")
    );
    // A line without a pages.dev URL yields nothing.
    assert_eq!(parse_wrangler_url("nothing here"), None);
}

#[test]
fn failure_details_prefers_stdout_when_stderr_is_empty() {
    // `wrangler` writes its diagnostics to stdout, leaving stderr empty — the
    // exact case that previously rendered the error as `… failed: ` with nothing
    // after it.
    let output = CommandOutput {
        success: false,
        stdout: "  Authentication error [code: 10000]\n".to_string(),
        stderr: String::new(),
    };
    assert_eq!(
        output.failure_details(),
        "Authentication error [code: 10000]"
    );
}

#[test]
fn failure_details_prefers_stderr_when_stdout_is_empty() {
    let output = CommandOutput {
        success: false,
        stdout: String::new(),
        stderr: "  fatal: repository not found\n".to_string(),
    };
    assert_eq!(output.failure_details(), "fatal: repository not found");
}

#[test]
fn failure_details_combines_both_streams_when_present() {
    let output = CommandOutput {
        success: false,
        stdout: "deploy output\n".to_string(),
        stderr: "a warning\n".to_string(),
    };
    assert_eq!(output.failure_details(), "a warning\ndeploy output");
}

#[test]
fn failure_details_reports_when_no_output_was_captured() {
    let output = CommandOutput {
        success: false,
        stdout: "   \n".to_string(),
        stderr: String::new(),
    };
    assert_eq!(output.failure_details(), "(no output captured)");
}

#[test]
fn scrub_build_dir_redacts_keys_in_nested_text_files_only() {
    let key = "sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01";
    let dir = tempfile::tempdir().expect("tempdir");
    let nested = dir.path().join("assets");
    std::fs::create_dir_all(&nested).expect("nested dir");

    // A bundled JS chunk that captured the key, a clean HTML file, and a binary
    // asset that merely contains the key bytes (and must be left untouched).
    let leaky = nested.join("app.js");
    std::fs::write(&leaky, format!("const K=\"{key}\";export default K;")).expect("js");
    let clean = dir.path().join("index.html");
    std::fs::write(&clean, "<!doctype html><title>play</title>").expect("html");
    let binary = nested.join("logo.png");
    let binary_bytes = [0x89, b'P', b'N', b'G', 0x00, 0xFF, 0xFE];
    std::fs::write(&binary, binary_bytes).expect("png");

    scrub_build_dir(dir.path()).expect("scrub");

    let scrubbed = std::fs::read_to_string(&leaky).expect("read js");
    assert!(!scrubbed.contains(key), "the key must be gone");
    assert!(scrubbed.contains(crate::redact::PLACEHOLDER));
    // Untouched files keep their exact bytes.
    assert_eq!(
        std::fs::read_to_string(&clean).expect("read html"),
        "<!doctype html><title>play</title>"
    );
    assert_eq!(std::fs::read(&binary).expect("read png"), binary_bytes);
}
