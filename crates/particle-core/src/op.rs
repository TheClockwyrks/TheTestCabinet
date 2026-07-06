//! The recorded operation log and the fold that resolves it into a [`System`].
//!
//! Every authoring call appends one [`Op`] to the run's action log — recording is all
//! a call does, exactly like the voxel/meshing tools; the expensive simulate-and-render
//! is the separate on-request `render`. The log is the authoritative output; `render`
//! replays it with [`build_system`] to produce the emitted `system.json` and to feed
//! the simulator. The log is a plain JSON array of internally-tagged ops, the same
//! recorded form the 2D `draw` tool uses.

use serde::{Deserialize, Serialize};

use crate::system::{
    Dimensionality, Emission, Emitter, Extent, Field, Forces, ParticleAppearance, Shape,
    SubEmitter, SubTrigger, System,
};

/// The authored definition of one emitter, as recorded by `add-emitter`. This is the
/// pre-projection form: [`build_system`] projects it into the effect's dimensionality.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmitterDef {
    /// The stable emitter name.
    pub name: String,
    /// The emission-source shape.
    pub shape: Shape,
    /// The emitter position `[x, y, z]`.
    pub position: [f32; 3],
    /// The shape's extent.
    pub extent: Extent,
    /// How the emitter releases particles.
    pub emission: Emission,
    /// Each particle's lifetime, in milliseconds.
    pub lifetime_ms: f32,
    /// The `±` spread on lifetime.
    #[serde(default)]
    pub lifetime_spread: f32,
    /// Each particle's launch speed.
    pub speed: f32,
    /// The `±` spread on speed.
    #[serde(default)]
    pub speed_spread: f32,
    /// The launch direction.
    pub direction: [f32; 3],
    /// The cone half-spread about the direction, in degrees.
    #[serde(default)]
    pub cone_angle: f32,
    /// A seed pinning this emitter's random draws.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
}

/// One recorded operation. The variants mirror the authoring subcommands one-for-one;
/// they are internally tagged on `"op"` (snake_case), so the log reads clearly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    /// Declare an emission source.
    AddEmitter {
        /// The emitter definition.
        def: EmitterDef,
    },
    /// Set forces globally (`emitter` = `None`) or on one emitter.
    SetForces {
        /// The emitter the forces are scoped to, or `None` for the global set.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        emitter: Option<String>,
        /// The forces to merge.
        forces: Forces,
    },
    /// Set an emitter's per-particle appearance.
    SetParticle {
        /// The emitter the appearance applies to.
        emitter: String,
        /// The appearance to merge.
        particle: ParticleAppearance,
    },
    /// Link a child emitter to fire from a parent's particles.
    AddSubemitter {
        /// The parent emitter.
        parent: String,
        /// When the child fires.
        on: SubTrigger,
        /// The child emitter.
        emitter: String,
    },
    /// Set the timeline's loop flag.
    SetTimeline {
        /// Whether the effect loops.
        looping: bool,
    },
}

/// Fold a recorded [`Op`] log into a [`System`], projecting into `dims` and framing it
/// with the seeded field/duration/fps/loop. A duplicate `add-emitter` name replaces the
/// earlier emitter (an in-place edit); `set-forces`/`set-particle` on an unknown emitter
/// are ignored (the model has not declared it yet). The result is exactly what `render`
/// emits as `system.json` and hands the simulator.
pub fn build_system(
    ops: &[Op],
    dims: Dimensionality,
    field: Field,
    duration_ms: u32,
    fps: u32,
    default_loop: bool,
) -> System {
    let mut system = System::empty(dims, field, duration_ms, fps, default_loop);
    for op in ops {
        match op {
            Op::AddEmitter { def } => upsert_emitter(&mut system, def, dims),
            Op::SetForces { emitter, forces } => {
                let mut forces = *forces;
                forces.project(dims);
                match emitter {
                    None => system.forces.merge_from(&forces),
                    Some(name) => {
                        if let Some(e) = system.emitters.iter_mut().find(|e| &e.name == name) {
                            e.forces.merge_from(&forces);
                        }
                    }
                }
            }
            Op::SetParticle { emitter, particle } => {
                if let Some(e) = system.emitters.iter_mut().find(|e| &e.name == emitter) {
                    e.particle.merge_from(particle);
                }
            }
            Op::AddSubemitter {
                parent,
                on,
                emitter,
            } => {
                system.sub_emitters.push(SubEmitter {
                    parent: parent.clone(),
                    on: *on,
                    emitter: emitter.clone(),
                });
            }
            Op::SetTimeline { looping } => system.looping = *looping,
        }
    }
    system
}

/// Insert `def` as a new [`Emitter`], or replace the existing same-name emitter in
/// place (preserving nothing — a re-declaration is a full edit), projecting its vectors
/// into `dims`.
fn upsert_emitter(system: &mut System, def: &EmitterDef, dims: Dimensionality) {
    let emitter = Emitter {
        name: def.name.clone(),
        shape: def.shape,
        position: dims.project(def.position),
        extent: project_extent(def.extent, dims),
        emission: def.emission,
        lifetime_ms: def.lifetime_ms,
        lifetime_spread: def.lifetime_spread,
        speed: def.speed,
        speed_spread: def.speed_spread,
        direction: dims.project(def.direction),
        cone_angle: def.cone_angle,
        seed: def.seed,
        forces: Forces::default(),
        particle: ParticleAppearance::default(),
    };
    match system.emitters.iter_mut().find(|e| e.name == def.name) {
        Some(existing) => *existing = emitter,
        None => system.emitters.push(emitter),
    }
}

/// Project a box/edge extent into `dims` (2D zeroes the `z` extent).
fn project_extent(mut extent: Extent, dims: Dimensionality) -> Extent {
    extent.size = dims.project(extent.size);
    extent
}

#[cfg(test)]
#[path = "op.test.rs"]
mod tests;
