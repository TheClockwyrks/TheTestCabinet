//! A hand-rolled PCM WAV encoder (and a decoder for round-trip tests).
//!
//! The emitted asset is a finished PCM `.wav` — binary, per the data-format
//! principle. A canonical 16-bit PCM WAV is a tiny, well-specified container (a RIFF
//! `WAVE` chunk carrying a `fmt ` sub-chunk and a `data` sub-chunk), so it is
//! hand-rolled here rather than pulling an audio crate: the whole encoder is a header
//! plus a little-endian `i16` per sample. Float samples are clamped to `[-1, 1]` and
//! quantized to signed 16-bit, the format a game and the review UI's `<audio>`
//! element both play directly.

/// Encode interleaved float samples (in `[-1, 1]`) as a 16-bit PCM WAV.
///
/// `samples` is interleaved by channel — for stereo, `[l0, r0, l1, r1, …]`. Values
/// outside `[-1, 1]` are clamped (the mixer already limits, but this keeps the
/// encoder total). The output is a complete `.wav` file ready to write to disk.
pub fn encode_pcm16(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
    let bits_per_sample: u16 = 16;
    let bytes_per_sample = (bits_per_sample / 8) as u32;
    let block_align = channels as u32 * bytes_per_sample;
    let byte_rate = sample_rate * block_align;
    let data_len = samples.len() as u32 * bytes_per_sample;

    let mut out = Vec::with_capacity(44 + data_len as usize);
    // RIFF header.
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes()); // chunk size = 36 + data
    out.extend_from_slice(b"WAVE");
    // fmt sub-chunk.
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // audio format = 1 (PCM)
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&(block_align as u16).to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    // data sub-chunk.
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        // Symmetric quantization to i16.
        let q = (clamped * i16::MAX as f32).round() as i32;
        let q = q.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
        out.extend_from_slice(&q.to_le_bytes());
    }
    out
}

/// A decoded PCM WAV: its interleaved float samples and its format.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedWav {
    /// Interleaved float samples in `[-1, 1]`.
    pub samples: Vec<f32>,
    /// Sample rate in Hz.
    pub sample_rate: u32,
    /// Channel count.
    pub channels: u16,
}

/// Decode a 16-bit PCM WAV produced by [`encode_pcm16`]. Used by the round-trip
/// tests and any consumer that wants to re-read an emitted clip; it accepts the
/// canonical layout this crate writes (it is not a general-purpose WAV parser).
pub fn decode_pcm16(bytes: &[u8]) -> Result<DecodedWav, String> {
    if bytes.len() < 44 {
        return Err("wav too short for a RIFF/WAVE header".to_string());
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a RIFF/WAVE file".to_string());
    }
    // Walk the sub-chunks so a decoder tolerates ordering; we only need fmt + data.
    let mut pos = 12;
    let mut channels = 0u16;
    let mut sample_rate = 0u32;
    let mut bits = 0u16;
    let mut data: Option<&[u8]> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        let body_start = pos + 8;
        let body_end = (body_start + size).min(bytes.len());
        match id {
            b"fmt " => {
                let f = &bytes[body_start..body_end];
                if f.len() < 16 {
                    return Err("truncated fmt chunk".to_string());
                }
                channels = u16::from_le_bytes([f[2], f[3]]);
                sample_rate = u32::from_le_bytes([f[4], f[5], f[6], f[7]]);
                bits = u16::from_le_bytes([f[14], f[15]]);
            }
            b"data" => data = Some(&bytes[body_start..body_end]),
            _ => {}
        }
        // Chunks are word-aligned (padded to an even byte count).
        pos = body_start + size + (size & 1);
    }
    if bits != 16 {
        return Err(format!("expected 16-bit PCM, got {bits}-bit"));
    }
    let data = data.ok_or_else(|| "missing data chunk".to_string())?;
    let mut samples = Vec::with_capacity(data.len() / 2);
    for frame in data.chunks_exact(2) {
        let q = i16::from_le_bytes([frame[0], frame[1]]);
        samples.push(q as f32 / i16::MAX as f32);
    }
    Ok(DecodedWav {
        samples,
        sample_rate,
        channels,
    })
}

#[cfg(test)]
#[path = "wav.test.rs"]
mod tests;
