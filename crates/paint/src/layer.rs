//! Layers, documents, and the workspace they live in.
//!
//! A **document** (a UI element or a material map) is a stack of [`Layer`]s plus a
//! current [`Selection`]. [`Document::composite`] flattens the visible layers
//! bottom-to-top with per-layer opacity, blend mode, and mask into one preview /
//! emitted image. A [`Workspace`] is the whole set of documents a run edits — the
//! elements of a UI kit, or the maps of a material — sharing one operation log; its
//! `wrap` mode (clamp for UI, toroidal for a seamless material) rides along on every
//! paint operation.

use std::collections::BTreeMap;

use crate::blend::{BlendMode, composite_over};
use crate::color::{Background, Color};
use crate::raster::{Raster, WrapMode};

/// One layer: a straight-RGBA raster with a name, opacity, blend mode, visibility,
/// and an optional grayscale coverage mask.
#[derive(Debug, Clone)]
pub struct Layer {
    /// The layer's unique (within its document) name, addressed by `--layer`.
    pub name: String,
    /// The layer's pixels.
    pub raster: Raster,
    /// Layer opacity, `0..=1`, applied to every pixel during compositing.
    pub opacity: f32,
    /// The blend mode this layer composites with.
    pub blend: BlendMode,
    /// Whether the layer contributes to the composite.
    pub visible: bool,
    /// An optional grayscale mask (`0` hides, `1` reveals) multiplied into the
    /// layer's coverage — the non-destructive way to carve a layer's extent.
    pub mask: Option<Vec<f32>>,
}

impl Layer {
    /// A new, fully-transparent, fully-opaque `normal` layer.
    pub fn new(name: impl Into<String>, width: u32, height: u32) -> Layer {
        Layer {
            name: name.into(),
            raster: Raster::filled(width, height, Color::TRANSPARENT),
            opacity: 1.0,
            blend: BlendMode::Normal,
            visible: true,
            mask: None,
        }
    }

    /// The mask coverage at pixel index `i` (`1` when there is no mask).
    fn mask_at(&self, i: usize) -> f32 {
        self.mask.as_ref().map(|m| m[i]).unwrap_or(1.0)
    }
}

/// The active selection: a per-pixel coverage mask that clips every subsequent
/// paint operation. `None` means "no selection" — operations affect the whole
/// document.
#[derive(Debug, Clone)]
pub struct Selection {
    /// Per-pixel coverage, `0..=1`, row-major over the document.
    pub coverage: Vec<f32>,
}

/// One editable document: a stack of layers, the current selection, and the size
/// every layer shares.
#[derive(Debug, Clone)]
pub struct Document {
    /// Document width in pixels.
    pub width: u32,
    /// Document height in pixels.
    pub height: u32,
    /// The initial background every fresh layer/composite starts from.
    pub background: Background,
    /// The layer stack, index `0` at the bottom.
    pub layers: Vec<Layer>,
    /// The active selection, if any.
    pub selection: Option<Selection>,
    /// The element's nine-slice stretchable insets, if authored (UI elements only).
    pub nine_slice: Option<crate::nine_slice::NineSlice>,
}

impl Document {
    /// A new document with a single, full-coverage base layer named `base`.
    pub fn new(width: u32, height: u32, background: Background) -> Document {
        let mut base = Layer::new("base", width, height);
        if let Background::Solid(color) = background {
            base.raster.pixels.fill(color);
        }
        Document {
            width,
            height,
            background,
            layers: vec![base],
            selection: None,
            nine_slice: None,
        }
    }

    /// The number of pixels in the document.
    pub fn pixel_count(&self) -> usize {
        self.width as usize * self.height as usize
    }

    /// The index of the layer named `name`, or an error naming the missing layer.
    pub fn layer_index(&self, name: &str) -> Result<usize, String> {
        self.layers
            .iter()
            .position(|l| l.name == name)
            .ok_or_else(|| format!("no layer named `{name}`"))
    }

    /// The layer named `name`, mutably; the active layer (topmost) when `name` is
    /// `None`, creating a base layer if the stack is somehow empty.
    pub fn resolve_layer_mut(&mut self, name: Option<&str>) -> Result<&mut Layer, String> {
        let idx = match name {
            Some(name) => self.layer_index(name)?,
            None => {
                if self.layers.is_empty() {
                    self.layers
                        .push(Layer::new("base", self.width, self.height));
                }
                self.layers.len() - 1
            }
        };
        Ok(&mut self.layers[idx])
    }

    /// The selection coverage at pixel `i` (`1` when nothing is selected).
    pub fn selection_at(&self, i: usize) -> f32 {
        self.selection
            .as_ref()
            .map(|s| s.coverage[i])
            .unwrap_or(1.0)
    }

    /// Flatten the visible layers into one straight-RGBA image, compositing
    /// bottom-to-top with each layer's opacity, blend mode, and mask.
    pub fn composite(&self) -> Raster {
        let base = match self.background {
            Background::Transparent => Color::TRANSPARENT,
            Background::Solid(color) => color,
        };
        let mut out = Raster::filled(self.width, self.height, base);
        for layer in &self.layers {
            if !layer.visible || layer.opacity <= 0.0 {
                continue;
            }
            for i in 0..out.pixels.len() {
                let coverage = layer.opacity * layer.mask_at(i);
                out.pixels[i] =
                    composite_over(out.pixels[i], layer.raster.pixels[i], layer.blend, coverage);
            }
        }
        out
    }
}

/// The whole set of documents a run edits, keyed by name (element name or map
/// channel), sharing one operation log and one wrap mode.
#[derive(Debug, Clone)]
pub struct Workspace {
    /// The documents, keyed by target name.
    pub documents: BTreeMap<String, Document>,
    /// Whether painting wraps toroidally (seamless material) or clips (UI).
    pub wrap: WrapMode,
    /// The order documents were declared, so a bare `--element`/`--map` (a
    /// single-target case) resolves to the sole document deterministically.
    pub order: Vec<String>,
    /// When set, an operation may target a not-yet-declared document (a scratch
    /// `height`/`curvature` map, or a bake output) and it is created at this size
    /// and background. UI workspaces leave this `None` so an unknown `--element`
    /// is an error; material workspaces set it so scratch maps materialize on use.
    pub auto: Option<(u32, u32, Background)>,
}

impl Workspace {
    /// A new workspace with `wrap` addressing and no documents yet.
    pub fn new(wrap: WrapMode) -> Workspace {
        Workspace {
            documents: BTreeMap::new(),
            wrap,
            order: Vec::new(),
            auto: None,
        }
    }

    /// Declare a document of the given size and background under `name`.
    pub fn insert(&mut self, name: impl Into<String>, width: u32, height: u32, bg: Background) {
        let name = name.into();
        self.documents
            .insert(name.clone(), Document::new(width, height, bg));
        self.order.push(name);
    }

    /// The zero-based index of `name` in declaration order (for the live-preview
    /// `frame` field), or `0` if unknown.
    pub fn target_index(&self, name: &str) -> u32 {
        self.order.iter().position(|n| n == name).unwrap_or(0) as u32
    }

    /// Resolve `target` (an explicit `--element`/`--map`, or `None` for a
    /// single-document case) to the document name and a mutable handle,
    /// materializing a scratch document when `auto` is set.
    pub fn resolve(&mut self, target: Option<&str>) -> Result<(String, &mut Document), String> {
        let name = match target {
            Some(name) => name.to_string(),
            None => match self.order.as_slice() {
                [only] => only.clone(),
                [] => return Err("workspace declares no documents".to_string()),
                _ => {
                    return Err(
                        "this case declares multiple targets; pass --element/--map".to_string()
                    );
                }
            },
        };
        if !self.documents.contains_key(&name) {
            match self.auto {
                Some((w, h, bg)) => self.insert(name.clone(), w, h, bg),
                None => return Err(format!("no document named `{name}`")),
            }
        }
        let doc = self
            .documents
            .get_mut(&name)
            .ok_or_else(|| format!("no document named `{name}`"))?;
        Ok((name, doc))
    }

    /// Resolve `target` to a document name without borrowing the document.
    pub fn resolve_name(&self, target: Option<&str>) -> Result<String, String> {
        match target {
            Some(name) => {
                if self.documents.contains_key(name) {
                    Ok(name.to_string())
                } else {
                    Err(format!("no document named `{name}`"))
                }
            }
            None => match self.order.as_slice() {
                [only] => Ok(only.clone()),
                [] => Err("workspace declares no documents".to_string()),
                _ => Err("this case declares multiple targets; pass --element/--map".to_string()),
            },
        }
    }
}

#[cfg(test)]
#[path = "layer.test.rs"]
mod tests;
