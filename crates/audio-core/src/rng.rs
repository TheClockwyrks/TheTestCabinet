//! The seeded noise source behind every stochastic voice.
//!
//! The render is deterministic: rather than draw from the OS entropy, each noisy
//! voice draws from a [`Prng`] seeded from the config's fixed seed mixed with the
//! voice's index (see [`derive_seed`]), so replaying the recorded ops reproduces the
//! same waveform. The generator is SplitMix64 — a tiny, well-distributed 64-bit
//! state stepper — which is more than enough for white noise and needs no crate.

/// A small deterministic PRNG (SplitMix64). Seeded once per stochastic voice from a
/// derived seed; two runs with the same seed produce the same stream.
#[derive(Debug, Clone)]
pub struct Prng {
    state: u64,
}

impl Prng {
    /// Seed the generator.
    pub fn new(seed: u64) -> Prng {
        Prng { state: seed }
    }

    /// The next raw 64-bit value.
    pub fn next_u64(&mut self) -> u64 {
        // SplitMix64.
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// The next sample of white noise in `[-1.0, 1.0)`.
    pub fn next_bipolar(&mut self) -> f64 {
        // Take 53 bits for a double in [0, 1), then map to [-1, 1).
        let bits = self.next_u64() >> 11;
        let unit = bits as f64 / (1u64 << 53) as f64;
        unit * 2.0 - 1.0
    }
}

/// Derive a per-op seed from the run's fixed base seed and the op's index, so each
/// stochastic voice gets its own reproducible stream (a single base PRNG, one derived
/// seed per op index) without any two noise voices sharing a sequence.
pub fn derive_seed(base_seed: u64, index: usize) -> u64 {
    let mut z = base_seed
        .wrapping_add((index as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15))
        .wrapping_add(0xD1B5_4A32_D192_ED03);
    z = (z ^ (z >> 33)).wrapping_mul(0xFF51_AFD7_ED55_8CCD);
    z = (z ^ (z >> 33)).wrapping_mul(0xC4CE_B9FE_1A85_EC53);
    z ^ (z >> 33)
}

#[cfg(test)]
#[path = "rng.test.rs"]
mod tests;
