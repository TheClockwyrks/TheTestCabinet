//! The skinning layer: automatic bone-heat weights, bone matrices, and the
//! linear-blend-skinning deform.
//!
//! These are the pieces the skinned family adds on top of the reused meshing +
//! rig stack. Weights are **derived** at render — a deterministic pure function of the
//! extracted mesh plus the skeleton — exactly as the mesh itself is a pure function of
//! the recorded field. Bone matrices are resolved by reusing `model-core`'s rig
//! [`pose_rig`](test_cabinet_model_core::pose::pose_rig): the skeleton is fed through
//! it as a part hierarchy (each bone a part, each joint targeting its bone), so the
//! skinned rig poses with exactly the same F-curve sampling, joint-compound-mount, and
//! pitch conventions as the rigid kinds — the one thing that differs is that a single
//! mesh is then **linear-blend-skinned** to the resulting bone matrices rather than
//! each part being transformed rigidly.

use std::collections::HashMap;

use glam::{Mat4, Vec3};

use test_cabinet_model_core::pose::pose_rig;
use test_cabinet_model_core::rig::{Part, Rig};

use crate::skeleton::{Bone, SkinnedRig, WeightOverride};

/// The fixed maximum number of bones that may influence one vertex.
pub const MAX_INFLUENCES: usize = 4;

/// A bone shorter than this (in field units) is treated as a zero-length **socket**
/// with no vertex influence — a position marker (for example an FPS `weapon_socket`)
/// the game attaches a separate asset to.
const SOCKET_LENGTH: f64 = 1.0e-6;

/// The falloff softening added to a squared distance so a vertex sitting exactly on a
/// bone gets a large but finite weight.
const FALLOFF_EPS: f32 = 1.0e-4;

/// One vertex's skin binding: up to [`MAX_INFLUENCES`] bone indices (into the rig's
/// bone list) and the matching normalized weights. Unused slots carry bone index `0`
/// and weight `0`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VertexSkin {
    /// The influencing bone indices (index into [`SkinnedRig::bones`]).
    pub joints: [u16; MAX_INFLUENCES],
    /// The matching skin weights, normalized to sum to one across the used slots.
    pub weights: [f32; MAX_INFLUENCES],
}

impl Default for VertexSkin {
    fn default() -> VertexSkin {
        VertexSkin {
            joints: [0; MAX_INFLUENCES],
            weights: [0.0; MAX_INFLUENCES],
        }
    }
}

/// Derive one [`VertexSkin`] per vertex by **bone-heat falloff weighting**: each vertex
/// is influenced by the nearest deforming bones with a smooth `1 / (d² + ε)` heat
/// falloff over the surface, capped at [`MAX_INFLUENCES`] and normalized so its weights
/// sum to one. Zero-length socket bones are excluded from the candidate set (they never
/// influence a vertex). Any [`WeightOverride`]s are layered on **after** the automatic
/// weights.
///
/// This is a deterministic pure function of `positions` (the extracted mesh) plus
/// `bones` and `overrides` (the recorded skeleton), so replaying a recorded log
/// reproduces identical weights.
pub fn compute_weights(
    positions: &[f32],
    bones: &[Bone],
    overrides: &[WeightOverride],
) -> Vec<VertexSkin> {
    let vertex_count = positions.len() / 3;
    // The deforming candidate bones (everything but zero-length sockets), each with its
    // world-space head/tail segment.
    let candidates: Vec<(usize, [f32; 3], [f32; 3])> = bones
        .iter()
        .enumerate()
        .filter(|(_, b)| b.length() > SOCKET_LENGTH)
        .map(|(i, b)| (i, to_f32(b.head), to_f32(b.tail)))
        .collect();

    let mut skins = Vec::with_capacity(vertex_count);
    for chunk in positions.chunks_exact(3) {
        let p = [chunk[0], chunk[1], chunk[2]];
        let mut influences = nearest_influences(p, &candidates, bones);
        apply_overrides(p, &mut influences, bones, overrides);
        skins.push(pack(&influences));
    }
    skins
}

/// The (bone index, normalized weight) influences for one vertex, before overrides.
fn nearest_influences(
    p: [f32; 3],
    candidates: &[(usize, [f32; 3], [f32; 3])],
    bones: &[Bone],
) -> Vec<(usize, f32)> {
    if candidates.is_empty() {
        // No deforming bone: fall back to the single nearest bone (by head distance) so
        // the mesh still rigidly follows the skeleton rather than vanishing.
        if let Some((idx, _)) = bones
            .iter()
            .enumerate()
            .map(|(i, b)| (i, dist2(p, to_f32(b.head))))
            .min_by(|a, b| a.1.total_cmp(&b.1))
        {
            return vec![(idx, 1.0)];
        }
        return Vec::new();
    }

    // A heat-like falloff on the distance to each bone segment.
    let mut ranked: Vec<(usize, f32)> = candidates
        .iter()
        .map(|(idx, head, tail)| {
            let d2 = point_segment_dist2(p, *head, *tail);
            (*idx, 1.0 / (d2 + FALLOFF_EPS))
        })
        .collect();
    // Keep the strongest few. `total_cmp` gives a deterministic order for equal keys.
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    ranked.truncate(MAX_INFLUENCES);
    normalize(&mut ranked);
    ranked
}

/// Apply the weight overrides whose region contains `p`, in order, renormalizing after
/// each so the influences still sum to one.
fn apply_overrides(
    p: [f32; 3],
    influences: &mut Vec<(usize, f32)>,
    bones: &[Bone],
    overrides: &[WeightOverride],
) {
    for over in overrides {
        if !region_contains(over.region, p) {
            continue;
        }
        let Some(bone_idx) = bones.iter().position(|b| b.name == over.bone) else {
            continue;
        };
        force_weight(influences, bone_idx, over.weight.clamp(0.0, 1.0) as f32);
    }
}

/// Force `bone_idx` to weight `w` for this vertex, distributing the remaining `1 - w`
/// across the other influences (proportionally, or entirely onto the pinned bone when
/// there are none). Keeps at most [`MAX_INFLUENCES`] influences.
fn force_weight(influences: &mut Vec<(usize, f32)>, bone_idx: usize, w: f32) {
    if !influences.iter().any(|(i, _)| *i == bone_idx) {
        if influences.len() < MAX_INFLUENCES {
            influences.push((bone_idx, 0.0));
        } else if let Some(min_pos) = influences
            .iter()
            .enumerate()
            .min_by(|a, b| a.1.1.total_cmp(&b.1.1))
            .map(|(pos, _)| pos)
        {
            influences[min_pos] = (bone_idx, 0.0);
        }
    }

    let others_sum: f32 = influences
        .iter()
        .filter(|(i, _)| *i != bone_idx)
        .map(|(_, x)| *x)
        .sum();
    let has_others = others_sum > 0.0;
    for (i, x) in influences.iter_mut() {
        if *i == bone_idx {
            // With no other influence to carry the remainder, the pinned bone takes it
            // all so the vertex stays normalized.
            *x = if has_others { w } else { 1.0 };
        } else if has_others {
            *x = *x / others_sum * (1.0 - w);
        } else {
            *x = 0.0;
        }
    }
}

/// Normalize a set of influences so their weights sum to one (a no-op on an all-zero or
/// empty set).
fn normalize(influences: &mut [(usize, f32)]) {
    let sum: f32 = influences.iter().map(|(_, w)| *w).sum();
    if sum > 0.0 {
        for (_, w) in influences.iter_mut() {
            *w /= sum;
        }
    }
}

/// Pack up to four influences into a fixed [`VertexSkin`], padding unused slots.
fn pack(influences: &[(usize, f32)]) -> VertexSkin {
    let mut skin = VertexSkin::default();
    for (slot, (idx, w)) in influences.iter().take(MAX_INFLUENCES).enumerate() {
        skin.joints[slot] = *idx as u16;
        skin.weights[slot] = *w;
    }
    skin
}

/// Whether the axis-aligned region `[x, y, z, w, h, d]` (min corner + extents) contains
/// point `p`.
fn region_contains(region: [f64; 6], p: [f32; 3]) -> bool {
    let min = [region[0] as f32, region[1] as f32, region[2] as f32];
    let max = [
        min[0] + region[3] as f32,
        min[1] + region[4] as f32,
        min[2] + region[5] as f32,
    ];
    (0..3).all(|a| p[a] >= min[a] && p[a] <= max[a])
}

/// A `[f64; 3]` bone coordinate as `[f32; 3]`.
fn to_f32(v: [f64; 3]) -> [f32; 3] {
    [v[0] as f32, v[1] as f32, v[2] as f32]
}

/// Squared distance between two points.
fn dist2(a: [f32; 3], b: [f32; 3]) -> f32 {
    let d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
}

/// Squared distance from point `p` to the segment `a`→`b`.
fn point_segment_dist2(p: [f32; 3], a: [f32; 3], b: [f32; 3]) -> f32 {
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    let ab_len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    if ab_len2 <= 0.0 {
        return dist2(p, a);
    }
    let t = ((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab_len2).clamp(0.0, 1.0);
    let proj = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    dist2(p, proj)
}

/// Build the equivalent `model-core` [`Rig`] whose **parts are this rig's bones**
/// (name and parent), so the shared [`pose_rig`] resolves one world matrix per bone.
/// The joints — whose [`Part`](test_cabinet_model_core::rig::Part)-shaped `part` field
/// names the bone they drive — and the animations carry over unchanged.
fn to_bone_rig(rig: &SkinnedRig) -> Rig {
    Rig {
        parts: rig
            .bones
            .iter()
            .map(|b| Part {
                name: b.name.clone(),
                parent: b.parent.clone(),
                // `pose_rig` does not read a part's pivot (parts pose in place); the
                // bone's own pivot lives on its joints, so a placeholder is fine.
                pivot: [0, 0, 0],
            })
            .collect(),
        joints: rig.joints.clone(),
        animations: rig.animations.clone(),
    }
}

/// The **bind** (rest-pose) world matrix of each bone, in bone order — every joint at
/// its `rest` value.
pub fn bind_matrices(rig: &SkinnedRig) -> Vec<Mat4> {
    let bone_rig = to_bone_rig(rig);
    let rest = HashMap::new();
    pose_rig(&bone_rig, &rest)
        .into_iter()
        .map(|(_, m)| m)
        .collect()
}

/// The **inverse-bind** matrix of each bone, in bone order — `inverse(bindWorld)`, the
/// glTF skin's `inverseBindMatrices`.
pub fn inverse_bind_matrices(rig: &SkinnedRig) -> Vec<Mat4> {
    bind_matrices(rig).into_iter().map(|m| m.inverse()).collect()
}

/// The **skinning** matrix of each bone at the given caller/animation values, in bone
/// order — `poseWorld · inverseBind`, the matrix a vertex bound to that bone is
/// transformed by. At rest this is the identity, so an un-posed mesh is undeformed.
pub fn skinning_matrices(rig: &SkinnedRig, caller: &HashMap<String, f64>) -> Vec<Mat4> {
    let bone_rig = to_bone_rig(rig);
    let world = pose_rig(&bone_rig, caller);
    let ibm = inverse_bind_matrices(rig);
    world
        .into_iter()
        .zip(ibm)
        .map(|((_, w), inv)| w * inv)
        .collect()
}

/// The **local** bind transform of each bone node for the glTF skeleton, in bone order:
/// `inverse(bindWorld(parent)) · bindWorld(self)` (or `bindWorld(self)` for a root), so
/// composing them down the node hierarchy reproduces each bone's bind world.
pub fn bone_node_locals(rig: &SkinnedRig) -> Vec<Mat4> {
    let world = bind_matrices(rig);
    let idx_by_name: HashMap<&str, usize> = rig
        .bones
        .iter()
        .enumerate()
        .map(|(i, b)| (b.name.as_str(), i))
        .collect();
    rig.bones
        .iter()
        .enumerate()
        .map(|(i, b)| match &b.parent {
            Some(parent) => match idx_by_name.get(parent.as_str()) {
                Some(&pi) => world[pi].inverse() * world[i],
                None => world[i],
            },
            None => world[i],
        })
        .collect()
}

/// Linear-blend-skin a mesh's `positions` and `normals` by the per-vertex `skins` and
/// the per-bone skinning `mats`: each vertex is transformed by the weighted blend of its
/// influencing bones' matrices. Returns fresh position and normal arrays (normals are
/// renormalized). A vertex with no influence is left in place.
pub fn lbs_deform(
    positions: &[f32],
    normals: &[f32],
    skins: &[VertexSkin],
    mats: &[Mat4],
) -> (Vec<f32>, Vec<f32>) {
    let vertex_count = positions.len() / 3;
    let mut out_pos = Vec::with_capacity(positions.len());
    let mut out_norm = Vec::with_capacity(normals.len());
    for vi in 0..vertex_count {
        let skin = skins.get(vi).copied().unwrap_or_default();
        let mut blend = Mat4::ZERO;
        let mut total = 0.0f32;
        for slot in 0..MAX_INFLUENCES {
            let w = skin.weights[slot];
            if w == 0.0 {
                continue;
            }
            if let Some(m) = mats.get(skin.joints[slot] as usize) {
                blend += *m * w;
                total += w;
            }
        }
        let m = if total > 0.0 { blend } else { Mat4::IDENTITY };

        let p = &positions[vi * 3..vi * 3 + 3];
        let v = m.transform_point3(Vec3::new(p[0], p[1], p[2]));
        out_pos.extend_from_slice(&[v.x, v.y, v.z]);

        if vi * 3 + 3 <= normals.len() {
            let n = &normals[vi * 3..vi * 3 + 3];
            let tn = m
                .transform_vector3(Vec3::new(n[0], n[1], n[2]))
                .normalize_or_zero();
            out_norm.extend_from_slice(&[tn.x, tn.y, tn.z]);
        }
    }
    (out_pos, out_norm)
}

#[cfg(test)]
#[path = "skin.test.rs"]
mod tests;
