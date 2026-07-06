//! The `mc-skin` binary: the Marching Cubes skinned-character tool (low-poly surface
//! character).
//!
//! It pins the [`MarchingCubes`](test_cabinet_model_skin::Algorithm::MarchingCubes)
//! algorithm and delegates the whole command surface — the whole-body CSG/SDF field
//! ops, the skeleton/skin subcommands, the reused rig animation subcommands, and the
//! on-request `render` — to the shared [`test_cabinet_model_skin::cli::run`]. There is
//! **no `--part` flag**: a skinned character is one field with one log. The Surface
//! Nets / Dual Contouring siblings are `sn-skin` / `dc-skin`. See
//! `apps/docs/src/content/docs/testing/asset-generation/skinned-binaries.md`.

use std::process::ExitCode;

use test_cabinet_model_skin::{Algorithm, run};

fn main() -> ExitCode {
    run(Algorithm::MarchingCubes, "mc-skin")
}
