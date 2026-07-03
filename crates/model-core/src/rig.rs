//! The on-disk rig the `voxel-anim` binary writes to `rig.json` and core reads.
//!
//! An animated voxel model is a **rig**: named [`Part`]s in a parent/child
//! hierarchy, each sculpted independently, named [`Joint`]s (degrees of freedom) a
//! consuming game or an animation drives, and named [`Animation`]s (F-curve
//! timelines the model authors). The manifest fixes the *required* parts, joints,
//! and animation declarations (the stable, game-facing contract and the scoring
//! targets); at run time the model authors each required animation's motion and may
//! add further parts, joints, and animations, all recorded here. `rig.json` is the
//! authoritative structure of an animated run alongside the per-part operation logs.
//!
//! These serde shapes are chosen to map cleanly onto core's resolved
//! `ModelSpec`/`JointSpec`/`DriveKindSpec`/`AnimationSpec` contract types (which
//! parse `rig.json` on their own side): `JointKind` and `Axis` serialize as their
//! lowercase names, a joint's [`Drive`] is exactly `caller` or `auto`, and a
//! keyframe's [`Interp`] is `constant`/`linear`/`bezier`/`ease-in`/`ease-out`/
//! `ease-in-out`. Actual JSON (de)serialization via `serde_json` is CLI-gated; the
//! plain serde derives stay available to core.

use serde::{Deserialize, Serialize};

use crate::axis::Axis;

/// A complete rig: the parts to sculpt, the joints that pose them, and the
/// model-authored animations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rig {
    /// The parts, in declared order. The first is the root (its `parent` is
    /// `None`); every other part names a declared parent.
    pub parts: Vec<Part>,
    /// The joints, in declared order. Each names a declared part.
    pub joints: Vec<Joint>,
    /// The animations, in declared order. Seeded from the case's required
    /// declarations (with empty [`Animation::tracks`]) and filled by the model.
    #[serde(default)]
    pub animations: Vec<Animation>,
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
/// A joint applies a **compound transform**: a fixed mount ([`Self::offset`]
/// translation and [`Self::orient`] rotation, applied at attach regardless of the
/// driven value) composed with the **driven** single-axis motion described by
/// [`Self::kind`]/[`Self::axis`]. Rotations are in radians about [`Self::axis`]
/// through [`Self::pivot`]; translations are in voxel units along the axis. The
/// valid range of the driven value is `[min, max]` and the neutral value is `rest`.
/// A joint whose driven range is empty (`min == max == rest`) but whose mount is
/// non-zero is a purely static attachment — how a component is mounted at a custom
/// rotation *and* translation.
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
    /// A fixed translation `[x, y, z]` (in voxels) this joint applies to the part in
    /// addition to its driven motion — the translation half of the compound mount.
    /// All-zero (the default) means no offset.
    #[serde(default, skip_serializing_if = "is_zero3")]
    pub offset: [f64; 3],
    /// A fixed rotation `[x, y, z]` (radians, applied as Euler X→Y→Z about
    /// [`Self::pivot`]) this joint applies in addition to its driven motion — the
    /// rotation half of the compound mount. All-zero (the default) means no rotation.
    #[serde(default, skip_serializing_if = "is_zero3")]
    pub orient: [f64; 3],
    /// Who drives this joint: a caller (a game) or the model's animations.
    pub drive: Drive,
}

/// Whether a fixed mount vector (`offset`/`orient`) is all zero, so it can be
/// omitted from `rig.json` for the common no-mount joint.
fn is_zero3(v: &[f64; 3]) -> bool {
    v.iter().all(|c| *c == 0.0)
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
/// is driven only by the model's [`Animation`]s, holding at `rest` until one
/// overlays it. Serializes to a bare string `caller` / `auto`, matching core's
/// `DriveKindSpec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Drive {
    /// A consuming game supplies the joint's value at runtime.
    Caller,
    /// The joint is driven only by the model's animations.
    Auto,
}

/// How an [`Animation`] F-curve segment interpolates between two keyframes, set on
/// the segment **leaving** each key. Serializes to `constant`/`linear`/`bezier`/
/// `ease-in`/`ease-out`/`ease-in-out`, matching core's `InterpSpec`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "cli", derive(clap::ValueEnum))]
pub enum Interp {
    /// Hold the value until the next key (a step).
    Constant,
    /// A straight line to the next key.
    Linear,
    /// A smooth cubic Bézier shaped by tangent handles (auto tangents when omitted).
    Bezier,
    /// Preset Bézier: start slow and accelerate into the next key.
    EaseIn,
    /// Preset Bézier: start fast and decelerate into the next key.
    EaseOut,
    /// Preset Bézier: ease both ends.
    EaseInOut,
}

/// A single keyframe of an [`Animation`] F-curve track: a joint value at a time
/// offset, with the interpolation of the segment leaving this key and optional
/// Bézier tangent handles.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    /// Time offset from the start of the animation, in milliseconds
    /// (`0..=period_ms`).
    pub t_ms: u32,
    /// The joint value at this time.
    pub value: f64,
    /// Interpolation of the segment **leaving** this key.
    pub interp: Interp,
    /// Bézier out-handle on this key as `[dt_ms, dvalue]`; `None` = auto tangent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out_handle: Option<[f64; 2]>,
    /// Bézier in-handle on this key as `[dt_ms, dvalue]`; `None` = auto tangent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_handle: Option<[f64; 2]>,
}

/// One track of an [`Animation`]: the F-curve keyframes that drive a single joint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// The joint this track drives (a declared [`Joint::name`]).
    pub joint: String,
    /// The keyframes, in time order over the animation's period.
    pub keyframes: Vec<Keyframe>,
}

/// A model-authored animation: a named F-curve timeline. Seeded from the case's
/// required declaration (its [`Self::joints`] set fixed, [`Self::tracks`] empty) and
/// filled by the model. Field JSON keys match core's `AnimationSpec` (`periodMs`,
/// `looping`, `autoPlay`, `joints`, `tracks`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Animation {
    /// Stable, unique name a game plays this animation by.
    pub name: String,
    /// The period in milliseconds — one full loop across every track.
    pub period_ms: u32,
    /// Whether the animation loops (true) or plays once and holds the last pose.
    pub looping: bool,
    /// Whether the animation plays continuously by default (a decorative idle) or is
    /// a named playable a game triggers.
    pub auto_play: bool,
    /// The joints the animation is **required** to drive.
    pub joints: Vec<String>,
    /// The authored F-curve tracks, one per driven joint. Empty for a pure required
    /// declaration.
    #[serde(default)]
    pub tracks: Vec<Track>,
}

impl Rig {
    /// An empty rig with no parts, joints, or animations.
    pub fn new() -> Rig {
        Rig {
            parts: Vec::new(),
            joints: Vec::new(),
            animations: Vec::new(),
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

    /// Create an animation, or update the metadata (period, loop, auto-play, joints)
    /// of the existing same-name animation **in place, preserving its authored
    /// tracks**. A new animation starts with no tracks; grow them with
    /// [`Self::add_keyframe`].
    pub fn upsert_animation(
        &mut self,
        name: &str,
        period_ms: u32,
        looping: bool,
        auto_play: bool,
        joints: Vec<String>,
    ) {
        if let Some(existing) = self.animations.iter_mut().find(|a| a.name == name) {
            existing.period_ms = period_ms;
            existing.looping = looping;
            existing.auto_play = auto_play;
            existing.joints = joints;
        } else {
            self.animations.push(Animation {
                name: name.to_string(),
                period_ms,
                looping,
                auto_play,
                joints,
                tracks: Vec::new(),
            });
        }
    }

    /// Add a keyframe to an animation's track for `joint` (creating the track on the
    /// joint's first keyframe), replacing any keyframe at the same `t_ms` and keeping
    /// the track sorted by `t_ms`. Returns `false` if no animation of that name
    /// exists.
    pub fn add_keyframe(&mut self, animation: &str, joint: &str, kf: Keyframe) -> bool {
        let Some(anim) = self.animations.iter_mut().find(|a| a.name == animation) else {
            return false;
        };
        let track = match anim.tracks.iter_mut().position(|t| t.joint == joint) {
            Some(i) => &mut anim.tracks[i],
            None => {
                anim.tracks.push(Track {
                    joint: joint.to_string(),
                    keyframes: Vec::new(),
                });
                anim.tracks.last_mut().expect("just pushed")
            }
        };
        match track.keyframes.iter().position(|k| k.t_ms == kf.t_ms) {
            Some(i) => track.keyframes[i] = kf,
            None => {
                let at = track
                    .keyframes
                    .iter()
                    .position(|k| k.t_ms > kf.t_ms)
                    .unwrap_or(track.keyframes.len());
                track.keyframes.insert(at, kf);
            }
        }
        true
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
