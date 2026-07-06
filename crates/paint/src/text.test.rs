use super::*;
use crate::color::Background;
use crate::raster::WrapMode;

#[test]
fn font_lookup_is_case_insensitive_with_fallback() {
    assert_eq!(font_by_name("INTER-BOLD").name, "inter-bold");
    assert!(font_by_name("inter-bold").bold);
    assert_eq!(font_by_name("nonexistent").name, FONTS[0].name);
}

#[test]
fn text_marks_pixels() {
    let mut doc = Document::new(128, 32, Background::Transparent);
    doc.draw_text(
        0,
        "START",
        font_by_name("sans-bold"),
        20.0,
        Color::new(1.0, 1.0, 1.0, 1.0),
        Align::Left,
        0.0,
        None,
        4.0,
        6.0,
    );
    let painted = doc.layers[0]
        .raster
        .pixels
        .iter()
        .filter(|c| c.a > 0.1)
        .count();
    assert!(painted > 20, "expected glyph coverage, got {painted}");
}

#[test]
fn empty_string_is_a_noop() {
    let mut doc = Document::new(32, 16, Background::Transparent);
    doc.draw_text(
        0,
        "",
        FONTS[0],
        12.0,
        Color::new(1.0, 1.0, 1.0, 1.0),
        Align::Center,
        0.0,
        Some(30.0),
        0.0,
        0.0,
    );
    assert!(doc.layers[0].raster.get(0, 0, WrapMode::Clamp).unwrap().a < 0.01);
}

#[test]
fn wrap_splits_into_multiple_lines() {
    let lines = wrap_lines("one two three four", 8.0, Some(24.0));
    assert!(lines.len() > 1);
}
