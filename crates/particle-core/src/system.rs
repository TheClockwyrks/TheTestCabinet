//! The authored particle-system model — the emitters, forces, per-particle curves,
//! sub-emitters, and timeline that make up a particle effect — plus the `system.json`
//! shape it serializes to.
//!
//! This is the whole asset. The model authors it one operation at a time (see
//! [`crate::op`]); a [`System`] is the folded result, and it is what `render` emits as
//! `system.json` and what the [simulator](crate::sim) plays. The types (de)serialize as
//! compact camelCase metadata, mirroring the `rig.json` analogue in `model-core`.
//! Nothing here decodes geometry: a system is *simulated*, never baked.

use serde::{Deserialize, Serialize};

use test_cabinet_model_core::Interp;
use test_cabinet_model_core::color::Rgb;

/// Whether the effect is planar (2D) or volumetric (3D). The two binaries share the
/// whole model; `particle-2d` runs in [`Dimensionality::D2`], which zeroes every `z`
/// component (positions, directions, forces) so the effect stays planar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dimensionality {
    /// A planar effect: `z` is dropped everywhere.
    D2,
    /// A volumetric effect: the full `x`/`y`/`z` space.
    D3,
}

impl Dimensionality {
    /// The dimension count recorded in `system.json` (`2` or `3`).
    pub fn count(self) -> u8 {
        match self {
            Dimensionality::D2 => 2,
            Dimensionality::D3 => 3,
        }
    }

    /// Project a vector into this dimensionality: 2D zeroes the `z` component.
    pub fn project(self, v: [f32; 3]) -> [f32; 3] {
        match self {
            Dimensionality::D2 => [v[0], v[1], 0.0],
            Dimensionality::D3 => v,
        }
    }
}

/// The bounding field the effect plays in — the 2D/3D analogue of the drawing
/// `[canvas]` / voxel `[voxel]` table. `depth` is present only for a 3D effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    /// Extent along `x`.
    pub width: u32,
    /// Extent along `y` (up).
    pub height: u32,
    /// Extent along `z`; `None` for a planar (2D) effect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<u32>,
}

impl Field {
    /// The largest field extent, in field units — the scale the simulator sizes
    /// particles relative to.
    pub fn max_extent(&self) -> f32 {
        let d = self.depth.unwrap_or(0);
        self.width.max(self.height).max(d).max(1) as f32
    }

    /// The field center in world coordinates.
    pub fn center(&self) -> [f32; 3] {
        [
            self.width as f32 * 0.5,
            self.height as f32 * 0.5,
            self.depth.unwrap_or(0) as f32 * 0.5,
        ]
    }
}

/// The emission-source shape a particle is born on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "cli", derive(clap::ValueEnum))]
pub enum Shape {
    /// A single point at the emitter position.
    Point,
    /// A flat disc of `radius` (horizontal `xz` in 3D, `xy` in 2D).
    Disc,
    /// A solid ball of `radius`.
    Sphere,
    /// A cone: particles start at the apex and spread along the emit direction.
    Cone,
    /// A solid axis-aligned box of `size`.
    Box,
    /// A line segment of length `size.x` along `x`.
    Edge,
}

/// The size of an emitter's [`Shape`]: `radius` for the round shapes, `size` for the
/// box/edge extents. Both travel so a consumer need not know which the shape reads.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extent {
    /// Radius, for `disc` / `sphere` / `cone`.
    pub radius: f32,
    /// Full extents `[x, y, z]`, for `box` / `edge`.
    pub size: [f32; 3],
}

impl Default for Extent {
    fn default() -> Extent {
        Extent {
            radius: 1.0,
            size: [1.0, 1.0, 1.0],
        }
    }
}

/// How an emitter releases particles: continuously at a `rate`, or all at once as a
/// timed `burst`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum Emission {
    /// Continuous emission of `rate` particles per second (for fire, smoke, exhaust).
    Rate {
        /// Particles per second.
        rate: f32,
    },
    /// A one-shot burst of `count` particles at `at_ms` (for an explosion, a flash).
    Burst {
        /// The number of particles released.
        count: u32,
        /// The time, in milliseconds, the burst fires at.
        #[serde(rename = "atMs")]
        at_ms: f32,
    },
}

impl Emission {
    /// Whether this emission actually releases any particles.
    pub fn emits(&self) -> bool {
        match self {
            Emission::Rate { rate } => *rate > 0.0,
            Emission::Burst { count, .. } => *count > 0,
        }
    }
}

/// Curl-noise turbulence: a swirling force of `amplitude`, sampled at spatial
/// frequency `scale`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turbulence {
    /// The force magnitude.
    pub amplitude: f32,
    /// The spatial frequency the curl-noise field is sampled at.
    pub scale: f32,
}

/// The forces integrated into a particle's motion each step. Every field is optional
/// so a [`crate::op::Op::SetForces`] merges only the components it names, and so a
/// per-emitter override overlays cleanly on the global set. In 2D every direction is
/// planar (`z` zeroed).
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Forces {
    /// Gravitational acceleration along [`Self::gravity_dir`] (default straight down).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gravity: Option<f32>,
    /// The direction gravity pulls, when not straight down `(0, -1, 0)`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gravity_dir: Option<[f32; 3]>,
    /// Linear drag: velocity is damped by this coefficient each second.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drag: Option<f32>,
    /// A radial push out from the emitter center — the outward shove of an explosion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radial: Option<f32>,
    /// A vortex swirl about the emitter's vertical (`y`) axis.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vortex: Option<f32>,
    /// Curl-noise turbulence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turbulence: Option<Turbulence>,
    /// A steady wind acceleration `[x, y, z]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wind: Option<[f32; 3]>,
}

impl Forces {
    /// Overlay `other`'s set components onto `self`, leaving `self`'s untouched where
    /// `other` is silent. This is how a `SetForces` op merges and how a per-emitter
    /// override composes over the global forces.
    pub fn merge_from(&mut self, other: &Forces) {
        if other.gravity.is_some() {
            self.gravity = other.gravity;
        }
        if other.gravity_dir.is_some() {
            self.gravity_dir = other.gravity_dir;
        }
        if other.drag.is_some() {
            self.drag = other.drag;
        }
        if other.radial.is_some() {
            self.radial = other.radial;
        }
        if other.vortex.is_some() {
            self.vortex = other.vortex;
        }
        if other.turbulence.is_some() {
            self.turbulence = other.turbulence;
        }
        if other.wind.is_some() {
            self.wind = other.wind;
        }
    }

    /// Project every direction to the effect's dimensionality (2D zeroes `z`).
    pub fn project(&mut self, dims: Dimensionality) {
        if let Some(dir) = &mut self.gravity_dir {
            *dir = dims.project(*dir);
        }
        if let Some(wind) = &mut self.wind {
            *wind = dims.project(*wind);
        }
    }
}

/// A keyed color stop over a particle's normalized life `[0, 1]` — fire runs
/// white → orange → red → smoke across these.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorStop {
    /// The stop color, opaque `#rrggbb`.
    pub color: Rgb,
    /// The normalized life position `[0, 1]` the stop sits at.
    pub at: f32,
}

/// An F-curve over a particle's normalized life `[0, 1]`, evaluated `from → to` with
/// one of the [`model-core`](test_cabinet_model_core) interpolations. The size and
/// opacity of a particle are each shaped by one of these.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Curve {
    /// How the curve interpolates from `from` to `to`.
    pub interp: Interp,
    /// The value at life `0`.
    pub from: f64,
    /// The value at life `1`.
    pub to: f64,
}

impl Curve {
    /// A curve holding constant at `value`.
    pub fn constant(value: f64) -> Curve {
        Curve {
            interp: Interp::Constant,
            from: value,
            to: value,
        }
    }

    /// Sample the curve at normalized life `t` (clamped to `[0, 1]`).
    pub fn sample(&self, t: f64) -> f64 {
        self.from + (self.to - self.from) * ease_fraction(self.interp, t)
    }
}

/// The eased fraction `[0, 1]` an [`Interp`] maps a normalized input `s` to. The
/// preset eases mirror the CSS timing curves (the same shapes `model-core`'s F-curve
/// sampler uses), so a particle curve reads like a rig animation curve.
fn ease_fraction(interp: Interp, s: f64) -> f64 {
    let s = s.clamp(0.0, 1.0);
    match interp {
        Interp::Constant => {
            if s >= 1.0 {
                1.0
            } else {
                0.0
            }
        }
        Interp::Linear => s,
        // A plain Bézier with no handles reads as a smoothstep ease.
        Interp::Bezier => s * s * (3.0 - 2.0 * s),
        Interp::EaseIn => cubic_bezier_y(0.42, 0.0, 1.0, 1.0, s),
        Interp::EaseOut => cubic_bezier_y(0.0, 0.0, 0.58, 1.0, s),
        Interp::EaseInOut => cubic_bezier_y(0.42, 0.0, 0.58, 1.0, s),
    }
}

/// One coordinate of a cubic Bézier at parameter `u ∈ [0, 1]`, with endpoints at 0
/// and 1.
fn cubic(p1: f64, p2: f64, u: f64) -> f64 {
    let v = 1.0 - u;
    // p0 = 0, p3 = 1.
    3.0 * v * v * u * p1 + 3.0 * v * u * u * p2 + u * u * u
}

/// The `y` of a CSS-style cubic-bezier timing curve `(x1, y1, x2, y2)` at input `x`:
/// solve `bezier_x(u) = x` by bisection (monotonic across a timing curve), then take
/// `bezier_y(u)`.
fn cubic_bezier_y(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    let mut lo = 0.0;
    let mut hi = 1.0;
    for _ in 0..40 {
        let mid = (lo + hi) / 2.0;
        if cubic(x1, x2, mid) < x {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    cubic(y1, y2, (lo + hi) / 2.0)
}

/// The per-particle appearance over a particle's normalized life, scoped to an
/// emitter. Every field is optional so a [`crate::op::Op::SetParticle`] merges only
/// what it names.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticleAppearance {
    /// How a particle's size scales over its life.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_curve: Option<Curve>,
    /// How a particle's opacity fades over its life.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity_curve: Option<Curve>,
    /// Keyed color stops over life (ordered by [`ColorStop::at`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_gradient: Option<Vec<ColorStop>>,
    /// Spin rate, in degrees per second.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f32>,
    /// Velocity-stretch factor (a particle elongates along its motion).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stretch: Option<f32>,
    /// An optional cross-asset sprite/atlas reference the particles are textured with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sprite: Option<String>,
}

impl ParticleAppearance {
    /// Overlay `other`'s set fields onto `self`.
    pub fn merge_from(&mut self, other: &ParticleAppearance) {
        if other.size_curve.is_some() {
            self.size_curve = other.size_curve;
        }
        if other.opacity_curve.is_some() {
            self.opacity_curve = other.opacity_curve;
        }
        if other.color_gradient.is_some() {
            self.color_gradient = other.color_gradient.clone();
        }
        if other.rotation.is_some() {
            self.rotation = other.rotation;
        }
        if other.stretch.is_some() {
            self.stretch = other.stretch;
        }
        if other.sprite.is_some() {
            self.sprite = other.sprite.clone();
        }
    }

    /// The size factor at normalized life `t` (default `1.0` when no curve is set).
    pub fn size_at(&self, t: f64) -> f32 {
        self.size_curve.map(|c| c.sample(t)).unwrap_or(1.0) as f32
    }

    /// The opacity at normalized life `t` (default fully opaque when no curve is set),
    /// clamped to `[0, 1]`.
    pub fn opacity_at(&self, t: f64) -> f32 {
        self.opacity_curve
            .map(|c| c.sample(t))
            .unwrap_or(1.0)
            .clamp(0.0, 1.0) as f32
    }

    /// The color at normalized life `t`, sampled from the gradient (default white when
    /// no gradient is set), as linear `0..1` RGB.
    pub fn color_at(&self, t: f64) -> [f32; 3] {
        let Some(stops) = &self.color_gradient else {
            return [1.0, 1.0, 1.0];
        };
        sample_gradient(stops, t as f32)
    }
}

/// Sample a keyed color gradient at normalized life `t`, lerping between the two
/// bracketing stops. An empty gradient is white; before the first / after the last
/// stop clamps.
fn sample_gradient(stops: &[ColorStop], t: f32) -> [f32; 3] {
    match stops {
        [] => [1.0, 1.0, 1.0],
        [only] => rgb_to_linear(only.color),
        _ => {
            if t <= stops[0].at {
                return rgb_to_linear(stops[0].color);
            }
            let last = &stops[stops.len() - 1];
            if t >= last.at {
                return rgb_to_linear(last.color);
            }
            for pair in stops.windows(2) {
                let (a, b) = (&pair[0], &pair[1]);
                if t >= a.at && t <= b.at {
                    let span = (b.at - a.at).max(f32::EPSILON);
                    let f = (t - a.at) / span;
                    let ca = rgb_to_linear(a.color);
                    let cb = rgb_to_linear(b.color);
                    return [
                        ca[0] + (cb[0] - ca[0]) * f,
                        ca[1] + (cb[1] - ca[1]) * f,
                        ca[2] + (cb[2] - ca[2]) * f,
                    ];
                }
            }
            rgb_to_linear(last.color)
        }
    }
}

/// An opaque [`Rgb`] as `0..1` per-channel floats (the convention the shared mesh
/// renderer and the raster compositor read).
fn rgb_to_linear(rgb: Rgb) -> [f32; 3] {
    let [r, g, b] = rgb.0;
    [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0]
}

/// One emitter of the system: where and how it emits, and the appearance and forces
/// of the particles it spawns. A sub-emitter's child is an ordinary emitter here,
/// distinguished only by being named in a [`SubEmitter`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Emitter {
    /// The stable name a `set-forces` / `set-particle` / `add-subemitter` op targets.
    pub name: String,
    /// The emission-source shape.
    pub shape: Shape,
    /// The emitter position in world coordinates.
    pub position: [f32; 3],
    /// The shape's extent.
    pub extent: Extent,
    /// How the emitter releases particles.
    pub emission: Emission,
    /// Each particle's lifetime, in milliseconds.
    pub lifetime_ms: f32,
    /// The `±` spread applied to each particle's lifetime.
    #[serde(default)]
    pub lifetime_spread: f32,
    /// Each particle's launch speed, in world units per second.
    pub speed: f32,
    /// The `±` spread applied to each particle's speed.
    #[serde(default)]
    pub speed_spread: f32,
    /// The launch direction (normalized on use).
    pub direction: [f32; 3],
    /// The cone half-spread about [`Self::direction`], in degrees (`0` = a straight
    /// beam, `360` = a full sphere).
    #[serde(default)]
    pub cone_angle: f32,
    /// A seed pinning this emitter's random draws for a repeatable look; `None` lets
    /// each play vary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
    /// Per-emitter force overrides layered over the global forces.
    #[serde(default)]
    pub forces: Forces,
    /// The particle appearance.
    #[serde(default)]
    pub particle: ParticleAppearance,
}

/// When a sub-emitter's child fires: on a parent particle's death, or along its path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "cli", derive(clap::ValueEnum))]
pub enum SubTrigger {
    /// The child bursts when a parent particle dies (a shell into embers).
    Death,
    /// The child trails along a parent particle's path (a spark trailing smoke).
    Step,
}

/// A secondary system spawned from a parent emitter's particles.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubEmitter {
    /// The parent emitter whose particles trigger the child.
    pub parent: String,
    /// When the child fires.
    pub on: SubTrigger,
    /// The child emitter (a declared [`Emitter::name`]).
    pub emitter: String,
}

/// A whole authored particle system — the emitted `system.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct System {
    /// `2` for a planar effect, `3` for a volumetric one.
    pub dimensions: u8,
    /// The field the effect plays in.
    pub field: Field,
    /// The effect's length in milliseconds.
    pub duration_ms: u32,
    /// The preview/playback frame rate.
    pub fps: u32,
    /// Whether the effect loops (fire, smoke) or is a one-shot (an explosion).
    #[serde(rename = "loop")]
    pub looping: bool,
    /// The emitters, in declared order.
    pub emitters: Vec<Emitter>,
    /// The global forces (a per-emitter override layers over these).
    #[serde(default)]
    pub forces: Forces,
    /// The sub-emitter links.
    #[serde(default)]
    pub sub_emitters: Vec<SubEmitter>,
}

impl System {
    /// An empty system for `field` over `duration_ms` at `fps`, defaulting `loop` to
    /// the case's declared value.
    pub fn empty(
        dims: Dimensionality,
        field: Field,
        duration_ms: u32,
        fps: u32,
        looping: bool,
    ) -> System {
        System {
            dimensions: dims.count(),
            field,
            duration_ms,
            fps: fps.max(1),
            looping,
            emitters: Vec::new(),
            forces: Forces::default(),
            sub_emitters: Vec::new(),
        }
    }

    /// Find an emitter by name.
    pub fn emitter(&self, name: &str) -> Option<&Emitter> {
        self.emitters.iter().find(|e| e.name == name)
    }

    /// The set of emitter names that are the *child* of some sub-emitter — the ones
    /// the simulator spawns only on a trigger, never on their own timeline.
    pub fn sub_emitter_children(&self) -> Vec<&str> {
        self.sub_emitters
            .iter()
            .map(|s| s.emitter.as_str())
            .collect()
    }

    /// Whether the system is non-empty in the sense the validator checks: it declares
    /// at least one emitter, and at least one of them actually emits particles.
    pub fn is_non_empty(&self) -> bool {
        self.emitters.iter().any(|e| e.emission.emits())
    }
}
