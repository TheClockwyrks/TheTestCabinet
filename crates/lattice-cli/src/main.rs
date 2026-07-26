//! The `lattice` binary: the oracle, the submission scorer, a scenario generator,
//! and the schema dumper for the Lattice performance test case.
//!
//! This is a thin clap wrapper. The simulation rules and the canonical
//! state/checksum live in [`lattice_core`]; the wasm sandbox and the
//! correct/incorrect + fuel scoring live in [`lattice_host`]; this crate only
//! parses arguments, reads/writes files, and (for `gen`) lays out a deterministic
//! scenario. Because `lattice run` uses `lattice-host` — the same host the
//! validator uses — a model gets the exact correct/incorrect + fuel signal the
//! case will score it on.
//!
//! Subcommands (mirroring the architecture doc):
//! - `solve` — run the reference engine (the **oracle**) on a scenario and write
//!   the canonical `state` (the array of snapshots) to `--out` or stdout.
//! - `run` — load a submission module, run it on a scenario via `lattice-host`,
//!   diff its checksums against the reference, and print correct/incorrect + fuel.
//! - `gen` — emit a fresh, deterministic, valid scenario from a `--seed`.
//! - `schema scenario|state` — dump a JSON Schema straight from `lattice-core`.

mod generate;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use lattice_core::schema::{scenario_schema_string, state_schema_string};
use lattice_core::{Engine, Scenario, Snapshot};
use lattice_host::{SandboxLimits, run_submission, score_against};

/// `lattice` — the oracle, scorer, generator, and schema dumper for the Lattice
/// performance test case.
#[derive(Debug, Parser)]
#[command(name = "lattice", version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the reference engine on a scenario and write the expected `state`.
    Solve(SolveArgs),
    /// Run a submission module on a scenario, diff against the reference, and
    /// report correct/incorrect + fuel.
    Run(RunArgs),
    /// Generate a fresh, deterministic, valid scenario from a seed.
    Gen(GenArgs),
    /// Write a `scenario` or `state` JSON Schema to stdout or a file.
    Schema(SchemaArgs),
}

/// Arguments for `lattice solve`.
#[derive(Debug, Parser)]
struct SolveArgs {
    /// The scenario JSON to solve.
    #[arg(long, value_name = "FILE")]
    scenario: PathBuf,
    /// Where to write the expected `state` JSON (the array of snapshots). Omit for
    /// stdout.
    #[arg(long, value_name = "FILE")]
    out: Option<PathBuf>,
}

/// Arguments for `lattice run`.
#[derive(Debug, Parser)]
struct RunArgs {
    /// The submission wasm module (a `wasm32-unknown-unknown` core module).
    #[arg(long, value_name = "FILE")]
    module: PathBuf,
    /// The scenario JSON to run the submission on.
    #[arg(long, value_name = "FILE")]
    scenario: PathBuf,
    /// The contract entry the submission exports (the manifest's `[contract] entry`).
    #[arg(long, default_value = "simulate")]
    entry: String,
    /// The per-scenario wasmtime fuel ceiling.
    #[arg(long, default_value_t = SandboxLimits::default().fuel_limit)]
    fuel_limit: u64,
    /// The linear-memory cap (bytes).
    #[arg(long, default_value_t = SandboxLimits::default().max_memory_bytes)]
    max_memory_bytes: usize,
}

/// Arguments for `lattice gen`.
#[derive(Debug, Parser)]
struct GenArgs {
    /// The seed the layout is generated from. Decimal or `0x…` hex. Same seed +
    /// flags always produces the identical scenario.
    #[arg(long, value_name = "HEX")]
    seed: String,
    /// The grid dimensions as `WxH`, e.g. `64x64`.
    #[arg(long, value_name = "WxH", default_value = "64x64")]
    grid: String,
    /// The number of ticks to simulate.
    #[arg(long, value_name = "N", default_value_t = 100_000)]
    ticks: u64,
    /// Which layout strategy to lay down: `lines` (independent east-flowing belt
    /// lines) or `bus` (an interconnected main-bus factory).
    #[arg(long, value_enum, default_value = "lines")]
    layout: generate::Layout,
    /// Where to write the scenario JSON. Omit for stdout.
    #[arg(long, value_name = "FILE")]
    out: Option<PathBuf>,
}

/// Arguments for `lattice schema`.
#[derive(Debug, Parser)]
struct SchemaArgs {
    /// Which schema to emit.
    #[arg(value_enum)]
    which: SchemaKind,
    /// Write to this file instead of stdout.
    #[arg(long, value_name = "FILE")]
    out: Option<PathBuf>,
}

/// The two contract schemas the case seeds.
#[derive(Debug, Clone, Copy, ValueEnum)]
enum SchemaKind {
    /// The scenario handed to a submission.
    Scenario,
    /// The state (array of snapshots) a submission returns.
    State,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Solve(args) => solve(args),
        Command::Run(args) => run(args),
        Command::Gen(args) => generate_scenario(args),
        Command::Schema(args) => schema(args),
    }
}

/// Run the reference engine on a scenario and write the expected `state` — the
/// oracle path the case author uses to produce a held-out `expected` answer.
fn solve(args: SolveArgs) -> Result<()> {
    let scenario = read_scenario(&args.scenario)?;
    let snapshots = Engine::solve(&scenario);
    let text = encode_state(&snapshots)?;
    match &args.out {
        Some(path) => {
            write_out(path, &text)?;
            eprintln!(
                "solved {} snapshot(s) -> {}",
                snapshots.len(),
                path.display()
            );
        }
        None => print!("{text}"),
    }
    Ok(())
}

/// Load a submission module, run it on a scenario via `lattice-host`, and diff its
/// checksums against the reference. Prints `correct` / `INCORRECT …` and the fuel
/// consumed. Exits non-zero on an incorrect (or un-runnable) submission so a
/// caller can gate on it.
fn run(args: RunArgs) -> Result<()> {
    let scenario = read_scenario(&args.scenario)?;
    let module = std::fs::read(&args.module)
        .with_context(|| format!("reading submission module {}", args.module.display()))?;

    let limits = SandboxLimits {
        fuel_limit: args.fuel_limit,
        max_memory_bytes: args.max_memory_bytes,
    };

    // Score against the oracle using the same comparison the validator uses: run
    // the reference once, run the submission, compare per-snapshot checksums.
    let expected = Engine::solve(&scenario);
    let submission_run = run_submission(&module, &scenario, limits, &args.entry)
        .with_context(|| format!("running submission {}", args.module.display()))?;
    let score = score_against(&expected, &submission_run);

    if score.correct {
        println!("correct");
        println!("fuel: {}", group_thousands(score.fuel));
    } else {
        match (&score.detail, score.first_mismatch_tick) {
            (Some(detail), Some(tick)) => {
                println!("INCORRECT at snapshot tick {tick} ({detail})")
            }
            (Some(detail), None) => println!("INCORRECT ({detail})"),
            _ => println!("INCORRECT"),
        }
        // Fuel is still reported for diagnostics even when the answer is wrong.
        println!("fuel: {}", group_thousands(score.fuel));
        std::process::exit(1);
    }
    Ok(())
}

/// Generate a fresh deterministic scenario from the seed and write it.
fn generate_scenario(args: GenArgs) -> Result<()> {
    let seed = parse_seed(&args.seed).with_context(|| format!("parsing --seed {:?}", args.seed))?;
    let (width, height) = parse_grid(&args.grid)?;
    let scenario = generate::scenario_with_layout(seed, width, height, args.ticks, args.layout)
        .context("generating the scenario")?;
    // The generator must only ever emit valid scenarios — verify before writing so
    // a generator bug surfaces here, not deep in a downstream solve.
    scenario
        .validate()
        .map_err(|err| anyhow::anyhow!("generated an invalid scenario: {err}"))?;

    let text = serde_json::to_string_pretty(&scenario).context("encoding the scenario")?;
    let text = format!("{text}\n");
    match &args.out {
        Some(path) => {
            write_out(path, &text)?;
            eprintln!(
                "generated a {width}x{height}, {}-tick scenario with {} entities -> {}",
                args.ticks,
                scenario.entities.len(),
                path.display()
            );
        }
        None => print!("{text}"),
    }
    Ok(())
}

/// Emit a contract schema.
fn schema(args: SchemaArgs) -> Result<()> {
    let text = match args.which {
        SchemaKind::Scenario => scenario_schema_string(),
        SchemaKind::State => state_schema_string(),
    };
    match args.out {
        Some(path) => write_out(&path, &text)?,
        None => print!("{text}"),
    }
    Ok(())
}

/// Read and validate a scenario from disk.
fn read_scenario(path: &Path) -> Result<Scenario> {
    let bytes =
        std::fs::read(path).with_context(|| format!("reading scenario {}", path.display()))?;
    Scenario::parse(&bytes)
        .map_err(|err| anyhow::anyhow!("{err}"))
        .with_context(|| format!("parsing scenario {}", path.display()))
}

/// Encode the `state` (the array of snapshots) as the canonical pretty JSON, with
/// a trailing newline, matching the seeded expected-answer format.
fn encode_state(snapshots: &[Snapshot]) -> Result<String> {
    let text = serde_json::to_string_pretty(snapshots).context("encoding the state")?;
    Ok(format!("{text}\n"))
}

/// Parse a `WxH` grid spec into `(width, height)`.
fn parse_grid(spec: &str) -> Result<(i32, i32)> {
    let (w, h) = spec
        .split_once(['x', 'X'])
        .with_context(|| format!("--grid must be WxH (got {spec:?})"))?;
    let width: i32 = w
        .trim()
        .parse()
        .with_context(|| format!("--grid width {w:?} is not an integer"))?;
    let height: i32 = h
        .trim()
        .parse()
        .with_context(|| format!("--grid height {h:?} is not an integer"))?;
    if width <= 0 || height <= 0 {
        anyhow::bail!("--grid dimensions must be positive (got {width}x{height})");
    }
    Ok((width, height))
}

/// Parse `seed` from its string form. Accepts decimal and `0x…` hex (mirroring
/// Foray's `parse_seed` and the `--seed 0xFAC7` the architecture doc shows).
fn parse_seed(seed: &str) -> Result<u64> {
    let trimmed = seed.trim();
    let value = if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16)
    } else {
        trimmed.parse()
    };
    value.with_context(|| format!("seed {seed:?} is not a decimal or 0x… hex integer"))
}

/// Format a fuel count with thousands separators for the human-readable summary
/// (e.g. `12,345,678`).
fn group_thousands(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    let len = digits.len();
    for (i, ch) in digits.chars().enumerate() {
        // A comma precedes every group of three counted from the right: insert one
        // before position `i` when the number of digits remaining (`len - i`) is a
        // positive multiple of three and we are not at the very start.
        if i != 0 && (len - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

/// Write `text` to `path`, creating the parent directory if needed.
fn write_out(path: &Path, text: &str) -> Result<()> {
    create_parent(path)?;
    std::fs::write(path, text).with_context(|| format!("writing {}", path.display()))
}

/// Create `path`'s parent directory if it has one and it does not already exist,
/// so a `--out` like `runs/x/expected.json` does not fail on a missing directory.
fn create_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "main.test.rs"]
mod tests;
