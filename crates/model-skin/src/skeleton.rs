//! The on-disk skinned rig the skinning binaries write to `rig.json` and core reads.
//!
//! A skinned model is a [`SkinnedRig`]: a `skinned` marker, a hierarchy of [`Bone`]s
//! (the skeleton that deforms the one continuous mesh), the reused rig
//! [`Joint`]s (degrees of freedom a game or an animation drives — each targeting a
//! bone), the reused [`Animation`]s (F-curve timelines), and any optional
//! [`WeightOverride`]s. It is the exact analogue of the meshed-animation
//! [`Rig`](test_cabinet_model_core::rig::Rig) — same joints, same animations — with the
//! rigid `parts` list replaced by a `bones` list and a `skinned: true` marker that
//! tells a consumer this rig deforms **one mesh** by linear-blend skinning rather than
//! posing rigid parts.
//!
//! The [`Joint`], [`Animation`], [`Keyframe`], and [`Track`] shapes are reused
//! verbatim from `test-cabinet-model-core`, so a joint's `part` field carries the name
//! of the **bone** it drives — the skinned analogue of the part a rigid joint moves.
//! The serde shapes map onto core's resolved `ModelSpec`/`JointSpec`/`AnimationSpec`
//! contract exactly as the rigid rig's do.

use serde::{Deserialize, Serialize};

use test_cabinet_model_core::rig::{Animation, Joint, Keyframe, Track};

/// One bone of the skeleton: a `head`→`tail` segment in a parent/child hierarchy.
///
/// The **head** is the bone's default joint pivot; the **tail** sets its direction and
/// length. A bone with a zero-length segment (`head == tail`) is a pure **socket** — a
/// position marker with **no vertex influence** (for example an FPS `weapon_socket` the
/// game hangs a separate weapon on) — and is excluded from the automatic weighting
/// while still exported as a joint node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bone {
    /// Stable name of this bone (for example `pelvis`, `upper_arm_l`).
    pub name: String,
    /// The parent bone this one attaches under, or `None` for the root bone (the
    /// first bone defined).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// The bone's head — its default joint pivot — in field coordinates `[x, y, z]`.
    pub head: [f64; 3],
    /// The bone's tail, which sets its direction and length, in field coordinates.
    pub tail: [f64; 3],
    /// Twist about the bone's own axis, in radians.
    #[serde(default)]
    pub roll: f64,
}

impl Bone {
    /// The bone's length (the head→tail distance).
    pub fn length(&self) -> f64 {
        let d = [
            self.tail[0] - self.head[0],
            self.tail[1] - self.head[1],
            self.tail[2] - self.head[2],
        ];
        (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()
    }
}

/// An optional manual skin-weight override for a region the automatic weighting gets
/// wrong (for example pinning a helmet fully rigid to the head bone). Recorded and
/// **applied after** the automatic weights.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightOverride {
    /// The bone whose influence is being pinned in the region.
    pub bone: String,
    /// The axis-aligned region as `[x, y, z, w, h, d]`: the minimum corner and the
    /// full extents, in field coordinates.
    pub region: [f64; 6],
    /// The weight (0..1) to force for `bone` over that region.
    pub weight: f64,
}

/// A complete skinned rig: the skeleton, the joints that pose it, the model-authored
/// animations, and any weight overrides.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinnedRig {
    /// Always `true`: marks this rig as deforming **one mesh** by linear-blend skinning
    /// rather than posing rigid parts.
    pub skinned: bool,
    /// The bones, in declared order. The first is the root (its `parent` is `None`);
    /// every other bone names a declared parent.
    pub bones: Vec<Bone>,
    /// The joints, in declared order. Each names the bone it drives (in [`Joint::part`]).
    pub joints: Vec<Joint>,
    /// The animations, in declared order. Seeded from the case's required declarations
    /// (with empty tracks) and filled by the model.
    #[serde(default)]
    pub animations: Vec<Animation>,
    /// Optional manual weight overrides, applied after the automatic weighting.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weight_overrides: Vec<WeightOverride>,
}

impl SkinnedRig {
    /// An empty skinned rig: the `skinned` marker set, no bones/joints/animations.
    pub fn new() -> SkinnedRig {
        SkinnedRig {
            skinned: true,
            bones: Vec::new(),
            joints: Vec::new(),
            animations: Vec::new(),
            weight_overrides: Vec::new(),
        }
    }

    /// Add a bone, or update its parent if a bone of that name already exists,
    /// preserving its head/tail/roll. A new bone starts as a zero-length socket at the
    /// origin; position it with [`Self::set_bone`].
    pub fn upsert_bone(&mut self, name: &str, parent: Option<String>) {
        if let Some(bone) = self.bones.iter_mut().find(|b| b.name == name) {
            bone.parent = parent;
        } else {
            self.bones.push(Bone {
                name: name.to_string(),
                parent,
                head: [0.0, 0.0, 0.0],
                tail: [0.0, 0.0, 0.0],
                roll: 0.0,
            });
        }
    }

    /// Set an existing bone's head, tail, and roll. Returns `false` if no such bone
    /// exists.
    pub fn set_bone(&mut self, name: &str, head: [f64; 3], tail: [f64; 3], roll: f64) -> bool {
        match self.bones.iter_mut().find(|b| b.name == name) {
            Some(b) => {
                b.head = head;
                b.tail = tail;
                b.roll = roll;
                true
            }
            None => false,
        }
    }

    /// The head of the named bone, if it exists — the default pivot of a joint on it.
    pub fn bone_head(&self, name: &str) -> Option<[f64; 3]> {
        self.bones.iter().find(|b| b.name == name).map(|b| b.head)
    }

    /// Add a joint, or replace the existing joint of the same name in place.
    pub fn upsert_joint(&mut self, joint: Joint) {
        if let Some(existing) = self.joints.iter_mut().find(|j| j.name == joint.name) {
            *existing = joint;
        } else {
            self.joints.push(joint);
        }
    }

    /// Create an animation, or update the metadata of the existing same-name animation
    /// in place, preserving its authored tracks.
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
    /// the track sorted by `t_ms`. Returns `false` if no animation of that name exists.
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

    /// Add a weight override, or replace the existing override on the same bone and
    /// region in place.
    pub fn add_weight_override(&mut self, over: WeightOverride) {
        if let Some(existing) = self
            .weight_overrides
            .iter_mut()
            .find(|o| o.bone == over.bone && o.region == over.region)
        {
            *existing = over;
        } else {
            self.weight_overrides.push(over);
        }
    }
}

impl Default for SkinnedRig {
    fn default() -> SkinnedRig {
        SkinnedRig::new()
    }
}

/// File I/O for `rig.json`, used only by the skinning binaries. Core parses `rig.json`
/// with its own contract types, so this stays behind the `cli` feature alongside the
/// rest of the `serde_json` usage.
#[cfg(feature = "cli")]
mod io {
    use std::fs;
    use std::path::Path;

    use super::SkinnedRig;

    impl SkinnedRig {
        /// Read a skinned rig from `path`, treating an absent file as an empty rig so
        /// the first rig subcommand of a run does not need a separate `init`.
        pub fn load(path: &Path) -> Result<SkinnedRig, String> {
            match fs::read_to_string(path) {
                Ok(raw) => serde_json::from_str(&raw)
                    .map_err(|err| format!("invalid rig {}: {err}", path.display())),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(SkinnedRig::new()),
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
