//! The `dc-skin` binary: the Dual Contouring skinned-character tool (high-fidelity,
//! sharp-feature surface character).
//!
//! It pins the [`DualContouring`](test_cabinet_model_skin::Algorithm::DualContouring)
//! algorithm and delegates the whole command surface — the whole-body CSG/SDF field ops
//! (including the DC-only `--sharp` tag), the skeleton/skin subcommands, the reused rig
//! animation subcommands, and the on-request `render` — to the shared
//! [`test_cabinet_model_skin::cli::run`]. There is **no `--part` flag**: a skinned
//! character is one field with one log. The Marching Cubes / Surface Nets siblings are
//! `mc-skin` / `sn-skin`. See
//! `apps/docs/src/content/docs/testing/asset-generation/skinned-binaries.md`.

use std::process::ExitCode;

use test_cabinet_model_skin::{Algorithm, run};

fn main() -> ExitCode {
    run(Algorithm::DualContouring, "dc-skin")
}
