use super::*;

fn opaque(r: f32, g: f32, b: f32) -> Color {
    Color::new(r, g, b, 1.0)
}

#[test]
fn composite_of_single_opaque_layer_is_that_layer() {
    let mut doc = Document::new(2, 2, Background::Transparent);
    doc.layers[0].raster.pixels.fill(opaque(0.2, 0.4, 0.6));
    let flat = doc.composite();
    assert_eq!(flat.pixels[0].to_rgba8(), opaque(0.2, 0.4, 0.6).to_rgba8());
}

#[test]
fn multiply_layer_darkens_backdrop() {
    let mut doc = Document::new(1, 1, Background::Solid(opaque(0.8, 0.8, 0.8)));
    let mut top = Layer::new("mul", 1, 1);
    top.raster.pixels.fill(opaque(0.5, 0.5, 0.5));
    top.blend = BlendMode::Multiply;
    doc.layers.push(top);
    let flat = doc.composite();
    assert!((flat.pixels[0].r - 0.4).abs() < 1e-3);
}

#[test]
fn invisible_layer_is_skipped() {
    let mut doc = Document::new(1, 1, Background::Transparent);
    doc.layers[0].raster.pixels.fill(opaque(1.0, 0.0, 0.0));
    let mut hidden = Layer::new("hidden", 1, 1);
    hidden.raster.pixels.fill(opaque(0.0, 0.0, 1.0));
    hidden.visible = false;
    doc.layers.push(hidden);
    let flat = doc.composite();
    assert_eq!(flat.pixels[0].to_rgba8(), opaque(1.0, 0.0, 0.0).to_rgba8());
}

#[test]
fn mask_hides_covered_pixels() {
    let mut doc = Document::new(1, 1, Background::Transparent);
    let mut layer = Layer::new("masked", 1, 1);
    layer.raster.pixels.fill(opaque(1.0, 1.0, 1.0));
    layer.mask = Some(vec![0.0]);
    doc.layers.push(layer);
    let flat = doc.composite();
    assert_eq!(flat.pixels[0].a, 0.0);
}

#[test]
fn resolve_single_document_needs_no_name() {
    let mut ws = Workspace::new(WrapMode::Clamp);
    ws.insert("canvas", 4, 4, Background::Transparent);
    assert_eq!(ws.resolve_name(None).unwrap(), "canvas");
}

#[test]
fn resolve_ambiguous_document_requires_name() {
    let mut ws = Workspace::new(WrapMode::Clamp);
    ws.insert("panel", 4, 4, Background::Transparent);
    ws.insert("button", 4, 4, Background::Transparent);
    assert!(ws.resolve_name(None).is_err());
    assert_eq!(ws.resolve_name(Some("button")).unwrap(), "button");
    assert!(ws.resolve_name(Some("missing")).is_err());
}
