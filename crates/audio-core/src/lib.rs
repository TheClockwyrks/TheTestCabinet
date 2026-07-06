//! The shared DSP, mixer, offline render engine, encoders, and preview renderers
//! behind the `sfx-synth`, `sfx-sample`, and `music` binaries.
//!
//! An audio asset-generation run authors a clip by
//! recording operations to an op log; rendering is a separate, on-request step that
//! mixes the recorded voices, samples, and effects down to interleaved PCM, encodes
//! a `.wav` (and, for `music`, a `.mid`), and draws a preview PNG (waveform +
//! spectrogram, plus a piano-roll for `music`). The render is **deterministic**:
//! synthesis noise draws from a fixed, config-seeded PRNG, so replaying the recorded
//! ops reproduces the same `.wav` byte-for-byte.
//!
//! The DSP primitives ([`synth`], [`effect`]), the offline mixer ([`sfx`], [`music`]),
//! the sample-library loader ([`sample`]), the encoders ([`wav`], [`midi`]), the FFT
//! ([`fft`]), and the PNG previews ([`preview`]) are all pure and build without the
//! `cli` feature, so `crates/core` can regenerate a clip from an op log without
//! linking clap. The `cli` feature adds the seeded [`config`] shapes, op-log
//! [`record`] plumbing, and the TOML pack-manifest reader.
//!
//! See `apps/docs/src/content/docs/testing/asset-generation/audio-binaries.md`.

mod canvas;
pub mod effect;
pub mod fft;
pub mod format;
pub mod midi;
pub mod music;
pub mod preview;
pub mod rng;
pub mod sample;
pub mod sfx;
pub mod synth;
pub mod wav;

#[cfg(feature = "cli")]
pub mod clap_ext;
#[cfg(feature = "cli")]
pub mod config;
#[cfg(feature = "cli")]
pub mod record;
#[cfg(feature = "cli")]
pub mod runner;

pub use format::{Channels, RenderParams, clip_length_samples};
