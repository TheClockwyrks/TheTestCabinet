//! A tiny, dependency-free, deterministic PRNG for the seeded stochastic
//! operations (scattered brushes, `noise`, textured brushes, `warp`).
//!
//! Randomness in the UI/material tools is never supplied by the model: `init`
//! records the asset's seed as the first log entry, and every operation that needs
//! randomness derives its **own** seed from it by operation index
//! ([`derive_seed`]). Replaying the recorded log therefore reproduces the exact
//! same stochastic result without the model choosing any random value. This uses
//! SplitMix64 — small, fast, and identical across platforms — so the derivation is
//! stable wherever the log is replayed.

/// A SplitMix64 generator: a 64-bit state advanced one step per draw.
#[derive(Debug, Clone, Copy)]
pub struct Rng {
    state: u64,
}

impl Rng {
    /// Seed a generator with an explicit 64-bit seed.
    pub fn new(seed: u64) -> Rng {
        Rng { state: seed }
    }

    /// The next raw 64-bit value.
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// The next `f32` in `[0, 1)`.
    pub fn next_f32(&mut self) -> f32 {
        // 24 bits of mantissa precision, scaled into the unit interval.
        ((self.next_u64() >> 40) as f32) / ((1u32 << 24) as f32)
    }

    /// The next `f32` in `[-1, 1)`.
    pub fn next_signed(&mut self) -> f32 {
        self.next_f32() * 2.0 - 1.0
    }
}

/// Derive a per-operation seed from the asset seed and the operation's index in the
/// recorded log, so a stochastic operation is reproducible from the log alone.
pub fn derive_seed(asset_seed: u64, op_index: usize) -> u64 {
    let mut rng = Rng::new(asset_seed ^ (op_index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    rng.next_u64()
}

#[cfg(test)]
#[path = "rng.test.rs"]
mod tests;
