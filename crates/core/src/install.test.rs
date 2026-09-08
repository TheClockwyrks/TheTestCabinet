//! The verified, retried install: what is retried, what is accepted, and what the
//! final result carries.
//!
//! The install command under test is a shell fixture, not a real `npm`: it counts
//! its own invocations in `installs.log` and creates the `node_modules` directories
//! the fixture lockfile declares according to a schedule the test chooses, which
//! is how a test makes "the first two attempts drop a package and the third does
//! not" happen on demand. The lockfile check itself runs through the embedded
//! script with the host's `node`, so a host without one skips the tests that need
//! it rather than failing them.

use std::path::Path;
use std::time::Duration;

use super::*;

const TIMEOUT: Duration = Duration::from_secs(60);

/// Whether the host has a `node` to run the lockfile check with. CI's rust-test
/// agent provisions one (gg's arms need it); a developer's machine might not.
fn node_available() -> bool {
    which::which("node").is_ok()
}

/// A lockfile declaring one always-required package, one dev-only package, and one
/// optional package that applies only to the host this test runs on, plus one that
/// never applies here.
fn write_lockfile(repo: &Path) {
    let os = std::env::consts::OS;
    let cpu = std::env::consts::ARCH;
    // Rust names the architecture `x86_64`/`aarch64`; node (and the lockfile) say
    // `x64`/`arm64`.
    let cpu = match cpu {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    let lock = serde_json::json!({
        "name": "fixture",
        "lockfileVersion": 3,
        "packages": {
            "": {
                "name": "fixture",
                "dependencies": { "always": "1.0.0" },
                "devDependencies": { "dev-only": "1.0.0" },
                "optionalDependencies": { "@native/host": "1.0.0", "@native/elsewhere": "1.0.0" }
            },
            "node_modules/always": { "version": "1.0.0" },
            "node_modules/dev-only": { "version": "1.0.0", "dev": true },
            "node_modules/@native/host": {
                "version": "1.0.0",
                "optional": true,
                "os": [os],
                "cpu": [cpu]
            },
            "node_modules/@native/elsewhere": {
                "version": "1.0.0",
                "optional": true,
                "os": ["nonesuch-os"],
                "cpu": [cpu]
            }
        }
    });
    std::fs::write(
        repo.join("package-lock.json"),
        serde_json::to_string_pretty(&lock).expect("lockfile json"),
    )
    .expect("write lockfile");
}

/// A shell install that records each invocation and creates the packages the
/// lockfile declares, leaving `@native/host` out until the `complete_on`th run.
fn flaky_install(complete_on: u32) -> String {
    format!(
        "echo ran >> installs.log; n=$(wc -l < installs.log); \
         mkdir -p node_modules/always node_modules/dev-only; \
         if [ \"$n\" -ge {complete_on} ]; then mkdir -p node_modules/@native/host; fi; \
         echo \"attempt $n\""
    )
}

/// How many times the fixture install ran.
fn installs(repo: &Path) -> u32 {
    std::fs::read_to_string(repo.join("installs.log"))
        .map(|log| log.lines().count() as u32)
        .unwrap_or(0)
}

#[tokio::test]
async fn an_install_that_completes_first_time_is_not_retried() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH to run the lockfile check");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    write_lockfile(repo.path());

    let outcome = install_with_retry(repo.path(), &flaky_install(1), TIMEOUT, Duration::ZERO).await;

    assert_eq!(installs(repo.path()), 1);
    assert_eq!(outcome.attempts, 1);
    assert!(outcome.result.succeeded, "{:?}", outcome.result);
    assert_eq!(outcome.result.attempts, Some(1));
    assert_eq!(outcome.result.detail, None);
    assert!(outcome.missing().is_empty());
    assert_eq!(
        outcome.check,
        LockfileCheck::Checked {
            missing: Vec::new()
        }
    );
    assert!(
        outcome.result.output.contains("attempt 1"),
        "the recorded result carries the command's output: {:?}",
        outcome.result.output
    );
}

#[tokio::test]
async fn a_dropped_package_is_retried_until_the_install_completes() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH to run the lockfile check");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    write_lockfile(repo.path());

    let outcome = install_with_retry(repo.path(), &flaky_install(3), TIMEOUT, Duration::ZERO).await;

    assert_eq!(
        installs(repo.path()),
        3,
        "two retries after the first attempt"
    );
    assert_eq!(outcome.attempts, 3);
    assert!(outcome.result.succeeded, "{:?}", outcome.result);
    assert_eq!(outcome.result.attempts, Some(3));
    assert_eq!(outcome.result.detail, None);
    assert!(outcome.missing().is_empty());
    assert!(
        outcome.result.output.contains("attempt 3"),
        "the final attempt's output is what is recorded: {:?}",
        outcome.result.output
    );
}

#[tokio::test]
async fn a_package_still_missing_after_the_last_attempt_fails_the_install() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH to run the lockfile check");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    write_lockfile(repo.path());

    // Never completes: the package is created on the tenth run, which never comes.
    let outcome =
        install_with_retry(repo.path(), &flaky_install(10), TIMEOUT, Duration::ZERO).await;

    assert_eq!(installs(repo.path()), INSTALL_ATTEMPTS);
    assert_eq!(outcome.attempts, INSTALL_ATTEMPTS);
    assert!(outcome.result.ran);
    assert_eq!(
        outcome.result.exit_code,
        Some(0),
        "the command itself exited zero"
    );
    assert!(
        !outcome.result.succeeded,
        "a zero exit with a package missing is not a success"
    );
    assert_eq!(outcome.missing(), ["node_modules/@native/host"]);
    let detail = outcome
        .result
        .detail
        .as_deref()
        .expect("a failure says why");
    assert!(
        detail.contains("exited 0 but left 1 lockfile package uninstalled")
            && detail.contains("node_modules/@native/host"),
        "{detail}"
    );
    assert_eq!(outcome.result.attempts, Some(INSTALL_ATTEMPTS));
}

#[tokio::test]
async fn a_non_zero_exit_is_retried() {
    let repo = tempfile::tempdir().expect("repo");
    // Fails twice, then succeeds; no lockfile, so only the exit code decides.
    let command = "echo ran >> installs.log; n=$(wc -l < installs.log); \
                   if [ \"$n\" -lt 3 ]; then echo \"npm ERR! network\" >&2; exit 1; fi; \
                   echo installed";

    let outcome = install_with_retry(repo.path(), command, TIMEOUT, Duration::ZERO).await;

    assert_eq!(installs(repo.path()), 3);
    assert_eq!(outcome.attempts, 3);
    assert!(outcome.result.succeeded, "{:?}", outcome.result);
    assert_eq!(outcome.result.exit_code, Some(0));
    assert!(outcome.result.output.contains("installed"));
}

#[tokio::test]
async fn a_non_zero_exit_on_the_last_attempt_fails_as_a_failed_command() {
    let repo = tempfile::tempdir().expect("repo");
    let command = "echo ran >> installs.log; echo 'npm ERR! code E503' >&2; exit 7";

    let outcome = install_with_retry(repo.path(), command, TIMEOUT, Duration::ZERO).await;

    assert_eq!(installs(repo.path()), INSTALL_ATTEMPTS);
    assert!(outcome.result.ran && !outcome.result.succeeded);
    assert_eq!(outcome.result.exit_code, Some(7));
    assert_eq!(outcome.result.attempts, Some(INSTALL_ATTEMPTS));
    assert!(outcome.result.output.contains("E503"));
    assert_eq!(
        outcome.result.detail, None,
        "a command that ran and failed is described by its output, as every other command is"
    );
    assert!(outcome.missing().is_empty());
}

#[tokio::test]
async fn a_tree_without_a_lockfile_is_accepted_unchecked() {
    let repo = tempfile::tempdir().expect("repo");
    // Creates nothing at all, and there is no lockfile to say it should have.
    let command = "echo ran >> installs.log";

    let outcome = install_with_retry(repo.path(), command, TIMEOUT, Duration::ZERO).await;

    assert_eq!(installs(repo.path()), 1);
    assert_eq!(outcome.attempts, 1);
    assert!(outcome.result.succeeded);
    assert!(
        matches!(&outcome.check, LockfileCheck::NotChecked { reason } if reason.contains("package-lock.json")),
        "{:?}",
        outcome.check
    );
    assert!(outcome.missing().is_empty());
}

#[tokio::test]
async fn the_install_commands_own_omit_flags_are_honored() {
    if !node_available() {
        eprintln!("skipping: no `node` on PATH to run the lockfile check");
        return;
    }
    let repo = tempfile::tempdir().expect("repo");
    write_lockfile(repo.path());
    // Creates everything except the dev-only package; the command omits dev, so the
    // lockfile check must not want it. The flag rides on a compound line, as Carom's
    // does.
    let command = "echo ran >> installs.log; \
                   mkdir -p node_modules/always node_modules/@native/host; \
                   true --omit=dev && echo second";

    let outcome = install_with_retry(repo.path(), command, TIMEOUT, Duration::ZERO).await;

    assert_eq!(installs(repo.path()), 1, "{:?}", outcome);
    assert!(outcome.result.succeeded, "{:?}", outcome.result);
    assert!(outcome.missing().is_empty());

    // The same tree under a command that does NOT omit dev is incomplete.
    let repo = tempfile::tempdir().expect("repo");
    write_lockfile(repo.path());
    let command = "echo ran >> installs.log; \
                   mkdir -p node_modules/always node_modules/@native/host";
    let outcome = install_with_retry(repo.path(), command, TIMEOUT, Duration::ZERO).await;
    assert!(!outcome.result.succeeded);
    assert_eq!(outcome.missing(), ["node_modules/dev-only"]);
}

#[tokio::test]
async fn an_install_that_cannot_start_or_times_out_is_not_retried() {
    let repo = tempfile::tempdir().expect("repo");
    let command = "echo ran >> installs.log; sleep 30";

    let outcome = install_with_retry(
        repo.path(),
        command,
        Duration::from_millis(200),
        Duration::ZERO,
    )
    .await;

    assert_eq!(installs(repo.path()), 1, "a timeout is not a registry blip");
    assert_eq!(outcome.attempts, 1);
    assert!(!outcome.result.ran && !outcome.result.succeeded);
    assert!(
        outcome
            .result
            .detail
            .as_deref()
            .unwrap_or_default()
            .contains("timed out")
    );
    assert!(matches!(outcome.check, LockfileCheck::NotChecked { .. }));
}

/// The synchronous entry point the build validator uses reaches the same outcome
/// from a plain thread, and from inside a runtime's worker thread.
#[test]
fn the_blocking_entry_point_installs_from_a_plain_thread() {
    let repo = tempfile::tempdir().expect("repo");
    let command = "echo ran >> installs.log; n=$(wc -l < installs.log); \
                   if [ \"$n\" -lt 2 ]; then exit 1; fi";

    let outcome = install_with_retry_blocking(repo.path(), command, TIMEOUT, Duration::ZERO);

    assert_eq!(installs(repo.path()), 2);
    assert!(outcome.result.succeeded);
    assert_eq!(outcome.attempts, 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_blocking_entry_point_installs_from_inside_a_runtime() {
    let repo = tempfile::tempdir().expect("repo");
    let outcome = install_with_retry_blocking(repo.path(), "echo hi", TIMEOUT, Duration::ZERO);
    assert!(outcome.result.succeeded);
    assert!(outcome.result.output.contains("hi"));

    let build = run_command_blocking(repo.path(), "echo built; exit 2", TIMEOUT);
    assert!(build.ran && !build.succeeded);
    assert_eq!(build.exit_code, Some(2));
    assert!(build.output.contains("built"));
}

#[tokio::test]
async fn the_blocking_entry_point_installs_from_inside_a_single_threaded_runtime() {
    let repo = tempfile::tempdir().expect("repo");
    let outcome = install_with_retry_blocking(repo.path(), "echo hi", TIMEOUT, Duration::ZERO);
    assert!(outcome.result.succeeded);
}

/// The step conversion the validator and the toolchain stage both report through.
#[test]
fn a_step_reports_the_installs_output_attempts_and_reason() {
    use crate::validation::StepResult;

    let mut failed = ToolchainCommandResult::ran("npm ci", Some(0), "added 200 packages");
    failed.attempts = Some(3);
    failed.succeeded = false;
    failed.detail = Some(missing_detail(&[
        "node_modules/@rolldown/binding".to_string()
    ]));
    let step: StepResult = (&failed).into();
    assert!(!step.succeeded);
    assert_eq!(step.attempts, Some(3));
    assert_eq!(step.output.as_deref(), Some("added 200 packages"));
    assert!(
        step.detail
            .as_deref()
            .unwrap_or_default()
            .contains("node_modules/@rolldown/binding")
    );

    let build = ToolchainCommandResult::ran(
        "npm run build",
        Some(1),
        "npm notice New major version of npm available!\nerror TS2322: nope",
    );
    let step: StepResult = (&build).into();
    assert!(!step.succeeded);
    assert_eq!(step.attempts, None);
    let detail = step.detail.as_deref().expect("a failed build says why");
    assert!(
        detail.starts_with("`npm run build` exited 1:") && detail.contains("error TS2322"),
        "{detail}"
    );
    assert!(
        step.output
            .as_deref()
            .unwrap_or_default()
            .contains("TS2322")
    );

    let never_ran =
        ToolchainCommandResult::skipped("npm run build", "timed out after 1200 seconds");
    let step: StepResult = (&never_ran).into();
    assert_eq!(
        step.output, None,
        "a command that never ran printed nothing"
    );
    assert_eq!(step.detail.as_deref(), Some("timed out after 1200 seconds"));
}
