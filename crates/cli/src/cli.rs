//! Clap argument model for `tcab`.
//!
//! The argument types live here, separate from the handlers, so the parser is
//! easy to test in isolation (see `cli.test.rs`).

use clap::{Args, Parser, Subcommand, ValueEnum};
use test_cabinet_core::run_record::HarnessSlug;

/// The Test Cabinet command line interface.
///
/// `tcab` exposes the headless core so runs can be scripted and benchmark sweeps
/// run in batch.
#[derive(Debug, Parser)]
#[command(
    name = "tcab",
    version,
    about = "The Test Cabinet — script and batch coding-agent benchmark runs",
    long_about = None,
)]
pub struct Cli {
    /// The subcommand to run.
    #[command(subcommand)]
    pub command: Command,
}

/// Top-level subcommands, each mapping onto a core capability.
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Launch a run: select a test case version, harness, and model.
    Run(RunArgs),

    /// Run validation over a produced implementation.
    Validate(ValidateArgs),

    /// Create an account on the auth service and log in (open self-registration).
    Register(RegisterArgs),

    /// Log in to an existing account and store the bearer token.
    Login(LoginArgs),

    /// Revoke the stored token and log out.
    Logout,

    /// Submit a review (from the run's `writeup.md`) for a produced run.
    Review(ReviewArgs),

    /// Publish finished run(s): self-review + publish in one step (the solo path).
    /// A run cannot be published without at least one review.
    Publish(PublishArgs),

    /// List supported harnesses and their availability.
    Harnesses(HarnessesArgs),

    /// List the built-in orchestrators and what each one does.
    Orchestrators(OrchestratorsArgs),

    /// Seed a test case version into a folder to inspect what a run's harness
    /// receives as input, without launching a container.
    Seed(SeedArgs),

    /// Print the prompt a run would hand to the harness for a test case variant,
    /// without seeding or launching anything.
    Prompt(PromptArgs),
}

/// The agent harness to drive, selectable on the command line.
///
/// This mirrors [`HarnessSlug`] from the core so the CLI's accepted values stay
/// in lockstep with the canonical slugs used in run records and on the site.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum HarnessArg {
    /// Anthropic Claude Code (`claude`).
    Claude,
    /// OpenAI Codex (`codex`).
    Codex,
    /// Cline (`cline`).
    Cline,
    /// Google Antigravity (`antigravity`).
    Antigravity,
    /// Goose (`goose`).
    Goose,
    /// Kilo Code (`kilo`).
    Kilo,
    /// OpenCode (`opencode`).
    Opencode,
    /// Pi (`pi`).
    Pi,
}

impl From<HarnessArg> for HarnessSlug {
    fn from(arg: HarnessArg) -> Self {
        match arg {
            HarnessArg::Claude => HarnessSlug::Claude,
            HarnessArg::Codex => HarnessSlug::Codex,
            HarnessArg::Cline => HarnessSlug::Cline,
            HarnessArg::Antigravity => HarnessSlug::Antigravity,
            HarnessArg::Goose => HarnessSlug::Goose,
            HarnessArg::Kilo => HarnessSlug::Kilo,
            HarnessArg::Opencode => HarnessSlug::Opencode,
            HarnessArg::Pi => HarnessSlug::Pi,
        }
    }
}

/// Arguments for `tcab run`.
///
/// `disable_version_flag` frees `--version` to mean the *test case* version
/// rather than clap's auto-generated binary-version flag.
#[derive(Debug, Args)]
#[command(disable_version_flag = true)]
pub struct RunArgs {
    /// Slug of the test case to run (for example, `carom`).
    #[arg(long, value_name = "SLUG")]
    pub test_case: String,

    /// Exact, immutable test case version to run.
    #[arg(long, value_name = "VERSION")]
    pub version: String,

    /// Variant of the test case to run (for example, `base`). Selects which specs
    /// are seeded and is recorded in the run record.
    #[arg(long, value_name = "VARIANT")]
    pub variant: String,

    /// Agent harness to drive the run.
    #[arg(long, value_enum, value_name = "HARNESS")]
    pub harness: HarnessArg,

    /// Model ID passed to the harness unchanged (opaque to The Test Cabinet).
    #[arg(long, value_name = "MODEL")]
    pub model: String,

    /// Maximum harness runtime in hours before the run is stopped. Overrides the
    /// test case's `max_runtime_hours` default; omit to use that default.
    /// Fractional hours are allowed (for example `0.5`).
    #[arg(long, value_name = "HOURS")]
    pub max_runtime: Option<f64>,

    /// Built-in orchestrator that conducts the harness sessions (for example
    /// `one-shot` or `ralph`). Defaults to `one-shot`, a single session. Selection
    /// is limited to end-to-end test cases; other test types always run `one-shot`.
    /// See `tcab orchestrators`.
    #[arg(long, value_name = "SLUG", default_value = "one-shot")]
    pub orchestrator: String,

    /// Harness authentication mode for this run: `auto`, `subscription`, or
    /// `api-key`. Omit to keep the default (API-key, preferring a subscription only
    /// when its credentials are available). Forwarded to the backend, which the
    /// driver applies — the only way to run a subscription-only harness on the
    /// cluster path.
    #[arg(long, value_name = "MODE")]
    pub auth_mode: Option<String>,

    /// Directory to also write the produced run record's JSON into. The backend
    /// holds the run's artifacts, so this only mirrors the record locally; omit it
    /// to write nothing to disk.
    #[arg(long, value_name = "DIR")]
    pub out_dir: Option<std::path::PathBuf>,
}

/// Arguments for `tcab validate`.
///
/// `disable_version_flag` frees `--version` to mean the *test case* version.
#[derive(Debug, Args)]
#[command(disable_version_flag = true)]
pub struct ValidateArgs {
    /// Path to the produced implementation to validate.
    #[arg(long, value_name = "DIR")]
    pub implementation: std::path::PathBuf,

    /// Slug of the test case the implementation was built for.
    #[arg(long, value_name = "SLUG")]
    pub test_case: String,

    /// Version of the test case the implementation was built for.
    #[arg(long, value_name = "VERSION")]
    pub version: String,

    /// Variant the implementation was built for (for example, `base`). Selects
    /// which reference baselines the declared checks compare against, since a
    /// variant may declare its own variant-specific references.
    #[arg(long, value_name = "VARIANT")]
    pub variant: String,
}

/// Arguments for `tcab register`.
#[derive(Debug, Args)]
pub struct RegisterArgs {
    /// The desired unique username.
    #[arg(long, value_name = "NAME")]
    pub username: String,

    /// The human-facing display name shown beside your reviews.
    #[arg(long, value_name = "NAME")]
    pub display_name: String,

    /// The account password. If omitted, the `TCAB_PASSWORD` environment variable
    /// is used (so the command stays scriptable).
    #[arg(long, value_name = "PASSWORD")]
    pub password: Option<String>,
}

/// Arguments for `tcab login`.
#[derive(Debug, Args)]
pub struct LoginArgs {
    /// The account username.
    #[arg(long, value_name = "NAME")]
    pub username: String,

    /// The account password. If omitted, the `TCAB_PASSWORD` environment variable
    /// is used.
    #[arg(long, value_name = "PASSWORD")]
    pub password: Option<String>,
}

/// Arguments for `tcab review`.
#[derive(Debug, Args)]
pub struct ReviewArgs {
    /// The backend run id of the (already-stored) run to review.
    #[arg(value_name = "RUN_ID")]
    pub run_id: String,

    /// Path to the review's `writeup.md` the reviewer authored locally. Defaults to
    /// `writeup.md` in the working directory.
    #[arg(long, value_name = "FILE")]
    pub writeup: Option<std::path::PathBuf>,
}

/// Arguments for `tcab publish`.
#[derive(Debug, Args)]
pub struct PublishArgs {
    /// One or more backend run ids to publish. Multiple values enable batch
    /// publishing of a sweep's runs in a single invocation.
    #[arg(value_name = "RUN_ID", required = true, num_args = 1..)]
    pub run_ids: Vec<String>,

    /// Print what would be reviewed and published — without submitting any review
    /// or flipping any run public.
    #[arg(long)]
    pub dry_run: bool,
}

/// Arguments for `tcab harnesses`.
#[derive(Debug, Args)]
pub struct HarnessesArgs {
    /// Emit the listing as JSON instead of a human-readable table.
    #[arg(long)]
    pub json: bool,
}

/// Arguments for `tcab orchestrators`.
#[derive(Debug, Args)]
pub struct OrchestratorsArgs {
    /// Emit the listing as JSON instead of a human-readable table.
    #[arg(long)]
    pub json: bool,
}

/// Arguments for `tcab seed`.
///
/// `disable_version_flag` frees `--version` to mean the *test case* version
/// rather than clap's auto-generated binary-version flag, matching `tcab run`.
#[derive(Debug, Args)]
#[command(disable_version_flag = true)]
pub struct SeedArgs {
    /// Slug of the test case to seed (for example, `carom`).
    #[arg(long, value_name = "SLUG")]
    pub test_case: String,

    /// Exact, immutable test case version to seed.
    #[arg(long, value_name = "VERSION")]
    pub version: String,

    /// Variant of the test case to seed (for example, `base`). Selects which
    /// specs are seeded.
    #[arg(long, value_name = "VARIANT")]
    pub variant: String,

    /// Directory the seeded repository is created under. Defaults to a `tmp/`
    /// subfolder of the working directory.
    #[arg(long, value_name = "DIR", default_value = "tmp")]
    pub out_dir: std::path::PathBuf,
}

/// Arguments for `tcab prompt`.
///
/// `disable_version_flag` frees `--version` to mean the *test case* version
/// rather than clap's auto-generated binary-version flag, matching `tcab run`.
#[derive(Debug, Args)]
#[command(disable_version_flag = true)]
pub struct PromptArgs {
    /// Slug of the test case to render the prompt for (for example, `carom`).
    #[arg(long, value_name = "SLUG")]
    pub test_case: String,

    /// Exact, immutable test case version.
    #[arg(long, value_name = "VERSION")]
    pub version: String,

    /// Variant of the test case to render the prompt for (for example, `base`).
    #[arg(long, value_name = "VARIANT")]
    pub variant: String,
}

#[cfg(test)]
#[path = "cli.test.rs"]
mod tests;
