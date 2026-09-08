//! The verified, retried dependency install, and the shell runner every host-side
//! command over a collected tree goes through.
//!
//! # Why an install is verified and retried
//!
//! A transient registry failure during `npm ci` makes npm drop a platform-specific
//! optional package — `@rolldown/binding-linux-arm64-gnu`, which Vite and Vitest
//! cannot start without — and exit zero regardless. The tree looks installed, the
//! build fails minutes later, and the failure is recorded against the model. An
//! install here is therefore not "the command exited zero": it is *the command
//! exited zero and left every package the lockfile declares for this host on disk*
//! ([`crate::lockfile_check`]). An attempt that misses either mark is run again after
//! a delay, up to [`INSTALL_ATTEMPTS`] attempts in all, and only the last attempt's
//! outcome is recorded — with the number of attempts it took beside it.
//!
//! # One runner
//!
//! [`run_command`] is how a manifest-declared shell line is run over a tree on the
//! host: `sh -c` verbatim from the tree's root, a non-interactive environment, both
//! streams captured and bounded, and a wall-clock cap. The
//! [toolchain stage](crate::toolchain_stage) runs its declared commands through it
//! and the [build validator](crate::validator::BuildValidator) runs its install and
//! build steps through it, so the two paths cannot drift on how a command is
//! started or what of its output is kept.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use crate::lockfile_check::{LockfileCheck, check_tree};
use crate::toolchain::ToolchainCommandResult;

/// The most times the install command is run before its outcome is final: the
/// first attempt and two retries.
pub const INSTALL_ATTEMPTS: u32 = 3;

/// How long a production install waits before it is retried. Long enough for a
/// registry hiccup to pass; short enough not to matter against a cold install
/// that is minutes long anyway. Tests inject zero.
pub const INSTALL_RETRY_DELAY: Duration = Duration::from_secs(10);

/// Wall-clock cap on the dependency install, and on the static build that follows
/// it. A cold `npm ci` for a game project is minutes, not seconds.
pub const INSTALL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// What the verified install came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallOutcome {
    /// The final attempt's result. `succeeded` is `true` only when that attempt
    /// exited zero and the lockfile check found nothing missing (or could not check
    /// the tree); an attempt that exited zero with packages still absent is recorded
    /// as not succeeded, with a `detail` naming them, and `attempts` carries the
    /// count on every path.
    pub result: ToolchainCommandResult,
    /// How many times the command was run, `1..=INSTALL_ATTEMPTS`.
    pub attempts: u32,
    /// What the last lockfile check said about the tree the final attempt left.
    /// `NotChecked` when the tree has no lockfile the check can read, or when the
    /// final attempt did not run at all.
    pub check: LockfileCheck,
}

impl InstallOutcome {
    /// The packages the lockfile declares for the host that the final attempt left
    /// absent. Empty when the install succeeded, or when the tree could not be
    /// checked.
    pub fn missing(&self) -> &[String] {
        self.check.missing()
    }
}

/// Run `command` over `repo` as a verified install: retried after `delay` on a
/// non-zero exit or on a lockfile package left missing, up to
/// [`INSTALL_ATTEMPTS`] attempts, each bounded by `timeout`.
///
/// A command that could not be started or that timed out is not retried — neither
/// is a registry blip — and is recorded as not run, exactly as [`run_command`]
/// reports it.
pub async fn install_with_retry(
    repo: &Path,
    command: &str,
    timeout: Duration,
    delay: Duration,
) -> InstallOutcome {
    let mut attempts = 0;
    loop {
        attempts += 1;
        let mut result = run_command(repo, command, timeout).await;
        result.attempts = Some(attempts);
        if !result.ran {
            return InstallOutcome {
                result,
                attempts,
                check: LockfileCheck::NotChecked {
                    reason: "the install did not run".to_string(),
                },
            };
        }
        let check = if result.succeeded {
            check_tree(repo, command).await
        } else {
            LockfileCheck::NotChecked {
                reason: "the install exited non-zero".to_string(),
            }
        };
        if let LockfileCheck::NotChecked { reason } = &check
            && result.succeeded
        {
            tracing::debug!(command, reason, "the install's tree was accepted unchecked");
        }
        let complete = result.succeeded && !check.found_missing();
        if complete || attempts >= INSTALL_ATTEMPTS {
            if result.succeeded && check.found_missing() {
                result.succeeded = false;
                result.detail = Some(missing_detail(check.missing()));
            }
            return InstallOutcome {
                result,
                attempts,
                check,
            };
        }
        let reason = retry_reason(&result, &check);
        tracing::warn!(
            command,
            attempt = attempts,
            reason,
            delay_secs = delay.as_secs_f64(),
            "the install did not complete; retrying",
        );
        tokio::time::sleep(delay).await;
    }
}

/// Run a verified install from a thread that is not async: the
/// [`Validator`](crate::validation::Validator) contract is synchronous, and the
/// engine calls it from inside its own runtime.
///
/// The future runs on a dedicated thread with a runtime of its own, so the call is
/// the same whether the caller is on a runtime's worker thread (where blocking on
/// the current runtime is forbidden), inside a single-threaded test runtime, or on
/// no runtime at all.
pub fn install_with_retry_blocking(
    repo: &Path,
    command: &str,
    timeout: Duration,
    delay: Duration,
) -> InstallOutcome {
    block_on_own_runtime(install_with_retry(repo, command, timeout, delay), || {
        InstallOutcome {
            result: ToolchainCommandResult::skipped(
                command,
                "could not start a runtime to run the install",
            ),
            attempts: 0,
            check: LockfileCheck::NotChecked {
                reason: "the install did not run".to_string(),
            },
        }
    })
}

/// Run one command over `repo` once, from a thread that is not async. See
/// [`install_with_retry_blocking`] for why a thread of its own.
pub fn run_command_blocking(
    repo: &Path,
    command: &str,
    timeout: Duration,
) -> ToolchainCommandResult {
    block_on_own_runtime(run_command(repo, command, timeout), || {
        ToolchainCommandResult::skipped(command, "could not start a runtime to run the command")
    })
}

/// Drive `future` to completion on a fresh current-thread runtime on a thread of
/// its own, or produce `fallback` when no runtime could be built.
fn block_on_own_runtime<T, F>(future: F, fallback: impl FnOnce() -> T) -> T
where
    T: Send,
    F: std::future::Future<Output = T> + Send,
{
    std::thread::scope(|scope| {
        let joined = scope
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map(|runtime| runtime.block_on(future))
            })
            .join();
        match joined {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(err)) => {
                tracing::error!(error = %err, "could not build a runtime for a blocking command");
                fallback()
            }
            Err(_) => {
                tracing::error!("the thread running a blocking command panicked");
                fallback()
            }
        }
    })
}

/// The detail an install that exited zero but left packages behind is failed with.
/// Shared with the in-container init step, which fails the same way for the same
/// reason.
pub(crate) fn missing_detail(missing: &[String]) -> String {
    format!(
        "the install exited 0 but left {} lockfile package{} uninstalled: {}",
        missing.len(),
        if missing.len() == 1 { "" } else { "s" },
        missing.join(", "),
    )
}

/// Why an attempt is being retried, for the log line.
fn retry_reason(result: &ToolchainCommandResult, check: &LockfileCheck) -> String {
    if !result.succeeded {
        return match result.exit_code {
            Some(code) => format!("exited {code}"),
            None => "was killed by a signal".to_string(),
        };
    }
    missing_detail(check.missing())
}

/// Run one manifest-declared shell line over `repo` through `sh -c`, bounded by
/// `timeout`, and record what it did.
///
/// Only the bounded result is returned: the excerpt *is* the record of what the
/// command said, and nothing wants the whole of it. A command that could not be
/// started or that outran its cap is recorded as not run, with the reason, rather
/// than as a failure it did not earn.
pub async fn run_command(repo: &Path, command: &str, timeout: Duration) -> ToolchainCommandResult {
    // `sh -c` verbatim: the manifest declares a shell line, not an argv vector.
    let child = match tokio::process::Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(repo)
        // `CI` is what makes a test runner run once and exit instead of dropping
        // into watch mode, and `NO_COLOR` keeps the excerpt readable.
        .env("CI", "1")
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        // Nothing may prompt: a tool waiting on stdin would otherwise burn the
        // whole timeout on a question no one is there to answer.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Dropping the future on timeout must not leave the shell running.
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            return ToolchainCommandResult::skipped(
                command,
                format!("could not start `sh`: {err}"),
            );
        }
    };

    let Ok(output) = tokio::time::timeout(timeout, child.wait_with_output()).await else {
        return ToolchainCommandResult::skipped(
            command,
            format!("timed out after {} seconds", timeout.as_secs()),
        );
    };
    let output = match output {
        Ok(output) => output,
        Err(err) => {
            return ToolchainCommandResult::skipped(command, format!("could not be run: {err}"));
        }
    };

    // stdout then stderr, in that order: `tsc` writes its diagnostics to stdout
    // while most runners write their summary to stderr, and a single combined
    // excerpt is what a reader wants rather than two half-empty ones.
    let mut raw = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        if !raw.is_empty() && !raw.ends_with('\n') {
            raw.push('\n');
        }
        raw.push_str(&stderr);
    }
    ToolchainCommandResult::ran(command, output.status.code(), &raw)
}

#[cfg(test)]
#[path = "install.test.rs"]
mod tests;
