//! Tests for the op-log fold ([`build_system`]) and the curve/appearance sampling.

use super::*;
use test_cabinet_model_core::Interp;
use test_cabinet_model_core::color::Rgb;

use crate::system::{
    ColorStop, Curve, Dimensionality, Emission, Extent, Field, Forces, ParticleAppearance, Shape,
    SubTrigger,
};

fn field_3d() -> Field {
    Field {
        width: 48,
        height: 48,
        depth: Some(48),
    }
}

fn burst_emitter(name: &str) -> EmitterDef {
    EmitterDef {
        name: name.to_string(),
        shape: Shape::Sphere,
        position: [4.0, 5.0, 6.0],
        extent: Extent {
            radius: 0.2,
            size: [2.0, 3.0, 4.0],
        },
        emission: Emission::Burst {
            count: 100,
            at_ms: 0.0,
        },
        lifetime_ms: 500.0,
        lifetime_spread: 0.0,
        speed: 8.0,
        speed_spread: 0.0,
        direction: [0.0, 1.0, 1.0],
        cone_angle: 30.0,
        seed: Some(7),
    }
}

#[test]
fn build_adds_emitter_and_reports_non_empty() {
    let ops = vec![Op::AddEmitter {
        def: burst_emitter("blast"),
    }];
    let system = build_system(&ops, Dimensionality::D3, field_3d(), 1000, 60, false);
    assert_eq!(system.emitters.len(), 1);
    assert_eq!(system.emitters[0].name, "blast");
    assert!(system.is_non_empty());
}

#[test]
fn empty_or_non_emitting_system_reports_empty() {
    let empty = build_system(&[], Dimensionality::D3, field_3d(), 1000, 60, false);
    assert!(!empty.is_non_empty());

    let mut def = burst_emitter("dud");
    def.emission = Emission::Burst {
        count: 0,
        at_ms: 0.0,
    };
    let ops = vec![Op::AddEmitter { def }];
    let system = build_system(&ops, Dimensionality::D3, field_3d(), 1000, 60, false);
    assert_eq!(system.emitters.len(), 1);
    assert!(!system.is_non_empty(), "an emitter that emits nothing is empty");
}

#[test]
fn two_d_drops_every_z_component() {
    let field = Field {
        width: 48,
        height: 48,
        depth: None,
    };
    let ops = vec![
        Op::AddEmitter {
            def: burst_emitter("planar"),
        },
        Op::SetForces {
            emitter: None,
            forces: Forces {
                wind: Some([1.0, 2.0, 3.0]),
                gravity_dir: Some([0.0, -1.0, 5.0]),
                ..Forces::default()
            },
        },
    ];
    let system = build_system(&ops, Dimensionality::D2, field, 1000, 60, false);
    let e = &system.emitters[0];
    assert_eq!(e.position[2], 0.0);
    assert_eq!(e.direction[2], 0.0);
    assert_eq!(e.extent.size[2], 0.0);
    assert_eq!(system.forces.wind.unwrap()[2], 0.0);
    assert_eq!(system.forces.gravity_dir.unwrap()[2], 0.0);
    assert_eq!(system.dimensions, 2);
    assert!(system.field.depth.is_none());
}

#[test]
fn set_forces_merges_global_and_per_emitter() {
    let ops = vec![
        Op::AddEmitter {
            def: burst_emitter("blast"),
        },
        Op::SetForces {
            emitter: None,
            forces: Forces {
                gravity: Some(-6.0),
                ..Forces::default()
            },
        },
        Op::SetForces {
            emitter: Some("blast".to_string()),
            forces: Forces {
                radial: Some(12.0),
                ..Forces::default()
            },
        },
    ];
    let system = build_system(&ops, Dimensionality::D3, field_3d(), 1000, 60, false);
    assert_eq!(system.forces.gravity, Some(-6.0));
    assert_eq!(system.emitters[0].forces.radial, Some(12.0));
    // A per-emitter set that is silent on gravity leaves the global gravity intact.
    assert_eq!(system.emitters[0].forces.gravity, None);
}

#[test]
fn set_particle_and_timeline_apply() {
    let ops = vec![
        Op::AddEmitter {
            def: burst_emitter("blast"),
        },
        Op::SetParticle {
            emitter: "blast".to_string(),
            particle: ParticleAppearance {
                opacity_curve: Some(Curve {
                    interp: Interp::EaseIn,
                    from: 1.0,
                    to: 0.0,
                }),
                ..ParticleAppearance::default()
            },
        },
        Op::SetTimeline { looping: true },
    ];
    let system = build_system(&ops, Dimensionality::D3, field_3d(), 1000, 60, false);
    assert!(system.looping);
    assert!(system.emitters[0].particle.opacity_curve.is_some());
    // set-particle on an unknown emitter is a no-op, not a panic.
    let ignored = vec![Op::SetParticle {
        emitter: "ghost".to_string(),
        particle: ParticleAppearance::default(),
    }];
    let _ = build_system(&ignored, Dimensionality::D3, field_3d(), 1000, 60, false);
}

#[test]
fn add_subemitter_links_child() {
    let ops = vec![
        Op::AddEmitter {
            def: burst_emitter("shell"),
        },
        Op::AddEmitter {
            def: burst_emitter("embers"),
        },
        Op::AddSubemitter {
            parent: "shell".to_string(),
            on: SubTrigger::Death,
            emitter: "embers".to_string(),
        },
    ];
    let system = build_system(&ops, Dimensionality::D3, field_3d(), 1000, 60, false);
    assert_eq!(system.sub_emitters.len(), 1);
    assert_eq!(system.sub_emitter_children(), vec!["embers"]);
}

#[test]
fn curve_sampling_matches_interp() {
    let linear = Curve {
        interp: Interp::Linear,
        from: 0.0,
        to: 1.0,
    };
    assert!((linear.sample(0.0) - 0.0).abs() < 1e-9);
    assert!((linear.sample(0.5) - 0.5).abs() < 1e-9);
    assert!((linear.sample(1.0) - 1.0).abs() < 1e-9);

    let constant = Curve::constant(2.5);
    assert!((constant.sample(0.3) - 2.5).abs() < 1e-9);

    // ease-in accelerates: it sits below the linear midpoint at t = 0.5.
    let ease_in = Curve {
        interp: Interp::EaseIn,
        from: 0.0,
        to: 1.0,
    };
    assert!(ease_in.sample(0.5) < 0.5);
    // Monotonic across the range.
    assert!(ease_in.sample(0.25) < ease_in.sample(0.75));
}

#[test]
fn appearance_samples_gradient_and_defaults() {
    let ap = ParticleAppearance {
        color_gradient: Some(vec![
            ColorStop {
                color: Rgb([255, 255, 255]),
                at: 0.0,
            },
            ColorStop {
                color: Rgb([0, 0, 0]),
                at: 1.0,
            },
        ]),
        ..ParticleAppearance::default()
    };
    let mid = ap.color_at(0.5);
    assert!((mid[0] - 0.5).abs() < 0.02);
    // No curve set → fully opaque, unit size.
    assert_eq!(ap.opacity_at(0.5), 1.0);
    assert_eq!(ap.size_at(0.5), 1.0);

    let bare = ParticleAppearance::default();
    assert_eq!(bare.color_at(0.5), [1.0, 1.0, 1.0]);
}
