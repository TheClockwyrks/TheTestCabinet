use super::*;
use std::f64::consts::PI;

#[test]
fn dc_signal_has_energy_only_in_bin_zero() {
    let n = 16;
    let mut re = vec![1.0f64; n];
    let mut im = vec![0.0f64; n];
    fft_in_place(&mut re, &mut im);
    assert!((re[0] - n as f64).abs() < 1e-9);
    for k in 1..n {
        let mag = (re[k] * re[k] + im[k] * im[k]).sqrt();
        assert!(mag < 1e-9, "bin {k} should be ~0, got {mag}");
    }
}

#[test]
fn pure_tone_peaks_at_its_bin() {
    let n = 64;
    let bin = 4;
    let mut re: Vec<f64> = (0..n)
        .map(|i| (2.0 * PI * bin as f64 * i as f64 / n as f64).cos())
        .collect();
    let mut im = vec![0.0f64; n];
    fft_in_place(&mut re, &mut im);
    let mags: Vec<f64> = (0..n)
        .map(|k| (re[k] * re[k] + im[k] * im[k]).sqrt())
        .collect();
    // The largest magnitude in the lower half should be at `bin`.
    let peak = (1..n / 2)
        .max_by(|&a, &b| mags[a].partial_cmp(&mags[b]).unwrap())
        .unwrap();
    assert_eq!(peak, bin);
}

#[test]
fn spectrogram_shape_is_columns_by_bins() {
    let signal: Vec<f32> = (0..2048)
        .map(|i| (2.0 * PI * 10.0 * i as f64 / 256.0).sin() as f32)
        .collect();
    let cols = spectrogram(&signal, 256, 128);
    assert!(!cols.is_empty());
    for col in &cols {
        assert_eq!(col.len(), 128);
    }
}

#[test]
fn empty_signal_yields_no_columns() {
    assert!(spectrogram(&[], 256, 128).is_empty());
}
