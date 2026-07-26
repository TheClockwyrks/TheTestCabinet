//! The 2D preview PNGs the model reads to see its progress: a waveform, a
//! spectrogram, and (for `music`) a piano-roll, stacked into one image.
//!
//! The model cannot hear its output, so the preview is the honest substitute: the
//! waveform shows the amplitude envelope (attack, sustain, the decaying tail), the
//! spectrogram shows the spectral content over time (a transient, a pitch sweep, a
//! filter sweep are all visible), and the piano-roll shows the sequenced notes. There
//! is no 3D render here — these are ordinary 2D panels drawn on the small
//! `crate::canvas` surface.

use crate::canvas::{Canvas, Rgb};
use crate::fft::spectrogram;
use crate::music::PianoRoll;

/// The preview width in pixels.
const WIDTH: u32 = 1024;
/// Each stacked panel's height in pixels.
const PANEL: u32 = 220;
/// The gap between panels.
const GAP: u32 = 12;

const BG: Rgb = [18, 20, 26];
const PANEL_BG: Rgb = [26, 29, 38];
const AXIS: Rgb = [70, 76, 92];
const WAVE: Rgb = [90, 200, 250];
const WAVE_MID: Rgb = [45, 120, 160];

/// Render the sound-effect preview (waveform + spectrogram) as PNG bytes.
pub fn render_sfx_preview(samples: &[f32], channels: usize, sample_rate: u32) -> Vec<u8> {
    let mono = to_mono(samples, channels);
    let height = GAP + PANEL + GAP + PANEL + GAP;
    let mut canvas = Canvas::new(WIDTH, height, BG);
    draw_waveform(&mut canvas, 0, GAP as i64, WIDTH, PANEL, &mono);
    draw_spectrogram(
        &mut canvas,
        0,
        (GAP + PANEL + GAP) as i64,
        WIDTH,
        PANEL,
        &mono,
        sample_rate,
    );
    canvas.to_png_bytes()
}

/// Render the music preview (waveform + spectrogram + piano-roll) as PNG bytes.
pub fn render_music_preview(
    samples: &[f32],
    channels: usize,
    sample_rate: u32,
    roll: &PianoRoll,
) -> Vec<u8> {
    let mono = to_mono(samples, channels);
    let height = GAP + PANEL + GAP + PANEL + GAP + PANEL + GAP;
    let mut canvas = Canvas::new(WIDTH, height, BG);
    draw_waveform(&mut canvas, 0, GAP as i64, WIDTH, PANEL, &mono);
    draw_spectrogram(
        &mut canvas,
        0,
        (GAP + PANEL + GAP) as i64,
        WIDTH,
        PANEL,
        &mono,
        sample_rate,
    );
    draw_piano_roll(
        &mut canvas,
        0,
        (GAP + PANEL + GAP + PANEL + GAP) as i64,
        WIDTH,
        PANEL,
        roll,
    );
    canvas.to_png_bytes()
}

/// Average interleaved samples to a mono envelope for the panels.
fn to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    let ch = channels.max(1);
    if ch == 1 {
        return samples.to_vec();
    }
    samples
        .chunks(ch)
        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
        .collect()
}

/// Fill a panel background and draw its frame.
fn panel_frame(canvas: &mut Canvas, x: i64, y: i64, w: u32, h: u32) {
    canvas.fill_rect(x, y, w as i64, h as i64, PANEL_BG);
    canvas.hline(x, x + w as i64 - 1, y, AXIS);
    canvas.hline(x, x + w as i64 - 1, y + h as i64 - 1, AXIS);
}

/// Draw a min/max waveform: for each column, the sample range in that time slice, with
/// a zero-crossing center line.
fn draw_waveform(canvas: &mut Canvas, x: i64, y: i64, w: u32, h: u32, mono: &[f32]) {
    panel_frame(canvas, x, y, w, h);
    let mid = y + h as i64 / 2;
    canvas.hline(x, x + w as i64 - 1, mid, AXIS);
    if mono.is_empty() {
        return;
    }
    let half = (h as f64 / 2.0) - 4.0;
    let per_col = (mono.len() as f64 / w as f64).max(1.0);
    for col in 0..w as i64 {
        let start = (col as f64 * per_col) as usize;
        let end = (((col + 1) as f64 * per_col) as usize).min(mono.len());
        if start >= end {
            continue;
        }
        let (mut lo, mut hi) = (f32::MAX, f32::MIN);
        for &s in &mono[start..end] {
            lo = lo.min(s);
            hi = hi.max(s);
        }
        let y_hi = mid - (hi as f64 * half).round() as i64;
        let y_lo = mid - (lo as f64 * half).round() as i64;
        canvas.vline(x + col, y_hi, y_lo, WAVE);
        // A brighter core near the center line for a fuller look.
        canvas.set(x + col, mid, WAVE_MID);
    }
}

/// Draw a log-magnitude spectrogram: time on x, frequency on y (low at the bottom),
/// magnitude mapped through a dark→hot colormap.
fn draw_spectrogram(
    canvas: &mut Canvas,
    x: i64,
    y: i64,
    w: u32,
    h: u32,
    mono: &[f32],
    _sample_rate: u32,
) {
    panel_frame(canvas, x, y, w, h);
    if mono.is_empty() {
        return;
    }
    let window = 512usize;
    // Choose a hop so the whole clip spans the panel width.
    let hop = ((mono.len() / w as usize).max(1)).max(64);
    let cols = spectrogram(mono, window, hop);
    if cols.is_empty() {
        return;
    }
    let bins = cols[0].len();
    let inner_h = h as i64 - 2;
    // Normalize on a log scale against the peak magnitude for stable contrast.
    let peak = cols
        .iter()
        .flat_map(|c| c.iter())
        .fold(1e-9f64, |m, &v| m.max(v));
    let log_ref = (1.0 + peak).ln();
    for col in 0..w as i64 {
        let ci = ((col as f64 / w as f64) * cols.len() as f64) as usize;
        let ci = ci.min(cols.len() - 1);
        let column = &cols[ci];
        for row in 0..inner_h {
            // Bottom row = lowest frequency bin.
            let f = ((inner_h - 1 - row) as f64 / inner_h as f64 * bins as f64) as usize;
            let f = f.min(bins - 1);
            let mag = (1.0 + column[f]).ln() / log_ref;
            let color = heat(mag);
            canvas.set(x + col, y + 1 + row, color);
        }
    }
}

/// A dark→purple→orange→white colormap for the spectrogram.
fn heat(v: f64) -> Rgb {
    let v = v.clamp(0.0, 1.0);
    // Gradient stops.
    let stops: [(f64, Rgb); 4] = [
        (0.0, [20, 22, 30]),
        (0.35, [70, 30, 120]),
        (0.7, [220, 90, 30]),
        (1.0, [255, 250, 210]),
    ];
    for pair in stops.windows(2) {
        let (a_pos, a_col) = pair[0];
        let (b_pos, b_col) = pair[1];
        if v <= b_pos {
            let t = if b_pos > a_pos {
                (v - a_pos) / (b_pos - a_pos)
            } else {
                0.0
            };
            return lerp(a_col, b_col, t);
        }
    }
    stops[stops.len() - 1].1
}

fn lerp(a: Rgb, b: Rgb, t: f64) -> Rgb {
    let t = t.clamp(0.0, 1.0);
    [
        (a[0] as f64 + (b[0] as f64 - a[0] as f64) * t).round() as u8,
        (a[1] as f64 + (b[1] as f64 - a[1] as f64) * t).round() as u8,
        (a[2] as f64 + (b[2] as f64 - a[2] as f64) * t).round() as u8,
    ]
}

/// A small palette of per-track note colors.
const TRACK_COLORS: [Rgb; 6] = [
    [90, 200, 250],
    [250, 170, 80],
    [130, 230, 140],
    [240, 120, 200],
    [200, 200, 120],
    [160, 150, 250],
];

/// Draw the piano-roll: notes as rectangles, time on x, pitch on y (high at the top).
fn draw_piano_roll(canvas: &mut Canvas, x: i64, y: i64, w: u32, h: u32, roll: &PianoRoll) {
    panel_frame(canvas, x, y, w, h);
    if roll.notes.is_empty() {
        return;
    }
    let total_beats = roll.total_beats.max(1.0);
    // Pitch range with a margin.
    let (mut lo, mut hi) = (127u8, 0u8);
    for n in &roll.notes {
        lo = lo.min(n.key);
        hi = hi.max(n.key);
    }
    let lo = lo.saturating_sub(2) as f64;
    let hi = (hi.saturating_add(2)).min(127) as f64;
    let span = (hi - lo).max(1.0);
    let inner_h = (h as i64 - 8) as f64;
    let inner_w = (w as i64 - 4) as f64;
    // Beat gridlines.
    let beats = total_beats.ceil() as i64;
    for b in 0..=beats {
        let gx = x + 2 + ((b as f64 / total_beats) * inner_w).round() as i64;
        canvas.vline(gx, y + 2, y + h as i64 - 3, AXIS);
    }
    for n in &roll.notes {
        let nx = x + 2 + ((n.start_beats / total_beats) * inner_w).round() as i64;
        let nw = ((n.dur_beats / total_beats) * inner_w).round().max(2.0) as i64;
        let ny = y + 4 + (((hi - n.key as f64) / span) * inner_h).round() as i64;
        let color = TRACK_COLORS[n.track % TRACK_COLORS.len()];
        canvas.fill_rect(nx, ny, nw, 5, color);
    }
}

#[cfg(test)]
#[path = "preview.test.rs"]
mod tests;
