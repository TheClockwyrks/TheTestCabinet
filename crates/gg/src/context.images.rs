//! **What an inline image costs the context window**: the pixel dimensions gg reads out of an
//! image's header, and the tile count a provider bills for a picture that size.
//!
//! An image is not text, so no tokenizer can answer what it costs. Providers charge it by tiling
//! the decoded **dimensions**, which is a different quantity from the file's size: a 1280×720
//! screenshot and a 1280×720 photograph cost the same and compress to wildly different byte
//! counts. Sizing from bytes therefore under-charges exactly the file a test case ships most of —
//! a flat, highly compressible mockup — and a window whose fullness reads low delays
//! [compaction](crate::compaction) past the point it was configured to fire.
//!
//! gg reads width and height out of the header rather than decoding the picture. Four formats
//! carry them in a fixed place near the front, and they are the four
//! [`read_file`](crate::tools::ReadFileTool) recognizes.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;

use crate::model::ImageContent;

/// How much of an image gg decodes looking for its dimensions.
///
/// PNG, GIF and WebP put them in the first three dozen bytes. JPEG spells them in a start-of-frame
/// segment reached by walking the segment chain, which an embedded colour profile or EXIF preview
/// can push some way in, so the walk gets room to cross one. A header past this bound is read as
/// [unknown](image_dimensions) and charged by size.
const HEADER_SCAN_BYTES: usize = 64 * 1024;

/// The tokens charged for the image envelope itself, before any tile.
const BASE_TOKENS: usize = 85;

/// The tokens charged per tile of the scaled picture.
const TOKENS_PER_TILE: usize = 170;

/// The square tile a scaled picture is divided into.
const TILE: u32 = 512;

/// The longest either side may be. A picture larger is scaled to fit, preserving aspect.
const MAX_SIDE: u32 = 2048;

/// The length the shortest side is reduced to once the picture fits [`MAX_SIDE`].
const SHORT_SIDE: u32 = 768;

/// Estimate the tokens `image` occupies.
///
/// From its dimensions when the header yields them, and from its size when it does not, so a
/// format gg cannot measure is still charged something rather than accounted as free.
pub fn estimate_image(image: &ImageContent) -> usize {
    match image_dimensions(image) {
        Some((width, height)) => tile_tokens(width, height),
        None => size_tokens(image.bytes),
    }
}

/// The tokens a picture of `width`×`height` pixels costs: a fixed envelope plus one charge per
/// tile of the picture after it is scaled the way a provider scales it.
///
/// The scaling is two steps. A picture larger than [`MAX_SIDE`] on either side is reduced to fit
/// that square, then a picture whose shortest side still exceeds [`SHORT_SIDE`] is reduced until
/// that side measures it. Both preserve aspect, and a picture already inside both bounds is
/// charged at the size it is.
fn tile_tokens(width: u32, height: u32) -> usize {
    let (width, height) = (width.max(1), height.max(1));
    let (width, height) = scale_to_fit(width, height, MAX_SIDE);
    let (width, height) = match width.min(height) {
        short if short > SHORT_SIDE => scale_short_side(width, height, SHORT_SIDE),
        _ => (width, height),
    };
    let tiles = width.div_ceil(TILE) as usize * height.div_ceil(TILE) as usize;
    BASE_TOKENS + TOKENS_PER_TILE * tiles
}

/// `width`×`height` reduced to fit a `bound`×`bound` square, preserving aspect. A picture already
/// inside the square is returned unchanged.
fn scale_to_fit(width: u32, height: u32, bound: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= bound {
        return (width, height);
    }
    let scaled = |side: u32| ((side as u64 * bound as u64) / longest as u64).max(1) as u32;
    (scaled(width), scaled(height))
}

/// `width`×`height` reduced until its shortest side measures `target`, preserving aspect.
fn scale_short_side(width: u32, height: u32, target: u32) -> (u32, u32) {
    let shortest = width.min(height);
    let scaled = |side: u32| ((side as u64 * target as u64) / shortest as u64).max(1) as u32;
    (scaled(width), scaled(height))
}

/// The fallback charge for an image whose dimensions gg could not read: a rate per KiB of encoded
/// bytes, floored so even a tiny icon costs something.
///
/// Deliberately coarse. Its job is to keep an unmeasurable picture from being accounted as free,
/// not to be accurate about one.
fn size_tokens(bytes: u64) -> usize {
    /// Tokens charged per KiB of encoded image.
    const TOKENS_PER_KIB: u64 = 2;
    /// The floor: no image is cheaper than this, however small the file.
    const MIN_TOKENS: u64 = BASE_TOKENS as u64;
    ((bytes / 1024) * TOKENS_PER_KIB).max(MIN_TOKENS) as usize
}

/// The pixel dimensions in `image`'s header, or `None` when the bytes are not one of the four
/// formats or the header does not reach within [`HEADER_SCAN_BYTES`].
///
/// The format is decided by magic number rather than by the declared media type, on the same terms
/// the read that produced the image decided it.
fn image_dimensions(image: &ImageContent) -> Option<(u32, u32)> {
    // Base64 encodes three bytes per four characters, so a prefix of the encoded text bounds the
    // decode without decoding the whole picture. Truncated to a whole 4-character group, since a
    // partial group is not decodable.
    let encoded =
        &image.data_base64[..image.data_base64.len().min(HEADER_SCAN_BYTES / 3 * 4) / 4 * 4];
    let header = BASE64.decode(encoded).ok()?;
    png_dimensions(&header)
        .or_else(|| gif_dimensions(&header))
        .or_else(|| webp_dimensions(&header))
        .or_else(|| jpeg_dimensions(&header))
}

/// A big-endian `u32` at `offset`.
fn be_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice: [u8; 4] = bytes.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_be_bytes(slice))
}

/// A big-endian `u16` at `offset`.
fn be_u16(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice: [u8; 2] = bytes.get(offset..offset + 2)?.try_into().ok()?;
    Some(u16::from_be_bytes(slice) as u32)
}

/// A little-endian `u16` at `offset`.
fn le_u16(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice: [u8; 2] = bytes.get(offset..offset + 2)?.try_into().ok()?;
    Some(u16::from_le_bytes(slice) as u32)
}

/// PNG: the signature, then an `IHDR` chunk whose first two fields are the dimensions.
fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    if !bytes.starts_with(SIGNATURE) || bytes.get(12..16)? != b"IHDR" {
        return None;
    }
    Some((be_u32(bytes, 16)?, be_u32(bytes, 20)?))
}

/// GIF: the header, then the logical screen descriptor's little-endian dimensions.
fn gif_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(b"GIF87a") && !bytes.starts_with(b"GIF89a") {
        return None;
    }
    Some((le_u16(bytes, 6)?, le_u16(bytes, 8)?))
}

/// WebP: a RIFF container whose first chunk names the variant, each spelling its dimensions
/// differently.
fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(b"RIFF") || bytes.get(8..12)? != b"WEBP" {
        return None;
    }
    match bytes.get(12..16)? {
        // Lossy: a VP8 keyframe header, dimensions in its low 14 bits.
        b"VP8 " => {
            let width = le_u16(bytes, 26)? & 0x3fff;
            let height = le_u16(bytes, 28)? & 0x3fff;
            Some((width, height))
        }
        // Lossless: 14-bit width and height packed across four bytes, each stored one less than
        // the value it represents.
        b"VP8L" => {
            let packed = u32::from_le_bytes(bytes.get(21..25)?.try_into().ok()?);
            Some(((packed & 0x3fff) + 1, ((packed >> 14) & 0x3fff) + 1))
        }
        // Extended: 24-bit canvas dimensions, each stored one less than the value it represents.
        b"VP8X" => {
            let read = |offset: usize| -> Option<u32> {
                let b = bytes.get(offset..offset + 3)?;
                Some(u32::from(b[0]) | u32::from(b[1]) << 8 | u32::from(b[2]) << 16)
            };
            Some((read(24)? + 1, read(27)? + 1))
        }
        _ => None,
    }
}

/// JPEG: the start-of-image marker, then a chain of segments walked until a start-of-frame one
/// carries the dimensions.
fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut offset = 2usize;
    loop {
        // Segments are marker-prefixed, and a run of padding bytes between them is legal.
        while bytes.get(offset) == Some(&0xff) && bytes.get(offset + 1) == Some(&0xff) {
            offset += 1;
        }
        if bytes.get(offset)? != &0xff {
            return None;
        }
        let marker = *bytes.get(offset + 1)?;
        // Start-of-frame carries the dimensions. The four excluded markers share the numeric range
        // and describe coding tables rather than a frame.
        let start_of_frame =
            (0xc0..=0xcf).contains(&marker) && !matches!(marker, 0xc4 | 0xc8 | 0xcc);
        let length = be_u16(bytes, offset + 2)? as usize;
        if start_of_frame {
            return Some((be_u16(bytes, offset + 7)?, be_u16(bytes, offset + 5)?));
        }
        // Entropy-coded data follows the scan header with no length of its own, so a frame not
        // found by here is not in this file's header.
        if marker == 0xda {
            return None;
        }
        offset = offset.checked_add(2)?.checked_add(length.max(2))?;
    }
}

#[cfg(test)]
#[path = "context.images.test.rs"]
mod tests;
