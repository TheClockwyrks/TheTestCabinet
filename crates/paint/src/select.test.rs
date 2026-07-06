use super::*;
use crate::color::{Background, Color};
use crate::raster::WrapMode;

#[test]
fn rect_selection_clips_a_fill() {
    let mut doc = Document::new(8, 8, Background::Transparent);
    doc.select_rect(2, 2, 3, 3);
    doc.fill_layer(0, false, Color::new(1.0, 0.0, 0.0, 1.0));
    // Inside the selection is painted; outside is untouched.
    assert!(doc.layers[0].raster.get(3, 3, WrapMode::Clamp).unwrap().a > 0.9);
    assert_eq!(
        doc.layers[0].raster.get(0, 0, WrapMode::Clamp).unwrap().a,
        0.0
    );
}

#[test]
fn invert_selection_flips_coverage() {
    let mut doc = Document::new(4, 4, Background::Transparent);
    doc.select_rect(0, 0, 2, 4);
    doc.invert_selection();
    assert_eq!(doc.selection_at(0), 0.0);
    assert_eq!(doc.selection_at(2), 1.0);
}

#[test]
fn none_clears_selection() {
    let mut doc = Document::new(4, 4, Background::Transparent);
    doc.select_rect(0, 0, 2, 2);
    doc.select_none();
    assert!(doc.selection.is_none());
    assert_eq!(doc.selection_at(15), 1.0);
}

#[test]
fn point_in_polygon_basic() {
    let square = [(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)];
    assert!(point_in_polygon(2.0, 2.0, &square));
    assert!(!point_in_polygon(5.0, 2.0, &square));
}

#[test]
fn feather_softens_edges() {
    let mut doc = Document::new(8, 8, Background::Transparent);
    doc.select_rect(2, 2, 4, 4);
    doc.feather_selection(1);
    // An edge pixel now has partial coverage.
    let edge = doc.selection_at((2 * 8 + 1) as usize);
    assert!(edge > 0.0 && edge < 1.0);
}
