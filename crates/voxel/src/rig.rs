//! The on-disk rig the `voxel-anim` binary writes to `rig.json` and core reads.
//!
//! An animated voxel model is a **rig**: named [`Part`]s in a parent/child
//! hierarchy, each sculpted independently, plus named [`Joint`]s (degrees of
//! freedom) a consuming game or an auto-play clip drives. The manifest fixes the
//! *required* parts and joints (the stable, game-facing contract and the scoring
//! targets); at run time the model may add further parts, joints, and auto-play
//! clips, all recorded here. `rig.json` is the authoritative structure of an
//! animated run alongside the per-part operation logs.
//!
//! These serde shapes are chosen to map cleanly onto core's resolved
//! `ModelSpec`/`JointSpec`/`DriveKindSpec`/`AutoPlaySpec` contract types (which
//! parse `rig.json` on their own side): `JointKind` and `Axis` serialize as their
//! lowercase names, and a joint's [`Drive`] tag is exactly `caller` or `auto`.
//! Actual JSON (de)serialization via `serde_json` is CLI-gated; the plain serde
//! derives stay available to core.

use serde::{Deserialize, Serialize};

use crate::ops::Axis;

/// A complete rig: the parts to sculpt and the joints that pose them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rig {
    /// The parts, in declared order. The first is the root (its `parent` is
    /// `None`); every other part names a declared parent.
    pub parts: Vec<Part>,
    /// The joints, in declared order. Each names a declared part.
    pub joints: Vec<Joint>,
}

/// One named voxel component of the rig.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    /// Stable name of this part (for example `chassis`, `turret`). The `voxel-anim`
    /// binary targets a part's voxel operations with `--part <name>`.
    pub name: String,
    /// The parent part this one is attached to, or `None` for the root part.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// The part's attachment point, in the **shared volume's coordinates** — the
    /// same coordinates the part is sculpted in (`[x, y, z]`). Parts are sculpted in
    /// place where they sit on the assembled model, so this is not a placement
    /// offset; it is the anchor the part's joints rotate about.
    pub pivot: [i64; 3],
}

/// One named degree of freedom on a part.
///
/// Rotations are in radians about [`Self::axis`] through [`Self::pivot`];
/// translations are in voxel units along the axis. The valid range is
/// `[min, max]` and the neutral value is `rest`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Joint {
    /// Stable name of this joint; the parameter a game addresses (for example
    /// `turret_yaw`).
    pub name: String,
    /// The part this joint moves (a declared [`Part::name`]).
    pub part: String,
    /// Whether this joint rotates or translates the part.
    pub kind: JointKind,
    /// The axis the joint acts about (rotation) or along (translation).
    pub axis: Axis,
    /// The joint origin — the point it rotates about — in the **shared volume's
    /// coordinates**, the same coordinates the part is sculpted in (`[x, y, z]`).
    pub pivot: [i64; 3],
    /// Minimum value: radians for a rotation, voxel units for a translation.
    pub min: f64,
    /// Maximum value.
    pub max: f64,
    /// The rest/default value, within `[min, max]`.
    pub rest: f64,
    /// Who drives this joint: a caller (a game) or an auto-play clip.
    pub drive: Drive,
}

/// Whether a [`Joint`] rotates or translates its part.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "cli", derive(clap::ValueEnum))]
pub enum JointKind {
    /// Rotate the part about [`Joint::axis`] through [`Joint::pivot`].
    Rotation,
    /// Translate the part along [`Joint::axis`].
    Translation,
}

/// Who drives a [`Joint`].
///
/// A `caller` joint is left to a consuming game to pose at runtime; an `auto` joint
/// carries the looping keyframe clip the model defined for it. The tag values
/// (`caller` / `auto`) match core's `DriveKindSpec`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Drive {
    /// A consuming game supplies the joint's value at runtime.
    Caller,
    /// The joint animates itself from a looping keyframe clip.
    #[serde(rename = "auto")]
    AutoPlay {
        /// The keyframes, in time order, sampled over one period.
        keyframes: Vec<Keyframe>,
        /// The clip period in milliseconds (one full loop). Serialized as
        /// `periodMs` to match core's `AutoPlaySpec`.
        #[serde(rename = "periodMs")]
        period_ms: u32,
        /// Whether the clip loops (true) or holds the last keyframe (false).
        /// Serialized as `looping` to match core's `AutoPlaySpec`.
        #[serde(rename = "looping")]
        r#loop: bool,
    },
}

/// A single keyframe within an auto-play [`Drive::AutoPlay`] clip: a joint value at
/// a time offset from the start of the clip.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    /// Time offset from the start of the clip, in milliseconds (`0..=period_ms`).
    pub t_ms: u32,
    /// The joint value at this time.
    pub value: f64,
}

impl Rig {
    /// An empty rig with no parts and no joints.
    pub fn new() -> Rig {
        Rig {
            parts: Vec::new(),
            joints: Vec::new(),
        }
    }

    /// Add a part, or update its parent if a part of that name already exists,
    /// preserving its pivot. A new part starts at the origin pivot `[0, 0, 0]`;
    /// set it with [`Self::set_pivot`].
    pub fn upsert_part(&mut self, name: &str, parent: Option<String>) {
        if let Some(part) = self.parts.iter_mut().find(|p| p.name == name) {
            part.parent = parent;
        } else {
            self.parts.push(Part {
                name: name.to_string(),
                parent,
                pivot: [0, 0, 0],
            });
        }
    }

    /// Set an existing part's pivot. Returns `false` if no such part exists.
    pub fn set_pivot(&mut self, part: &str, pivot: [i64; 3]) -> bool {
        match self.parts.iter_mut().find(|p| p.name == part) {
            Some(p) => {
                p.pivot = pivot;
                true
            }
            None => false,
        }
    }

    /// Add a joint, or replace the existing joint of the same name in place
    /// (keeping its declared position).
    pub fn upsert_joint(&mut self, joint: Joint) {
        if let Some(existing) = self.joints.iter_mut().find(|j| j.name == joint.name) {
            *existing = joint;
        } else {
            self.joints.push(joint);
        }
    }
}

impl Default for Rig {
    fn default() -> Rig {
        Rig::new()
    }
}

/// File I/O for `rig.json`, used only by the `voxel-anim` binary. Core parses
/// `rig.json` with its own contract types, so this stays behind the `cli` feature
/// alongside the rest of the `serde_json` usage.
#[cfg(feature = "cli")]
mod io {
    use std::fs;
    use std::path::Path;

    use super::Rig;

    impl Rig {
        /// Read a rig from `path`, treating an absent file as an empty rig so the
        /// first rig subcommand of a run does not need a separate `init`.
        pub fn load(path: &Path) -> Result<Rig, String> {
            match fs::read_to_string(path) {
                Ok(raw) => serde_json::from_str(&raw)
                    .map_err(|err| format!("invalid rig {}: {err}", path.display())),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Rig::new()),
                Err(err) => Err(format!("reading {}: {err}", path.display())),
            }
        }

        /// Write the rig as pretty JSON, creating parent directories as needed.
        pub fn save(&self, path: &Path) -> Result<(), String> {
            if let Some(parent) = path.parent()
                && !parent.as_os_str().is_empty()
            {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("creating {}: {err}", parent.display()))?;
            }
            let mut json = serde_json::to_string_pretty(self)
                .map_err(|err| format!("serializing rig: {err}"))?;
            json.push('\n');
            fs::write(path, json).map_err(|err| format!("writing {}: {err}", path.display()))
        }
    }
}
