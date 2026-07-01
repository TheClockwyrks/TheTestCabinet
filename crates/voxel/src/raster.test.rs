//! Determinism and shape tests for the isometric rasterizer: the same operations
//! always render byte-identical PNGs (the cheat-divergence invariant), the output
//! decodes cleanly, and its size is derived only from the volume dimensions.

use super::*;
use crate::ops::Operation;
use crate::{Dims, render};

const GREEN: Rgb = Rgb([0x22, 0xcc, 0x44]);

/// A small, known model: a solid box plus a couple of accents.
fn known_model() -> VoxelSet {
    render(
        &Dims {
            width: 8,
            height: 8,
            depth: 8,
        },
        &[
            Operation::FillBox {
                x: 1,
                y: 0,
                z: 1,
                width: 6,
                height: 3,
                depth: 6,
                color: GREEN,
            },
            Operation::SetVoxel {
                x: 4,
                y: 3,
                z: 4,
                color: Rgb([0xff, 0xff, 0xff]),
            },
        ],
    )
}

#[test]
fn rendering_is_deterministic() {
    let a = rasterize(
        &known_model(),
        &Camera::PREVIEW,
        PreviewBackground::Transparent,
    );
    let b = rasterize(
        &known_model(),
        &Camera::PREVIEW,
        PreviewBackground::Transparent,
    );
    assert_eq!(a, b, "the same model renders byte-identical PNGs");
    assert!(!a.is_empty(), "a non-empty model yields a non-empty PNG");
}

#[test]
fn known_model_has_a_stable_occupied_count() {
    // 6*3*6 box = 108, plus one accent voxel not inside the box.
    assert_eq!(known_model().occupied_count(), 109);
}

#[test]
fn image_size_depends_only_on_dims() {
    let dims = Dims {
        width: 8,
        height: 8,
        depth: 8,
    };
    let (w, h) = Camera::PREVIEW.image_size(&dims);
    // width = (8 + 8)*half_w + 2*margin = 16*4 + 4 = 68.
    assert_eq!(w, 68);
    // height = (8 + 8)*half_h + 8*cube_h + 2*margin = 16*2 + 8*4 + 4 = 68.
    assert_eq!(h, 68);

    // The empty and occupied volumes of the same dims render to the same size.
    let empty = rasterize(
        &VoxelSet::empty(dims),
        &Camera::PREVIEW,
        PreviewBackground::Transparent,
    );
    let full = rasterize(
        &known_model(),
        &Camera::PREVIEW,
        PreviewBackground::Transparent,
    );
    assert_eq!(decode_size(&empty), (w, h));
    assert_eq!(decode_size(&full), (w, h));
}

#[test]
fn rendered_preview_decodes_as_rgba() {
    let bytes = rasterize(
        &known_model(),
        &Camera::PREVIEW,
        PreviewBackground::Transparent,
    );
    let decoder = png::Decoder::new(bytes.as_slice());
    let mut reader = decoder.read_info().expect("valid PNG");
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).expect("PNG frame");
    assert_eq!(info.color_type, png::ColorType::Rgba);
    assert_eq!(info.bit_depth, png::BitDepth::Eight);
}

#[test]
fn a_color_background_fills_the_empty_area() {
    let bytes = rasterize(
        &VoxelSet::empty(Dims {
            width: 2,
            height: 2,
            depth: 2,
        }),
        &Camera::PREVIEW,
        PreviewBackground::Color(Rgb([0x10, 0x20, 0x30])),
    );
    let decoder = png::Decoder::new(bytes.as_slice());
    let mut reader = decoder.read_info().expect("valid PNG");
    let mut buf = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut buf).expect("PNG frame");
    assert_eq!(
        &buf[0..4],
        &[0x10, 0x20, 0x30, 0xff],
        "the empty area is the opaque background color"
    );
}

fn decode_size(bytes: &[u8]) -> (u32, u32) {
    let decoder = png::Decoder::new(bytes);
    let reader = decoder.read_info().expect("valid PNG");
    let info = reader.info();
    (info.width, info.height)
}
