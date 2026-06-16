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

    /// Publish a finished run (idempotent, batch-capable).
    Publish(PublishArgs),

    /// List supported harnesses and their availability.
    Harnesses(HarnessesArgs),

    /// Seed a test case version into a folder to inspect what a run's harness
    /// receives as input, without launching a container.
    Seed(SeedArgs),

    /// Print the prompt a run would hand to the harness for a test case variant,
    /// without seeding or launching anything.
    Prompt(PromptArgs),

    /// Emit the static-site catalog datasets (test cases and models) the site
    /// reads without a backend.
    Catalog(CatalogArgs),
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
    /// Slug of the test case to run (for example, `pong`).
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

    /// Maximum harness runtime in seconds before the run is stopped. Overrides
    /// the test case's `max_runtime_seconds` default; omit to use that default.
    #[arg(long, value_name = "SECONDS")]
    pub max_runtime: Option<u64>,

    /// Directory to write the run record and collected artifacts into.
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

/// Arguments for `tcab publish`.
#[derive(Debug, Args)]
pub struct PublishArgs {
    /// One or more run record files to publish. Multiple values enable batch
    /// publishing of a sweep's runs in a single invocation.
    #[arg(value_name = "RUN_RECORD", required = true, num_args = 1..)]
    pub run_records: Vec<std::path::PathBuf>,

    /// Re-publish even if a run already appears published. Publishing is
    /// idempotent regardless; this only forces the work to run again.
    #[arg(long)]
    pub force: bool,

    /// Print what would be published — repository names, build subdomains, and
    /// the dataset that would change — without creating, pushing, or committing
    /// anything.
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

/// Arguments for `tcab seed`.
///
/// `disable_version_flag` frees `--version` to mean the *test case* version
/// rather than clap's auto-generated binary-version flag, matching `tcab run`.
#[derive(Debug, Args)]
#[command(disable_version_flag = true)]
pub struct SeedArgs {
    /// Slug of the test case to seed (for example, `pong`).
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
    /// Slug of the test case to render the prompt for (for example, `pong`).
    #[arg(long, value_name = "SLUG")]
    pub test_case: String,

    /// Exact, immutable test case version.
    #[arg(long, value_name = "VERSION")]
    pub version: String,

    /// Variant of the test case to render the prompt for (for example, `base`).
    #[arg(long, value_name = "VARIANT")]
    pub variant: String,
}

/// Arguments for `tcab catalog`.
///
/// The catalog command needs no API keys: it reads the test case and model
/// catalogs from disk and writes the site's static datasets. `--models-dir` and
/// `--site-dir` exist so the source catalogs and the output site can be relocated
/// in tests or alternative layouts; the test case catalog honors
/// `TCAB_TEST_CASES_DIR` like the other commands.
#[derive(Debug, Args)]
pub struct CatalogArgs {
    /// Directory holding the model catalog (`<slug>.toml` declarations).
    #[arg(long, value_name = "DIR", default_value = "models")]
    pub models_dir: std::path::PathBuf,

    /// The site directory the datasets and public catalog assets are written
    /// under (`<site>/src/data/*.json` and `<site>/public/catalog/...`).
    #[arg(long, value_name = "DIR", default_value = "apps/site")]
    pub site_dir: std::path::PathBuf,
}

#[cfg(test)]
#[path = "cli.test.rs"]
mod tests;
