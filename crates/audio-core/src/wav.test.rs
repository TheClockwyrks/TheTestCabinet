use super::*;

#[test]
fn header_is_canonical_pcm16() {
    let wav = encode_pcm16(&[0.0, 0.0], 44100, 2);
    assert_eq!(&wav[0..4], b"RIFF");
    assert_eq!(&wav[8..12], b"WAVE");
    assert_eq!(&wav[12..16], b"fmt ");
    // audio format = 1 (PCM)
    assert_eq!(u16::from_le_bytes([wav[20], wav[21]]), 1);
    // channels = 2
    assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 2);
    // sample rate
    assert_eq!(
        u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]),
        44100
    );
    // bits per sample = 16
    assert_eq!(u16::from_le_bytes([wav[34], wav[35]]), 16);
    assert_eq!(&wav[36..40], b"data");
    // 2 samples * 2 bytes = 4 data bytes
    assert_eq!(u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]), 4);
    assert_eq!(wav.len(), 44 + 4);
}

#[test]
fn round_trips_through_decode() {
    let samples: Vec<f32> = vec![0.0, 0.25, -0.5, 0.75, -1.0, 1.0];
    let wav = encode_pcm16(&samples, 22050, 2);
    let decoded = decode_pcm16(&wav).expect("decode");
    assert_eq!(decoded.sample_rate, 22050);
    assert_eq!(decoded.channels, 2);
    assert_eq!(decoded.samples.len(), samples.len());
    for (a, b) in samples.iter().zip(decoded.samples.iter()) {
        // 16-bit quantization tolerance.
        assert!((a - b).abs() < 1.0 / 32000.0, "{a} vs {b}");
    }
}

#[test]
fn out_of_range_is_clamped() {
    let wav = encode_pcm16(&[2.0, -2.0], 8000, 1);
    let decoded = decode_pcm16(&wav).expect("decode");
    assert!((decoded.samples[0] - 1.0).abs() < 1e-3);
    assert!((decoded.samples[1] + 1.0).abs() < 1e-3);
}

#[test]
fn rejects_non_riff() {
    let mut junk = vec![0u8; 64];
    junk[0] = b'X';
    assert!(decode_pcm16(&junk).is_err());
}
