/**
 * The resolved `[model]` of a voxel-animation case: the rig the model must
 * produce — named parts in a parent/child hierarchy and the named joints a
 * consuming game (or an auto-play clip) drives. This is the **required**
 * interface, the parts and joints a consuming game may rely on by name; a
 * produced rig may carry further parts and joints of its own, which `rig.json`
 * records and nothing here requires.
 */
export type ModelSpec = {
    /**
     * The declared parts, in declared order. The first is the root (its `parent`
     * is `None`); every other part names a declared parent.
     */
    parts: Array<PartSpec>;
    /**
     * The declared joints, in declared order. Each names a declared part.
     */
    joints: Array<JointSpec>;
    /**
     * The model's **animations** — one unified type across the pipeline. On the
     * *required* contract each is a declaration (its `joints` set, `tracks` empty),
     * seeded into `rig.json` from t=0; on the *produced* rig each additionally
     * carries the model-authored F-curve `tracks`. Empty when the case declares
     * none.
     */
    animations?: Array<AnimationSpec>;
};
/**
 * A resolved part of a [`ModelSpec`]: one named voxel component of the rig.
 */
export type PartSpec = {
    /**
     * Stable name of this part (for example `chassis`, `turret`). The `voxel-anim`
     * binary targets a part's voxel operations with `--part <name>`.
     */
    name: string;
    /**
     * The parent part this one is attached to, or `None` for the root part. A
     * part inherits its parent's world transform, so posing a parent moves it too.
     */
    parent?: string;
    /**
     * The attachment point of this part in the parent's local voxel coordinates
     * (`[x, y, z]`). For the root part this is its origin in world space.
     */
    pivot: [number, number, number];
};
/**
 * A resolved joint of a [`ModelSpec`]: one named degree of freedom on a part.
 *
 * A joint is either **caller-driven** (a consuming game supplies its value at
 * runtime, e.g. `turret_yaw`) or **`auto`** (driven only by the model's
 * [`AnimationSpec`] tracks, holding at `rest` until one overlays it). Rotations
 * are in radians about [`Self::axis`] through [`Self::pivot`]; translations are in
 * voxel units along the axis.
 */
export type JointSpec = {
    /**
     * Stable name of this joint; the parameter a game addresses (for example
     * `turret_yaw`).
     */
    name: string;
    /**
     * The part this joint moves (a declared [`PartSpec::name`]).
     */
    part: string;
    /**
     * Whether this joint rotates or translates the part.
     */
    kind: JointKindSpec;
    /**
     * The axis the joint acts about (rotation) or along (translation).
     */
    axis: AxisSpec;
    /**
     * The joint origin in the part's local voxel coordinates (`[x, y, z]`).
     */
    pivot: [number, number, number];
    /**
     * Minimum value: radians for a rotation, voxel units for a translation.
     */
    min: number;
    /**
     * Maximum value.
     */
    max: number;
    /**
     * The rest/default value, within `[min, max]`.
     */
    rest: number;
    /**
     * A fixed mount translation `[x, y, z]` (in voxels) this joint applies to the
     * part in addition to its driven motion — the translation half of a compound
     * attach. Absent (or all-zero) means no offset.
     */
    offset?: [number, number, number];
    /**
     * A fixed mount rotation `[x, y, z]` (radians, applied as Euler X→Y→Z about
     * [`Self::pivot`]) this joint applies in addition to its driven motion — the
     * rotation half of a compound attach. Absent (or all-zero) means no rotation.
     */
    orient?: [number, number, number];
    /**
     * Who drives this joint: a caller (a game) or the model's animations.
     */
    drive: DriveKindSpec;
};
/**
 * Whether a [`JointSpec`] rotates or translates its part.
 */
export type JointKindSpec = "rotation" | "translation";
/**
 * A principal axis a [`JointSpec`] acts about or along.
 */
export type AxisSpec = "x" | "y" | "z";
/**
 * Who drives a [`JointSpec`].
 */
export type DriveKindSpec = "caller" | "auto";
/**
 * How an [`AnimationSpec`] F-curve segment interpolates between two keyframes —
 * the graph-editor curve real 3D tools use, so motion carries weight and snap
 * instead of sliding linearly. Set per keyframe on the segment **leaving** it.
 */
export type InterpSpec = "constant" | "linear" | "bezier" | "ease-in" | "ease-out" | "ease-in-out";
/**
 * A resolved keyframe within an [`AnimationTrackSpec`] F-curve: a joint value at a
 * time offset, plus how the curve leaves this key.
 */
export type KeyframeSpec = {
    /**
     * Time offset from the start of the animation, in milliseconds
     * (`0..=period_ms`).
     */
    tMs: number;
    /**
     * The joint value at this time.
     */
    value: number;
    /**
     * Interpolation of the segment **leaving** this key.
     */
    interp: InterpSpec;
    /**
     * Bézier out-handle on this key as `[dt_ms, dvalue]` offset from the key;
     * `None` = auto tangent.
     */
    outHandle?: [number, number];
    /**
     * Bézier in-handle on this key as `[dt_ms, dvalue]` offset from the key; `None`
     * = auto tangent.
     */
    inHandle?: [number, number];
};
/**
 * A model **animation** — one unified type across the whole pipeline. On the
 * *required* contract it is a declaration: its [`Self::joints`] set is fixed and
 * [`Self::tracks`] is empty; the declaration is seeded into `rig.json` from t=0. On
 * the *produced* rig the model fills [`Self::tracks`] with the authored F-curve
 * motion. An animation is either an [`Self::auto_play`] decorative idle (played
 * continuously by default) or a named playable a game triggers.
 */
export type AnimationSpec = {
    /**
     * Stable, unique name a game plays this animation by (for example `walk`).
     */
    name: string;
    /**
     * The period in milliseconds — one full loop across every track.
     */
    periodMs: number;
    /**
     * Whether the animation loops (true) or plays once and holds the last pose.
     */
    looping: boolean;
    /**
     * Whether the animation plays continuously by default (a decorative idle) or is
     * a named playable a game triggers.
     */
    autoPlay: boolean;
    /**
     * The joints the animation is **required** to drive. Present on both the
     * declaration and the produced animation.
     */
    joints: Array<string>;
    /**
     * The authored F-curve tracks, one per driven joint. Empty for a pure required
     * declaration; filled on the produced rig.
     */
    tracks?: Array<AnimationTrackSpec>;
};
/**
 * One track of an [`AnimationSpec`]: the F-curve keyframes that drive a single
 * joint over the animation's timeline.
 */
export type AnimationTrackSpec = {
    /**
     * The joint this track drives (a declared [`JointSpec::name`]).
     */
    joint: string;
    /**
     * The keyframes, in time order, sampled over the animation's period.
     */
    keyframes: Array<KeyframeSpec>;
};
//# sourceMappingURL=index.d.ts.map