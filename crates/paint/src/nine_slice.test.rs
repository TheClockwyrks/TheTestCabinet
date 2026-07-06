use super::*;

fn opaque(r: f32, g: f32, b: f32) -> Color {
    Color::new(r, g, b, 1.0)
}

#[test]
fn fits_checks_opposite_margins() {
    let ns = NineSlice {
        left: 10,
        right: 10,
        top: 10,
        bottom: 10,
    };
    assert!(ns.fits(32, 32));
    assert!(!ns.fits(20, 32));
    assert!(!ns.fits(32, 20));
}

#[test]
fn stretch_preserves_size_and_corners() {
    // A source with distinct corners: mark the top-left corner pixel.
    let mut src = Raster::filled(16, 16, opaque(0.5, 0.5, 0.5));
    src.pixels[0] = opaque(1.0, 0.0, 0.0);
    let ns = NineSlice {
        left: 4,
        right: 4,
        top: 4,
        bottom: 4,
    };
    let out = stretch(&src, ns, 64, 40);
    assert_eq!((out.width, out.height), (64, 40));
    // The fixed top-left corner pixel survives unscaled at the origin.
    assert_eq!(out.pixels[0].to_rgba8(), opaque(1.0, 0.0, 0.0).to_rgba8());
}

#[test]
fn oversize_insets_fall_back_to_resize() {
    let src = Raster::filled(16, 16, opaque(0.2, 0.2, 0.2));
    let ns = NineSlice {
        left: 20,
        right: 20,
        top: 2,
        bottom: 2,
    };
    let out = stretch(&src, ns, 32, 32);
    assert_eq!((out.width, out.height), (32, 32));
}
