//! Clap argument model for `tcab`.
//!
//! The argument types live here, separate from the handlers, so the parser is
//! easy to test in isolation (see `cli.test.rs`).

use clap::{Args, Parser, Subcommand, ValueEnum};
use test_cabinet_core::CodeTreeBasis;
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

    /// Reconstruct a **gg** run from a captured replay record — a debug-only tool. Loads the
    /// record, by run id from the backend or from a local file, and re-runs the session from its
    /// pinned model I/O and tool results, with no live model and no real tools, re-emitting the
    /// reconstructed telemetry and (optionally) the per-agent step-through. It does not produce a
    /// scored run.
    #[command(name = "gg-replay")]
    GgReplay(GgReplayArgs),

    /// Re-run a recorded **gg** session through the *real* turn loop, answering only the model
    /// call and the shell from the record and performing every other side effect for real. A
    /// session that took half an hour reconstructs in seconds, for free, and the report says
    /// whether this build of gg still produces it.
    ///
    /// Not `gg-replay`: that walks a record passively and shows you the transcript. This drives
    /// the loop, so it is what detects that a prompt edit invalidated the recorded answers.
    #[command(name = "gg-playback")]
    GgPlayback(GgPlaybackArgs),

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

    /// Build and deploy a test case variant's **reference implementation** — the
    /// authored, correct static build of the case — and record its URL on the
    /// backend so the site's Reference tab can embed it.
    #[command(name = "publish-reference")]
    PublishReference(PublishReferenceArgs),

    /// (Re)generate a case version's committed **baseline** validation media by
    /// driving its debug scripts against its reference implementation(s). Needs no
    /// deployment environment or credentials — just the case's toolchain and a
    /// browser.
    #[command(name = "capture-baselines")]
    CaptureBaselines(CaptureBaselinesArgs),

    /// Run the static code analyzer over a directory and print what it found.
    ///
    /// The same analysis a run records about its produced tree, pointed at any tree on
    /// disk — no run, no container, no backend, no credentials. It executes nothing in the
    /// tree it reads.
    Analyze(AnalyzeArgs),
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

    /// Built-in orchestrator that conducts the harness sessions (today only
    /// `one-shot`, a single session — the default). Selection is limited to
    /// end-to-end test cases; other test types always run `one-shot`. See
    /// `tcab orchestrators`.
    #[arg(long, value_name = "SLUG", default_value = "one-shot")]
    pub orchestrator: String,

    /// Harness authentication mode for this run: `auto`, `subscription`, or
    /// `api-key`. Omit to keep the default (API-key, preferring a subscription only
    /// when its credentials are available). Forwarded to the backend, which the
    /// driver applies — the only way to run a subscription-only harness on the
    /// cluster path.
    #[arg(long, value_name = "MODE")]
    pub auth_mode: Option<String>,

    /// How many times the backend automatically retries this run after a terminal
    /// infrastructure error or catastrophic (won't-load) build. Omit to accept the
    /// backend default of `1` (one retry); `0` disables retries. A timeout or a
    /// completed run is never retried.
    #[arg(long, value_name = "N")]
    pub retry_count: Option<u32>,

    /// Directory to also write the produced run record's JSON into. The backend
    /// holds the run's artifacts, so this only mirrors the record locally; omit it
    /// to write nothing to disk.
    #[arg(long, value_name = "DIR")]
    pub out_dir: Option<std::path::PathBuf>,
}

/// Arguments for `tcab gg-replay` — a local, debug-only reconstruction of a gg run from its
/// captured [replay record](test_cabinet_core::gg_replay::GgReplayRecord).
///
/// The record is named **either** by run id (fetched from the backend) or by `--record` (a local
/// file), and exactly one of the two is required — a clap group, so naming both is a parse error
/// rather than a silent precedence rule.
///
/// `--record` remains a flag. The run-id form was *added* as a positional; demoting the shipped
/// flag to a positional would break every script and shell history that already uses it, which is
/// the same class of break `gg --config` is deliberately protected from.
#[derive(Debug, Args)]
#[command(group(
    clap::ArgGroup::new("gg_replay_record_source")
        .required(true)
        .args(["run_id", "record"])
))]
pub struct GgReplayArgs {
    /// The id of a published run to fetch the replay record for (`GET /runs/{id}/replay` against
    /// `TCAB_BACKEND_URL`). Mutually exclusive with `--record`.
    #[arg(value_name = "RUN_ID")]
    pub run_id: Option<String>,

    /// Path to the replay record to reconstruct, plain JSON or gzipped (a run tree's copy is
    /// `replay.json.gz`). Either format version: a v1 record — what `GET /runs/{id}/replay` serves
    /// for any run captured before format v2 — is upgraded as it is read.
    #[arg(long, value_name = "FILE")]
    pub record: Option<std::path::PathBuf>,

    /// Optional path to write the reconstructed per-agent step-through list to, as JSON — what a
    /// debugging UI renders (each step: which agent, what it saw, and what it did with each tool
    /// result). Omit to only stream the reconstructed telemetry and a summary.
    #[arg(long, value_name = "FILE")]
    pub steps: Option<std::path::PathBuf>,

    /// Reconstruct with an **older** `gg` instead of this build: a released version (`0.6.9`, or
    /// `v0.6.9`) to resolve from the published releases, or a path to a `gg` binary.
    ///
    /// A record's `formatVersion` says whether *this* build can parse it, and a record from a newer
    /// gg is refused outright. This is the other direction: a record written by a build whose
    /// inputs this one no longer models is best reconstructed by the build that wrote it, and the
    /// record's own `recorder` block names it.
    #[arg(long, value_name = "VERSION|PATH")]
    pub gg: Option<String>,
}

/// Arguments for `tcab gg-playback` — a **driving** reconstruction of a gg session from its
/// [replay record](test_cabinet_core::gg_replay::GgReplayRecord).
///
/// The record is named the same two ways `tcab gg-replay` names one — a run id, or `--record` —
/// through the same clap group, so the impossible third state (neither, or both) is a parse error
/// phrased in the flags the user typed.
///
/// Everything else here is a relaxation, and each one costs the reconstruction its
/// **faithfulness**. That asymmetry is deliberate: the default invocation is the one whose answer
/// means something, and every way of getting a greener result has to be typed out.
#[derive(Debug, Args)]
#[command(group(
    clap::ArgGroup::new("gg_playback_record_source")
        .required(true)
        .args(["run_id", "record"])
))]
pub struct GgPlaybackArgs {
    /// The id of a published run to fetch the replay record for (`GET /runs/{id}/replay` against
    /// `TCAB_BACKEND_URL`). Mutually exclusive with `--record`.
    #[arg(value_name = "RUN_ID")]
    pub run_id: Option<String>,

    /// Path to the replay record to reconstruct, plain JSON or gzipped (a run tree's copy is
    /// `replay.json.gz`).
    ///
    /// A record captured before format v2 is refused: a *driving* reconstruction needs the
    /// recorder-stamped fingerprints, the agent provenance table and the seed that v2 introduced.
    /// `tcab gg-replay` still walks such a record passively.
    #[arg(long, value_name = "FILE")]
    pub record: Option<std::path::PathBuf>,

    /// The directory to build the reconstruction in. It must be empty (or not exist yet).
    ///
    /// Omit it and the reconstruction builds in a temporary directory that is removed afterwards:
    /// the products of a playback are the report and the telemetry, not the tree. Name one when
    /// you want to look at what the loop wrote — but never point it at a run's produced tree,
    /// which is why a non-empty directory is refused rather than merged into.
    #[arg(long, value_name = "DIR")]
    pub workspace: Option<std::path::PathBuf>,

    /// Write the divergence report to this file, as JSON.
    ///
    /// Written **whatever** the reconstruction found, including when a fatal divergence stopped
    /// it: the divergences found before the stop are exactly what a developer came for.
    #[arg(long, value_name = "FILE")]
    pub report: Option<std::path::PathBuf>,

    /// Write the reconstruction's telemetry to this file, as NDJSON — the same stream a live gg
    /// run emits, which is the *product* of a playback.
    #[arg(long, value_name = "FILE")]
    pub events: Option<std::path::PathBuf>,

    /// How much of each recorded request the live one must still match. `exact` is the only
    /// setting under which a reconstruction can be faithful.
    #[arg(long, value_name = "MODE", value_enum, default_value_t = StrictnessArg::Exact)]
    pub strictness: StrictnessArg,

    /// Whether recorded inputs are served in the order the run consumed them (`seq`), or the
    /// moment each is asked for (`free`).
    ///
    /// `free` is a measurement instrument rather than a convenience: reconstruct a concurrent
    /// record both ways and the difference between them is what the ordering barrier is worth.
    #[arg(long, value_name = "MODE", value_enum, default_value_t = OrderingArg::Seq)]
    pub ordering: OrderingArg,

    /// **Actually run** a command line the record has no answer for, in the reconstruction's
    /// workspace — and report that it did.
    ///
    /// The escape hatch for a session recorded before the shell seam captured every path, where
    /// the alternative is a reconstruction whose every command is a miss. Never inferred: this is
    /// the one flag that lets a playback start a process at all, and the whole value of a playback
    /// is that it costs nothing and touches nothing.
    #[arg(long, conflicts_with = "stop_on_unrecorded")]
    pub execute_unrecorded: bool,

    /// Treat a command line the record has no answer for as fatal, instead of synthesizing a
    /// classified failure for it and carrying on.
    ///
    /// For a caller who would rather have nothing than a session in which a build's output was
    /// invented.
    #[arg(long)]
    pub stop_on_unrecorded: bool,
}

/// How much of a recorded request `tcab gg-playback` requires the live one to still match.
///
/// Mirrors gg's `Strictness` so the CLI's accepted values stay in lockstep with the drift matrix
/// they select a row of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "lower")]
pub enum StrictnessArg {
    /// Every component — message count, system prompt, offered toolset, conversation — must
    /// match. The default, and the only mode a faithful reconstruction is possible under.
    Exact,
    /// The message count and the offered toolset must match; the system prompt and the transcript
    /// text may have moved. For extracting data from sessions recorded before a prompt edit.
    Shape,
    /// Nothing is required to match. Triage only — every difference is still reported, and the
    /// report, the `faithful` flag and the exit code all say the reconstruction was relaxed.
    None,
}

/// Whether `tcab gg-playback` serves recorded inputs in the order the run consumed them.
///
/// Mirrors gg's `Ordering`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "lower")]
pub enum OrderingArg {
    /// Serve a recorded input only once every recorded input below it has been served — the
    /// ordering barrier. The default.
    Seq,
    /// Serve every recorded input the moment it is asked for.
    Free,
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

/// Arguments for `tcab publish-reference`.
///
/// The command targets a case (by slug or folder name) at a single version and,
/// for each targeted variant that declares a `reference_implementation`, builds
/// it with the case's own `[build]` commands, deploys the static output to
/// Cloudflare Pages, and records the served URL on the backend.
///
/// `version` is positional and optional: omit it to target the case's newest
/// version. Variant selection is `--variant <slug>` for exactly one, or
/// `--all-variants` for every variant that declares a reference implementation;
/// when neither is given the command defaults to all such variants (the flag is
/// the explicit, self-documenting form of the default). The two selectors are
/// mutually exclusive.
///
/// `disable_version_flag` frees `--version`/`-V` so it is not consumed as clap's
/// auto-generated binary-version flag, matching `tcab run`/`tcab prompt` — though
/// here the version is positional rather than a `--version` flag.
/// The deployment environment a reference implementation publishes to, selecting
/// the Cloudflare Pages project it lands in (see `publish_reference`). It is a
/// required `--env` flag rather than a defaulted one so a publish can never
/// silently target prod — the same convention the operator shell scripts use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "snake_case")]
pub enum DeployEnv {
    /// Production hosting.
    Prod,
    /// Staging hosting (the pre-release mirror of prod).
    Staging,
}

impl DeployEnv {
    /// The canonical environment name — the accepted flag value, the key the
    /// reference-builds lockfile groups by, and the backend's `TCAB_ENV` value it
    /// selects its entries with. Keeping these in one place keeps the three in
    /// lockstep.
    pub fn as_str(self) -> &'static str {
        match self {
            DeployEnv::Prod => "prod",
            DeployEnv::Staging => "staging",
        }
    }
}

#[derive(Debug, Args)]
#[command(disable_version_flag = true)]
pub struct PublishReferenceArgs {
    /// Deployment environment: which Cloudflare Pages project the reference
    /// implementation deploys to. **Required** — with no default a publish can
    /// never silently target prod, mirroring the `--env` flag on the operator
    /// shell scripts (for example `scripts/upload-subscription-creds.sh`).
    #[arg(long, value_enum, value_name = "ENV")]
    pub env: DeployEnv,

    /// Slug (or folder name) of the test case to publish a reference for (for
    /// example, `carom`).
    #[arg(value_name = "SLUG")]
    pub slug: String,

    /// Exact, immutable test case version. Omit to target the case's newest
    /// version.
    #[arg(value_name = "VERSION")]
    pub version: Option<String>,

    /// Publish the reference for exactly this variant (for example, `base`).
    /// Mutually exclusive with `--all-variants`; errors if the named variant has
    /// no reference implementation.
    #[arg(long, value_name = "VARIANT", conflicts_with = "all_variants")]
    pub variant: Option<String>,

    /// Publish the reference for every variant that declares one. This is also the
    /// default when neither `--variant` nor `--all-variants` is given.
    #[arg(long)]
    pub all_variants: bool,

    /// Print the plan — the targeted variants, their resolved reference-impl
    /// directories, and the deploy branch each would use — without building,
    /// deploying, scrubbing, or recording anything.
    #[arg(long)]
    pub dry_run: bool,

    /// Deploy without re-capturing the committed **baseline** validation media
    /// (`validation-baseline/<variant>/`), leaving whatever is committed in place.
    /// Use it when the baselines are known to be current for this build — the
    /// capture drives every debug script in a browser and dominates the command's
    /// runtime. To regenerate that media *without* deploying, use
    /// `tcab capture-baselines`.
    #[arg(long)]
    pub skip_baselines: bool,
}

/// Arguments for `tcab capture-baselines`.
///
/// The case/version/variant selection mirrors `tcab publish-reference` — the two
/// commands share their resolution, build, and capture helpers — minus everything
/// deployment-related: there is no `--env`, no Cloudflare project, and no lockfile
/// write, because regenerating committed baseline media is a purely local
/// authoring step.
///
/// `disable_version_flag` frees `--version`/`-V` so it is not consumed as clap's
/// auto-generated binary-version flag, matching `tcab publish-reference`.
#[derive(Debug, Args)]
#[command(disable_version_flag = true)]
pub struct CaptureBaselinesArgs {
    /// Slug (or folder name) of the test case to capture baselines for (for
    /// example, `carom`).
    #[arg(value_name = "SLUG")]
    pub slug: String,

    /// Exact, immutable test case version. Omit to target the case's newest
    /// version.
    #[arg(value_name = "VERSION")]
    pub version: Option<String>,

    /// Capture baselines for exactly this variant (for example, `base`). Mutually
    /// exclusive with `--all-variants`; errors if the named variant has no
    /// reference implementation.
    #[arg(long, value_name = "VARIANT", conflicts_with = "all_variants")]
    pub variant: Option<String>,

    /// Capture baselines for every variant that declares a reference
    /// implementation. This is also the default when neither `--variant` nor
    /// `--all-variants` is given.
    #[arg(long)]
    pub all_variants: bool,

    /// Print the plan — the targeted variants, their resolved reference-impl
    /// directories, and the baseline directory each would rewrite — without
    /// building or writing anything.
    #[arg(long)]
    pub dry_run: bool,
}

/// Arguments for `tcab analyze`.
///
/// `disable_version_flag` frees `--version`/`-V`, which would otherwise be clap's
/// binary-version flag and is confusing next to the *analyzer* version this command prints.
#[derive(Debug, Args)]
#[command(disable_version_flag = true)]
pub struct AnalyzeArgs {
    /// Root of the source tree to analyse (for example, `crates/gg`).
    #[arg(value_name = "DIR")]
    pub path: String,

    /// The commit that laid the workspace down, if this tree is a seeded run workspace.
    ///
    /// This is the exact top rung of the authored-set ladder: with it, the analysis measures
    /// only what was written *after* that commit. Omit it for an ordinary source tree, where
    /// every file is authored by definition.
    #[arg(long, value_name = "SHA")]
    pub seed_commit: Option<String>,

    /// Which state of the tree this is, recorded on the result so a mixed corpus stays
    /// sliceable.
    ///
    /// Defaults to `post-validation`, which is the only honest answer for a directory this
    /// command was simply pointed at: `pre-validation` is a claim that nothing has built in
    /// the tree yet, and only the run path can make it truthfully.
    #[arg(long, value_name = "BASIS", default_value = "post-validation")]
    pub tree_basis: TreeBasisArg,

    /// How many rows to show in each of the specific sections — the complex functions, the
    /// largest files, the cycles, the duplicate blocks.
    #[arg(long, value_name = "N", default_value_t = 10)]
    pub top: usize,

    /// Print the full analysis document as JSON instead of the report: every file, symbol,
    /// import edge, cycle and clone group, with the summary embedded.
    #[arg(long)]
    pub json: bool,
}

/// Which state of a tree `tcab analyze` is being pointed at.
///
/// Mirrors [`CodeTreeBasis`] so the CLI's accepted values stay in lockstep with the value
/// recorded in the analysis document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
#[value(rename_all = "kebab-case")]
pub enum TreeBasisArg {
    /// The tree as a run left it, with validation not yet run.
    PreValidation,
    /// The tree after something built in it — the safe assumption for any directory.
    PostValidation,
}

impl From<TreeBasisArg> for CodeTreeBasis {
    fn from(value: TreeBasisArg) -> Self {
        match value {
            TreeBasisArg::PreValidation => Self::PreValidation,
            TreeBasisArg::PostValidation => Self::PostValidation,
        }
    }
}

#[cfg(test)]
#[path = "cli.test.rs"]
mod tests;
