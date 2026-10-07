//! Tests for [what an inline image costs the window](super).

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;

use super::*;

/// An [`ImageContent`] over `bytes`, declaring `declared_bytes` as the file's size so a test can
/// separate what the header says from what the file measures.
fn image(bytes: Vec<u8>, declared_bytes: u64) -> ImageContent {
    ImageContent::new("image/png", BASE64.encode(bytes), declared_bytes)
}

/// A PNG header declaring `width`×`height`, padded to `len` bytes of body.
fn png(width: u32, height: u32, len: usize) -> Vec<u8> {
    let mut bytes = Vec::from(b"\x89PNG\r\n\x1a\n");
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.resize(bytes.len().max(len), 0);
    bytes
}

/// A GIF header declaring `width`×`height`.
fn gif(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = Vec::from(b"GIF89a");
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.resize(64, 0);
    bytes
}

/// A WebP file of `variant` declaring `width`×`height`.
fn webp(variant: &[u8; 4], width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::from(b"RIFF");
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(b"WEBP");
    bytes.extend_from_slice(variant);
    bytes.extend_from_slice(&0u32.to_le_bytes());
    match variant {
        b"VP8 " => {
            bytes.extend_from_slice(&[0, 0, 0, 0x9d, 0x01, 0x2a]);
            bytes.extend_from_slice(&(width as u16).to_le_bytes());
            bytes.extend_from_slice(&(height as u16).to_le_bytes());
        }
        b"VP8L" => {
            bytes.push(0x2f);
            let packed = (width - 1) | ((height - 1) << 14);
            bytes.extend_from_slice(&packed.to_le_bytes());
        }
        b"VP8X" => {
            bytes.extend_from_slice(&[0, 0, 0, 0]);
            bytes.extend_from_slice(&(width - 1).to_le_bytes()[..3]);
            bytes.extend_from_slice(&(height - 1).to_le_bytes()[..3]);
        }
        _ => unreachable!("unknown webp variant"),
    }
    bytes.resize(64, 0);
    bytes
}

/// A JPEG declaring `width`×`height` in a start-of-frame segment, preceded by `filler` bytes of
/// an application segment so the walk has a chain to cross.
fn jpeg(width: u16, height: u16, filler: usize) -> Vec<u8> {
    let mut bytes = vec![0xff, 0xd8];
    if filler > 0 {
        bytes.extend_from_slice(&[0xff, 0xe1]);
        bytes.extend_from_slice(&((filler + 2) as u16).to_be_bytes());
        bytes.resize(bytes.len() + filler, 0);
    }
    bytes.extend_from_slice(&[0xff, 0xc0]);
    bytes.extend_from_slice(&17u16.to_be_bytes());
    bytes.push(8);
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.resize(bytes.len() + 32, 0);
    bytes
}

#[test]
fn a_reference_mockup_is_charged_by_its_tiles() {
    // 1280×720 fits the 2048 square and its shortest side is under 768, so it tiles 3×2.
    assert_eq!(
        estimate_image(&image(png(1280, 720, 4096), 4096)),
        85 + 170 * 6
    );
}

#[test]
fn dimensions_decide_the_charge_and_file_size_does_not() {
    // The same picture at wildly different compression costs the same, which is the whole point of
    // reading the header: a flat mockup and a photograph of one screen tile identically.
    let flat = estimate_image(&image(png(1280, 720, 8 * 1024), 8 * 1024));
    let dense = estimate_image(&image(png(1280, 720, 900 * 1024), 900 * 1024));
    assert_eq!(flat, dense);
}

#[test]
fn a_small_picture_costs_one_tile() {
    assert_eq!(estimate_image(&image(png(320, 240, 512), 512)), 85 + 170);
}

#[test]
fn an_oversized_picture_is_scaled_into_the_square_before_tiling() {
    // 4096×4096 reduces to 2048×2048, whose shortest side then reduces to 768: a 768×768 square
    // tiles 2×2.
    assert_eq!(
        estimate_image(&image(png(4096, 4096, 4096), 4096)),
        85 + 170 * 4
    );
}

#[test]
fn a_tall_picture_is_reduced_until_its_shortest_side_fits() {
    // 1536×3072 fits the square already; its shortest side 1536 halves to 768, giving 768×1536,
    // which tiles 2×3.
    assert_eq!(
        estimate_image(&image(png(1536, 3072, 4096), 4096)),
        85 + 170 * 6
    );
}

#[test]
fn every_recognized_format_yields_its_dimensions() {
    let expected = 85 + 170 * 6;
    assert_eq!(estimate_image(&image(png(1280, 720, 4096), 4096)), expected);
    assert_eq!(estimate_image(&image(gif(1280, 720), 4096)), expected);
    assert_eq!(
        estimate_image(&image(webp(b"VP8 ", 1280, 720), 4096)),
        expected
    );
    assert_eq!(
        estimate_image(&image(webp(b"VP8L", 1280, 720), 4096)),
        expected
    );
    assert_eq!(
        estimate_image(&image(webp(b"VP8X", 1280, 720), 4096)),
        expected
    );
    assert_eq!(estimate_image(&image(jpeg(1280, 720, 0), 4096)), expected);
}

#[test]
fn a_jpeg_frame_behind_a_metadata_segment_is_still_found() {
    // An embedded colour profile or EXIF preview sits between the start marker and the frame.
    assert_eq!(
        estimate_image(&image(jpeg(1280, 720, 20_000), 4096)),
        85 + 170 * 6
    );
}

#[test]
fn an_unreadable_header_is_charged_by_size_rather_than_free() {
    let mystery = image(vec![0u8; 64], 512 * 1024);
    assert_eq!(estimate_image(&mystery), 1024);
    // Floored, so even a tiny file of an unknown format costs something.
    assert!(estimate_image(&image(vec![0u8; 8], 0)) > 0);
}

#[test]
fn a_truncated_header_falls_back_instead_of_panicking() {
    for len in 0..24usize {
        let truncated = png(1280, 720, 0);
        let bytes = truncated[..len.min(truncated.len())].to_vec();
        assert!(estimate_image(&image(bytes, 4096)) > 0);
    }
}

#[test]
fn a_jpeg_that_reaches_entropy_coded_data_without_a_frame_falls_back() {
    // A start-of-scan with no preceding frame ends the walk: there is no length to step over the
    // entropy-coded bytes that follow it.
    let mut bytes = vec![0xff, 0xd8, 0xff, 0xda];
    bytes.extend_from_slice(&12u16.to_be_bytes());
    bytes.resize(64, 0);
    assert_eq!(estimate_image(&image(bytes, 256 * 1024)), 512);
}
