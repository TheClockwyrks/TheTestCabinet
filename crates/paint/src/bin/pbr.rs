//! The `pbr` CLI: the derivation and assembly tool for a material run. It bakes a
//! normal/AO/curvature map from a painted height field, sets uniform scalar maps,
//! assembles `material.json`, and renders the lit 3D preview of the assembled
//! material applied to a test surface by triplanar projection. The bakes and uniform
//! are ordinary log operations (they replay in a preview); the 3D `render` is the
//! one on-request, deferred render. Shares the operation log and config with the
//! `texture` binary. See
//! `apps/docs/src/content/docs/testing/asset-generation/material-binaries.md`.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use test_cabinet_model_core::color::PreviewBackground;
use test_cabinet_paint::op::Op;
use test_cabinet_paint::preview3d::{self, MaterialMaps, Shape};
use test_cabinet_paint::raster::Raster;
use test_cabinet_paint::{cli, config::MaterialConfig};

const PREVIEW_SIZE: u32 = 512;

#[derive(Parser)]
#[command(name = "pbr", about = "Bake, set uniforms, assemble material.json, and render the lit preview.")]
struct Cli {
    /// Path to the seeded material config JSON (shared with `texture`).
    #[arg(long, default_value = "material.config.json", global = true)]
    config: PathBuf,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Bake a tangent-space normal map from a height channel (writes `normal`).
    BakeNormal {
        #[arg(long, default_value = "height")]
        from: String,
        #[arg(long, default_value_t = 1.0)]
        strength: f32,
    },
    /// Bake ambient occlusion from a height channel (writes `ao`).
    BakeAo {
        #[arg(long, default_value = "height")]
        from: String,
        #[arg(long, default_value_t = 4)]
        radius: u32,
    },
    /// Bake curvature from a height channel (writes `curvature`).
    BakeCurvature {
        #[arg(long, default_value = "height")]
        from: String,
    },
    /// Fill a scalar map with a constant value (0..1).
    SetUniform {
        #[arg(long)]
        map: String,
        #[arg(long)]
        value: f32,
    },
    /// Assemble `material.json` (maps, color spaces, tiling scale).
    Assemble {
        #[arg(long, default_value_t = 1.0)]
        tiling: f32,
    },
    /// Render the lit 3D preview (or, with `--map`, one map flat 2x2-tiled).
    Render {
        /// The preview surface.
        #[arg(long, default_value = "sphere")]
        shape: String,
        /// Inspect one map flat (2x2-tiled) instead of the 3D surface.
        #[arg(long)]
        map: Option<String>,
        /// Where to write the preview PNG.
        #[arg(long, default_value = "preview.png")]
        out: PathBuf,
        /// World-space tiles per unit for the triplanar projection.
        #[arg(long, default_value_t = 1.0)]
        tiling: f32,
    },
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(message) => {
            if !message.is_empty() {
                println!("{message}");
            }
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("pbr: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<String, String> {
    match cli.command {
        Command::BakeNormal { from, strength } => cli::apply_material_op(
            &cli.config,
            Some("normal".to_string()),
            Op::BakeNormal { from, strength },
        ),
        Command::BakeAo { from, radius } => cli::apply_material_op(
            &cli.config,
            Some("ao".to_string()),
            Op::BakeAo { from, radius },
        ),
        Command::BakeCurvature { from } => cli::apply_material_op(
            &cli.config,
            Some("curvature".to_string()),
            Op::BakeCurvature { from },
        ),
        Command::SetUniform { map, value } => {
            cli::apply_material_op(&cli.config, Some(map), Op::SetUniform { value })
        }
        Command::Assemble { tiling } => {
            let config: MaterialConfig = cli::read_config(&cli.config)?;
            cli::recomposite_material(&cli.config)?;
            cli::write_material_json(&config.material_json, &config, tiling)?;
            Ok(format!("assembled material.json ({} maps)", config.maps.len()))
        }
        Command::Render { shape, map, out, tiling } => render(&cli.config, &shape, map, &out, tiling),
    }
}

fn render(
    config_path: &std::path::Path,
    shape: &str,
    inspect: Option<String>,
    out: &std::path::Path,
    tiling: f32,
) -> Result<String, String> {
    let config: MaterialConfig = cli::read_config(config_path)?;
    let template = config.workspace()?;
    let actions = cli::read_actions(&config.actions)?;

    // Flat single-map inspection: write that map, 2x2-tiled.
    if let Some(map) = inspect {
        let composite = cli::composite_target(&template, &actions, &map)?;
        let tiled = cli::tile_2x2(&composite);
        cli::write_png(&tiled, out)?;
        return Ok(format!("wrote {map} inspection to {}", out.display()));
    }

    let shape = Shape::parse(shape)?;
    let background = PreviewBackground::parse(&config.background).map_err(|e| e.to_string())?;
    let base = cli::composite_target(&template, &actions, "base-color")?;
    let ao = optional_map(&config, &template, &actions, "ao")?;
    let emissive = optional_map(&config, &template, &actions, "emissive")?;
    let maps = MaterialMaps {
        base_color: &base,
        ao: ao.as_ref(),
        emissive: emissive.as_ref(),
        tiling,
    };
    let png = preview3d::render(shape, &maps, background, PREVIEW_SIZE)?;
    cli::write_png_bytes(&png, out)?;
    if let Some(live) = &config.live {
        cli::send_live_preview(live, 0, "render", actions.len(), &png);
    }
    Ok(format!("rendered {shape:?} preview to {}", out.display()))
}

/// Composite an optional declared map, or `None` when the material doesn't carry it.
fn optional_map(
    config: &MaterialConfig,
    template: &test_cabinet_paint::layer::Workspace,
    actions: &[test_cabinet_paint::op::Action],
    name: &str,
) -> Result<Option<Raster>, String> {
    if config.maps.iter().any(|m| m == name) {
        Ok(Some(cli::composite_target(template, actions, name)?))
    } else {
        Ok(None)
    }
}
