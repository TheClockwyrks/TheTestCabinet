//! A hand-rolled radix-2 FFT and the short-time spectrogram it powers.
//!
//! The spectrogram preview needs a forward FFT; an iterative Cooley-Tukey radix-2
//! transform is a few dozen lines and needs no crate. Window sizes are always powers
//! of two (the spectrogram picks one), so the radix-2 restriction is not a
//! limitation here.

use std::f64::consts::PI;

/// An in-place iterative radix-2 Cooley-Tukey FFT. `re` and `im` are the real and
/// imaginary parts of the signal; their length **must** be a power of two. On return
/// they hold the transform. A negative-exponent (forward) transform, unnormalized.
pub fn fft_in_place(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    assert_eq!(n, im.len(), "re/im length mismatch");
    if n <= 1 {
        return;
    }
    assert!(n.is_power_of_two(), "fft length must be a power of two");

    // Bit-reversal permutation.
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    // Danielson-Lanczos butterflies.
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * PI / len as f64;
        let (wlen_re, wlen_im) = (ang.cos(), ang.sin());
        let mut i = 0;
        while i < n {
            let (mut w_re, mut w_im) = (1.0f64, 0.0f64);
            for k in 0..len / 2 {
                let a = i + k;
                let b = i + k + len / 2;
                let u_re = re[a];
                let u_im = im[a];
                let v_re = re[b] * w_re - im[b] * w_im;
                let v_im = re[b] * w_im + im[b] * w_re;
                re[a] = u_re + v_re;
                im[a] = u_im + v_im;
                re[b] = u_re - v_re;
                im[b] = u_im - v_im;
                let nw_re = w_re * wlen_re - w_im * wlen_im;
                let nw_im = w_re * wlen_im + w_im * wlen_re;
                w_re = nw_re;
                w_im = nw_im;
            }
            i += len;
        }
        len <<= 1;
    }
}

/// The magnitude spectrogram of a mono signal: a column of `window / 2` frequency
/// bins for each Hann-windowed frame, stepped by `hop`. `window` must be a power of
/// two. Returns `(columns, bins)` where `columns[t][f]` is the magnitude of bin `f`
/// at frame `t`. An empty signal yields no columns.
pub fn spectrogram(signal: &[f32], window: usize, hop: usize) -> Vec<Vec<f64>> {
    assert!(window.is_power_of_two() && window >= 2, "window pow2 >= 2");
    let hop = hop.max(1);
    let bins = window / 2;
    if signal.is_empty() {
        return Vec::new();
    }
    // Precompute the Hann window.
    let hann: Vec<f64> = (0..window)
        .map(|n| 0.5 - 0.5 * (2.0 * PI * n as f64 / window as f64).cos())
        .collect();

    let mut columns = Vec::new();
    let mut start = 0usize;
    // Emit at least one column even for a signal shorter than the window.
    loop {
        let mut re = vec![0.0f64; window];
        let mut im = vec![0.0f64; window];
        for n in 0..window {
            let idx = start + n;
            let s = if idx < signal.len() {
                signal[idx] as f64
            } else {
                0.0
            };
            re[n] = s * hann[n];
        }
        fft_in_place(&mut re, &mut im);
        let col: Vec<f64> = (0..bins)
            .map(|f| (re[f] * re[f] + im[f] * im[f]).sqrt())
            .collect();
        columns.push(col);
        if start + window >= signal.len() {
            break;
        }
        start += hop;
    }
    columns
}

#[cfg(test)]
#[path = "fft.test.rs"]
mod tests;
