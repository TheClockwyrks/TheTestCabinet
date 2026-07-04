//! The `mc` CLI: the only way a single static marching-cubes asset-generation run
//! makes a mark.
//!
//! The model calls this binary once per operation — `mc add-sphere --cx 8 …` — and
//! each call **only** appends the [`FieldOp`](test_cabinet_voxel_mesh::FieldOp) to the
//! run's `actions.json`. It renders **nothing** automatically: compositing the field,
//! extracting its surface with marching cubes, and rasterizing it through the
//! wgpu+Mesa renderer is far more expensive than stamping 2D pixels, and a model takes
//! many operations, so rendering is an explicit, on-request step — the `render`
//! command — that the model runs to inspect its work and, before finishing, to emit
//! the mesh `.glb` the run's result is built from. The recorded log is always the
//! single source of truth. The operation subcommands' `--help` is the contract; no
//! operations schema is seeded.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_mc::cli::{self, Config, OpCommand, RenderArgs};

/// The marching-cubes tool for single static-model asset-generation test cases.
#[derive(Parser)]
#[command(
    name = "mc",
    about = "Sculpt a marching-cubes field model one operation at a time (render on request)."
)]
struct Cli {
    /// Path to the volume config JSON (`{ width, height, depth, background, actions,
    /// preview, mesh }`). Read by `init`, `render`, and every field operation.
    #[arg(long, default_value = "mc.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Initialize the field: write an empty action log so the run starts from a known,
    /// empty state. Renders nothing — run `render` to produce a preview.
    Init,
    /// Render the model from its recorded log on request: mesh it to the `.glb` and
    /// draw a preview PNG. Nothing renders automatically, so run this to see your
    /// work and, before finishing, to emit the geometry the result is built from.
    Render(RenderArgs),
    /// Record one field operation: append it to the action log. This is all it does —
    /// it renders nothing; run `render` when you want to see the model.
    #[command(flatten)]
    Op(OpCommand),
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("mc: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Command::Init => {
            let config: Config = cli::read_config(&cli.config)?;
            cli::init_log(&config.actions)?;
            println!(
                "initialized {}x{}x{} field (run `render` to draw a preview)",
                config.width, config.height, config.depth
            );
            Ok(())
        }
        Command::Render(args) => {
            let config: Config = cli::read_config(&cli.config)?;
            let rendered = args.run(&config)?;
            // A single static model is part 0. Streaming is best-effort and a no-op
            // when the run has no live viewer (no `live` in the seeded config).
            if let Some(live) = &config.live {
                let count = cli::read_actions(&config.actions)
                    .map(|ops| ops.len())
                    .unwrap_or(0);
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
            let field_op = op.into_field_op();
            let name = field_op.name();
            let count = cli::record(&config.actions, field_op)?;
            println!(
                "recorded {name} ({count} operation{} in the log)",
                if count == 1 { "" } else { "s" }
            );
            Ok(())
        }
    }
}
