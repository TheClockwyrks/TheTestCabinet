//! The per-algorithm grid resolution and character each meshing tool samples its
//! field at.
//!
//! Output character is a fixed property of the binary, not a per-case knob: you pick
//! the tool for the fidelity you want. That choice reduces to two data values — how
//! finely the volume is sampled ([`GridConfig::cell_size`]) and whether the mesher
//! honors sharp-feature tags ([`GridConfig::honor_sharp`]) — captured here as one
//! preset per [`Algorithm`]. Marching cubes samples coarsely for a chunky, faceted
//! low-poly surface; surface nets samples at a medium resolution for a smooth,
//! rounded, watertight surface; dual contouring samples finely *and* honors the
//! sharp tags so crisp edges and corners survive.

use crate::field::{Dims, Resolution};

/// A surface-extraction algorithm, and thus a fixed output character.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algorithm {
    /// Marching cubes: coarse grid, chunky faceted low-poly surface.
    MarchingCubes,
    /// Surface nets: medium grid, smooth rounded watertight surface (no sharp edges).
    SurfaceNets,
    /// Dual contouring: fine grid plus sharp-feature preservation, high fidelity.
    DualContouring,
}

/// How a tool samples a field into a grid: the world-space size of one grid cell
/// (smaller is finer) and whether the mesher preserves sharp features. Each meshing
/// binary uses the preset for its [`Algorithm`]; it is never exposed as a per-run
/// flag.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GridConfig {
    /// The world-space edge length of one grid cell. The node count on an axis is
    /// derived from the volume extent divided by this, so a smaller cell means a
    /// finer grid and a higher-fidelity surface.
    pub cell_size: f32,
    /// Whether the mesher honors the DC-only sharp-feature tag carried on the field.
    /// Only dual contouring sets this; marching cubes and surface nets cannot
    /// represent sharp features and leave it `false`.
    pub honor_sharp: bool,
}

impl GridConfig {
    /// The coarse marching-cubes preset: a large cell for a chunky low-poly surface;
    /// sharp features are not honored.
    pub fn marching_cubes() -> GridConfig {
        GridConfig {
            cell_size: 2.0,
            honor_sharp: false,
        }
    }

    /// The medium surface-nets preset: a mid-size cell for a smooth, rounded surface;
    /// sharp features are not honored (surface nets rounds every feature).
    pub fn surface_nets() -> GridConfig {
        GridConfig {
            cell_size: 1.0,
            honor_sharp: false,
        }
    }

    /// The fine dual-contouring preset: a small cell plus sharp-feature preservation,
    /// for a high-fidelity surface with crisp edges and corners.
    pub fn dual_contouring() -> GridConfig {
        GridConfig {
            cell_size: 0.5,
            honor_sharp: true,
        }
    }

    /// The preset for `algorithm`.
    pub fn for_algorithm(algorithm: Algorithm) -> GridConfig {
        match algorithm {
            Algorithm::MarchingCubes => GridConfig::marching_cubes(),
            Algorithm::SurfaceNets => GridConfig::surface_nets(),
            Algorithm::DualContouring => GridConfig::dual_contouring(),
        }
    }

    /// The grid [`Resolution`] this config samples `bounds` at: each axis gets
    /// `round(extent / cell_size) + 1` nodes, floored to 2 so every axis has a valid
    /// spacing even when the volume is thinner than one cell.
    pub fn resolution(&self, bounds: &Dims) -> Resolution {
        Resolution {
            nx: axis_nodes(bounds.width, self.cell_size),
            ny: axis_nodes(bounds.height, self.cell_size),
            nz: axis_nodes(bounds.depth, self.cell_size),
        }
    }
}

/// The node count for an axis of `extent` world units sampled at `cell_size`: at
/// least 2, so the axis always has a defined spacing.
fn axis_nodes(extent: f32, cell_size: f32) -> u32 {
    if cell_size <= 0.0 {
        return 2;
    }
    let cells = (extent / cell_size).round().max(1.0);
    (cells as u32).saturating_add(1).max(2)
}
