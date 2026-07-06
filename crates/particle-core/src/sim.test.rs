//! Tests for the stochastic simulator: emission, one-shot vs. looping decay,
//! determinism, and sub-emitter spawning.

use super::*;

use crate::op::{EmitterDef, Op, build_system};
use crate::system::{Dimensionality, Emission, Extent, Field, Shape, SubTrigger, System};

fn field_3d() -> Field {
    Field {
        width: 32,
        height: 32,
        depth: Some(32),
    }
}

fn emitter(name: &str, emission: Emission, lifetime_ms: f32) -> EmitterDef {
    EmitterDef {
        name: name.to_string(),
        shape: Shape::Point,
        position: [16.0, 4.0, 16.0],
        extent: Extent::default(),
        emission,
        lifetime_ms,
        lifetime_spread: 0.0,
        speed: 6.0,
        speed_spread: 1.0,
        direction: [0.0, 1.0, 0.0],
        cone_angle: 45.0,
        seed: Some(11),
    }
}

fn build(ops: Vec<Op>, duration_ms: u32, fps: u32, looping: bool) -> System {
    build_system(&ops, Dimensionality::D3, field_3d(), duration_ms, fps, looping)
}

#[test]
fn burst_spawns_its_particles_on_the_first_frame() {
    let ops = vec![Op::AddEmitter {
        def: emitter("blast", Emission::Burst { count: 200, at_ms: 0.0 }, 400.0),
    }];
    let system = build(ops, 500, 60, false);
    let sim = simulate(&system, 1);
    assert!(!sim.frames.is_empty());
    assert_eq!(sim.frames[0].particles.len(), 200);
}

#[test]
fn one_shot_burst_decays_to_empty() {
    // A 200 ms lifetime over a 1000 ms one-shot: the last frame is empty.
    let ops = vec![Op::AddEmitter {
        def: emitter("blast", Emission::Burst { count: 150, at_ms: 0.0 }, 200.0),
    }];
    let system = build(ops, 1000, 60, false);
    let sim = simulate(&system, 2);
    let last = sim.frames.last().expect("frames");
    assert_eq!(last.particles.len(), 0, "a one-shot effect decays to empty");
}

#[test]
fn looping_rate_emitter_holds_a_steady_state() {
    let ops = vec![Op::AddEmitter {
        def: emitter("smoke", Emission::Rate { rate: 300.0 }, 500.0),
    }];
    let system = build(ops, 1000, 60, true);
    let sim = simulate(&system, 3);
    let last = sim.frames.last().expect("frames");
    assert!(
        last.particles.len() > 10,
        "a looping rate emitter sustains particles, got {}",
        last.particles.len()
    );
}

#[test]
fn simulation_is_deterministic_for_a_fixed_seed() {
    let ops = vec![Op::AddEmitter {
        def: emitter("blast", Emission::Burst { count: 120, at_ms: 0.0 }, 400.0),
    }];
    let system = build(ops, 600, 60, false);
    let a = simulate(&system, 99);
    let b = simulate(&system, 99);
    let mid = a.frames.len() / 2;
    assert_eq!(a.frames[mid].particles.len(), b.frames[mid].particles.len());
    let pa = a.frames[mid].particles.first();
    let pb = b.frames[mid].particles.first();
    if let (Some(pa), Some(pb)) = (pa, pb) {
        assert_eq!(pa.position, pb.position);
    }
}

#[test]
fn two_d_simulation_keeps_particles_planar() {
    let field = Field {
        width: 32,
        height: 32,
        depth: None,
    };
    let ops = vec![Op::AddEmitter {
        def: emitter("planar", Emission::Burst { count: 80, at_ms: 0.0 }, 400.0),
    }];
    let system = build_system(&ops, Dimensionality::D2, field, 500, 60, false);
    let sim = simulate(&system, 5);
    for frame in &sim.frames {
        for p in &frame.particles {
            assert_eq!(p.position[2], 0.0, "a 2D effect stays planar");
            assert_eq!(p.velocity[2], 0.0);
        }
    }
}

#[test]
fn death_subemitter_spawns_children() {
    // A short-lived parent that bursts embers on death: after the parent dies, its
    // children are alive.
    let ops = vec![
        Op::AddEmitter {
            def: emitter("shell", Emission::Burst { count: 10, at_ms: 0.0 }, 100.0),
        },
        Op::AddEmitter {
            def: emitter("embers", Emission::Burst { count: 8, at_ms: 0.0 }, 400.0),
        },
        Op::AddSubemitter {
            parent: "shell".to_string(),
            on: SubTrigger::Death,
            emitter: "embers".to_string(),
        },
    ];
    let system = build(ops, 700, 60, false);
    let sim = simulate(&system, 7);
    // The embers emitter is a child, so it never fires on its own timeline. The
    // parents (100 ms lifetime) are all gone by ~150 ms, and the embers they burst on
    // death (400 ms lifetime) live to ~500 ms — so a frame at ~280 ms holds only
    // spawned children.
    let mid = &sim.frames[sim.frames.len() * 2 / 5];
    assert!(
        !mid.particles.is_empty(),
        "death sub-emitter should have spawned children"
    );
}
