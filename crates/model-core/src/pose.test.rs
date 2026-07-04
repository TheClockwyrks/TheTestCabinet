//! Tests for the rig-posing port. These pin the behaviours the TS `voxel-runtime`
//! guarantees (F-curve sampling, the pitch convention, rest = sculpted place) so the
//! Rust `--time` preview stays in lockstep with the client and exporter.

use std::collections::HashMap;

use glam::Vec3;

use super::*;
use crate::rig::{Animation, Drive, Interp, Joint, JointKind, Keyframe, Part, Rig, Track};

fn kf(t_ms: u32, value: f64, interp: Interp) -> Keyframe {
    Keyframe {
        t_ms,
        value,
        interp,
        out_handle: None,
        in_handle: None,
    }
}

fn anim(name: &str, period_ms: u32, looping: bool, tracks: Vec<Track>) -> Animation {
    Animation {
        name: name.to_string(),
        period_ms,
        looping,
        auto_play: false,
        joints: tracks.iter().map(|t| t.joint.clone()).collect(),
        tracks,
    }
}

#[test]
fn empty_and_single_tracks() {
    assert_eq!(sample_keyframes(&[], 1000.0, true, 500.0), 0.0);
    assert_eq!(
        sample_keyframes(&[kf(0, 3.5, Interp::Linear)], 1000.0, true, 500.0),
        3.5
    );
}

#[test]
fn linear_interpolation_midpoint() {
    let frames = [kf(0, 0.0, Interp::Linear), kf(1000, 10.0, Interp::Linear)];
    assert!((sample_keyframes(&frames, 1000.0, false, 500.0) - 5.0).abs() < 1e-9);
    // Before the first / after the last key clamps.
    assert_eq!(sample_keyframes(&frames, 1000.0, false, -50.0), 0.0);
    assert_eq!(sample_keyframes(&frames, 1000.0, false, 2000.0), 10.0);
}

#[test]
fn constant_holds_until_next_key() {
    let frames = [kf(0, 2.0, Interp::Constant), kf(1000, 9.0, Interp::Linear)];
    assert_eq!(sample_keyframes(&frames, 1000.0, false, 999.0), 2.0);
}

#[test]
fn looping_wraps_time_into_period() {
    // A single-segment loop: sampling one period later gives the same value.
    let frames = [kf(0, 0.0, Interp::Linear), kf(500, 10.0, Interp::Linear)];
    let at = sample_keyframes(&frames, 1000.0, true, 250.0);
    let wrapped = sample_keyframes(&frames, 1000.0, true, 1250.0);
    assert!((at - wrapped).abs() < 1e-9);
    // Past the last key, the seamless wrap segment eases back toward the first value.
    let tail = sample_keyframes(&frames, 1000.0, true, 750.0);
    assert!((0.0..=10.0).contains(&tail));
}

#[test]
fn ease_in_out_stays_monotonic_and_bounded() {
    let frames = [
        kf(0, 0.0, Interp::EaseInOut),
        kf(1000, 100.0, Interp::Linear),
    ];
    let a = sample_keyframes(&frames, 1000.0, false, 250.0);
    let b = sample_keyframes(&frames, 1000.0, false, 500.0);
    let c = sample_keyframes(&frames, 1000.0, false, 750.0);
    assert!(a < b && b < c);
    assert!(
        (b - 50.0).abs() < 1e-6,
        "midpoint of a symmetric ease is the value midpoint"
    );
}

/// A positive rotation about `x` (pitch) must lift a forward `+z` point up toward
/// `+y` — the deliberate mirror of a right-handed x-rotation.
#[test]
fn positive_pitch_lifts_forward_part_up() {
    let rig = Rig {
        parts: vec![Part {
            name: "barrel".to_string(),
            parent: None,
            pivot: [0, 0, 0],
        }],
        joints: vec![Joint {
            name: "pitch".to_string(),
            part: "barrel".to_string(),
            kind: JointKind::Rotation,
            axis: Axis::X,
            pivot: [0, 0, 0],
            min: -1.6,
            max: 1.6,
            rest: 0.0,
            offset: [0.0; 3],
            orient: [0.0; 3],
            drive: Drive::Auto,
        }],
        animations: vec![],
    };
    let mut caller = HashMap::new();
    caller.insert("pitch".to_string(), std::f64::consts::FRAC_PI_2);
    let posed = pose_rig(&rig, &caller);
    let m = posed[0].1;
    // A point one unit forward (+z) rotates up to +y under +90° pitch.
    let p = m.transform_point3(Vec3::new(0.0, 0.0, 1.0));
    assert!(p.y > 0.9, "expected +z to lift toward +y, got {p:?}");
    assert!(
        p.z.abs() < 1e-5,
        "expected z≈0 after a quarter turn, got {p:?}"
    );
}

/// At rest (no caller values, no mount) a part stays exactly where it was sculpted —
/// its world matrix is the identity, so posing never shifts a rest model.
#[test]
fn rest_pose_is_identity() {
    let rig = Rig {
        parts: vec![
            Part {
                name: "root".to_string(),
                parent: None,
                pivot: [4, 0, 4],
            },
            Part {
                name: "child".to_string(),
                parent: Some("root".to_string()),
                pivot: [4, 8, 4],
            },
        ],
        joints: vec![Joint {
            name: "spin".to_string(),
            part: "child".to_string(),
            kind: JointKind::Rotation,
            axis: Axis::Y,
            pivot: [4, 8, 4],
            min: -3.0,
            max: 3.0,
            rest: 0.0,
            offset: [0.0; 3],
            orient: [0.0; 3],
            drive: Drive::Caller,
        }],
        animations: vec![],
    };
    let posed = pose_rig(&rig, &HashMap::new());
    for (_, m) in posed {
        assert!(m.abs_diff_eq(glam::Mat4::IDENTITY, 1e-6));
    }
}

#[test]
fn sample_animation_maps_each_track() {
    let animation = anim(
        "walk",
        1000,
        true,
        vec![
            Track {
                joint: "hip".to_string(),
                keyframes: vec![kf(0, 0.0, Interp::Linear), kf(1000, 2.0, Interp::Linear)],
            },
            Track {
                joint: "knee".to_string(),
                keyframes: vec![kf(0, 5.0, Interp::Constant)],
            },
        ],
    );
    let values = sample_animation(&animation, 500.0);
    assert!((values["hip"] - 1.0).abs() < 1e-9);
    assert_eq!(values["knee"], 5.0);
}
