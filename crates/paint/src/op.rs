//! The recorded operation log and the engine that replays it into a composited
//! workspace.
//!
//! Every mark the four binaries make is one [`Action`] appended to a single shared
//! JSON log: an optional `target` (the `--element` or `--map` it edits) plus an
//! internally-tagged [`Op`]. Like the `draw` tool, the log is
//! the single source of truth: a preview (and core's parse) is produced by
//! **replaying the whole log** from an empty workspace ([`replay`]). Stochastic ops
//! derive their seed from the asset seed (recorded by the first `init` action) and
//! their operation index, so a replay is exactly reproducible.

use serde::{Deserialize, Serialize};

use crate::bake;
use crate::blend::BlendMode;
use crate::color::Color;
use crate::effects::{EffectKind, EffectParams};
use crate::layer::{Document, Layer, Workspace};
use crate::paint_core::{Brush, BrushKind};
use crate::proc::{NoiseKind, PatternKind};
use crate::rng::{Rng, derive_seed};
use crate::text::{Align, font_by_name};
use crate::vector::ShapeStyle;

/// A 2D point in element/map pixel space.
pub type Point = (f32, f32);

/// A gradient/gradient-map color stop: position `0..=1` and its color.
pub type Stop = (f32, Color);

/// One recorded log entry: the target document and the operation applied to it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    /// The `--element` / `--map` the operation edits (absent for a single-target
    /// case and for workspace-wide entries like `init`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// The operation itself.
    #[serde(flatten)]
    pub op: Op,
}

impl Action {
    /// A workspace-wide action with no specific target.
    pub fn global(op: Op) -> Action {
        Action { target: None, op }
    }

    /// A targeted action.
    pub fn targeted(target: Option<String>, op: Op) -> Action {
        Action { target, op }
    }

    /// The wire tag of this action's operation (for the confirmation line and the
    /// live-preview header).
    pub fn name(&self) -> &'static str {
        self.op.name()
    }
}

/// A single operation, the internally-tagged wire form recorded in the log.
///
/// Coordinates are pixels within the target document and may be signed/off-document
/// (the off-document part is clipped, never a panic). Every variant is total.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Op {
    /// Records the asset seed as the first log entry. Per-op randomness derives from
    /// it; the model never supplies a seed.
    Init { seed: u64 },

    // ---- layers ----
    /// Add a new, transparent layer on top of the stack.
    AddLayer { name: String },
    /// Remove a named layer.
    RemoveLayer { layer: String },
    /// Move a named layer to stack index `to` (0 = bottom).
    ReorderLayer { layer: String, to: usize },
    /// Set a layer's opacity (`0..=1`).
    SetLayerOpacity { layer: String, opacity: f32 },
    /// Set a layer's blend mode.
    SetBlendMode { layer: String, mode: BlendMode },
    /// Show or hide a layer.
    SetLayerVisible { layer: String, visible: bool },
    /// Merge several named layers into one flattened layer.
    GroupLayers {
        layers: Vec<String>,
        #[serde(default)]
        name: Option<String>,
    },
    /// Attach a fully-revealing grayscale mask to a layer.
    AddMask { layer: String },

    // ---- brushes / fills / gradients ----
    /// Stamp one brush dab at `(x, y)`.
    Brush {
        #[serde(default)]
        layer: Option<String>,
        #[serde(default)]
        mask: bool,
        brush: BrushKind,
        size: f32,
        hardness: f32,
        flow: f32,
        opacity: f32,
        color: Color,
        x: f32,
        y: f32,
        #[serde(default = "one")]
        spacing: f32,
        #[serde(default)]
        scatter: f32,
        #[serde(default)]
        jitter: f32,
    },
    /// Draw a smoothed polyline of brush dabs.
    Stroke {
        #[serde(default)]
        layer: Option<String>,
        #[serde(default)]
        mask: bool,
        brush: BrushKind,
        size: f32,
        hardness: f32,
        flow: f32,
        opacity: f32,
        color: Color,
        points: Vec<Point>,
        #[serde(default = "quarter")]
        spacing: f32,
        #[serde(default)]
        scatter: f32,
        #[serde(default)]
        jitter: f32,
    },
    /// Fill the whole layer (or selection) with a color.
    Fill {
        #[serde(default)]
        layer: Option<String>,
        #[serde(default)]
        mask: bool,
        color: Color,
    },
    /// Contiguous flood fill from a seed pixel.
    Bucket {
        #[serde(default)]
        layer: Option<String>,
        x: i64,
        y: i64,
        color: Color,
        #[serde(default = "tenth")]
        tolerance: f32,
    },
    /// Fill an axis-aligned rectangle.
    FillRect {
        #[serde(default)]
        layer: Option<String>,
        #[serde(default)]
        mask: bool,
        x: i64,
        y: i64,
        width: u32,
        height: u32,
        color: Color,
    },
    /// Fill an ellipse.
    FillEllipse {
        #[serde(default)]
        layer: Option<String>,
        #[serde(default)]
        mask: bool,
        cx: f32,
        cy: f32,
        rx: f32,
        ry: f32,
        color: Color,
    },
    /// A linear or radial gradient across the layer.
    Gradient {
        #[serde(default)]
        layer: Option<String>,
        #[serde(default)]
        mask: bool,
        #[serde(default)]
        radial: bool,
        stops: Vec<Stop>,
        from: Point,
        to: Point,
    },

    // ---- selections ----
    /// Select a rectangle.
    SelectRect {
        x: i64,
        y: i64,
        width: u32,
        height: u32,
    },
    /// Select an ellipse.
    SelectEllipse { cx: f32, cy: f32, rx: f32, ry: f32 },
    /// Select a freeform polygon (lasso).
    SelectLasso { points: Vec<Point> },
    /// Clear the selection.
    SelectNone,
    /// Invert the selection.
    InvertSelection,
    /// Feather (soften) the selection edge.
    Feather { radius: u32 },

    // ---- filters ----
    /// Gaussian-ish blur.
    Blur {
        #[serde(default)]
        layer: Option<String>,
        radius: u32,
    },
    /// Unsharp-mask sharpen.
    Sharpen {
        #[serde(default)]
        layer: Option<String>,
    },
    /// Add seeded monochrome noise.
    Noise {
        #[serde(default)]
        layer: Option<String>,
        amount: f32,
    },
    /// Levels: black point, white point, gamma.
    Levels {
        #[serde(default)]
        layer: Option<String>,
        black: f32,
        white: f32,
        #[serde(default = "one")]
        gamma: f32,
    },
    /// S-curve contrast (`amount` in `-1..=1`).
    Curves {
        #[serde(default)]
        layer: Option<String>,
        amount: f32,
    },
    /// Hue shift (degrees), saturation scale, lightness offset.
    HueSat {
        #[serde(default)]
        layer: Option<String>,
        #[serde(default)]
        hue: f32,
        #[serde(default)]
        sat: f32,
        #[serde(default)]
        lightness: f32,
    },
    /// Collapse to grayscale.
    Desaturate {
        #[serde(default)]
        layer: Option<String>,
    },

    // ---- effects / transforms ----
    /// A layer effect (bevel/inner-shadow/drop-shadow/stroke/glow).
    LayerEffect {
        #[serde(default)]
        layer: Option<String>,
        effect: EffectKind,
        #[serde(default = "four")]
        size: f32,
        #[serde(default = "black")]
        color: Color,
        #[serde(default = "one_thirty_five")]
        angle: f32,
        #[serde(default = "four")]
        distance: f32,
    },
    /// Affine transform: translate, scale, rotate.
    TransformLayer {
        #[serde(default)]
        layer: Option<String>,
        #[serde(default)]
        translate: Point,
        #[serde(default = "unit_scale")]
        scale: Point,
        #[serde(default)]
        rotate: f32,
    },
    /// Flip horizontally or vertically.
    Flip {
        #[serde(default)]
        layer: Option<String>,
        horizontal: bool,
    },
    /// Mirror the left half onto the right about `axis_x`.
    Mirror {
        #[serde(default)]
        layer: Option<String>,
        axis_x: u32,
    },

    // ---- ui vector shapes / text / nine-slice ----
    /// Anti-aliased rectangle.
    Rect {
        #[serde(default)]
        layer: Option<String>,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        #[serde(default)]
        fill: Option<Color>,
        #[serde(default)]
        stroke: Option<Color>,
        #[serde(default)]
        stroke_width: f32,
    },
    /// Anti-aliased rounded rectangle.
    RoundedRect {
        #[serde(default)]
        layer: Option<String>,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        corner_radius: f32,
        #[serde(default)]
        fill: Option<Color>,
        #[serde(default)]
        stroke: Option<Color>,
        #[serde(default)]
        stroke_width: f32,
    },
    /// Anti-aliased ellipse.
    Ellipse {
        #[serde(default)]
        layer: Option<String>,
        cx: f32,
        cy: f32,
        rx: f32,
        ry: f32,
        #[serde(default)]
        fill: Option<Color>,
        #[serde(default)]
        stroke: Option<Color>,
        #[serde(default)]
        stroke_width: f32,
    },
    /// Anti-aliased line.
    Line {
        #[serde(default)]
        layer: Option<String>,
        x0: f32,
        y0: f32,
        x1: f32,
        y1: f32,
        stroke: Color,
        #[serde(default = "one")]
        stroke_width: f32,
    },
    /// Anti-aliased closed polygon.
    Polygon {
        #[serde(default)]
        layer: Option<String>,
        points: Vec<Point>,
        #[serde(default)]
        fill: Option<Color>,
        #[serde(default)]
        stroke: Option<Color>,
        #[serde(default)]
        stroke_width: f32,
    },
    /// Baked-font text.
    Text {
        #[serde(default)]
        layer: Option<String>,
        content: String,
        #[serde(default = "default_font")]
        font: String,
        size: f32,
        color: Color,
        #[serde(default = "align_left")]
        align: Align,
        #[serde(default)]
        bold: bool,
        #[serde(default)]
        letter_spacing: f32,
        #[serde(default)]
        wrap: Option<f32>,
        x: f32,
        y: f32,
    },
    /// Record the element's nine-slice stretchable insets.
    SetNineSlice {
        left: u32,
        right: u32,
        top: u32,
        bottom: u32,
    },

    // ---- texture procedural ----
    /// Fill the map with tiling coherent noise.
    GenNoise {
        #[serde(default)]
        layer: Option<String>,
        kind: NoiseKind,
        #[serde(default = "four")]
        scale: f32,
        #[serde(default = "four_u")]
        octaves: u32,
    },
    /// Stamp a tiling structural pattern.
    Pattern {
        #[serde(default)]
        layer: Option<String>,
        kind: PatternKind,
        #[serde(default = "four")]
        scale: f32,
    },
    /// Domain-warp the map by another channel's relief.
    Warp {
        #[serde(default)]
        layer: Option<String>,
        source: String,
        #[serde(default = "four")]
        amount: f32,
    },
    /// Remap the map's grayscale through a color ramp.
    GradientMap {
        #[serde(default)]
        layer: Option<String>,
        stops: Vec<Stop>,
    },

    // ---- pbr derivation / uniforms ----
    /// Bake a tangent-space normal map from a height channel into the target map.
    BakeNormal {
        #[serde(default = "height_src")]
        from: String,
        #[serde(default = "one")]
        strength: f32,
    },
    /// Bake ambient occlusion from a height channel into the target map.
    BakeAo {
        #[serde(default = "height_src")]
        from: String,
        #[serde(default = "four_u")]
        radius: u32,
    },
    /// Bake curvature from a height channel into the target map.
    BakeCurvature {
        #[serde(default = "height_src")]
        from: String,
    },
    /// Fill the target scalar map with a constant `value` (`0..=1`).
    SetUniform { value: f32 },
}

impl Op {
    /// The wire tag of this operation.
    pub fn name(&self) -> &'static str {
        match self {
            Op::Init { .. } => "init",
            Op::AddLayer { .. } => "add-layer",
            Op::RemoveLayer { .. } => "remove-layer",
            Op::ReorderLayer { .. } => "reorder-layer",
            Op::SetLayerOpacity { .. } => "set-layer-opacity",
            Op::SetBlendMode { .. } => "set-blend-mode",
            Op::SetLayerVisible { .. } => "set-layer-visible",
            Op::GroupLayers { .. } => "group-layers",
            Op::AddMask { .. } => "add-mask",
            Op::Brush { .. } => "brush",
            Op::Stroke { .. } => "stroke",
            Op::Fill { .. } => "fill",
            Op::Bucket { .. } => "bucket",
            Op::FillRect { .. } => "fill-rect",
            Op::FillEllipse { .. } => "fill-ellipse",
            Op::Gradient { .. } => "gradient",
            Op::SelectRect { .. } => "select-rect",
            Op::SelectEllipse { .. } => "select-ellipse",
            Op::SelectLasso { .. } => "select-lasso",
            Op::SelectNone => "select-none",
            Op::InvertSelection => "invert-selection",
            Op::Feather { .. } => "feather",
            Op::Blur { .. } => "blur",
            Op::Sharpen { .. } => "sharpen",
            Op::Noise { .. } => "noise",
            Op::Levels { .. } => "levels",
            Op::Curves { .. } => "curves",
            Op::HueSat { .. } => "hue-sat",
            Op::Desaturate { .. } => "desaturate",
            Op::LayerEffect { .. } => "layer-effect",
            Op::TransformLayer { .. } => "transform-layer",
            Op::Flip { .. } => "flip",
            Op::Mirror { .. } => "mirror",
            Op::Rect { .. } => "rect",
            Op::RoundedRect { .. } => "rounded-rect",
            Op::Ellipse { .. } => "ellipse",
            Op::Line { .. } => "line",
            Op::Polygon { .. } => "polygon",
            Op::Text { .. } => "text",
            Op::SetNineSlice { .. } => "set-nine-slice",
            Op::GenNoise { .. } => "noise",
            Op::Pattern { .. } => "pattern",
            Op::Warp { .. } => "warp",
            Op::GradientMap { .. } => "gradient-map",
            Op::BakeNormal { .. } => "bake-normal",
            Op::BakeAo { .. } => "bake-ao",
            Op::BakeCurvature { .. } => "bake-curvature",
            Op::SetUniform { .. } => "set-uniform",
        }
    }
}

/// The asset seed recorded by the first `init` action (0 if none).
pub fn asset_seed(actions: &[Action]) -> u64 {
    actions
        .iter()
        .find_map(|a| match a.op {
            Op::Init { seed } => Some(seed),
            _ => None,
        })
        .unwrap_or(0)
}

/// Replay a whole operation log into `ws`, applying each action in order.
pub fn replay(ws: &mut Workspace, actions: &[Action]) -> Result<(), String> {
    let seed = asset_seed(actions);
    for (index, action) in actions.iter().enumerate() {
        apply(ws, action, index, seed)?;
    }
    Ok(())
}

/// Resolve a layer name (or the topmost layer when `None`) to an index.
fn layer_idx(doc: &mut Document, name: &Option<String>) -> Result<usize, String> {
    match name {
        Some(n) => doc.layer_index(n),
        None => {
            if doc.layers.is_empty() {
                doc.layers.push(Layer::new("base", doc.width, doc.height));
            }
            Ok(doc.layers.len() - 1)
        }
    }
}

/// Apply one action to the workspace. `index` is the action's position in the log
/// (for seed derivation); `seed` is the asset seed.
pub fn apply(ws: &mut Workspace, action: &Action, index: usize, seed: u64) -> Result<(), String> {
    let mut rng = Rng::new(derive_seed(seed, index));
    // Warp and bakes read a *source* document, so resolve those fields before
    // borrowing the target mutably.
    match &action.op {
        Op::Init { .. } => return Ok(()),
        Op::Warp {
            source,
            amount,
            layer,
        } => {
            let src = ws
                .documents
                .get(source)
                .ok_or_else(|| format!("no source map `{source}`"))?;
            let field = bake::height_field(&src.composite());
            let wrap = ws.wrap;
            let (_, doc) = ws.resolve(action.target.as_deref())?;
            let li = layer_idx(doc, layer)?;
            doc.warp_by(li, &field, *amount, wrap);
            return Ok(());
        }
        Op::BakeNormal { from, strength } => {
            let (w, h, field) = source_height(ws, from)?;
            let raster = bake::bake_normal(&field, w, h, *strength);
            let (_, doc) = ws.resolve(action.target.as_deref())?;
            doc.replace_with(raster);
            return Ok(());
        }
        Op::BakeAo { from, radius } => {
            let (w, h, field) = source_height(ws, from)?;
            let raster = bake::bake_ao(&field, w, h, *radius);
            let (_, doc) = ws.resolve(action.target.as_deref())?;
            doc.replace_with(raster);
            return Ok(());
        }
        Op::BakeCurvature { from } => {
            let (w, h, field) = source_height(ws, from)?;
            let raster = bake::bake_curvature(&field, w, h);
            let (_, doc) = ws.resolve(action.target.as_deref())?;
            doc.replace_with(raster);
            return Ok(());
        }
        _ => {}
    }

    let wrap = ws.wrap;
    let (_, doc) = ws.resolve(action.target.as_deref())?;
    match &action.op {
        Op::Init { .. }
        | Op::Warp { .. }
        | Op::BakeNormal { .. }
        | Op::BakeAo { .. }
        | Op::BakeCurvature { .. } => {
            unreachable!("handled above")
        }
        Op::AddLayer { name } => {
            doc.layers
                .push(Layer::new(name.clone(), doc.width, doc.height));
        }
        Op::RemoveLayer { layer } => {
            let i = doc.layer_index(layer)?;
            doc.layers.remove(i);
        }
        Op::ReorderLayer { layer, to } => {
            let i = doc.layer_index(layer)?;
            let l = doc.layers.remove(i);
            let to = (*to).min(doc.layers.len());
            doc.layers.insert(to, l);
        }
        Op::SetLayerOpacity { layer, opacity } => {
            let i = doc.layer_index(layer)?;
            doc.layers[i].opacity = opacity.clamp(0.0, 1.0);
        }
        Op::SetBlendMode { layer, mode } => {
            let i = doc.layer_index(layer)?;
            doc.layers[i].blend = *mode;
        }
        Op::SetLayerVisible { layer, visible } => {
            let i = doc.layer_index(layer)?;
            doc.layers[i].visible = *visible;
        }
        Op::GroupLayers { layers, name } => {
            group_layers(doc, layers, name.clone())?;
        }
        Op::AddMask { layer } => {
            let i = doc.layer_index(layer)?;
            let count = doc.layers[i].raster.pixels.len();
            doc.layers[i].mask = Some(vec![1.0; count]);
        }
        Op::Brush {
            layer,
            mask,
            brush,
            size,
            hardness,
            flow,
            opacity,
            color,
            x,
            y,
            spacing,
            scatter,
            jitter,
        } => {
            let li = layer_idx(doc, layer)?;
            let b = Brush {
                kind: *brush,
                size: *size,
                hardness: *hardness,
                flow: *flow,
                opacity: *opacity,
                color: *color,
            };
            let _ = spacing;
            doc.brush_stroke(
                li,
                *mask,
                &b,
                &[(*x, *y)],
                1.0,
                *scatter,
                *jitter,
                wrap,
                &mut rng,
            );
        }
        Op::Stroke {
            layer,
            mask,
            brush,
            size,
            hardness,
            flow,
            opacity,
            color,
            points,
            spacing,
            scatter,
            jitter,
        } => {
            let li = layer_idx(doc, layer)?;
            let b = Brush {
                kind: *brush,
                size: *size,
                hardness: *hardness,
                flow: *flow,
                opacity: *opacity,
                color: *color,
            };
            doc.brush_stroke(
                li, *mask, &b, points, *spacing, *scatter, *jitter, wrap, &mut rng,
            );
        }
        Op::Fill { layer, mask, color } => {
            let li = layer_idx(doc, layer)?;
            doc.fill_layer(li, *mask, *color);
        }
        Op::Bucket {
            layer,
            x,
            y,
            color,
            tolerance,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.bucket(li, *x, *y, *color, *tolerance, wrap);
        }
        Op::FillRect {
            layer,
            mask,
            x,
            y,
            width,
            height,
            color,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.fill_rect(li, *mask, *x, *y, *width, *height, *color, wrap);
        }
        Op::FillEllipse {
            layer,
            mask,
            cx,
            cy,
            rx,
            ry,
            color,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.fill_ellipse(li, *mask, *cx, *cy, *rx, *ry, *color, wrap);
        }
        Op::Gradient {
            layer,
            mask,
            radial,
            stops,
            from,
            to,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.gradient(li, *mask, *radial, stops, *from, *to);
        }
        Op::SelectRect {
            x,
            y,
            width,
            height,
        } => doc.select_rect(*x, *y, *width, *height),
        Op::SelectEllipse { cx, cy, rx, ry } => doc.select_ellipse(*cx, *cy, *rx, *ry),
        Op::SelectLasso { points } => doc.select_lasso(points),
        Op::SelectNone => doc.select_none(),
        Op::InvertSelection => doc.invert_selection(),
        Op::Feather { radius } => doc.feather_selection(*radius),
        Op::Blur { layer, radius } => {
            let li = layer_idx(doc, layer)?;
            doc.blur(li, *radius, wrap);
        }
        Op::Sharpen { layer } => {
            let li = layer_idx(doc, layer)?;
            doc.sharpen(li, wrap);
        }
        Op::Noise { layer, amount } => {
            let li = layer_idx(doc, layer)?;
            doc.noise_filter(li, *amount, rng.next_u64());
        }
        Op::Levels {
            layer,
            black,
            white,
            gamma,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.levels(li, *black, *white, *gamma);
        }
        Op::Curves { layer, amount } => {
            let li = layer_idx(doc, layer)?;
            doc.curves(li, *amount);
        }
        Op::HueSat {
            layer,
            hue,
            sat,
            lightness,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.hue_sat(li, *hue, *sat, *lightness);
        }
        Op::Desaturate { layer } => {
            let li = layer_idx(doc, layer)?;
            doc.desaturate(li);
        }
        Op::LayerEffect {
            layer,
            effect,
            size,
            color,
            angle,
            distance,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.layer_effect(
                li,
                *effect,
                EffectParams {
                    size: *size,
                    color: *color,
                    angle: *angle,
                    distance: *distance,
                },
            );
        }
        Op::TransformLayer {
            layer,
            translate,
            scale,
            rotate,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.transform_layer(li, *translate, *scale, *rotate, wrap);
        }
        Op::Flip { layer, horizontal } => {
            let li = layer_idx(doc, layer)?;
            doc.flip(li, *horizontal);
        }
        Op::Mirror { layer, axis_x } => {
            let li = layer_idx(doc, layer)?;
            doc.mirror(li, *axis_x);
        }
        Op::Rect {
            layer,
            x,
            y,
            width,
            height,
            fill,
            stroke,
            stroke_width,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.shape_rect(
                li,
                *x,
                *y,
                *width,
                *height,
                style(*fill, *stroke, *stroke_width),
                wrap,
            );
        }
        Op::RoundedRect {
            layer,
            x,
            y,
            width,
            height,
            corner_radius,
            fill,
            stroke,
            stroke_width,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.shape_rounded_rect(
                li,
                *x,
                *y,
                *width,
                *height,
                *corner_radius,
                style(*fill, *stroke, *stroke_width),
                wrap,
            );
        }
        Op::Ellipse {
            layer,
            cx,
            cy,
            rx,
            ry,
            fill,
            stroke,
            stroke_width,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.shape_ellipse(
                li,
                *cx,
                *cy,
                *rx,
                *ry,
                style(*fill, *stroke, *stroke_width),
                wrap,
            );
        }
        Op::Line {
            layer,
            x0,
            y0,
            x1,
            y1,
            stroke,
            stroke_width,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.shape_line(li, *x0, *y0, *x1, *y1, *stroke, *stroke_width, wrap);
        }
        Op::Polygon {
            layer,
            points,
            fill,
            stroke,
            stroke_width,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.shape_polygon(li, points, style(*fill, *stroke, *stroke_width), wrap);
        }
        Op::Text {
            layer,
            content,
            font,
            size,
            color,
            align,
            bold,
            letter_spacing,
            wrap: wrap_w,
            x,
            y,
        } => {
            let li = layer_idx(doc, layer)?;
            let mut face = font_by_name(font);
            if *bold {
                face.bold = true;
            }
            doc.draw_text(
                li,
                content,
                face,
                *size,
                *color,
                *align,
                *letter_spacing,
                *wrap_w,
                *x,
                *y,
            );
        }
        Op::SetNineSlice {
            left,
            right,
            top,
            bottom,
        } => {
            doc.nine_slice = Some(crate::nine_slice::NineSlice {
                left: *left,
                right: *right,
                top: *top,
                bottom: *bottom,
            });
        }
        Op::GenNoise {
            layer,
            kind,
            scale,
            octaves,
        } => {
            let li = layer_idx(doc, layer)?;
            doc.gen_noise(li, *kind, *scale, *octaves, rng.next_u64());
        }
        Op::Pattern { layer, kind, scale } => {
            let li = layer_idx(doc, layer)?;
            doc.gen_pattern(li, *kind, *scale);
        }
        Op::GradientMap { layer, stops } => {
            let li = layer_idx(doc, layer)?;
            doc.gradient_map(li, stops);
        }
        Op::SetUniform { value } => {
            doc.set_uniform(*value);
        }
    }
    Ok(())
}

/// A shape style from optional fill/stroke.
fn style(fill: Option<Color>, stroke: Option<Color>, stroke_width: f32) -> ShapeStyle {
    ShapeStyle {
        fill,
        stroke,
        stroke_width,
    }
}

/// Read a height source map's composited luma as a `(w, h, field)` triple.
fn source_height(ws: &mut Workspace, from: &str) -> Result<(u32, u32, Vec<f32>), String> {
    let doc = ws
        .documents
        .get(from)
        .ok_or_else(|| format!("no height map `{from}`"))?;
    Ok((doc.width, doc.height, bake::height_field(&doc.composite())))
}

/// Merge `layers` into one flattened layer at the lowest of their positions.
fn group_layers(doc: &mut Document, layers: &[String], name: Option<String>) -> Result<(), String> {
    let mut indices: Vec<usize> = layers
        .iter()
        .map(|n| doc.layer_index(n))
        .collect::<Result<_, _>>()?;
    if indices.is_empty() {
        return Ok(());
    }
    indices.sort_unstable();
    let insert_at = indices[0];
    // Composite the selected layers, in stack order, into one raster.
    let mut merged = crate::raster::Raster::filled(doc.width, doc.height, Color::TRANSPARENT);
    for &i in &indices {
        let layer = &doc.layers[i];
        if !layer.visible {
            continue;
        }
        for p in 0..merged.pixels.len() {
            let cov = layer.opacity * layer.mask.as_ref().map(|m| m[p]).unwrap_or(1.0);
            merged.pixels[p] = crate::blend::composite_over(
                merged.pixels[p],
                layer.raster.pixels[p],
                layer.blend,
                cov,
            );
        }
    }
    // Remove originals (high to low) then insert the merged layer.
    for &i in indices.iter().rev() {
        doc.layers.remove(i);
    }
    let mut layer = Layer::new(
        name.unwrap_or_else(|| "group".to_string()),
        doc.width,
        doc.height,
    );
    layer.raster = merged;
    doc.layers.insert(insert_at.min(doc.layers.len()), layer);
    Ok(())
}

impl Document {
    /// Replace the document with a single opaque base layer holding `raster` — used
    /// by the bake operations and `set-uniform`.
    fn replace_with(&mut self, raster: crate::raster::Raster) {
        let mut base = Layer::new("base", self.width, self.height);
        base.raster = raster;
        self.layers = vec![base];
        self.selection = None;
    }

    /// Fill the map with a constant grayscale value.
    fn set_uniform(&mut self, value: f32) {
        let v = value.clamp(0.0, 1.0);
        let raster =
            crate::raster::Raster::filled(self.width, self.height, Color::new(v, v, v, 1.0));
        self.replace_with(raster);
    }
}

fn one() -> f32 {
    1.0
}
fn quarter() -> f32 {
    0.25
}
fn tenth() -> f32 {
    0.1
}
fn four() -> f32 {
    4.0
}
fn four_u() -> u32 {
    4
}
fn one_thirty_five() -> f32 {
    135.0
}
fn black() -> Color {
    Color::new(0.0, 0.0, 0.0, 1.0)
}
fn unit_scale() -> Point {
    (1.0, 1.0)
}
fn default_font() -> String {
    "sans".to_string()
}
fn align_left() -> Align {
    Align::Left
}
fn height_src() -> String {
    "height".to_string()
}

#[cfg(test)]
#[path = "op.test.rs"]
mod tests;
