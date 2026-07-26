//! Tests for the live-particle budget projection.

use super::*;
use crate::op::{Op, build_system};
use crate::system::{Dimensionality, Extent, Field, Shape};

fn field() -> Field {
    Field {
        width: 48,
        height: 64,
        depth: Some(32),
    }
}

/// Fold ops into a 2-second looping 3D system, exactly as the binary does.
fn system(ops: &[Op]) -> System {
    build_system(ops, Dimensionality::D3, field(), 2000, 60, true)
}

fn emitter(name: &str, emission: Emission, lifetime_ms: f32) -> Op {
    Op::AddEmitter {
        def: crate::op::EmitterDef {
            name: name.to_string(),
            shape: Shape::Box,
            position: [24.0, 60.0, 16.0],
            extent: Extent {
                radius: 1.0,
                size: [40.0, 1.0, 8.0],
            },
            emission,
            lifetime_ms,
            lifetime_spread: 0.0,
            speed: 6.0,
            speed_spread: 0.0,
            direction: [0.0, -1.0, 0.0],
            cone_angle: 8.0,
            seed: None,
        },
    }
}

fn rate(rate: f32) -> Emission {
    Emission::Rate { rate }
}

fn burst(count: u32) -> Emission {
    Emission::Burst { count, at_ms: 0.0 }
}

#[test]
fn rate_emitter_holds_rate_times_lifetime() {
    let projection = project(&system(&[emitter("fall", rate(2000.0), 1500.0)]));
    assert!((projection.total - 3000.0).abs() < 1e-6);
    assert_eq!(projection.contributions.len(), 1);
    assert_eq!(projection.contributions[0].emitter, "fall");
    assert!(!projection.exceeds_budget());
}

#[test]
fn lifetime_spread_counts_at_its_maximum() {
    let mut op = emitter("fall", rate(1000.0), 1000.0);
    let Op::AddEmitter { def } = &mut op else {
        unreachable!()
    };
    def.lifetime_spread = 500.0;
    // 1000/s x (1000 + 500) ms, the longest a particle can live.
    assert!((project(&system(&[op])).total - 1500.0).abs() < 1e-6);
}

#[test]
fn looping_burst_overlaps_when_a_particle_outlives_the_window() {
    // One-shot: the burst is alive once, however long its particles live.
    let one_shot = build_system(
        &[emitter("pop", burst(400), 5000.0)],
        Dimensionality::D3,
        field(),
        2000,
        60,
        false,
    );
    assert!((project(&one_shot).total - 400.0).abs() < 1e-6);

    // Looping over a 2s window: a 5s lifetime keeps three bursts alive at once.
    let looping = system(&[emitter("pop", burst(400), 5000.0)]);
    assert!((project(&looping).total - 1200.0).abs() < 1e-6);
}

#[test]
fn a_sub_emitter_child_is_projected_from_its_parents_deaths() {
    // 1000/s alive for 1s = 1000 live, dying at 1000/s. Each death bursts 5 children
    // that live 0.5s: 1000 x 5 x 0.5 = 2500 live children.
    let ops = vec![
        emitter("fall", rate(1000.0), 1000.0),
        emitter("spray", burst(5), 500.0),
        Op::AddSubemitter {
            parent: "fall".to_string(),
            on: SubTrigger::Death,
            emitter: "spray".to_string(),
        },
    ];
    let projection = project(&system(&ops));
    assert!((projection.total - 3500.0).abs() < 1e-6);
    // The child is listed, and the biggest spender comes first.
    assert_eq!(projection.contributions[0].emitter, "spray");
    assert!((projection.contributions[0].live - 2500.0).abs() < 1e-6);
}

#[test]
fn a_child_emits_nothing_on_its_own_timeline() {
    // `spray` would hold 5000 live as a top-level rate emitter; as a sub-emitter child
    // it contributes only what its parent's deaths spawn — and here nothing triggers it
    // because the parent emits nothing.
    let ops = vec![
        emitter("fall", rate(0.0), 1000.0),
        emitter("spray", rate(10_000.0), 500.0),
        Op::AddSubemitter {
            parent: "fall".to_string(),
            on: SubTrigger::Death,
            emitter: "spray".to_string(),
        },
    ];
    assert_eq!(project(&system(&ops)).total, 0.0);
}

#[test]
fn a_death_spawns_death_cycle_terminates() {
    // Two emitters that each burst the other on death would grow without bound; the
    // projection stops at the generation depth the simulator stops triggering at.
    let ops = vec![
        emitter("a", rate(10.0), 1000.0),
        emitter("b", burst(4), 1000.0),
        Op::AddSubemitter {
            parent: "a".to_string(),
            on: SubTrigger::Death,
            emitter: "b".to_string(),
        },
        Op::AddSubemitter {
            parent: "b".to_string(),
            on: SubTrigger::Death,
            emitter: "a".to_string(),
        },
    ];
    let projection = project(&system(&ops));
    assert!(projection.total.is_finite());
    // 10 live in `a`, then 4x per generation, four generations deep.
    assert!(projection.total < 10.0 * 4.0f64.powi(4) * 2.0);
}

#[test]
fn an_over_budget_projection_names_its_biggest_spenders() {
    let ops = vec![
        emitter("fall", rate(20_000.0), 1600.0),
        emitter("mist", rate(200.0), 2000.0),
    ];
    let projection = project(&system(&ops));
    assert!(projection.exceeds_budget());

    let message = projection.over_budget_message();
    assert!(message.contains("32000"), "{message}");
    assert!(
        message.contains(&MAX_LIVE_PARTICLES.to_string()),
        "{message}"
    );
    assert!(message.contains("fall"), "{message}");
    assert!(message.contains("--rate"), "{message}");
}

#[test]
fn an_empty_system_costs_nothing() {
    let projection = project(&system(&[]));
    assert_eq!(projection.total, 0.0);
    assert!(projection.contributions.is_empty());
    assert!(!projection.exceeds_budget());
}
