//! The layer and animation subcommands.
//!
//! Split out of [`cli`](super) alongside [the drawing operations](super::OpCommand).
//! These commands never paint: they register a surface, place it, animate it, or
//! report what exists. Painting is done by an ordinary drawing operation carrying
//! the binary's global `--layer` flag, so the drawing vocabulary stays one list.

use clap::{Args, Subcommand, ValueEnum};

use crate::curve::{Interp, Keyframe};
use crate::layer::{ACTUAL_SIZE, Document, Layer, OPAQUE, Property};

/// The layer subcommands shared by both binaries.
///
/// Animation is **not** here: keyframes are indexed by frame, which only a sprite
/// sheet has, so `draw-sheet` adds [`AnimateArgs`] on its own.
#[derive(Debug, Clone, PartialEq, Eq, Subcommand)]
pub enum LayerCommand {
    /// Register a layer: a separately placed surface that composites over the
    /// canvas. Its own operations use layer-local coordinates, and it may be much
    /// smaller than the canvas — only the region it covers is affected.
    RegisterLayer {
        /// The name operations address this layer by (`--layer <name>`).
        #[arg(long)]
        name: String,
        /// Left edge on the canvas.
        #[arg(long)]
        x: i64,
        /// Top edge on the canvas.
        #[arg(long)]
        y: i64,
        /// The layer's own width. Not the canvas width.
        #[arg(long)]
        width: u32,
        /// The layer's own height. Not the canvas height.
        #[arg(long)]
        height: u32,
        /// Composite order, low to high. Layers with equal `z` stack in
        /// registration order; all layers sit above the canvas log.
        #[arg(long, default_value_t = 0)]
        z: i64,
        /// Opacity, 0 (invisible) to 255 (opaque).
        #[arg(long, default_value_t = OPAQUE)]
        opacity: i64,
        /// Clockwise rotation about the layer's centre, in whole degrees.
        #[arg(long, default_value_t = 0)]
        rotation: i64,
        /// Horizontal scale as a percentage (100 = actual size).
        #[arg(long, default_value_t = ACTUAL_SIZE)]
        scale_x: i64,
        /// Vertical scale as a percentage (100 = actual size).
        #[arg(long, default_value_t = ACTUAL_SIZE)]
        scale_y: i64,
    },
    /// Discard a layer's drawing operations, keeping it registered, placed, and
    /// animated. The way to repaint a layer's content without rebuilding it.
    ClearLayer {
        /// The layer to clear.
        #[arg(long)]
        name: String,
    },
    /// Remove a layer entirely: its content, its placement, and its keyframes.
    RemoveLayer {
        /// The layer to remove.
        #[arg(long)]
        name: String,
    },
    /// List every registered layer with its placement, transform, operation count,
    /// and animated properties.
    ListLayers,
}

impl LayerCommand {
    /// The name of the layer this command targets, if it names one.
    pub fn target(&self) -> Option<&str> {
        match self {
            LayerCommand::RegisterLayer { name, .. }
            | LayerCommand::ClearLayer { name }
            | LayerCommand::RemoveLayer { name } => Some(name),
            LayerCommand::ListLayers => None,
        }
    }
}

/// Add or replace a keyframe on one of a layer's transform properties.
///
/// A property with no keyframes holds the resting value `register-layer` gave it.
/// Before the first key the curve holds the first value and after the last it holds
/// the last, so one key pins a property across the whole sheet.
#[derive(Debug, Clone, PartialEq, Eq, Args)]
pub struct AnimateArgs {
    /// The layer to animate.
    #[arg(long)]
    pub layer: String,
    /// Which transform property this key drives.
    #[arg(long, value_enum)]
    pub property: PropertyArg,
    /// The frame this key sits on. A key already on this frame is replaced.
    #[arg(long)]
    pub frame: u32,
    /// The property's value at this frame. Whole degrees for `rotation`, a
    /// percentage for `scale-x`/`scale-y`, 0..=255 for `opacity`, pixels otherwise.
    #[arg(long)]
    pub value: i64,
    /// Interpolation of the segment **leaving** this key.
    #[arg(long, value_enum, default_value = "bezier")]
    pub interp: InterpArg,
    /// Bézier out-handle on this key as `<dframes,dvalue>`, an offset from the key.
    /// Omitted, a `bezier` key uses an auto tangent.
    #[arg(long, value_parser = parse_handle)]
    pub handle_out: Option<Handle>,
    /// Bézier in-handle on this key as `<dframes,dvalue>`, an offset from the key.
    /// Omitted, a `bezier` key uses an auto tangent.
    #[arg(long, value_parser = parse_handle)]
    pub handle_in: Option<Handle>,
}

impl AnimateArgs {
    /// The keyframe these arguments describe.
    pub fn keyframe(&self) -> Keyframe {
        Keyframe {
            frame: self.frame,
            value: self.value,
            interp: self.interp.into(),
            out_handle: self.handle_out.map(|handle| handle.0),
            in_handle: self.handle_in.map(|handle| handle.0),
        }
    }
}

/// Drop keyframes from a layer, returning the affected properties to their resting
/// values.
#[derive(Debug, Clone, PartialEq, Eq, Args)]
pub struct ClearKeyframesArgs {
    /// The layer to clear keyframes from.
    #[arg(long)]
    pub layer: String,
    /// Clear only this property. Omitted, every property is cleared.
    #[arg(long, value_enum)]
    pub property: Option<PropertyArg>,
}

/// A Bézier tangent handle, parsed from `<dframes,dvalue>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Handle(pub [i64; 2]);

/// Parse a `<dframes,dvalue>` handle. Both components are integers, and each is an
/// offset from the handle's own key rather than an absolute position.
fn parse_handle(value: &str) -> Result<Handle, String> {
    let (dt, dvalue) = value
        .split_once(',')
        .ok_or_else(|| format!("invalid handle `{value}` (expected `<dframes,dvalue>`)"))?;
    let parse = |part: &str, what: &str| -> Result<i64, String> {
        part.trim()
            .parse::<i64>()
            .map_err(|_| format!("invalid handle `{value}`: {what} `{part}` is not an integer"))
    };
    Ok(Handle([parse(dt, "dframes")?, parse(dvalue, "dvalue")?]))
}

/// The animatable properties, as `clap` values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum PropertyArg {
    /// The layer's left edge on the canvas.
    X,
    /// The layer's top edge on the canvas.
    Y,
    /// Opacity, 0 (invisible) to 255 (opaque).
    Opacity,
    /// Clockwise rotation about the layer's centre, in whole degrees.
    Rotation,
    /// Horizontal scale as a percentage (100 = actual size).
    ScaleX,
    /// Vertical scale as a percentage (100 = actual size).
    ScaleY,
}

impl From<PropertyArg> for Property {
    fn from(arg: PropertyArg) -> Property {
        match arg {
            PropertyArg::X => Property::X,
            PropertyArg::Y => Property::Y,
            PropertyArg::Opacity => Property::Opacity,
            PropertyArg::Rotation => Property::Rotation,
            PropertyArg::ScaleX => Property::ScaleX,
            PropertyArg::ScaleY => Property::ScaleY,
        }
    }
}

/// The interpolation modes, as `clap` values. These mirror the F-curve vocabulary
/// the voxel and mesh animation tools use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum InterpArg {
    /// Hold the value until the next key (a step).
    Constant,
    /// A straight line to the next key.
    Linear,
    /// A smooth curve shaped by tangent handles (auto tangents when omitted).
    Bezier,
    /// Start slow and accelerate into the next key.
    EaseIn,
    /// Start fast and decelerate into the next key.
    EaseOut,
    /// Ease both ends.
    EaseInOut,
}

impl From<InterpArg> for Interp {
    fn from(arg: InterpArg) -> Interp {
        match arg {
            InterpArg::Constant => Interp::Constant,
            InterpArg::Linear => Interp::Linear,
            InterpArg::Bezier => Interp::Bezier,
            InterpArg::EaseIn => Interp::EaseIn,
            InterpArg::EaseOut => Interp::EaseOut,
            InterpArg::EaseInOut => Interp::EaseInOut,
        }
    }
}

/// Apply a layer command to the document, returning the line to print.
///
/// Both binaries share this: registering and removing a layer means the same thing
/// whether or not the asset has frames. Only the animation commands are
/// sheet-specific, and they are not part of [`LayerCommand`].
pub fn apply(document: &mut Document, command: LayerCommand) -> Result<String, String> {
    match command {
        LayerCommand::RegisterLayer {
            name,
            x,
            y,
            width,
            height,
            z,
            opacity,
            rotation,
            scale_x,
            scale_y,
        } => {
            // Re-registering silently would discard the layer's content and
            // keyframes, so it is refused: `clear-layer` and `remove-layer` are the
            // explicit ways to undo work.
            if document.layer(&name).is_some() {
                return Err(format!(
                    "a layer named `{name}` is already registered — use `clear-layer` to \
                     repaint it or `remove-layer` to replace it"
                ));
            }
            if width == 0 || height == 0 {
                return Err(format!(
                    "layer `{name}` would be {width}x{height}: a layer needs a non-zero extent"
                ));
            }
            let mut layer = Layer::new(name.clone(), x, y, width, height);
            layer.z = z;
            layer.opacity = opacity;
            layer.rotation = rotation;
            layer.scale_x = scale_x;
            layer.scale_y = scale_y;
            document.layers.push(layer);
            Ok(format!(
                "registered layer {name}: {width}x{height} at ({x}, {y})"
            ))
        }
        LayerCommand::ClearLayer { name } => {
            let layer = document
                .layer_mut(&name)
                .ok_or_else(|| super::unknown_layer(&name))?;
            let cleared = layer.ops.len();
            layer.ops.clear();
            Ok(format!(
                "cleared layer {name} ({cleared} operation{} discarded)",
                if cleared == 1 { "" } else { "s" }
            ))
        }
        LayerCommand::RemoveLayer { name } => {
            if !document.remove(&name) {
                return Err(super::unknown_layer(&name));
            }
            Ok(format!("removed layer {name}"))
        }
        LayerCommand::ListLayers => Ok(describe(&document.layers)),
    }
}

/// Add or replace a keyframe, returning the line to print.
pub fn animate(document: &mut Document, args: &AnimateArgs) -> Result<String, String> {
    let property: Property = args.property.into();
    let layer = document
        .layer_mut(&args.layer)
        .ok_or_else(|| super::unknown_layer(&args.layer))?;
    layer.set_keyframe(property, args.keyframe());
    let count = layer
        .track(property)
        .map(|track| track.keys.len())
        .unwrap_or(0);
    Ok(format!(
        "keyed {} of layer {} to {} at frame {} ({count} key{} on it)",
        property.name(),
        args.layer,
        args.value,
        args.frame,
        if count == 1 { "" } else { "s" }
    ))
}

/// Drop keyframes, returning the line to print.
pub fn clear_keyframes(
    document: &mut Document,
    args: &ClearKeyframesArgs,
) -> Result<String, String> {
    let layer = document
        .layer_mut(&args.layer)
        .ok_or_else(|| super::unknown_layer(&args.layer))?;
    match args.property {
        Some(property) => {
            let property: Property = property.into();
            layer.tracks.retain(|track| track.property != property);
            Ok(format!(
                "cleared the {} track of layer {} — it rests at {}",
                property.name(),
                args.layer,
                layer.resting(property)
            ))
        }
        None => {
            let cleared = layer.tracks.len();
            layer.tracks.clear();
            Ok(format!(
                "cleared {cleared} track{} of layer {} — it rests at its registered transform",
                if cleared == 1 { "" } else { "s" },
                args.layer
            ))
        }
    }
}

/// A human-readable summary of the document, for `list-layers`.
///
/// A model cannot see the document file directly in the way it sees a preview, so
/// this is its only view of what it has registered — it reports placement, the full
/// transform, content size, and which properties are animated over what frame range.
pub fn describe(layers: &[Layer]) -> String {
    if layers.is_empty() {
        return "no layers registered".to_string();
    }
    let mut out = String::new();
    for layer in layers {
        out.push_str(&format!(
            "{} — {}x{} at ({}, {}), z {}, opacity {}, rotation {}°, scale {}%x{}%, {} op{}",
            layer.name,
            layer.width,
            layer.height,
            layer.x,
            layer.y,
            layer.z,
            layer.opacity,
            layer.rotation,
            layer.scale_x,
            layer.scale_y,
            layer.ops.len(),
            if layer.ops.len() == 1 { "" } else { "s" },
        ));
        for track in &layer.tracks {
            let frames: Vec<String> = track
                .keys
                .iter()
                .map(|key| format!("{}={}", key.frame, key.value))
                .collect();
            out.push_str(&format!(
                "\n    {} [{}]",
                track.property.name(),
                frames.join(", ")
            ));
        }
        out.push('\n');
    }
    out.pop();
    out
}
