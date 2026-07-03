//! Voxel colors and the preview background.
//!
//! A voxel color is an **opaque** RGB triple that (de)serializes as a `#rrggbb`
//! hex string, so the operations the model writes into `actions.json` read the
//! same way the manifest's `[voxel] background` does — a single, model-friendly
//! color spelling everywhere. Unlike the 2D drawing tool's RGBA color, voxels
//! carry no alpha: a cell is either empty (unset) or a solid, opaque color, so a
//! `#rrggbbaa` form is rejected rather than silently truncated.

use serde::de::{self, Deserialize, Deserializer};
use serde::{Serialize, Serializer};

/// An error parsing a hex color or a preview-background specification.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ColorError {
    /// The string was not a recognized color form.
    #[error("invalid color `{0}` (expected `#rrggbb` or `transparent`)")]
    Invalid(String),
}

/// An opaque 8-bit RGB voxel color.
///
/// Voxels are solid: a cell is either empty or filled with one of these. There is
/// no alpha to composite, so setting a voxel simply replaces whatever occupied the
/// cell, keeping regeneration a pure, order-only function of the operation log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub [u8; 3]);

impl Rgb {
    /// The color as a `#rrggbb` hex string (lowercase).
    pub fn to_hex(self) -> String {
        let [r, g, b] = self.0;
        format!("#{r:02x}{g:02x}{b:02x}")
    }

    /// Parse a `#rrggbb` hex string. A leading `#` is required; casing is ignored.
    /// An alpha component (`#rrggbbaa`) is **rejected** — voxels are opaque.
    pub fn parse_hex(value: &str) -> Result<Rgb, ColorError> {
        let invalid = || ColorError::Invalid(value.to_string());
        let hex = value.strip_prefix('#').ok_or_else(invalid)?;
        if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(invalid());
        }
        let component = |i: usize| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16);
        let r = component(0).map_err(|_| invalid())?;
        let g = component(1).map_err(|_| invalid())?;
        let b = component(2).map_err(|_| invalid())?;
        Ok(Rgb([r, g, b]))
    }
}

impl Serialize for Rgb {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for Rgb {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Rgb, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Rgb::parse_hex(&raw).map_err(de::Error::custom)
    }
}

/// The clear color behind the rendered preview PNG.
///
/// This is **only** the background of the rendered image — the voxel volume itself
/// always starts empty (there is no such thing as a "background voxel"). It is
/// either fully transparent or a single opaque color.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewBackground {
    /// The preview PNG's empty area is fully transparent.
    Transparent,
    /// The preview PNG's empty area is this opaque color.
    Color(Rgb),
}

impl PreviewBackground {
    /// Parse the manifest's `[voxel] background` value: the literal `transparent`
    /// or a hex color.
    pub fn parse(value: &str) -> Result<PreviewBackground, ColorError> {
        if value.eq_ignore_ascii_case("transparent") {
            Ok(PreviewBackground::Transparent)
        } else {
            Ok(PreviewBackground::Color(Rgb::parse_hex(value)?))
        }
    }

    /// The RGBA bytes every empty pixel of the preview PNG is cleared to. A
    /// transparent background is fully transparent black; a color background is
    /// that color at full opacity.
    pub fn fill(self) -> [u8; 4] {
        match self {
            PreviewBackground::Transparent => [0, 0, 0, 0],
            PreviewBackground::Color(Rgb([r, g, b])) => [r, g, b, 0xff],
        }
    }
}
