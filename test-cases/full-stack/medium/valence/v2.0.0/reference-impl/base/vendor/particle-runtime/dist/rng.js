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
const U64 = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;
const M1 = 0xbf58476d1ce4e5b9n;
const M2 = 0x94d049bb133111ebn;
/** The SplitMix64 finalizer, used both as a PRNG step and a scalar hash (mirrors Rust `mix`). */
export function splitmix64(z0) {
    let z = (z0 + GOLDEN) & U64;
    z = ((z ^ (z >> 30n)) * M1) & U64;
    z = ((z ^ (z >> 27n)) * M2) & U64;
    return (z ^ (z >> 31n)) & U64;
}
/** Reinterpret a JS number as a wrapped u64 `BigInt` (two's-complement for negatives). */
export function asU64(n) {
    return BigInt.asUintN(64, BigInt(Math.trunc(n)));
}
/** Rotate a u64 `BigInt` left by `bits`. */
export function rotl64(x, bits) {
    const b = bits & 63n;
    return ((x << b) | (x >> (64n - b))) & U64;
}
/**
 * A small deterministic PRNG (SplitMix64), matching `particle-core`'s `Rng`. Seed with
 * a u64 (as a `BigInt`); `Rng.new` folds in the same salt the Rust constructor uses.
 */
export class Rng {
    state;
    constructor(seed) {
        this.state = (seed ^ 0xdeadbeefcafef00dn) & U64;
    }
    nextU64() {
        this.state = (this.state + GOLDEN) & U64;
        return splitmix64(this.state);
    }
    /** A uniform `[0, 1)` float (top 24 bits, as in Rust). */
    unit() {
        return Number(this.nextU64() >> 40n) / (1 << 24);
    }
    /** A uniform `[-1, 1)` float. */
    symmetric() {
        return this.unit() * 2 - 1;
    }
    /** A uniform point in a disc of `radius` (in the `xy` plane). */
    inDisc(radius) {
        const r = radius * Math.sqrt(this.unit());
        const a = this.unit() * Math.PI * 2;
        return [r * Math.cos(a), r * Math.sin(a)];
    }
    /** A uniform point in a ball of `radius` (a disc when `twoD`). */
    inBall(radius, twoD) {
        if (twoD) {
            const d = this.inDisc(radius);
            return [d[0], d[1], 0];
        }
        const u = Math.cbrt(this.unit()) * radius;
        const z = this.symmetric();
        const phi = this.unit() * Math.PI * 2;
        const s = Math.sqrt(Math.max(1 - z * z, 0));
        return [u * s * Math.cos(phi), u * s * Math.sin(phi), u * z];
    }
}
//# sourceMappingURL=rng.js.map