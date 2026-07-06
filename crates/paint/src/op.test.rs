use super::*;
use crate::color::Background;
use crate::raster::WrapMode;

fn ws_single() -> Workspace {
    let mut ws = Workspace::new(WrapMode::Clamp);
    ws.insert("canvas", 16, 16, Background::Transparent);
    ws
}

#[test]
fn action_roundtrips_through_json() {
    let action = Action::targeted(
        Some("panel".to_string()),
        Op::FillRect {
            layer: None,
            mask: false,
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            color: Color::new(1.0, 0.0, 0.0, 1.0),
        },
    );
    let json = serde_json::to_string(&action).unwrap();
    assert!(json.contains("\"op\":\"fill-rect\""));
    assert!(json.contains("\"target\":\"panel\""));
    let back: Action = serde_json::from_str(&json).unwrap();
    assert_eq!(back.target.as_deref(), Some("panel"));
    assert!(matches!(back.op, Op::FillRect { width: 3, .. }));
}

#[test]
fn init_carries_the_asset_seed() {
    let actions = vec![Action::global(Op::Init { seed: 777 })];
    assert_eq!(asset_seed(&actions), 777);
}

#[test]
fn replay_applies_a_fill() {
    let mut ws = ws_single();
    let actions = vec![
        Action::global(Op::Init { seed: 1 }),
        Action::targeted(
            Some("canvas".to_string()),
            Op::Fill {
                layer: None,
                mask: false,
                color: Color::new(0.0, 1.0, 0.0, 1.0),
            },
        ),
    ];
    replay(&mut ws, &actions).unwrap();
    let flat = ws.documents["canvas"].composite();
    assert!(flat.pixels[0].g > 0.9);
}

#[test]
fn add_layer_then_brush_targets_the_new_layer() {
    let mut ws = ws_single();
    let actions = vec![
        Action::global(Op::Init { seed: 1 }),
        Action::targeted(Some("canvas".to_string()), Op::AddLayer { name: "top".into() }),
        Action::targeted(
            Some("canvas".to_string()),
            Op::Fill {
                layer: None,
                mask: false,
                color: Color::new(0.0, 0.0, 1.0, 1.0),
            },
        ),
    ];
    replay(&mut ws, &actions).unwrap();
    let doc = &ws.documents["canvas"];
    assert_eq!(doc.layers.len(), 2);
    assert_eq!(doc.layers[1].name, "top");
    assert!(doc.layers[1].raster.pixels[0].b > 0.9);
}

#[test]
fn replay_is_deterministic_for_stochastic_ops() {
    let actions = vec![
        Action::global(Op::Init { seed: 42 }),
        Action::targeted(
            Some("canvas".to_string()),
            Op::GenNoise {
                layer: None,
                kind: NoiseKind::Perlin,
                scale: 4.0,
                octaves: 1,
            },
        ),
    ];
    let mut a = ws_single();
    let mut b = ws_single();
    replay(&mut a, &actions).unwrap();
    replay(&mut b, &actions).unwrap();
    assert_eq!(
        a.documents["canvas"].layers[0].raster.pixels,
        b.documents["canvas"].layers[0].raster.pixels
    );
}

#[test]
fn set_uniform_fills_the_map() {
    let mut ws = Workspace::new(WrapMode::Wrap);
    ws.insert("roughness", 8, 8, Background::Transparent);
    let actions = vec![
        Action::global(Op::Init { seed: 1 }),
        Action::targeted(Some("roughness".to_string()), Op::SetUniform { value: 0.6 }),
    ];
    replay(&mut ws, &actions).unwrap();
    let c = ws.documents["roughness"].composite().pixels[0];
    assert!((c.r - 0.6).abs() < 0.01);
}

#[test]
fn bake_normal_reads_height_writes_normal() {
    let mut ws = Workspace::new(WrapMode::Wrap);
    ws.insert("normal", 8, 8, Background::Transparent);
    ws.insert("height", 8, 8, Background::Solid(Color::new(0.5, 0.5, 0.5, 1.0)));
    let actions = vec![
        Action::global(Op::Init { seed: 1 }),
        Action::targeted(
            Some("normal".to_string()),
            Op::BakeNormal {
                from: "height".to_string(),
                strength: 1.0,
            },
        ),
    ];
    replay(&mut ws, &actions).unwrap();
    // Flat height -> ~#8080ff normal.
    let c = ws.documents["normal"].composite().pixels[0].to_rgba8();
    assert!(c[2] > 250);
}

#[test]
fn set_nine_slice_records_on_document() {
    let mut ws = ws_single();
    let actions = vec![
        Action::global(Op::Init { seed: 1 }),
        Action::targeted(
            Some("canvas".to_string()),
            Op::SetNineSlice {
                left: 4,
                right: 4,
                top: 4,
                bottom: 4,
            },
        ),
    ];
    replay(&mut ws, &actions).unwrap();
    assert!(ws.documents["canvas"].nine_slice.is_some());
}
