//! A tiny, dependency-free deterministic PRNG for maze generation.
//!
//! The generator is seeded from the match seed so a `(seed, map)` pair always
//! produces the same maze. We hand-roll SplitMix64 rather than pull a crate
//! because the engine must compile to `wasm32-unknown-unknown` with no host and
//! the only randomness the engine needs is this generator — replays record
//! inputs, not RNG draws, so nothing else in the engine is stochastic.

/// SplitMix64 — a small, well-distributed 64-bit generator. Chosen for being a
/// few lines of pure integer arithmetic that behave identically on every target,
/// which is what makes a seed reproduce a maze bit-for-bit across native and
/// wasm.
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    /// Seed the generator. Any `u64` is a valid seed. `const` so a controller can
    /// hold a `SplitMix64` in a `static` (the reference `random` controller keeps
    /// its match-long stream in a module global).
    pub const fn new(seed: u64) -> SplitMix64 {
        SplitMix64 { state: seed }
    }

    /// The next 64-bit value in the stream.
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A value in `0..bound` (`bound` must be non-zero). Uses the simple modulo
    /// reduction; the slight bias is irrelevant for laying out a maze.
    pub fn below(&mut self, bound: usize) -> usize {
        debug_assert!(bound > 0, "below requires a non-zero bound");
        (self.next_u64() % bound as u64) as usize
    }

    /// `true` with probability `numerator / denominator`.
    pub fn chance(&mut self, numerator: u32, denominator: u32) -> bool {
        self.below(denominator as usize) < numerator as usize
    }
}
