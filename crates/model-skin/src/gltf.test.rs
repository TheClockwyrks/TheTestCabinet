//! Tests for the skinned `.glb` encoder and its decoder.

use glam::Mat4;

use super::*;
use crate::skeleton::Bone;
use crate::skin::VertexSkin;
use test_cabinet_model_core::glb_to_part_mesh;

fn two_bones() -> Vec<Bone> {
    vec![
        Bone {
            name: "root".into(),
            parent: None,
            head: [0.0, 0.0, 0.0],
            tail: [0.0, 5.0, 0.0],
            roll: 0.0,
        },
        Bone {
            name: "tip".into(),
            parent: Some("root".into()),
            head: [0.0, 5.0, 0.0],
            tail: [0.0, 10.0, 0.0],
            roll: 0.0,
        },
    ]
}

#[test]
fn skinned_glb_round_trips_mesh_and_skin() {
    let positions = vec![0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let normals = vec![0.0f32, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
    let colors = vec![1.0f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    let indices = vec![0u32, 1, 2];
    let skins = vec![
        VertexSkin {
            joints: [0, 1, 0, 0],
            weights: [1.0, 0.0, 0.0, 0.0],
        },
        VertexSkin {
            joints: [0, 1, 0, 0],
            weights: [0.5, 0.5, 0.0, 0.0],
        },
        VertexSkin {
            joints: [1, 0, 0, 0],
            weights: [1.0, 0.0, 0.0, 0.0],
        },
    ];
    let bones = two_bones();
    let node_locals = vec![Mat4::IDENTITY, Mat4::from_translation(glam::Vec3::new(0.0, 5.0, 0.0))];
    let ibm = vec![Mat4::IDENTITY, Mat4::from_translation(glam::Vec3::new(0.0, -5.0, 0.0))];

    let glb = skinned_glb(
        &positions, &normals, &colors, &indices, &skins, &bones, &node_locals, &ibm,
    );
    assert_eq!(&glb[0..4], b"glTF", "starts with the glTF magic");
    assert_eq!(glb.len() % 4, 0, "the glb is 4-byte aligned");

    // The base mesh decodes through the shared per-part decoder.
    let base = glb_to_part_mesh(&glb).expect("decode base mesh");
    assert_eq!(base.positions, positions);
    assert_eq!(base.normals, normals);
    assert_eq!(base.colors, colors);
    assert_eq!(base.indices, indices);

    // The skin decodes through the skinned decoder.
    let skin = decode_skinned_glb(&glb).expect("decode skin");
    assert_eq!(skin.skin_joint_count, 2, "the skin lists both bones");
    assert_eq!(skin.inverse_bind_count, 2, "one inverse-bind matrix per bone");
    assert_eq!(skin.joints.len(), 3);
    assert_eq!(skin.weights.len(), 3);
    assert_eq!(skin.joints[1], [0, 1, 0, 0]);
    for (got, want) in skin.weights.iter().zip(skins.iter()) {
        for k in 0..4 {
            assert!((got[k] - want.weights[k]).abs() < 1.0e-6);
        }
    }
}

#[test]
fn empty_mesh_still_emits_skeleton_and_skin() {
    let bones = two_bones();
    let node_locals = vec![Mat4::IDENTITY, Mat4::IDENTITY];
    let ibm = vec![Mat4::IDENTITY, Mat4::IDENTITY];
    let glb = skinned_glb(&[], &[], &[], &[], &[], &bones, &node_locals, &ibm);
    assert_eq!(&glb[0..4], b"glTF");

    let skin = decode_skinned_glb(&glb).expect("decode skeleton-only glb");
    assert_eq!(skin.skin_joint_count, 2);
    assert_eq!(skin.inverse_bind_count, 2);
    assert!(skin.joints.is_empty(), "a hollow character has no per-vertex skins");

    // The base decoder sees an empty mesh.
    let base = glb_to_part_mesh(&glb).expect("decode empty base mesh");
    assert!(base.positions.is_empty());
}

#[test]
fn no_bones_falls_back_to_a_plain_part_glb() {
    let positions = vec![0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let normals = vec![0.0f32, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
    let colors = vec![0.2f32, 0.4, 0.6, 0.2, 0.4, 0.6, 0.2, 0.4, 0.6];
    let indices = vec![0u32, 1, 2];
    let glb = skinned_glb(&positions, &normals, &colors, &indices, &[], &[], &[], &[]);

    // A plain per-part glb: no skin, but the base mesh still decodes.
    assert!(decode_skinned_glb(&glb).is_err(), "no skin without bones");
    let base = glb_to_part_mesh(&glb).expect("decode fallback mesh");
    assert_eq!(base.positions, positions);
    assert_eq!(base.indices, indices);
}
