//! Tests for the env-resolved publisher config. Environment mutation is process
//! global, so these serialize through a mutex and clear every variable they touch —
//! a panic mid-test still leaves the next test a clean slate.

use super::*;

use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Every variable a test in this file may set, cleared before and after each so
/// config resolution sees only what the test set (and the ambient process env on a
/// developer/CI machine cannot leak in).
const ALL_VARS: &[&str] = &[
    "TCAB_BACKEND_URL",
    "TCAB_PUBLISH_JOB_ID",
    "TCAB_PUBLISH_JOB_TOKEN",
    "TCAB_PUBLISH_RUN_ID",
    "TCAB_ARTIFACTS_URL",
    "TCAB_WORK_DIR",
];

fn clear_all() {
    for var in ALL_VARS {
        unsafe { std::env::remove_var(var) };
    }
}

/// Run `body` with the env lock held and every touched variable cleared first and
/// after.
fn with_env(body: impl FnOnce()) {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    clear_all();
    body();
    clear_all();
}

fn set(key: &str, value: &str) {
    unsafe { std::env::set_var(key, value) };
}

/// The required variables, set so a config resolves. URLs carry trailing slashes to
/// assert they are trimmed.
fn set_required() {
    set("TCAB_BACKEND_URL", "http://backend:8787/");
    set("TCAB_PUBLISH_JOB_ID", "pub-job-1");
    set("TCAB_PUBLISH_JOB_TOKEN", "pub-tok");
    set("TCAB_PUBLISH_RUN_ID", "run-9");
    set("TCAB_ARTIFACTS_URL", "http://artifacts:9090/");
}

#[test]
fn resolves_with_required_and_defaults() {
    with_env(|| {
        set_required();
        let config = Config::from_env().expect("config should resolve");

        // Trailing slashes trimmed off both URLs.
        assert_eq!(config.backend_url, "http://backend:8787");
        assert_eq!(config.artifacts_url, "http://artifacts:9090");
        assert_eq!(config.publish_job_id, "pub-job-1");
        assert_eq!(config.publish_job_token, "pub-tok");
        assert_eq!(config.run_id, "run-9");
        // Work dir defaults when unset.
        assert_eq!(config.work_dir, std::path::PathBuf::from(".tcab-publisher"));
    });
}

#[test]
fn work_dir_override_is_honored() {
    with_env(|| {
        set_required();
        set("TCAB_WORK_DIR", "/scratch/pub");
        let config = Config::from_env().expect("config should resolve");
        assert_eq!(config.work_dir, std::path::PathBuf::from("/scratch/pub"));
    });
}

#[test]
fn each_required_variable_is_enforced() {
    let required = [
        "TCAB_BACKEND_URL",
        "TCAB_PUBLISH_JOB_ID",
        "TCAB_PUBLISH_JOB_TOKEN",
        "TCAB_PUBLISH_RUN_ID",
        "TCAB_ARTIFACTS_URL",
    ];
    for missing in required {
        with_env(|| {
            set_required();
            // Drop the one under test (a blank export must read as unset too).
            set(missing, "   ");
            let err = Config::from_env().expect_err("a blank required variable must fail");
            match err {
                ConfigError::Missing(name) => assert_eq!(name, missing),
            }
        });
    }
}
