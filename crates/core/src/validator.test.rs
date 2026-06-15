//! Unit tests for the validator's image-similarity scoring.

use std::io::BufWriter;

use super::{Image, decode_png, image_similarity, score};

/// A solid image of `value` in every channel.
fn solid(width: usize, height: usize, channels: usize, value: u8) -> Image {
    Image {
        width,
        height,
        channels,
        data: vec![value; width * height * channels],
    }
}

#[test]
fn identical_images_score_one() {
    let a = solid(4, 4, 3, 128);
    let b = solid(4, 4, 3, 128);
    assert_eq!(image_similarity(&a, &b), 1.0);
}

#[test]
fn inverted_images_score_zero() {
    let black = solid(4, 4, 3, 0);
    let white = solid(4, 4, 3, 255);
    assert_eq!(image_similarity(&black, &white), 0.0);
}

#[test]
fn half_difference_scores_about_half() {
    let black = solid(2, 2, 3, 0);
    let gray = solid(2, 2, 3, 128);
    let similarity = image_similarity(&black, &gray);
    // 1 - 128/255 ≈ 0.498.
    assert!((similarity - (1.0 - 128.0 / 255.0)).abs() < 1e-9);
}

#[test]
fn zero_overlap_scores_zero() {
    let empty = solid(0, 4, 3, 255);
    let other = solid(4, 4, 3, 255);
    assert_eq!(image_similarity(&empty, &other), 0.0);
}

#[test]
fn alpha_channel_is_ignored() {
    // Two opaque-vs-transparent reds: identical RGB, differing alpha, scores 1.0.
    let opaque = Image {
        width: 1,
        height: 1,
        channels: 4,
        data: vec![255, 0, 0, 255],
    };
    let transparent = Image {
        width: 1,
        height: 1,
        channels: 4,
        data: vec![255, 0, 0, 0],
    };
    assert_eq!(image_similarity(&opaque, &transparent), 1.0);
}

/// Write an RGBA buffer as an 8-bit PNG.
fn write_png(path: &std::path::Path, width: u32, height: u32, rgba: &[u8]) {
    let file = std::fs::File::create(path).expect("create png");
    let mut encoder = png::Encoder::new(BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().expect("png header");
    writer.write_image_data(rgba).expect("png data");
}

#[test]
fn decode_png_round_trips_dimensions_and_channels() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("solid.png");
    write_png(&path, 3, 2, &[10u8; 3 * 2 * 4]);

    let image = decode_png(&path).expect("decode");
    assert_eq!((image.width, image.height, image.channels), (3, 2, 4));
}

#[test]
fn score_of_identical_pngs_is_one() {
    let dir = tempfile::tempdir().expect("temp dir");
    let baseline = dir.path().join("baseline.png");
    let capture = dir.path().join("capture.png");
    let pixels = vec![64u8; 5 * 5 * 4];
    write_png(&baseline, 5, 5, &pixels);
    write_png(&capture, 5, 5, &pixels);

    assert_eq!(score(&baseline, &capture).expect("score"), 1.0);
}
