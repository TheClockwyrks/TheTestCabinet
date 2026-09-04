//! The [post-run stage](crate::post_run) that runs a case's declared
//! [`[toolchain]`](crate::toolchain) commands over the produced implementation and
//! smoke-checks the site it builds.
//!
//! # Why a post-run stage, and not the validator
//!
//! The commands are *checks over the code the model wrote*, in the same family as
//! the static code analysis and the session assembly: they read a finished tree and
//! report what they found. Putting them at the [seam](crate::post_run) is what buys
//! the three properties that seam exists for — a slow `vitest` suite costs the test
//! case none of its runtime budget, a failing command can never turn a finished run
//! into a failed one, and the results are produced upstream of the record so the
//! record can carry them.
//!
//! It also puts them **before** validation, which matters for the one command that
//! gates. Validation is skipped for a canceled run and can fail for reasons that
//! have nothing to do with the code compiling; deciding "does this typecheck" in a
//! step of its own keeps the gate's evidence independent of how far validation got.
//!
//! # The container is already gone
//!
//! By the time a stage runs, the run's container has been stopped and its working
//! tree collected onto the host. The commands therefore run **on the host, in the
//! collected tree**, through `sh -c` from the implementation's repository root —
//! which is exactly how the validator already runs the case's `[build]` install and
//! build commands, and what the manifest documentation describes ("runs from the
//! implementation's repository root once the `[build]` install has completed").
//!
//! The collected tree carries no `node_modules` (the collector
//! [skips it](crate::SKIPPED_DIRS), and a lockfile install reproduces it exactly),
//! so this stage runs the case's own `install` command first and reports it as its
//! own result, bounded by [`INSTALL_TIMEOUT`].
//!
//! Validation runs that same install. When this stage's succeeded, it reports the
//! install it completed on its [report](crate::PostRunReport::prepared_install), the
//! engine stamps that onto the
//! [tree's description](crate::ArtifactCollection::prepared_install), and validation
//! reports the recorded step rather than clearing `node_modules` and rebuilding it
//! from the same lockfile. An install that failed prepares nothing, so validation
//! installs for itself and reaches its own verdict about the tree.
//!
//! # The test command's figures are read from files it wrote
//!
//! The stage runs the `test` command and then reads the two report files the case's
//! own build vitest config writes into the tree ([`crate::toolchain_report`]),
//! whatever the command exited with, because the config sets `reportOnFailure` and a
//! failing suite is the one whose coverage is most worth having. Nothing is derived
//! from what the command printed. A case whose configuration writes no reports records
//! no figures at all, which is how the record distinguishes *not reported* from
//! *zero*.
//!
//! The stage owns those two paths for the length of the command and
//! [clears them](crate::toolchain_report::discard_reports) on either side of it. The
//! collected tree arrives carrying whatever the model's own in-container test run left
//! behind, so clearing first is what makes a figure read afterwards a figure this
//! invocation produced; and removing them again keeps host-written files, with the
//! absolute paths and stack traces the record strips, out of the published
//! `implementation/` tree. A command recorded as `ran: false` contributes no figures at
//! all.
//!
//! # Every step is bounded, and every failure is a recorded fact
//!
//! Each command runs under a wall-clock cap and its output is capped at
//! [`TOOLCHAIN_OUTPUT_LIMIT`](crate::toolchain::TOOLCHAIN_OUTPUT_LIMIT) bytes. A
//! command that could not be started, or that ran out of time, is recorded as
//! `ran: false` with the reason — never as a failure it did not earn, because only
//! a typecheck that *ran* and exited non-zero gates the run.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use crate::error::Result;
use crate::playable::find_build_output;
use crate::post_run::{PostRunContext, PostRunReport, PostRunStage};
use crate::toolchain::{
    ToolchainCommandResult, ToolchainSmokeResult, ToolchainSummary, ToolchainTestRun,
};
use crate::toolchain_report::{discard_reports, read_coverage_summary, read_test_report};

/// Wall-clock cap on the dependency install, and on the static build the smoke
/// check needs. A cold `npm ci` for a game project is minutes, not seconds.
pub const INSTALL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Wall-clock cap on each declared toolchain command.
///
/// Generous enough that no honest `tsc`/`eslint`/`vitest` invocation hits it, and
/// short enough that a command that never terminates (a test runner left in watch
/// mode) is recorded as timed out rather than wedging the host relaying the run.
pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// The most console errors carried from the smoke check onto the record.
const MAX_CONSOLE_ERRORS: usize = 20;

/// The most characters of any one console error carried onto the record.
const MAX_CONSOLE_ERROR_LEN: usize = 500;

/// The [post-run stage](crate::post_run) that runs a case's `[toolchain]` commands
/// and the build smoke check.
///
/// **It judges nothing itself.** It records what each command did — including, for
/// the typecheck, whether it ran and what it exited with — and the *gate* built on
/// that record is applied where a run's overall rating and score are aggregated
/// (see [`crate::review::gated_rating`]). Keeping the measurement and the verdict
/// apart is what lets a reviewer's own marks survive the gate untouched.
#[derive(Debug, Default, Clone, Copy)]
pub struct ToolchainStage;

#[async_trait::async_trait]
impl PostRunStage for ToolchainStage {
    fn name(&self) -> &'static str {
        "toolchain"
    }

    async fn run(&self, context: &PostRunContext<'_>) -> Result<PostRunReport> {
        // A case that declares no `[toolchain]` table is not checked and not gated.
        // Every case version frozen before the table existed is in this arm.
        let Some(commands) = context.test_case.toolchain.as_ref() else {
            return Ok(PostRunReport::empty());
        };
        // The commands need the case's own install command, which lives on the
        // `[build]` table. A case with a toolchain but no build cannot be checked.
        let Some(build) = context.test_case.build.as_ref() else {
            return Ok(PostRunReport::empty());
        };
        // Nothing to check: the tree never reached the host, or it is not a node
        // project. An absent summary reads as "not checked", which is the truth.
        let repo = &context.artifacts.repo_path;
        if !repo.is_dir() || !repo.join("package.json").is_file() {
            return Ok(PostRunReport::empty());
        }
        // A canceled run is not checked, for the same reason validation skips it:
        // these commands are fresh work over output an operator chose to stop, and
        // a gate derived from them would rate a deliberately-interrupted run broken
        // on the strength of an implementation nobody claimed was finished.
        if context.canceled {
            return Ok(PostRunReport::empty());
        }

        let install = run_command(repo, &build.install, INSTALL_TIMEOUT).await;
        let unavailable = (!install.succeeded).then(|| {
            format!(
                "not run: the `{}` install did not succeed",
                build.install.trim()
            )
        });

        let typecheck = match &unavailable {
            Some(reason) => ToolchainCommandResult::skipped(&commands.typecheck, reason),
            None => run_command(repo, &commands.typecheck, COMMAND_TIMEOUT).await,
        };

        let mut optional = Vec::new();
        for declared in [commands.lint.as_deref(), commands.format.as_deref()] {
            optional.push(match (declared, &unavailable) {
                (None, _) => None,
                (Some(command), Some(reason)) => {
                    Some(ToolchainCommandResult::skipped(command, reason))
                }
                (Some(command), None) => Some(run_command(repo, command, COMMAND_TIMEOUT).await),
            });
        }
        let format = optional.pop().flatten();
        let lint = optional.pop().flatten();

        let test = match (commands.test.as_deref(), &unavailable) {
            (None, _) => None,
            // A command that never ran wrote no reports, and reading whatever an
            // earlier run left in the tree would attribute another run's figures to
            // this one.
            (Some(command), Some(reason)) => Some(ToolchainTestRun {
                result: ToolchainCommandResult::skipped(command, reason),
                tests: None,
                coverage: None,
            }),
            (Some(command), None) => {
                // The stage owns the two report paths while its own command runs. The
                // collected tree arrives with whatever the model's own in-container
                // `npm test` left in `coverage/`, so clearing them first is what makes
                // a figure read afterwards a figure THIS invocation produced — a
                // runner that cannot resolve, or dies before writing, then reports
                // nothing instead of another run's numbers.
                discard_reports(repo);
                let result = run_command(repo, command, COMMAND_TIMEOUT).await;
                let (tests, coverage) = reported_figures(repo, &result);
                // Read, then removed. `implementation/` is published as a copy of what
                // the model produced, and these two files are the host's writing:
                // istanbul's whole instrumentation map keyed by absolute host paths,
                // and failure messages carrying the stack frames the record strips.
                discard_reports(repo);
                Some(ToolchainTestRun {
                    result,
                    tests,
                    coverage,
                })
            }
        };

        // The smoke check needs a build. It is deliberately last: it is the most
        // expensive step and the least load-bearing, so a host that runs out of
        // time still has the gate's answer.
        let smoke = match &unavailable {
            Some(reason) => Some(ToolchainSmokeResult::not_run(reason.clone())),
            None => Some(smoke_check(repo, &build.build).await),
        };

        let summary = ToolchainSummary {
            install,
            typecheck,
            lint,
            format,
            test,
            smoke,
        };
        tracing::info!(
            run_id = context.run_id,
            typecheck_ran = summary.typecheck.ran,
            typecheck_passed = summary.typecheck.succeeded,
            gated = summary.gates(),
            // Whether the case is on the report-file contract at all, which is the
            // one thing a host operator cannot tell from the commands themselves.
            tests_reported = summary.test.as_ref().is_some_and(|t| t.tests.is_some()),
            coverage_reported = summary.test.as_ref().is_some_and(|t| t.coverage.is_some()),
            smoke_clean = summary.smoke.as_ref().is_some_and(|s| s.clean()),
            "ran the case's TypeScript toolchain over the produced implementation",
        );
        Ok(PostRunReport::toolchain(summary))
    }
}

/// The figures a finished `test` command contributes, read from the report files it
/// left in `repo`.
///
/// Gated on whether the command RAN, and deliberately not on what it exited with. The
/// build config sets `reportOnFailure`, so a suite that failed still wrote its coverage
/// and a failing suite is the one whose coverage matters most. A command that timed out
/// or could not be started is recorded as `ran: false`, and a figure beside that would
/// describe an invocation with no result — including one that flushed a partial report
/// on its way to being killed.
///
/// A case whose configuration writes no reports leaves both absent, which is how the
/// record says *not reported* rather than *zero*.
fn reported_figures(
    repo: &Path,
    result: &ToolchainCommandResult,
) -> (
    Option<crate::toolchain::ToolchainTests>,
    Option<crate::toolchain::ToolchainCoverage>,
) {
    if !result.ran {
        return (None, None);
    }
    (read_test_report(repo), read_coverage_summary(repo))
}

/// Build the implementation and open the built site in headless Chromium.
///
/// Every negative answer here is a *recorded* one: a build that fails, a build that
/// emits no output directory, and a host with no browser are three different
/// [details](ToolchainSmokeResult::detail), and only the first two are facts about
/// the implementation.
async fn smoke_check(repo: &Path, build_command: &str) -> ToolchainSmokeResult {
    let build = run_command(repo, build_command, INSTALL_TIMEOUT).await;
    if !build.succeeded {
        return ToolchainSmokeResult::not_run(format!(
            "not run: `{}` did not succeed",
            build_command.trim()
        ));
    }
    let Some(output_dir) = find_build_output(repo) else {
        return ToolchainSmokeResult::not_run(
            "not run: the build produced no dist/build/out directory".to_string(),
        );
    };

    // The server and the driver are both blocking, and the driver spawns a browser:
    // off the runtime's worker threads, exactly as the code analyzer moves its
    // parser pass off them.
    let joined = tokio::task::spawn_blocking(move || {
        let server = match crate::browser::StaticServer::start(output_dir) {
            Ok(server) => server,
            Err(err) => {
                return ToolchainSmokeResult::not_run(format!("could not serve the build: {err}"));
            }
        };
        match crate::browser::smoke_check(&server.url()) {
            // A driver that could not run at all is a fact about the HOST, so it
            // degrades to "not checked" rather than to a boot failure the build
            // never had.
            Err(err) => ToolchainSmokeResult::not_run(err),
            Ok(result) => ToolchainSmokeResult {
                ran: true,
                booted: result.booted,
                painted: result.painted,
                console_errors: result
                    .console_errors
                    .into_iter()
                    .take(MAX_CONSOLE_ERRORS)
                    .map(|line| truncate_chars(&line, MAX_CONSOLE_ERROR_LEN))
                    .collect(),
                detail: result.detail,
            },
        }
    })
    .await;
    joined.unwrap_or_else(|err| {
        ToolchainSmokeResult::not_run(format!("the smoke-check thread did not finish: {err}"))
    })
}

/// Truncate `line` to `limit` characters, marking it when anything was dropped.
fn truncate_chars(line: &str, limit: usize) -> String {
    if line.chars().count() <= limit {
        return line.to_string();
    }
    line.chars().take(limit).collect::<String>() + "…"
}

/// Run one declared command through `sh -c` from `repo`, bounded by `timeout`.
///
/// Only the bounded result is returned. The unbounded output used to be handed back
/// beside it so the test command's figures could be scraped out of it; those figures
/// now come from the files the runner wrote (see [`crate::toolchain_report`]), and
/// nothing else ever wanted the whole of what a command printed.
async fn run_command(repo: &Path, command: &str, timeout: Duration) -> ToolchainCommandResult {
    // `sh -c` verbatim, matching how the validator runs the case's `[build]`
    // commands: the manifest declares a shell line, not an argv vector.
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
#[path = "toolchain_stage.test.rs"]
mod tests;
