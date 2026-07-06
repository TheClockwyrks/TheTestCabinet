use super::*;

#[test]
fn clamp_drops_off_image() {
    let r = Raster::filled(4, 4, Color::TRANSPARENT);
    assert!(r.get(-1, 0, WrapMode::Clamp).is_none());
    assert!(r.get(4, 0, WrapMode::Clamp).is_none());
    assert!(r.get(0, 0, WrapMode::Clamp).is_some());
}

#[test]
fn wrap_is_toroidal() {
    let r = Raster::filled(4, 4, Color::TRANSPARENT);
    assert_eq!(r.index(-1, 0, WrapMode::Wrap), r.index(3, 0, WrapMode::Wrap));
    assert_eq!(r.index(4, 5, WrapMode::Wrap), r.index(0, 1, WrapMode::Wrap));
}

#[test]
fn wrapped_write_lands_on_opposite_edge() {
    let mut r = Raster::filled(4, 4, Color::TRANSPARENT);
    let red = Color::new(1.0, 0.0, 0.0, 1.0);
    r.set(-1, -1, red, WrapMode::Wrap);
    assert_eq!(r.get(3, 3, WrapMode::Wrap).unwrap(), red);
}

#[test]
fn sample_midpoint_averages() {
    let mut r = Raster::filled(2, 1, Color::new(0.0, 0.0, 0.0, 1.0));
    r.set(1, 0, Color::new(1.0, 1.0, 1.0, 1.0), WrapMode::Clamp);
    let mid = r.sample(0.5, 0.0, WrapMode::Clamp);
    assert!((mid.r - 0.5).abs() < 1e-4);
}

#[test]
fn png_roundtrips_through_bytes() {
    let mut r = Raster::filled(3, 2, Color::TRANSPARENT);
    r.set(1, 1, Color::new(0.2, 0.4, 0.6, 1.0), WrapMode::Clamp);
    let bytes = r.to_png_bytes();
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().unwrap();
    let mut out = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut out).unwrap();
    let back = Raster::from_rgba8(info.width, info.height, &out[..info.buffer_size()]);
    assert_eq!(back.get(1, 1, WrapMode::Clamp).unwrap().to_rgba8(), [51, 102, 153, 255]);
}
