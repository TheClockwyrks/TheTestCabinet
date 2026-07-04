//! The `voxel` CLI: the only way a single static-model asset-generation run makes
//! a mark.
//!
//! The model calls this binary once per operation — `voxel fill-box --x 4 …` — and
//! each call **only** appends the operation to the run's `actions.json`. It renders
//! **nothing** automatically: meshing a volume and rasterizing it through the
//! wgpu+Mesa renderer is far more expensive than stamping 2D pixels, and a voxel
//! model takes many operations, so rendering is an explicit, on-request step — the
//! `render` command — that the model runs to inspect its work and, before finishing,
//! to emit the mesh `.glb` the run's result is built from. The recorded log is always
//! the single source of truth: after the run, `crates/core` replays it through the
//! same [`test_cabinet_voxel`] library to count the occupied voxels, so a volume
//! produced any other way cannot match. The operation subcommands' `--help` is the
//! contract; no operations schema is seeded. `render` emits a face-culled cube `.glb`
//! (the geometry the 3D client renders) alongside the preview.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_voxel::cli::{self, Config, OpCommand, RenderArgs};

/// The sculpting tool for single static-model asset-generation test cases.
#[derive(Parser)]
#[command(
    name = "voxel",
    about = "Sculpt a voxel model one operation at a time (render on request)."
)]
struct Cli {
    /// Path to the volume config JSON (`{ width, height, depth, background,
    /// actions, preview, mesh }`). Read by `init`, `render`, and every operation.
    #[arg(long, default_value = "voxel.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Initialize the volume: write an empty action log so the run starts from a
    /// known, empty state. Renders nothing — run `render` to produce a preview.
    Init,
    /// Render the model from its recorded log on request: mesh it to the `.glb` and
    /// draw a preview PNG. Nothing renders automatically, so run this to see your
    /// work and, before finishing, to emit the geometry the result is built from.
    Render(RenderArgs),
    /// Record one sculpting operation: append it to the action log. This is all it
    /// does — it renders nothing; run `render` when you want to see the model.
    #[command(flatten)]
    Op(OpCommand),
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("voxel: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Init => {
            let config: Config = cli::read_config(&cli.config)?;
            let dims = cli::dims(config.extents());
            cli::init_log(&config.actions)?;
            println!(
                "initialized {}x{}x{} volume (run `render` to draw a preview)",
                dims.width, dims.height, dims.depth
            );
            Ok(())
        }
        Command::Render(args) => {
            let config: Config = cli::read_config(&cli.config)?;
            let rendered = args.run(&config)?;
            // A single static model is part 0. Streaming is best-effort and a no-op
            // when the run has no live viewer (no `live` in the seeded config).
            if let Some(live) = &config.live {
                let count = cli::read_actions(&config.actions).map(|ops| ops.len()).unwrap_or(0);
                cli::send_live_preview(
                    &live.endpoint,
                    &live.token,
                    0,
                    "render",
                    count,
                    &rendered.image,
                    &rendered.live_body,
                );
            }
            println!("rendered model");
            Ok(())
        }
        Command::Op(op) => {
            let config: Config = cli::read_config(&cli.config)?;
            let name = op.name();
            let count = cli::record(&config.actions, op.into_operation())?;
            println!(
                "recorded {name} ({count} operation{} in the log)",
                if count == 1 { "" } else { "s" }
            );
            Ok(())
        }
    }
}
