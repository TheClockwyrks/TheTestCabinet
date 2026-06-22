//! The `foray` binary: load two controller wasm modules and a map, run **one**
//! match, and write the replay.
//!
//! This is a thin clap wrapper over [`foray_host`] — all of the wasm sandbox and
//! the per-tick simulation loop live there so the core validator can reuse the
//! exact same host (lead decision 7). This crate only parses arguments, reads the
//! map and the two modules off disk, and writes the resulting `replay.json`.
//!
//! It also exposes a `schema` helper that dumps the controller contract's
//! `world`/`action` JSON Schemas straight from `foray-core`, so a case author can
//! seed a verbatim copy that can never drift from the engine's types.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use foray_core::board::{Board, BoardParams};
use foray_core::config::{BoardParamsSerde, Rules, Simulation};
use foray_core::contract::{action_schema_string, world_schema_string};
use foray_core::replay::parse_seed;
use foray_host::{DecidedBy, MatchSetup, SandboxLimits, run_match};

/// `foray` — run a single Foray match between two controllers and produce its
/// replay.
#[derive(Debug, Parser)]
#[command(name = "foray", version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run one match between two controller wasm modules and write the replay.
    Simulate(SimulateArgs),
    /// Write a controller-contract JSON Schema (`world` or `action`) to stdout or
    /// a file, straight from `foray-core`'s types.
    Schema(SchemaArgs),
}

/// Arguments for `foray simulate`.
#[derive(Debug, Parser)]
struct SimulateArgs {
    /// Red's controller wasm module (conventionally the submission).
    #[arg(long, value_name = "FILE")]
    red: PathBuf,
    /// Blue's controller wasm module (conventionally the baseline opponent).
    #[arg(long, value_name = "FILE")]
    blue: PathBuf,
    /// The map TOML to play on (e.g. `crates/foray-core/maps/mirror-32x16.toml`).
    #[arg(long, value_name = "FILE")]
    map: PathBuf,
    /// The seed recorded in the replay so a reconstructor regenerates the
    /// identical maze. Decimal or `0x…` hex. Defaults to the map's own seed.
    #[arg(long, value_name = "HEX")]
    seed: Option<String>,
    /// Where to write the replay JSON.
    #[arg(long, value_name = "FILE")]
    out: PathBuf,
    /// The contract entry the controllers export (the manifest's `[contract] entry`).
    #[arg(long, default_value = "tick")]
    entry: String,
    /// The per-tick wasmtime fuel ceiling applied to every controller invocation.
    #[arg(long, default_value_t = SandboxLimits::default().fuel_per_tick)]
    fuel_per_tick: u64,
    /// The linear-memory cap (bytes) applied to every controller.
    #[arg(long, default_value_t = SandboxLimits::default().max_memory_bytes)]
    max_memory_bytes: usize,
    /// The model/controller id recorded as Red (site-facing provenance).
    #[arg(long, default_value = "red")]
    red_id: String,
    /// The model/controller id recorded as Blue.
    #[arg(long, default_value = "blue")]
    blue_id: String,
}

/// Arguments for `foray schema`.
#[derive(Debug, Parser)]
struct SchemaArgs {
    /// Which contract schema to emit.
    #[arg(value_enum)]
    which: SchemaKind,
    /// Write to this file instead of stdout.
    #[arg(long, value_name = "FILE")]
    out: Option<PathBuf>,
}

/// The two controller-contract schemas the case seeds.
#[derive(Debug, Clone, Copy, ValueEnum)]
enum SchemaKind {
    /// The per-tick observation handed to a controller.
    World,
    /// The actions a controller may return each tick.
    Action,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Simulate(args) => simulate(args),
        Command::Schema(args) => schema(args),
    }
}

/// Load the map and both modules, run the match, and write the replay.
fn simulate(args: SimulateArgs) -> Result<()> {
    let map_text = std::fs::read_to_string(&args.map)
        .with_context(|| format!("reading map {}", args.map.display()))?;
    let loaded = Board::from_map(&map_text)
        .map_err(|err| anyhow::anyhow!("{err}"))
        .with_context(|| format!("loading map {}", args.map.display()))?;

    let seed = match &args.seed {
        Some(text) => parse_seed(text).with_context(|| format!("parsing --seed {text:?}"))?,
        None => loaded.seed,
    };

    // The replay records the seed + board params so a reconstructor (the browser)
    // regenerates the identical maze from the seed alone — playback never ships or
    // parses the map TOML, it only re-runs the generator. So the board the match is
    // played on must be exactly the one that seed regenerates:
    //
    // - With no `--seed` (or a `--seed` equal to the map's baked seed) the loaded,
    //   committed geometry is played, and we *verify* the generator reproduces it
    //   from that seed (a mismatch would mean playback drew a different maze).
    // - With a *different* `--seed` the operator is asking to explore a fresh maze;
    //   the committed file's geometry no longer applies, so we generate the board
    //   from that seed (keeping the map's id and dimensions) and play *that*. The
    //   recorded seed regenerates it identically in the browser, so the replay is
    //   reproducible either way.
    let (board, board_params) = playable_board(loaded, seed)?;

    let red_wasm = std::fs::read(&args.red)
        .with_context(|| format!("reading red module {}", args.red.display()))?;
    let blue_wasm = std::fs::read(&args.blue)
        .with_context(|| format!("reading blue module {}", args.blue.display()))?;

    let setup = MatchSetup {
        entry: args.entry,
        limits: SandboxLimits {
            fuel_per_tick: args.fuel_per_tick,
            max_memory_bytes: args.max_memory_bytes,
        },
        map_id: board.id.clone(),
        seed,
        board_params,
        red_id: args.red_id,
        blue_id: args.blue_id,
        rules: Rules::default(),
        sim: Simulation::default(),
    };

    let summary = run_match(&red_wasm, &blue_wasm, board, &setup).context("running the match")?;

    create_parent(&args.out)?;
    std::fs::write(&args.out, summary.replay.to_json())
        .with_context(|| format!("writing replay {}", args.out.display()))?;

    let result = &summary.replay.result;
    // The reported winner applies the efficiency tie-break: a level-score time-limit
    // match is won by the leaner controller, so print *that* verdict (and why) rather
    // than the rules engine's bare "draw".
    let decided = summary.decided();
    let winner = match (decided.winner, decided.by) {
        (Some(team), DecidedBy::Efficiency) => format!("{team:?} wins on efficiency"),
        (Some(team), _) => format!("{team:?} wins"),
        (None, _) => "draw".to_string(),
    };
    println!(
        "match decided after {} ticks: {winner} ({:?})",
        result.ticks, result.ended,
    );
    println!(
        "  score: red {}, blue {}",
        result.score.red, result.score.blue
    );
    // Report each controller's peak per-tick fuel against the ceiling, so a model
    // can tell "comfortably within budget" from "one heavy tick from a forfeit" and
    // size its per-tick work (raise `--fuel-per-tick` to explore how far over the
    // limit an over-budget controller runs). The whole-match total is the efficiency
    // figure the tie-break compares — the lower total wins a level-score draw.
    let fuel = &summary.fuel;
    println!(
        "  peak fuel/tick: red {} ({:.0}%), blue {} ({:.0}%) of {} ceiling",
        fuel.red_peak,
        percent(fuel.red_peak, fuel.ceiling),
        fuel.blue_peak,
        percent(fuel.blue_peak, fuel.ceiling),
        fuel.ceiling,
    );
    println!(
        "  total fuel: red {}, blue {}",
        fuel.red_total, fuel.blue_total,
    );
    // A forfeit is the one outcome the replay alone cannot explain (it records only
    // `Ended::Forfeit`), so when the host reports one, print which team forfeited,
    // on what tick, and the exact reason (fuel/memory/trap/bad action). This is the
    // signal the model needs to fix a controller that disqualifies itself.
    if let Some(forfeit) = &summary.forfeit {
        for (team, reason) in [("red", &forfeit.red), ("blue", &forfeit.blue)] {
            if let Some(reason) = reason {
                println!("  forfeit: {team} at tick {} — {reason}", forfeit.tick);
            }
        }
    }
    println!("  replay written to {}", args.out.display());
    Ok(())
}

/// Resolve the board the match is actually played on, paired with the generator
/// params recorded in the replay so the browser regenerates the identical maze
/// from `seed` alone.
///
/// If `seed` reproduces the `loaded` committed geometry under the default params,
/// the committed board is played as-is. Otherwise `seed` names a *different* maze
/// than the file holds, so we generate the board from `seed` (keeping the map's id
/// and dimensions) and play that — the recorded seed regenerates it identically on
/// playback. Either branch yields a board that the replay's seed reconstructs
/// exactly, which is the property the browser relies on.
fn playable_board(loaded: Board, seed: u64) -> Result<(Board, BoardParamsSerde)> {
    // The shipped maps use the default generator params at the loaded board's own
    // dimensions; that is the only family of maps a replay can reconstruct.
    let params = BoardParams {
        width: loaded.width,
        height: loaded.height,
        ..BoardParams::default()
    };

    let generated = Board::generate(loaded.id.clone(), params, seed);
    if generated == loaded {
        // Seed reproduces the committed file: play the committed geometry.
        return Ok((loaded, params.into()));
    }

    // A seed that does not reproduce the committed file is a request for a fresh,
    // reproducible maze. Play the generated board (it round-trips through the seed
    // on playback by construction). This still rejects nothing the browser could
    // not reconstruct — `generated` *is* what the seed regenerates.
    Ok((generated, params.into()))
}

/// `used` as a percentage of `ceiling` (0 when the ceiling is 0, to avoid a
/// divide-by-zero in the unreachable zero-fuel case).
fn percent(used: u64, ceiling: u64) -> f64 {
    if ceiling == 0 {
        0.0
    } else {
        used as f64 / ceiling as f64 * 100.0
    }
}

/// Emit a contract schema.
fn schema(args: SchemaArgs) -> Result<()> {
    let text = match args.which {
        SchemaKind::World => world_schema_string(),
        SchemaKind::Action => action_schema_string(),
    };
    match args.out {
        Some(path) => write_out(&path, &text)?,
        None => print!("{text}"),
    }
    Ok(())
}

/// Write `text` to `path`, creating the parent directory if needed.
fn write_out(path: &Path, text: &str) -> Result<()> {
    create_parent(path)?;
    std::fs::write(path, text).with_context(|| format!("writing {}", path.display()))
}

/// Create `path`'s parent directory if it has one and it does not already exist,
/// so a `--out` like `runs/x/replay.json` does not fail on a missing directory.
fn create_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    Ok(())
}
