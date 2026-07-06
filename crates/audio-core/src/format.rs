//! The clip's output format — sample rate, channel layout, and length cap — and the
//! [`RenderParams`] every renderer threads through the DSP.

use serde::{Deserialize, Serialize};

/// The clip's channel layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channels {
    /// One channel: pans collapse and the mix is summed to a single stream.
    Mono,
    /// Two channels: voices pan across the stereo field (equal-power).
    Stereo,
}

impl Channels {
    /// The channel count (1 or 2).
    pub fn count(self) -> usize {
        match self {
            Channels::Mono => 1,
            Channels::Stereo => 2,
        }
    }
}

/// The fixed parameters every render threads through the DSP: the output sample
/// rate, channel layout, the hard length cap (`max_duration_ms`, at most 5000), and
/// the fixed synthesis seed that makes the noisy voices reproducible.
#[derive(Debug, Clone, Copy)]
pub struct RenderParams {
    /// Output sample rate in Hz.
    pub sample_rate: u32,
    /// Output channel layout.
    pub channels: Channels,
    /// The hard cap on the rendered clip's length in milliseconds (at most 5000).
    pub max_duration_ms: u32,
    /// The fixed seed the synthesis PRNG is seeded from, so noise is reproducible.
    pub seed: u64,
}

impl RenderParams {
    /// The hard length cap expressed in per-channel samples.
    pub fn max_samples(&self) -> usize {
        clip_length_samples(self.sample_rate, self.max_duration_ms)
    }

    /// Convert a duration in milliseconds to a per-channel sample count at this rate.
    pub fn ms_to_samples(&self, ms: f64) -> usize {
        ((ms / 1000.0) * self.sample_rate as f64).round().max(0.0) as usize
    }
}

/// The per-channel sample count for a duration in milliseconds at `sample_rate`.
pub fn clip_length_samples(sample_rate: u32, duration_ms: u32) -> usize {
    ((duration_ms as u64 * sample_rate as u64) / 1000) as usize
}
