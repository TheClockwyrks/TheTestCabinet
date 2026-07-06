//! The stochastic particle simulator: play an authored [`System`] over its duration,
//! producing one [`Frame`] of live particles per playback tick.
//!
//! This is the pure, headless heart of the effect — the same simulation a real
//! particle editor runs, and the same one the runtime's pure core will run in the
//! browser. It steps every emitter (spawning by rate or burst), integrates the forces
//! (gravity, drag, radial, vortex, curl-noise turbulence, wind) into each particle's
//! motion, evaluates the per-particle curves, and fires sub-emitters on a particle's
//! death or along its path. Being stochastic, it varies from one play to the next; a
//! caller seeds it (from an emitter's `seed`, else a fixed preview seed) purely so the
//! captured preview is reproducible — the model never supplies a seed.

use crate::system::{Emission, Emitter, Forces, Shape, SubTrigger, System};

/// A hard cap on the live particle count, so a runaway rate or a self-triggering
/// sub-emitter can never exhaust memory. Spawns past the cap are dropped.
const MAX_PARTICLES: usize = 120_000;

/// The deepest sub-emitter generation that still triggers further sub-emitters, so a
/// death-spawns-death loop terminates.
const MAX_GENERATION: u8 = 4;

/// One captured playback frame: the live particles at a playback tick.
#[derive(Debug, Clone, Default)]
pub struct Frame {
    /// The live particles, ready to billboard (3D) or composite (2D).
    pub particles: Vec<RenderParticle>,
}

/// A live particle at a captured instant, with its appearance already evaluated.
#[derive(Debug, Clone, Copy)]
pub struct RenderParticle {
    /// World position `[x, y, z]` (`z` is `0` in 2D).
    pub position: [f32; 3],
    /// The size factor (a curve value; the render path scales it to world/pixel size).
    pub size: f32,
    /// Linear `0..1` RGB color.
    pub color: [f32; 3],
    /// Opacity `[0, 1]`.
    pub opacity: f32,
    /// The particle's velocity (for velocity-stretch).
    pub velocity: [f32; 3],
    /// The velocity-stretch factor (`1` = round).
    pub stretch: f32,
}

/// The whole simulated playback: one [`Frame`] per tick, `frame_count` of them.
#[derive(Debug, Clone, Default)]
pub struct Simulation {
    /// The captured frames, in playback order.
    pub frames: Vec<Frame>,
}

/// A live particle carried between frames (its appearance is derived on capture).
#[derive(Clone, Copy)]
struct Particle {
    emitter: usize,
    generation: u8,
    pos: [f32; 3],
    vel: [f32; 3],
    age: f32,
    lifetime: f32,
}

/// Simulate `system`, seeding the stochastic draws from `seed` so the capture is
/// reproducible. Produces `round(duration_ms * fps / 1000) + 1` frames (the state at
/// `t = 0, dt, 2·dt, …`).
pub fn simulate(system: &System, seed: u64) -> Simulation {
    let fps = system.fps.max(1);
    let dt_ms = 1000.0 / fps as f32;
    let dt_s = dt_ms / 1000.0;
    let steps = ((system.duration_ms as f32 * fps as f32 / 1000.0).round() as usize).max(1);

    let children = system.sub_emitter_children();
    // Effective forces per emitter: the global set, overlaid with the emitter's own.
    let eff_forces: Vec<Forces> = system
        .emitters
        .iter()
        .map(|e| {
            let mut f = system.forces;
            f.merge_from(&e.forces);
            f
        })
        .collect();
    // A per-emitter RNG for spawn draws, seeded reproducibly.
    let mut spawners: Vec<Rng> = system
        .emitters
        .iter()
        .enumerate()
        .map(|(i, e)| Rng::new(seed ^ e.seed.unwrap_or(0) ^ mix(i as u64 + 1)))
        .collect();
    // Rate emitters accumulate fractional spawns between ticks.
    let mut rate_accum = vec![0.0f32; system.emitters.len()];

    let mut particles: Vec<Particle> = Vec::new();
    let mut frames: Vec<Frame> = Vec::with_capacity(steps + 1);

    // Frame 0: fire any zero-time bursts (and start rate emitters), then capture.
    for (i, emitter) in system.emitters.iter().enumerate() {
        if is_child(&children, &emitter.name) {
            continue;
        }
        if let Emission::Burst { count, at_ms } = emitter.emission
            && at_ms <= 0.0
        {
            spawn(
                &mut particles,
                system,
                i,
                count as usize,
                None,
                0,
                &mut spawners[i],
            );
        }
    }
    frames.push(capture(system, &particles));

    for step in 1..=steps {
        let t = step as f32 * dt_ms;
        let t_prev = t - dt_ms;

        integrate(
            system,
            &eff_forces,
            &mut particles,
            &mut spawners,
            dt_ms,
            dt_s,
        );

        // Top-level emission over this tick's window.
        for (i, emitter) in system.emitters.iter().enumerate() {
            if is_child(&children, &emitter.name) {
                continue;
            }
            match emitter.emission {
                Emission::Rate { rate } => {
                    rate_accum[i] += rate * dt_s;
                    let n = rate_accum[i].floor();
                    if n >= 1.0 {
                        rate_accum[i] -= n;
                        let spawner = &mut spawners[i];
                        spawn(&mut particles, system, i, n as usize, None, 0, spawner);
                    }
                }
                Emission::Burst { count, at_ms } => {
                    if at_ms > t_prev && at_ms <= t {
                        let spawner = &mut spawners[i];
                        spawn(&mut particles, system, i, count as usize, None, 0, spawner);
                    }
                }
            }
        }

        frames.push(capture(system, &particles));
    }

    Simulation { frames }
}

/// Advance every particle one tick: integrate its forces and motion, age it, fire
/// `step` sub-emitters along its path, and fire `death` sub-emitters when it expires
/// (dead particles are removed).
fn integrate(
    system: &System,
    eff_forces: &[Forces],
    particles: &mut Vec<Particle>,
    spawners: &mut [Rng],
    dt_ms: f32,
    dt_s: f32,
) {
    let mut spawned: Vec<Particle> = Vec::new();
    let mut i = 0;
    while i < particles.len() {
        let mut p = particles[i];
        let emitter = &system.emitters[p.emitter];
        let forces = &eff_forces[p.emitter];

        // Accumulate forces into an acceleration.
        let mut accel = [0.0f32; 3];
        apply_forces(&mut accel, &p, emitter, forces);

        // Semi-implicit Euler with drag damping.
        p.vel = add(p.vel, scale(accel, dt_s));
        if let Some(drag) = forces.drag {
            let damp = 1.0 / (1.0 + drag.max(0.0) * dt_s);
            p.vel = scale(p.vel, damp);
        }
        p.pos = add(p.pos, scale(p.vel, dt_s));
        if system.dimensions <= 2 {
            p.pos[2] = 0.0;
            p.vel[2] = 0.0;
        }
        p.age += dt_ms;

        // `step` sub-emitters trail along the path.
        if p.generation < MAX_GENERATION {
            fire_step_subemitters(system, &p, dt_ms, &mut spawned, spawners);
        }

        if p.age >= p.lifetime {
            // `death` sub-emitters burst at the death site.
            if p.generation < MAX_GENERATION {
                fire_death_subemitters(system, &p, &mut spawned, spawners);
            }
            particles.swap_remove(i);
            // Do not advance `i`: the swapped-in particle still needs stepping.
        } else {
            particles[i] = p;
            i += 1;
        }
    }
    for np in spawned {
        if particles.len() >= MAX_PARTICLES {
            break;
        }
        particles.push(np);
    }
}

/// Accumulate the enabled forces at a particle into `accel`. Turbulence samples a
/// curl-noise field at the particle's position, so its swirl is stable frame-to-frame.
fn apply_forces(accel: &mut [f32; 3], p: &Particle, emitter: &Emitter, forces: &Forces) {
    if let Some(g) = forces.gravity {
        let dir = forces.gravity_dir.unwrap_or([0.0, -1.0, 0.0]);
        *accel = add(*accel, scale(normalize_or(dir, [0.0, -1.0, 0.0]), g));
    }
    let radial_out = normalize_or(sub(p.pos, emitter.position), [0.0, 1.0, 0.0]);
    if let Some(r) = forces.radial {
        *accel = add(*accel, scale(radial_out, r));
    }
    if let Some(v) = forces.vortex {
        // Tangential swirl about the vertical (y) axis.
        let tangent = normalize_or(cross([0.0, 1.0, 0.0], radial_out), [1.0, 0.0, 0.0]);
        *accel = add(*accel, scale(tangent, v));
    }
    if let Some(turb) = forces.turbulence {
        let curl = curl_noise(p.pos, turb.scale.max(1e-4));
        *accel = add(*accel, scale(curl, turb.amplitude));
    }
    if let Some(wind) = forces.wind {
        *accel = add(*accel, wind);
    }
}

/// Fire the `step` sub-emitters of `p`'s emitter, trailing children along its path at a
/// rate derived from the child's emission.
fn fire_step_subemitters(
    system: &System,
    p: &Particle,
    dt_ms: f32,
    spawned: &mut Vec<Particle>,
    spawners: &mut [Rng],
) {
    let parent_name = &system.emitters[p.emitter].name;
    for sub in &system.sub_emitters {
        if sub.on != SubTrigger::Step || &sub.parent != parent_name {
            continue;
        }
        let Some(child) = system.emitters.iter().position(|e| e.name == sub.emitter) else {
            continue;
        };
        let per_second = child_trail_rate(&system.emitters[child]);
        if per_second <= 0.0 {
            continue;
        }
        // One accumulator per particle across every step sub-emitter (good enough for a
        // preview): emit whole particles as the accumulator crosses the interval.
        let interval = 1000.0 / per_second;
        // The particle's own accumulator is tracked on the live copy; approximate by
        // sampling the expected count for this tick.
        let count = (dt_ms / interval).floor() as usize;
        for _ in 0..count {
            if let Some(np) = spawn_child(system, child, p, spawners) {
                spawned.push(np);
            }
        }
    }
}

/// Fire the `death` sub-emitters of `p`'s emitter, bursting children at the death site.
fn fire_death_subemitters(
    system: &System,
    p: &Particle,
    spawned: &mut Vec<Particle>,
    spawners: &mut [Rng],
) {
    let parent_name = &system.emitters[p.emitter].name;
    for sub in &system.sub_emitters {
        if sub.on != SubTrigger::Death || &sub.parent != parent_name {
            continue;
        }
        let Some(child) = system.emitters.iter().position(|e| e.name == sub.emitter) else {
            continue;
        };
        let count = child_burst_count(&system.emitters[child]);
        for _ in 0..count {
            if let Some(np) = spawn_child(system, child, p, spawners) {
                spawned.push(np);
            }
        }
    }
}

/// How many particles a child emitter releases per parent death.
fn child_burst_count(child: &Emitter) -> usize {
    match child.emission {
        Emission::Burst { count, .. } => count as usize,
        Emission::Rate { rate } => (rate * 0.1).round().max(1.0) as usize,
    }
}

/// The per-second trail rate a `step` child emits at.
fn child_trail_rate(child: &Emitter) -> f32 {
    match child.emission {
        Emission::Rate { rate } => rate,
        Emission::Burst { count, .. } => count as f32,
    }
}

/// Spawn one child particle at parent particle `p`'s position, one generation deeper.
fn spawn_child(
    system: &System,
    child: usize,
    p: &Particle,
    spawners: &mut [Rng],
) -> Option<Particle> {
    let mut out = Vec::new();
    let rng = &mut spawners[child];
    spawn(
        &mut out,
        system,
        child,
        1,
        Some(p.pos),
        p.generation + 1,
        rng,
    );
    out.into_iter().next()
}

/// Spawn `count` particles for emitter `index`, at an explicit `origin` (a sub-emitter
/// trigger site) or sampled from the emitter's shape, drawing lifetime/speed/direction
/// spreads from `rng`.
fn spawn(
    particles: &mut Vec<Particle>,
    system: &System,
    index: usize,
    count: usize,
    origin: Option<[f32; 3]>,
    generation: u8,
    rng: &mut Rng,
) {
    let emitter = &system.emitters[index];
    let two_d = system.dimensions <= 2;
    for _ in 0..count {
        if particles.len() >= MAX_PARTICLES {
            break;
        }
        let pos = origin.unwrap_or_else(|| sample_shape(emitter, two_d, rng));
        let dir = sample_direction(emitter, two_d, rng);
        let speed = jitter(emitter.speed, emitter.speed_spread, rng);
        let lifetime = jitter(emitter.lifetime_ms, emitter.lifetime_spread, rng).max(1.0);
        let mut vel = scale(dir, speed);
        if two_d {
            vel[2] = 0.0;
        }
        particles.push(Particle {
            emitter: index,
            generation,
            pos: if two_d { [pos[0], pos[1], 0.0] } else { pos },
            vel,
            age: 0.0,
            lifetime,
        });
    }
}

/// Sample a birth position on the emitter's [`Shape`].
fn sample_shape(emitter: &Emitter, two_d: bool, rng: &mut Rng) -> [f32; 3] {
    let c = emitter.position;
    let r = emitter.extent.radius;
    let s = emitter.extent.size;
    match emitter.shape {
        Shape::Point | Shape::Cone => c,
        Shape::Sphere => add(c, rng.in_ball(r, two_d)),
        Shape::Disc => {
            let d = rng.in_disc(r);
            if two_d {
                [c[0] + d[0], c[1] + d[1], 0.0]
            } else {
                // A horizontal ground disc in the xz-plane.
                [c[0] + d[0], c[1], c[2] + d[1]]
            }
        }
        Shape::Box => [
            c[0] + rng.symmetric() * s[0] * 0.5,
            c[1] + rng.symmetric() * s[1] * 0.5,
            if two_d {
                0.0
            } else {
                c[2] + rng.symmetric() * s[2] * 0.5
            },
        ],
        Shape::Edge => [c[0] + rng.symmetric() * s[0] * 0.5, c[1], if two_d { 0.0 } else { c[2] }],
    }
}

/// Sample a launch direction: the emitter direction, spread within its cone.
fn sample_direction(emitter: &Emitter, two_d: bool, rng: &mut Rng) -> [f32; 3] {
    let base = normalize_or(emitter.direction, [0.0, 1.0, 0.0]);
    let half = (emitter.cone_angle * 0.5).to_radians();
    if half <= 0.0 {
        return base;
    }
    if two_d {
        // Rotate the base direction by a random angle within the cone, in-plane.
        let a = rng.symmetric() * half;
        let (sin, cos) = a.sin_cos();
        let x = base[0] * cos - base[1] * sin;
        let y = base[0] * sin + base[1] * cos;
        return [x, y, 0.0];
    }
    // Sample a direction within a cone of half-angle `half` about `base`.
    let cos_min = half.cos();
    let cos_theta = 1.0 - rng.unit() * (1.0 - cos_min);
    let sin_theta = (1.0 - cos_theta * cos_theta).max(0.0).sqrt();
    let phi = rng.unit() * std::f32::consts::TAU;
    let local = [sin_theta * phi.cos(), sin_theta * phi.sin(), cos_theta];
    // Orient the local `+z` cone onto `base`.
    let (right, up) = basis(base);
    add(
        add(scale(right, local[0]), scale(up, local[1])),
        scale(base, local[2]),
    )
}

/// Capture the live particles into a [`Frame`], evaluating each particle's appearance
/// at its current normalized life.
fn capture(system: &System, particles: &[Particle]) -> Frame {
    let mut out = Vec::with_capacity(particles.len());
    for p in particles {
        let emitter = &system.emitters[p.emitter];
        let life = (p.age / p.lifetime).clamp(0.0, 1.0) as f64;
        let ap = &emitter.particle;
        out.push(RenderParticle {
            position: p.pos,
            size: ap.size_at(life),
            color: ap.color_at(life),
            opacity: ap.opacity_at(life),
            velocity: p.vel,
            stretch: ap.stretch.unwrap_or(1.0).max(0.0),
        });
    }
    Frame { particles: out }
}

/// Whether an emitter name is a sub-emitter child (spawned only on a trigger).
fn is_child(children: &[&str], name: &str) -> bool {
    children.contains(&name)
}

/// A jittered value: `base ± spread`, uniform.
fn jitter(base: f32, spread: f32, rng: &mut Rng) -> f32 {
    base + rng.symmetric() * spread
}

// --- small vector helpers (plain [f32; 3], to avoid a glam dependency here) ---

fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn scale(a: [f32; 3], s: f32) -> [f32; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn length(a: [f32; 3]) -> f32 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}

/// Normalize `v`, falling back to `default` when `v` is (near) zero.
fn normalize_or(v: [f32; 3], default: [f32; 3]) -> [f32; 3] {
    let len = length(v);
    if len > 1e-6 {
        scale(v, 1.0 / len)
    } else {
        default
    }
}

/// An orthonormal `(right, up)` basis perpendicular to a unit `forward`.
fn basis(forward: [f32; 3]) -> ([f32; 3], [f32; 3]) {
    let up_ref = if forward[1].abs() > 0.99 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let right = normalize_or(cross(up_ref, forward), [1.0, 0.0, 0.0]);
    let up = cross(forward, right);
    (right, up)
}

/// A cheap curl-noise field for turbulence: the curl of a hash-based potential,
/// approximated by finite differences. Good enough to give a plume its swirling
/// character; it is not a physically exact solenoidal field.
fn curl_noise(pos: [f32; 3], scale_freq: f32) -> [f32; 3] {
    let p = scale(pos, scale_freq);
    let e = 0.1f32;
    let potential = |q: [f32; 3]| -> [f32; 3] {
        [
            value_noise(add(q, [0.0, 0.0, 0.0])),
            value_noise(add(q, [31.4, 17.2, 4.7])),
            value_noise(add(q, [7.1, 23.9, 55.3])),
        ]
    };
    let dx = sub(potential(add(p, [e, 0.0, 0.0])), potential(sub(p, [e, 0.0, 0.0])));
    let dy = sub(potential(add(p, [0.0, e, 0.0])), potential(sub(p, [0.0, e, 0.0])));
    let dz = sub(potential(add(p, [0.0, 0.0, e])), potential(sub(p, [0.0, 0.0, e])));
    let inv = 1.0 / (2.0 * e);
    [
        (dy[2] - dz[1]) * inv,
        (dz[0] - dx[2]) * inv,
        (dx[1] - dy[0]) * inv,
    ]
}

/// A smooth pseudo-random scalar field in `[-1, 1]`, trilinearly interpolating a
/// hash-based lattice.
fn value_noise(p: [f32; 3]) -> f32 {
    let xi = p[0].floor();
    let yi = p[1].floor();
    let zi = p[2].floor();
    let xf = smooth(p[0] - xi);
    let yf = smooth(p[1] - yi);
    let zf = smooth(p[2] - zi);
    let (x0, y0, z0) = (xi as i64, yi as i64, zi as i64);
    let corner = |dx: i64, dy: i64, dz: i64| hash3(x0 + dx, y0 + dy, z0 + dz);
    let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;
    let c00 = lerp(corner(0, 0, 0), corner(1, 0, 0), xf);
    let c10 = lerp(corner(0, 1, 0), corner(1, 1, 0), xf);
    let c01 = lerp(corner(0, 0, 1), corner(1, 0, 1), xf);
    let c11 = lerp(corner(0, 1, 1), corner(1, 1, 1), xf);
    let c0 = lerp(c00, c10, yf);
    let c1 = lerp(c01, c11, yf);
    lerp(c0, c1, zf)
}

/// A smoothstep fade for lattice interpolation.
fn smooth(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

/// A hash of integer lattice coordinates to `[-1, 1]`.
fn hash3(x: i64, y: i64, z: i64) -> f32 {
    let mut h = mix(x as u64)
        ^ mix(y as u64).rotate_left(21)
        ^ mix(z as u64).rotate_left(42);
    h = mix(h);
    ((h >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
}

/// A SplitMix64 finalizer, used both as a PRNG step and a scalar hash.
fn mix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// A small deterministic PRNG (SplitMix64), so a seeded simulation replays exactly.
#[derive(Clone, Copy)]
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed ^ 0xDEAD_BEEF_CAFE_F00D)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        mix(self.0)
    }

    /// A uniform `[0, 1)` float.
    fn unit(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }

    /// A uniform `[-1, 1)` float.
    fn symmetric(&mut self) -> f32 {
        self.unit() * 2.0 - 1.0
    }

    /// A uniform point in a disc of `radius` (in the `xy` plane).
    fn in_disc(&mut self, radius: f32) -> [f32; 2] {
        let r = radius * self.unit().sqrt();
        let a = self.unit() * std::f32::consts::TAU;
        [r * a.cos(), r * a.sin()]
    }

    /// A uniform point in a ball of `radius` (a disc when `two_d`).
    fn in_ball(&mut self, radius: f32, two_d: bool) -> [f32; 3] {
        if two_d {
            let d = self.in_disc(radius);
            return [d[0], d[1], 0.0];
        }
        let u = self.unit().cbrt() * radius;
        let z = self.symmetric();
        let phi = self.unit() * std::f32::consts::TAU;
        let s = (1.0 - z * z).max(0.0).sqrt();
        [u * s * phi.cos(), u * s * phi.sin(), u * z]
    }
}

#[cfg(test)]
#[path = "sim.test.rs"]
mod tests;
