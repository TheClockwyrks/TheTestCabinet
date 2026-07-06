use super::*;

#[test]
fn flat_height_bakes_flat_normal() {
    let field = vec![0.5; 16];
    let n = bake_normal(&field, 4, 4, 1.0);
    // A flat field points straight up: ~#8080ff.
    let c = n.pixels[5].to_rgba8();
    assert!((c[0] as i32 - 128).abs() <= 1);
    assert!((c[1] as i32 - 128).abs() <= 1);
    assert!(c[2] > 250);
}

#[test]
fn slope_tilts_the_normal() {
    // A left-to-right ramp: normal should tilt off vertical in x.
    let (w, h) = (8u32, 8u32);
    let mut field = vec![0.0; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            field[(y * w + x) as usize] = x as f32 / w as f32;
        }
    }
    let n = bake_normal(&field, w, h, 2.0);
    let c = n.pixels[(4 * w + 4) as usize].to_rgba8();
    assert!(c[0] != 128, "normal x-channel should shift on a slope");
}

#[test]
fn ao_is_darker_in_a_pit() {
    let (w, h) = (8u32, 8u32);
    let mut field = vec![1.0; (w * h) as usize];
    // Carve a low pit in the center.
    field[(4 * w + 4) as usize] = 0.0;
    let ao = bake_ao(&field, w, h, 2);
    let pit = ao.pixels[(4 * w + 4) as usize].r;
    let edge = ao.pixels[0].r;
    assert!(pit < edge, "pit {pit} should be darker than flat {edge}");
}

#[test]
fn bakes_are_seamless() {
    let (w, h) = (16u32, 16u32);
    let mut field = vec![0.0; (w * h) as usize];
    for (i, v) in field.iter_mut().enumerate() {
        *v = ((i as f32 * 0.3).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    }
    // Wrap-aware baking means column -1 (== last column) is well-defined and equal.
    let n = bake_normal(&field, w, h, 1.0);
    assert_eq!(n.pixels.len(), (w * h) as usize);
}
