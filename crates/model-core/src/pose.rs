//! Rig posing: sample a model-authored animation at an instant and resolve each
//! part's world transform, so a tool's `render --time` can show the model actually
//! posed at that point of the animation.
//!
//! This is a faithful Rust port of the TypeScript `voxel-runtime`'s
//! `clips.ts` (F-curve sampling) and `hierarchy.ts` (joint transforms + parent
//! composition). The two implementations MUST stay in semantic lockstep — and with
//! the glTF exporter's `rotation` — so an in-container `--time` preview poses a rig
//! the same way the web/desktop client and the exported clips do. In particular the
//! **pitch** convention (a positive rotation about `x` lifts a forward `+z` part up
//! toward `+y`) is the deliberate mirror of a plain right-handed x-rotation, matched
//! here by negating the angle for the `x` axis (see [`rotation`]).

use std::collections::{HashMap, HashSet};

use glam::{Mat4, Vec3};

use crate::axis::Axis;
use crate::rig::{Animation, Interp, Joint, JointKind, Keyframe, Part, Rig};

/// One keyframe in the `f64` time space the sampler works in. Real [`Keyframe`]s
/// carry a `u32` time; the loop-wrap synthetic neighbours need times outside
/// `[0, period]` (even negative), so sampling lifts every key into this shape first.
#[derive(Clone, Copy)]
struct Kf {
    t: f64,
    value: f64,
    interp: Interp,
    out_handle: Option<[f64; 2]>,
    in_handle: Option<[f64; 2]>,
}

impl From<&Keyframe> for Kf {
    fn from(k: &Keyframe) -> Kf {
        Kf {
            t: k.t_ms as f64,
            value: k.value,
            interp: k.interp,
            out_handle: k.out_handle,
            in_handle: k.in_handle,
        }
    }
}

/// Sample an [`Animation`] at `time_ms` into a joint-value map, one entry per track —
/// the values that pose the rig at this instant. Every track shares the animation's
/// period and loop flag. Feed the result to [`pose_rig`] as the caller map.
pub fn sample_animation(animation: &Animation, time_ms: f64) -> HashMap<String, f64> {
    let mut values = HashMap::new();
    for track in &animation.tracks {
        values.insert(
            track.joint.clone(),
            sample_keyframes(
                &track.keyframes,
                animation.period_ms as f64,
                animation.looping,
                time_ms,
            ),
        );
    }
    values
}

/// Sample an F-curve track at `time_ms`. Each keyframe's `interp` sets how the curve
/// **leaves** it (the segment to the next key). Empty track → `0`; a single key → its
/// value; before the first / after the last key clamps to that value, except that a
/// looping track whose last key ends before the period evaluates the seamless wrap
/// segment (last → first). A direct port of `clips.ts`'s `sampleKeyframes`.
fn sample_keyframes(frames: &[Keyframe], period_ms: f64, looping: bool, time_ms: f64) -> f64 {
    let n = frames.len();
    if n == 0 {
        return 0.0;
    }
    let first = Kf::from(&frames[0]);
    if n == 1 {
        return first.value;
    }
    let last = Kf::from(&frames[n - 1]);

    let mut t = time_ms;
    if looping && period_ms > 0.0 {
        t = ((t % period_ms) + period_ms) % period_ms;
    }

    if t <= first.t {
        return first.value;
    }

    if t >= last.t {
        // Seamless wrap: the segment from the last key back to the first, spanning
        // `[last.t, period]`, using the first key's interpolation. Neighbours for auto
        // tangents wrap around the loop.
        if looping && period_ms > last.t {
            let wrap = Kf {
                t: period_ms,
                value: first.value,
                interp: first.interp,
                out_handle: None,
                in_handle: None,
            };
            let prev = Some(Kf::from(&frames[n - 2]));
            let next = Some(Kf::from(&frames[1]));
            return eval_segment(last, wrap, prev, next, t);
        }
        return last.value;
    }

    for i in 0..n - 1 {
        let a = Kf::from(&frames[i]);
        let b = Kf::from(&frames[i + 1]);
        if t >= a.t && t <= b.t {
            let prev = if i > 0 {
                Some(Kf::from(&frames[i - 1]))
            } else if looping {
                Some(wrap_before(&last, period_ms))
            } else {
                None
            };
            let next = if i + 2 < n {
                Some(Kf::from(&frames[i + 2]))
            } else if looping {
                Some(wrap_after(&first, period_ms))
            } else {
                None
            };
            return eval_segment(a, b, prev, next, t);
        }
    }

    last.value
}

/// The synthetic neighbour *before* the first key when looping: the last key shifted
/// one period earlier, so the auto tangent at the first key is continuous across the
/// loop seam.
fn wrap_before(last: &Kf, period_ms: f64) -> Kf {
    Kf {
        t: last.t - period_ms,
        value: last.value,
        interp: last.interp,
        out_handle: None,
        in_handle: None,
    }
}

/// The synthetic neighbour *after* the last key when looping: the first key shifted
/// one period later.
fn wrap_after(first: &Kf, period_ms: f64) -> Kf {
    Kf {
        t: first.t + period_ms,
        value: first.value,
        interp: first.interp,
        out_handle: None,
        in_handle: None,
    }
}

/// Evaluate one F-curve segment `a → b` at time `t` (with `a.t <= t <= b.t`), per
/// `a.interp`. `prev`/`next` are neighbouring keys used only for auto tangents.
fn eval_segment(a: Kf, b: Kf, prev: Option<Kf>, next: Option<Kf>, t: f64) -> f64 {
    let dt = b.t - a.t;
    if dt <= 0.0 {
        return b.value;
    }
    match a.interp {
        Interp::Constant => a.value,
        Interp::Linear => a.value + (b.value - a.value) * ((t - a.t) / dt),
        _ => eval_bezier(a, b, prev, next, t, dt),
    }
}

/// A cubic-Bézier segment `a → b`, its handles resolved from an easing preset,
/// explicit `[dt_ms, dvalue]` handles, or auto tangents.
fn eval_bezier(a: Kf, b: Kf, prev: Option<Kf>, next: Option<Kf>, t: f64, dt: f64) -> f64 {
    // The easing presets mirror the CSS curves: ease-in = cubic-bezier(0.42,0,1,1),
    // ease-out = cubic-bezier(0,0,0.58,1), ease-in-out = cubic-bezier(0.42,0,0.58,1).
    // Every preset's value-offset component is zero, so the handles sit on each key's
    // own value line — only the time component shifts. A preset ignores explicit
    // handles.
    let (a_out, b_in) = match a.interp {
        Interp::EaseIn => ([a.t + 0.42 * dt, a.value], [b.t, b.value]),
        Interp::EaseOut => ([a.t, a.value], [b.t - 0.42 * dt, b.value]),
        Interp::EaseInOut => ([a.t + 0.42 * dt, a.value], [b.t - 0.42 * dt, b.value]),
        // `bezier`: explicit `[dt_ms, dvalue]` handles, else an auto tangent from the
        // neighbours.
        _ => {
            let a_out = match a.out_handle {
                Some(h) => [a.t + h[0], a.value + h[1]],
                None => auto_out(a, b, prev, dt),
            };
            let b_in = match b.in_handle {
                Some(h) => [b.t + h[0], b.value + h[1]],
                None => auto_in(a, b, next, dt),
            };
            (a_out, b_in)
        }
    };

    bezier_value_at_time([a.t, a.value], a_out, b_in, [b.t, b.value], t)
}

/// Auto out-handle at `a` for the segment `a → b`: slope from `a`'s neighbours, a
/// third of the segment out.
fn auto_out(a: Kf, b: Kf, prev: Option<Kf>, dt: f64) -> [f64; 2] {
    let slope = match prev {
        Some(p) => (b.value - p.value) / (b.t - p.t),
        None => (b.value - a.value) / dt,
    };
    let h = dt / 3.0;
    [a.t + h, a.value + slope * h]
}

/// Auto in-handle at `b` for the segment `a → b`: slope from `b`'s neighbours, a
/// third of the segment back.
fn auto_in(a: Kf, b: Kf, next: Option<Kf>, dt: f64) -> [f64; 2] {
    let slope = match next {
        Some(nx) => (nx.value - a.value) / (nx.t - a.t),
        None => (b.value - a.value) / dt,
    };
    let h = dt / 3.0;
    [b.t - h, b.value - slope * h]
}

/// One coordinate of a cubic Bézier at parameter `s ∈ [0, 1]`.
fn cubic(p0: f64, p1: f64, p2: f64, p3: f64, s: f64) -> f64 {
    let u = 1.0 - s;
    u * u * u * p0 + 3.0 * u * u * s * p1 + 3.0 * u * s * s * p2 + s * s * s * p3
}

/// Value of a cubic Bézier `(time, value)` curve at a query `time`: solve `x(s) =
/// time` for `s` by bisection (`x` is monotonic across a well-formed segment), then
/// evaluate `y(s)`.
fn bezier_value_at_time(
    p0: [f64; 2],
    p1: [f64; 2],
    p2: [f64; 2],
    p3: [f64; 2],
    time: f64,
) -> f64 {
    let mut lo = 0.0;
    let mut hi = 1.0;
    for _ in 0..40 {
        let mid = (lo + hi) / 2.0;
        if cubic(p0[0], p1[0], p2[0], p3[0], mid) < time {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let s = (lo + hi) / 2.0;
    cubic(p0[1], p1[1], p2[1], p3[1], s)
}

/// The index of a principal axis in an `[x, y, z]` vector.
fn axis_index(axis: Axis) -> usize {
    match axis {
        Axis::X => 0,
        Axis::Y => 1,
        Axis::Z => 2,
    }
}

/// Whether a fixed-mount vector is non-zero (so the mount contributes a transform).
fn non_zero(v: [f64; 3]) -> bool {
    v[0] != 0.0 || v[1] != 0.0 || v[2] != 0.0
}

/// Clamp `value` to `[min, max]`, matching the TS clamp's behaviour for any argument
/// order (a `min > max` rig clamps toward `min`).
fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

/// Rotation of `angle` radians about a principal `axis`, as a column-major matrix.
///
/// `y` (yaw) and `z` (roll) are right-handed. `x` (**pitch**) is the deliberate
/// mirror of a right-handed x-rotation — a positive angle lifts a forward (`+z`) part
/// **up** toward `+y` — matched by negating the angle. This is the same convention the
/// `voxel-runtime` `rotation` and the glTF exporter use; keep the three in sync.
fn rotation(axis: Axis, angle: f32) -> Mat4 {
    match axis {
        Axis::X => Mat4::from_rotation_x(-angle),
        Axis::Y => Mat4::from_rotation_y(angle),
        Axis::Z => Mat4::from_rotation_z(angle),
    }
}

/// A fixed rotation expressed as intrinsic Euler angles `[x, y, z]` (radians), applied
/// X→Y→Z, as `Rz · Ry · Rx`.
fn euler_rotation(euler: [f64; 3]) -> Mat4 {
    rotation(Axis::Z, euler[2] as f32)
        * rotation(Axis::Y, euler[1] as f32)
        * rotation(Axis::X, euler[0] as f32)
}

/// The local transform a single joint contributes at `value`: its fixed compound
/// mount (`orient` rotation about the pivot and `offset` translation, applied
/// regardless of the driven value) composed with its driven single-axis motion, as
/// `mount · driven`. A joint with no mount contributes only the driven motion.
fn joint_matrix(joint: &Joint, value: f64) -> Mat4 {
    let p = Vec3::new(
        joint.pivot[0] as f32,
        joint.pivot[1] as f32,
        joint.pivot[2] as f32,
    );

    let driven = match joint.kind {
        JointKind::Translation => {
            let mut t = Vec3::ZERO;
            t[axis_index(joint.axis)] = value as f32;
            Mat4::from_translation(t)
        }
        // Rotation about the joint's own pivot: T(pivot) · R(axis, value) · T(-pivot).
        JointKind::Rotation => {
            Mat4::from_translation(p) * rotation(joint.axis, value as f32) * Mat4::from_translation(-p)
        }
    };

    if !non_zero(joint.offset) && !non_zero(joint.orient) {
        return driven;
    }

    // The fixed mount: a rotation about the pivot, then a translation, applied outside
    // the driven motion so the component is posed and then mounted.
    let mut mount = Mat4::IDENTITY;
    if non_zero(joint.orient) {
        mount = Mat4::from_translation(p) * euler_rotation(joint.orient) * Mat4::from_translation(-p);
    }
    if non_zero(joint.offset) {
        let offset = Vec3::new(
            joint.offset[0] as f32,
            joint.offset[1] as f32,
            joint.offset[2] as f32,
        );
        mount = Mat4::from_translation(offset) * mount;
    }
    mount * driven
}

/// Resolve the scalar value a joint poses at this frame: its value from the `caller`
/// map (a game supplies caller-driven joints; an animation overlays its `auto` joints
/// onto the same map), falling back to `rest`, clamped to `[min, max]`.
fn joint_value(joint: &Joint, caller: &HashMap<String, f64>) -> f64 {
    let value = caller.get(&joint.name).copied().unwrap_or(joint.rest);
    clamp(value, joint.min, joint.max)
}

/// Pose a rig into per-part world matrices, in the rig's part order.
///
/// For each part `world = parentWorld · joint₀ · joint₁ …` over the joints declared on
/// the part, composed in declared order. Parts are sculpted in the shared volume's
/// world coordinates (already sitting where they belong on the assembled model), so a
/// part contributes no placement translation of its own — its joints' pivots are the
/// anchors they rotate about. At rest a part stays exactly where it was sculpted.
/// Every joint reads its value from `caller` (see [`joint_value`]). A part naming a
/// missing parent, or a parent cycle, is treated as a root. A direct port of
/// `hierarchy.ts`'s `poseRig`.
pub fn pose_rig(rig: &Rig, caller: &HashMap<String, f64>) -> Vec<(String, Mat4)> {
    let part_by_name: HashMap<&str, &Part> =
        rig.parts.iter().map(|p| (p.name.as_str(), p)).collect();
    let mut joints_by_part: HashMap<&str, Vec<&Joint>> = HashMap::new();
    for joint in &rig.joints {
        joints_by_part
            .entry(joint.part.as_str())
            .or_default()
            .push(joint);
    }

    let mut world_by_name: HashMap<String, Mat4> = HashMap::new();
    rig.parts
        .iter()
        .map(|p| {
            let mut seen = HashSet::new();
            seen.insert(p.name.clone());
            let m = resolve_world(
                &p.name,
                &part_by_name,
                &joints_by_part,
                caller,
                &mut world_by_name,
                &seen,
            );
            (p.name.clone(), m)
        })
        .collect()
}

/// Resolve one part's world matrix, memoising into `world_by_name`. `seen` guards
/// against parent cycles (a part whose parent chain loops back is treated as a root).
fn resolve_world(
    name: &str,
    part_by_name: &HashMap<&str, &Part>,
    joints_by_part: &HashMap<&str, Vec<&Joint>>,
    caller: &HashMap<String, f64>,
    world_by_name: &mut HashMap<String, Mat4>,
    seen: &HashSet<String>,
) -> Mat4 {
    if let Some(cached) = world_by_name.get(name) {
        return *cached;
    }
    let part = part_by_name[name];

    let mut local = Mat4::IDENTITY;
    if let Some(joints) = joints_by_part.get(name) {
        for joint in joints {
            local *= joint_matrix(joint, joint_value(joint, caller));
        }
    }

    let world = match &part.parent {
        Some(parent)
            if part_by_name.contains_key(parent.as_str()) && !seen.contains(parent) =>
        {
            let mut next_seen = seen.clone();
            next_seen.insert(name.to_string());
            let parent_world = resolve_world(
                parent,
                part_by_name,
                joints_by_part,
                caller,
                world_by_name,
                &next_seen,
            );
            parent_world * local
        }
        _ => local,
    };

    world_by_name.insert(name.to_string(), world);
    world
}

/// Transform a mesh's flat `positions` (as points) and `normals` (as directions) by a
/// world matrix, returning fresh arrays. Used to pose each part's rest mesh into its
/// animated place before rendering. The transforms are rigid, so normals are rotated
/// and renormalised.
pub fn transform_mesh(positions: &[f32], normals: &[f32], m: &Mat4) -> (Vec<f32>, Vec<f32>) {
    let mut out_pos = Vec::with_capacity(positions.len());
    for c in positions.chunks_exact(3) {
        let v = m.transform_point3(Vec3::new(c[0], c[1], c[2]));
        out_pos.extend_from_slice(&[v.x, v.y, v.z]);
    }
    let mut out_norm = Vec::with_capacity(normals.len());
    for c in normals.chunks_exact(3) {
        let v = m
            .transform_vector3(Vec3::new(c[0], c[1], c[2]))
            .normalize_or_zero();
        out_norm.extend_from_slice(&[v.x, v.y, v.z]);
    }
    (out_pos, out_norm)
}

#[cfg(test)]
#[path = "pose.test.rs"]
mod tests;
