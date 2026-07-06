//! Tests for the automatic bone-heat weighting and the linear-blend-skinning math.

use std::collections::HashMap;

use glam::Mat4;

use super::*;
use crate::skeleton::{Bone, SkinnedRig, WeightOverride};
use test_cabinet_model_core::axis::Axis;
use test_cabinet_model_core::rig::{Drive, Joint, JointKind};

/// A vertical arm skeleton: an upper bone stacked on a lower bone, plus a zero-length
/// socket sharing the root's head (a `weapon_socket`-style empty bone).
fn arm_bones() -> Vec<Bone> {
    vec![
        Bone {
            name: "lower".into(),
            parent: None,
            head: [0.0, 0.0, 0.0],
            tail: [0.0, 5.0, 0.0],
            roll: 0.0,
        },
        Bone {
            name: "upper".into(),
            parent: Some("lower".into()),
            head: [0.0, 5.0, 0.0],
            tail: [0.0, 10.0, 0.0],
            roll: 0.0,
        },
        Bone {
            name: "socket".into(),
            parent: Some("upper".into()),
            head: [0.0, 10.0, 0.0],
            tail: [0.0, 10.0, 0.0], // zero length → a socket with no vertex influence
            roll: 0.0,
        },
    ]
}

/// A column of vertices running up the arm.
fn column_positions() -> Vec<f32> {
    let mut p = Vec::new();
    for y in [0.0f32, 2.5, 5.0, 7.5, 10.0] {
        p.extend_from_slice(&[0.0, y, 0.0]);
    }
    p
}

fn nonzero_count(skin: &VertexSkin) -> usize {
    skin.weights.iter().filter(|w| **w > 0.0).count()
}

fn weight_sum(skin: &VertexSkin) -> f32 {
    skin.weights.iter().sum()
}

#[test]
fn weights_normalize_to_one() {
    let bones = arm_bones();
    let positions = column_positions();
    let skins = compute_weights(&positions, &bones, &[]);
    assert_eq!(skins.len(), positions.len() / 3);
    for skin in &skins {
        assert!(
            (weight_sum(skin) - 1.0).abs() < 1.0e-5,
            "each vertex's weights sum to one, got {}",
            weight_sum(skin)
        );
    }
}

#[test]
fn at_most_four_influences() {
    // Six deforming bones fanned around the origin, so every vertex could in principle
    // be reached by all six — the cap must still hold.
    let mut bones = Vec::new();
    for (i, dir) in [
        [1.0, 0.0, 0.0],
        [-1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, -1.0],
    ]
    .into_iter()
    .enumerate()
    {
        bones.push(Bone {
            name: format!("b{i}"),
            parent: None,
            head: [0.0, 0.0, 0.0],
            tail: dir,
            roll: 0.0,
        });
    }
    let positions = vec![0.1f32, 0.1, 0.1, 0.3, -0.2, 0.05, -0.4, 0.0, 0.2];
    let skins = compute_weights(&positions, &bones, &[]);
    for skin in &skins {
        assert!(
            nonzero_count(skin) <= MAX_INFLUENCES,
            "at most {MAX_INFLUENCES} influences, got {}",
            nonzero_count(skin)
        );
        assert!((weight_sum(skin) - 1.0).abs() < 1.0e-5);
    }
}

#[test]
fn socket_bone_has_no_influence_but_is_representable() {
    let bones = arm_bones();
    let positions = column_positions();
    let skins = compute_weights(&positions, &bones, &[]);

    // The socket is bone index 2. No vertex may weight to it.
    let socket = 2u16;
    for skin in &skins {
        for slot in 0..MAX_INFLUENCES {
            if skin.joints[slot] == socket {
                assert_eq!(
                    skin.weights[slot], 0.0,
                    "the zero-length socket bone carries no vertex weight"
                );
            }
        }
    }

    // It is still a representable joint: the rig exports an inverse-bind matrix for it.
    let rig = SkinnedRig {
        skinned: true,
        bones,
        joints: Vec::new(),
        animations: Vec::new(),
        weight_overrides: Vec::new(),
    };
    assert_eq!(inverse_bind_matrices(&rig).len(), 3);
}

#[test]
fn override_pins_a_region_to_a_bone() {
    let bones = arm_bones();
    // One vertex near the bottom (naturally weighted to `lower`), pinned fully to
    // `upper` (bone index 1) by a covering override.
    let positions = vec![0.0f32, 1.0, 0.0];
    let over = WeightOverride {
        bone: "upper".into(),
        region: [-1.0, -1.0, -1.0, 2.0, 4.0, 2.0],
        weight: 1.0,
    };
    let skins = compute_weights(&positions, &bones, std::slice::from_ref(&over));
    let skin = skins[0];
    let upper_weight: f32 = (0..MAX_INFLUENCES)
        .filter(|&k| skin.joints[k] == 1)
        .map(|k| skin.weights[k])
        .sum();
    assert!(
        (upper_weight - 1.0).abs() < 1.0e-5,
        "the override pins the vertex fully to `upper`, got {upper_weight}"
    );
    assert!((weight_sum(&skin) - 1.0).abs() < 1.0e-5);
}

#[test]
fn rest_pose_skinning_matrices_are_identity() {
    // A rig with a driven joint: at rest the skinning matrices must be identity, so an
    // un-posed mesh is undeformed.
    let rig = SkinnedRig {
        skinned: true,
        bones: arm_bones(),
        joints: vec![Joint {
            name: "elbow".into(),
            part: "upper".into(),
            kind: JointKind::Rotation,
            axis: Axis::X,
            pivot: [0, 5, 0],
            min: -1.0,
            max: 1.0,
            rest: 0.0,
            offset: [0.0, 0.0, 0.0],
            orient: [0.0, 0.0, 0.0],
            drive: Drive::Auto,
        }],
        animations: Vec::new(),
        weight_overrides: Vec::new(),
    };
    let rest = HashMap::new();
    for m in skinning_matrices(&rig, &rest) {
        let d = m - Mat4::IDENTITY;
        let max = d.to_cols_array().iter().fold(0.0f32, |a, x| a.max(x.abs()));
        assert!(
            max < 1.0e-5,
            "rest skinning matrix is identity, off by {max}"
        );
    }
}

#[test]
fn lbs_with_identity_matrices_is_a_no_op() {
    let positions = column_positions();
    let normals: Vec<f32> = positions
        .chunks_exact(3)
        .flat_map(|_| [0.0f32, 1.0, 0.0])
        .collect();
    let bones = arm_bones();
    let skins = compute_weights(&positions, &bones, &[]);
    let mats = vec![Mat4::IDENTITY; bones.len()];
    let (pos, _norm) = lbs_deform(&positions, &normals, &skins, &mats);
    for (a, b) in pos.iter().zip(&positions) {
        assert!(
            (a - b).abs() < 1.0e-4,
            "identity LBS leaves positions in place"
        );
    }
}
