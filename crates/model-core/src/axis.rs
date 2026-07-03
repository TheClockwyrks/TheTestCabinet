//! The principal-axis enum shared across the voxel family.
//!
//! `y` is the up axis; `x`/`z` are the two horizontal axes. It names the axis a
//! [`Joint`](crate::rig::Joint) rotates about or translates along, and the plane
//! normal of a mirror operation in the cube domain. It (de)serializes as its
//! lowercase name (`x`/`y`/`z`), matching core's `AxisSpec`.

use serde::{Deserialize, Serialize};

/// A principal axis.
///
/// `y` is the up axis, matching a voxel volume's `height`; `x`/`z` are the two
/// horizontal axes (`width`/`depth`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "cli", derive(clap::ValueEnum))]
pub enum Axis {
    /// The x axis (volume width).
    X,
    /// The y axis (volume height, up).
    Y,
    /// The z axis (volume depth).
    Z,
}
