/**
 * The deterministic PRNG the simulator draws its stochastic spawns from — a faithful
 * port of `particle-core`'s SplitMix64 (`sim.rs`), so a *seeded* browser play replays
 * exactly and reads like the binary's captured preview. u64 arithmetic is carried in
 * `BigInt` to keep the finalizer's wrapping-multiply exact; the per-draw floats it
 * yields are ordinary numbers.
 *
 * A particle system carries no model-supplied seed: seeding is purely so a preview (or
 * a paused, inspected runtime frame) is reproducible. An unseeded runtime play varies
 * from play to play, which is correct for VFX.
 */
/** The SplitMix64 finalizer, used both as a PRNG step and a scalar hash (mirrors Rust `mix`). */
export declare function splitmix64(z0: bigint): bigint;
/** Reinterpret a JS number as a wrapped u64 `BigInt` (two's-complement for negatives). */
export declare function asU64(n: number): bigint;
/** Rotate a u64 `BigInt` left by `bits`. */
export declare function rotl64(x: bigint, bits: bigint): bigint;
/**
 * A small deterministic PRNG (SplitMix64), matching `particle-core`'s `Rng`. Seed with
 * a u64 (as a `BigInt`); `Rng.new` folds in the same salt the Rust constructor uses.
 */
export declare class Rng {
    private state;
    constructor(seed: bigint);
    nextU64(): bigint;
    /** A uniform `[0, 1)` float (top 24 bits, as in Rust). */
    unit(): number;
    /** A uniform `[-1, 1)` float. */
    symmetric(): number;
    /** A uniform point in a disc of `radius` (in the `xy` plane). */
    inDisc(radius: number): [number, number];
    /** A uniform point in a ball of `radius` (a disc when `twoD`). */
    inBall(radius: number, twoD: boolean): [number, number, number];
}
//# sourceMappingURL=rng.d.ts.map