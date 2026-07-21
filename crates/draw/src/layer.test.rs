//! Unit tests for the layer document: resolving transforms, editing tracks, and
//! the document's own bookkeeping.

use super::*;
use crate::curve::Interp;

fn layer(name: &str) -> Layer {
    Layer::new(name.to_string(), 0, 0, 8, 8)
}

fn key(frame: u32, value: i64) -> Keyframe {
    Keyframe {
        frame,
        value,
        interp: Interp::Linear,
        out_handle: None,
        in_handle: None,
    }
}

#[test]
fn a_new_layer_rests_visible_at_actual_size() {
    // The defaults have to be the identity, or registering a layer and painting it
    // would produce nothing visible and a model would have no way to tell why.
    let layer = layer("body");
    assert_eq!(layer.opacity, OPAQUE);
    assert_eq!(layer.scale_x, ACTUAL_SIZE);
    assert_eq!(layer.scale_y, ACTUAL_SIZE);
    assert_eq!(layer.rotation, 0);
    assert_eq!(layer.z, 0);
    assert!(layer.ops.is_empty());
    assert!(layer.tracks.is_empty());
}

#[test]
fn an_unanimated_property_holds_its_resting_value() {
    let mut layer = layer("body");
    layer.x = 12;
    layer.rotation = 45;
    let transform = layer.transform_at(7);
    assert_eq!(transform.x, 12);
    assert_eq!(transform.rotation, 45);
    assert_eq!(transform.opacity, OPAQUE);
}

#[test]
fn a_keyed_property_overrides_its_resting_value() {
    let mut layer = layer("ball");
    layer.x = 100;
    layer.set_keyframe(Property::X, key(0, 0));
    layer.set_keyframe(Property::X, key(10, 50));
    assert_eq!(layer.transform_at(0).x, 0);
    assert_eq!(layer.transform_at(5).x, 25);
    assert_eq!(layer.transform_at(10).x, 50);
    // The untouched properties still rest.
    assert_eq!(layer.transform_at(5).y, 0);
}

#[test]
fn keyframes_stay_sorted_however_they_arrive() {
    // A model will not necessarily key in frame order, and an unsorted track would
    // make the segment search pick the wrong pair.
    let mut layer = layer("ball");
    for frame in [9, 0, 5, 2] {
        layer.set_keyframe(Property::Y, key(frame, frame as i64 * 10));
    }
    let frames: Vec<u32> = layer
        .track(Property::Y)
        .expect("keyed")
        .keys
        .iter()
        .map(|k| k.frame)
        .collect();
    assert_eq!(frames, vec![0, 2, 5, 9]);
}

#[test]
fn keying_the_same_frame_twice_replaces_rather_than_duplicates() {
    // Re-keying is how a model corrects itself; appending a second key on the same
    // frame would leave a zero-length segment and an unpredictable value.
    let mut layer = layer("ball");
    layer.set_keyframe(Property::X, key(4, 10));
    layer.set_keyframe(Property::X, key(4, 90));
    let track = layer.track(Property::X).expect("keyed");
    assert_eq!(track.keys.len(), 1);
    assert_eq!(track.keys[0].value, 90);
}

#[test]
fn opacity_is_clamped_even_when_a_curve_overshoots() {
    // An eased or Bézier segment readily overshoots its keys. Every other property
    // tolerates that — a layer may legitimately swing off-canvas — but an opacity
    // outside 0..=255 would corrupt the blend.
    let mut layer = layer("fade");
    layer.set_keyframe(
        Property::Opacity,
        Keyframe {
            frame: 0,
            value: 300,
            interp: Interp::Linear,
            out_handle: None,
            in_handle: None,
        },
    );
    assert_eq!(layer.transform_at(0).opacity, OPAQUE);

    layer.set_keyframe(Property::Opacity, key(0, -50));
    assert_eq!(layer.transform_at(0).opacity, 0);
}

#[test]
fn position_is_not_clamped() {
    // The counterpart to the rule above: a layer sliding off the canvas is a normal
    // thing to animate, and clipping is the compositor's job, not the curve's.
    let mut layer = layer("ball");
    layer.set_keyframe(Property::X, key(0, -400));
    assert_eq!(layer.transform_at(0).x, -400);
}

#[test]
fn composite_order_is_z_then_registration() {
    let mut document = Document::new();
    for (name, z) in [("a", 5), ("b", 0), ("c", 5), ("d", -1)] {
        let mut layer = layer(name);
        layer.z = z;
        document.layers.push(layer);
    }
    let order: Vec<&str> = document
        .composite_order()
        .iter()
        .map(|layer| layer.name.as_str())
        .collect();
    // `d` is lowest; `a` and `c` share a z and keep the order they were registered
    // in, which is what lets a model stack layers without ever setting `--z`.
    assert_eq!(order, vec!["d", "b", "a", "c"]);
}

#[test]
fn removing_a_layer_reports_whether_it_existed() {
    let mut document = Document::new();
    document.layers.push(layer("body"));
    assert!(document.remove("body"));
    assert!(!document.remove("body"));
    assert!(document.is_empty());
}

#[test]
fn the_document_round_trips_through_json() {
    // The document is an authoritative run artifact that core re-reads to
    // regenerate, so what is written has to come back identical.
    let mut layer = layer("ball");
    layer.z = 3;
    layer.rotation = 45;
    layer.opacity = 128;
    layer.ops.push(crate::Operation::FillBackground {
        color: crate::Rgba([1, 2, 3, 4]),
    });
    layer.set_keyframe(Property::X, key(0, 5));
    layer.set_keyframe(Property::Rotation, key(9, 360));
    let document = Document {
        layers: vec![layer],
    };

    let json = serde_json::to_string(&document).expect("serialize");
    let parsed: Document = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(parsed, document);
}

#[test]
fn a_minimal_document_fills_in_the_resting_transform() {
    // Only the placement is required on the wire; everything else defaults to the
    // identity so a hand-written or older document still loads.
    let json = r#"{"layers":[{"name":"body","x":1,"y":2,"width":4,"height":4}]}"#;
    let document: Document = serde_json::from_str(json).expect("deserialize");
    let layer = document.layer("body").expect("present");
    assert_eq!(layer.opacity, OPAQUE);
    assert_eq!(layer.scale_x, ACTUAL_SIZE);
    assert_eq!(layer.scale_y, ACTUAL_SIZE);
    assert!(layer.ops.is_empty());
}

#[test]
fn an_empty_document_is_the_default() {
    let document: Document = serde_json::from_str("{}").expect("deserialize");
    assert!(document.is_empty());
    assert!(document.composite_order().is_empty());
}
