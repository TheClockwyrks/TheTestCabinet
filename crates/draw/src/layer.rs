//! Layers: independently placed surfaces that composite over the canvas.
//!
//! A plain drawing operation paints straight onto the canvas, where it becomes
//! indistinguishable from everything already there — moving one element means
//! redrawing the image. A [`Layer`] is a separate surface with its own extent and
//! its own operation log, placed on the canvas by a transform that can be
//! [animated](crate::curve) across a sheet's frames. That is what makes motion
//! like an arc or a spin expressible at all: the shape is painted once and the
//! curve moves it.
//!
//! The whole set lives in one [`Document`] — `layers.json` — rather than in the
//! per-frame action logs, because a layer is inherently **sheet-wide**: the same
//! painted content appears in every frame at a different transform. The per-frame
//! logs keep their existing meaning and render underneath.

use serde::{Deserialize, Serialize};

use crate::Operation;
use crate::curve::{self, Keyframe};

/// The default opacity of a layer: fully opaque.
pub const OPAQUE: i64 = 255;

/// The default scale of a layer, as a percentage: actual size.
pub const ACTUAL_SIZE: i64 = 100;

/// A layer transform property that can carry keyframes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Property {
    /// The layer's left edge on the canvas.
    X,
    /// The layer's top edge on the canvas.
    Y,
    /// Opacity, `0` (invisible) to `255` (opaque).
    Opacity,
    /// Clockwise rotation about the layer's centre, in whole degrees.
    Rotation,
    /// Horizontal scale as a percentage (`100` = actual size).
    ScaleX,
    /// Vertical scale as a percentage (`100` = actual size).
    ScaleY,
}

impl Property {
    /// The property's spelling on the command line and in the document.
    pub fn name(self) -> &'static str {
        match self {
            Property::X => "x",
            Property::Y => "y",
            Property::Opacity => "opacity",
            Property::Rotation => "rotation",
            Property::ScaleX => "scale_x",
            Property::ScaleY => "scale_y",
        }
    }
}

/// One property's F-curve: the keyframes driving a single layer property.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Track {
    /// The property this track drives.
    pub property: Property,
    /// The keyframes, kept sorted by frame.
    pub keys: Vec<Keyframe>,
}

/// A layer's resolved transform at one frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Transform {
    /// The layer's left edge on the canvas.
    pub x: i64,
    /// The layer's top edge on the canvas.
    pub y: i64,
    /// Opacity, `0` (invisible) to `255` (opaque).
    pub opacity: i64,
    /// Clockwise rotation about the layer's centre, in whole degrees.
    pub rotation: i64,
    /// Horizontal scale as a percentage.
    pub scale_x: i64,
    /// Vertical scale as a percentage.
    pub scale_y: i64,
}

/// A named surface painted once and placed on the canvas by its transform.
///
/// The layer's own operations use **layer-local** coordinates, so its content is
/// independent of where it currently sits; `width`/`height` bound it, and it may be
/// far smaller than the canvas (only the region it covers is affected) or larger
/// (the overhang is clipped).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Layer {
    /// The name operations address this layer by.
    pub name: String,
    /// Resting left edge on the canvas.
    pub x: i64,
    /// Resting top edge on the canvas.
    pub y: i64,
    /// The layer's own width.
    pub width: u32,
    /// The layer's own height.
    pub height: u32,
    /// Composite order, low to high; ties break by registration order.
    #[serde(default)]
    pub z: i64,
    /// Resting opacity, `0`..=`255`.
    #[serde(default = "default_opacity")]
    pub opacity: i64,
    /// Resting rotation in whole degrees, clockwise about the centre.
    #[serde(default)]
    pub rotation: i64,
    /// Resting horizontal scale, as a percentage.
    #[serde(default = "default_scale")]
    pub scale_x: i64,
    /// Resting vertical scale, as a percentage.
    #[serde(default = "default_scale")]
    pub scale_y: i64,
    /// The drawing operations painting this layer's content, in layer-local
    /// coordinates.
    #[serde(default)]
    pub ops: Vec<Operation>,
    /// The animated properties. A property with no track holds its resting value.
    #[serde(default)]
    pub tracks: Vec<Track>,
}

fn default_opacity() -> i64 {
    OPAQUE
}

fn default_scale() -> i64 {
    ACTUAL_SIZE
}

impl Layer {
    /// A newly registered layer at its resting transform, with no content.
    pub fn new(name: String, x: i64, y: i64, width: u32, height: u32) -> Layer {
        Layer {
            name,
            x,
            y,
            width,
            height,
            z: 0,
            opacity: OPAQUE,
            rotation: 0,
            scale_x: ACTUAL_SIZE,
            scale_y: ACTUAL_SIZE,
            ops: Vec::new(),
            tracks: Vec::new(),
        }
    }

    /// The layer's resting value for `property` — what it holds when the property
    /// carries no keyframes.
    pub fn resting(&self, property: Property) -> i64 {
        match property {
            Property::X => self.x,
            Property::Y => self.y,
            Property::Opacity => self.opacity,
            Property::Rotation => self.rotation,
            Property::ScaleX => self.scale_x,
            Property::ScaleY => self.scale_y,
        }
    }

    /// The track driving `property`, if it has one.
    pub fn track(&self, property: Property) -> Option<&Track> {
        self.tracks.iter().find(|track| track.property == property)
    }

    /// Resolve `property` at `frame`: its curve's value, or its resting value when
    /// it is not animated.
    pub fn value_at(&self, property: Property, frame: u32) -> i64 {
        self.track(property)
            .and_then(|track| curve::evaluate(&track.keys, frame))
            .unwrap_or_else(|| self.resting(property))
    }

    /// Resolve the layer's whole transform at `frame`.
    pub fn transform_at(&self, frame: u32) -> Transform {
        Transform {
            x: self.value_at(Property::X, frame),
            y: self.value_at(Property::Y, frame),
            // Opacity is the one property with a meaningful range rather than a
            // meaningful sign: a curve overshooting past either end (an ease or a
            // Bézier readily does) must not wrap into a stray blend factor.
            opacity: self.value_at(Property::Opacity, frame).clamp(0, OPAQUE),
            rotation: self.value_at(Property::Rotation, frame),
            scale_x: self.value_at(Property::ScaleX, frame),
            scale_y: self.value_at(Property::ScaleY, frame),
        }
    }

    /// Insert a keyframe on `property`, replacing any key already on that frame and
    /// keeping the track sorted.
    pub fn set_keyframe(&mut self, property: Property, key: Keyframe) {
        let track = match self.tracks.iter().position(|t| t.property == property) {
            Some(index) => &mut self.tracks[index],
            None => {
                self.tracks.push(Track {
                    property,
                    keys: Vec::new(),
                });
                self.tracks.last_mut().expect("a track was just pushed")
            }
        };
        match track.keys.binary_search_by_key(&key.frame, |k| k.frame) {
            Ok(index) => track.keys[index] = key,
            Err(index) => track.keys.insert(index, key),
        }
    }
}

/// Every layer of a sprite or sheet: the contents of `layers.json`.
///
/// This is the second authoritative artifact of an asset-generation run, alongside
/// the action log(s). It is seeded empty, so a run that never registers a layer
/// renders exactly as it did before layers existed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Document {
    /// The registered layers, in registration order.
    #[serde(default)]
    pub layers: Vec<Layer>,
}

impl Document {
    /// An empty document.
    pub fn new() -> Document {
        Document::default()
    }

    /// Whether any layer is registered.
    pub fn is_empty(&self) -> bool {
        self.layers.is_empty()
    }

    /// The layer named `name`.
    pub fn layer(&self, name: &str) -> Option<&Layer> {
        self.layers.iter().find(|layer| layer.name == name)
    }

    /// The layer named `name`, mutably.
    pub fn layer_mut(&mut self, name: &str) -> Option<&mut Layer> {
        self.layers.iter_mut().find(|layer| layer.name == name)
    }

    /// Remove the layer named `name`, reporting whether it existed.
    pub fn remove(&mut self, name: &str) -> bool {
        let before = self.layers.len();
        self.layers.retain(|layer| layer.name != name);
        self.layers.len() != before
    }

    /// The layers in composite order: ascending `z`, ties in registration order.
    ///
    /// The sort is stable, so registration order is preserved within a `z` — which
    /// is what makes `z` optional for the common case of stacking layers in the
    /// order they were created.
    pub fn composite_order(&self) -> Vec<&Layer> {
        let mut ordered: Vec<&Layer> = self.layers.iter().collect();
        ordered.sort_by_key(|layer| layer.z);
        ordered
    }

    /// The registered layer names, in registration order.
    pub fn names(&self) -> Vec<&str> {
        self.layers
            .iter()
            .map(|layer| layer.name.as_str())
            .collect()
    }
}

#[cfg(test)]
#[path = "layer.test.rs"]
mod tests;
