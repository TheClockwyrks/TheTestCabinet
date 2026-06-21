//! Colors and the canvas background.
//!
//! A color is an RGBA quadruple that (de)serializes as a `#rrggbb` or
//! `#rrggbbaa` hex string, so the operations the model writes into `actions.json`
//! read the same way the manifest's `[canvas] background` does — a single, model-
//! friendly color spelling everywhere.

use serde::de::{self, Deserialize, Deserializer};
use serde::{Serialize, Serializer};

/// An error parsing a hex color or a background specification.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ColorError {
    /// The string was not a recognized color form.
    #[error("invalid color `{0}` (expected `#rrggbb`, `#rrggbbaa`, or `transparent`)")]
    Invalid(String),
}

/// A straight (non-premultiplied) 8-bit RGBA color.
///
/// Drawing operations replace pixels rather than alpha-compositing them, so a
/// color's alpha is written verbatim. This keeps regeneration a pure, order-only
/// function of the operation log with no blend-rounding to reproduce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgba(pub [u8; 4]);

impl Rgba {
    /// Fully transparent black — the value a transparent background fills with.
    pub const TRANSPARENT: Rgba = Rgba([0, 0, 0, 0]);

    /// The color as a `#rrggbbaa` hex string (alpha always emitted, lowercase).
    pub fn to_hex(self) -> String {
        let [r, g, b, a] = self.0;
        format!("#{r:02x}{g:02x}{b:02x}{a:02x}")
    }

    /// Parse a `#rrggbb` (alpha defaults to `0xff`) or `#rrggbbaa` hex string. A
    /// leading `#` is required; casing is ignored.
    pub fn parse_hex(value: &str) -> Result<Rgba, ColorError> {
        let invalid = || ColorError::Invalid(value.to_string());
        let hex = value.strip_prefix('#').ok_or_else(invalid)?;
        if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(invalid());
        }
        let component = |i: usize| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16);
        match hex.len() {
            6 => {
                let r = component(0).map_err(|_| invalid())?;
                let g = component(1).map_err(|_| invalid())?;
                let b = component(2).map_err(|_| invalid())?;
                Ok(Rgba([r, g, b, 0xff]))
            }
            8 => {
                let r = component(0).map_err(|_| invalid())?;
                let g = component(1).map_err(|_| invalid())?;
                let b = component(2).map_err(|_| invalid())?;
                let a = component(3).map_err(|_| invalid())?;
                Ok(Rgba([r, g, b, a]))
            }
            _ => Err(invalid()),
        }
    }
}

impl Serialize for Rgba {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for Rgba {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Rgba, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Rgba::parse_hex(&raw).map_err(de::Error::custom)
    }
}

/// The initial state of the canvas before any operation runs: either fully
/// transparent or flooded with a single color.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Background {
    /// Every pixel starts fully transparent.
    Transparent,
    /// Every pixel starts as this color.
    Color(Rgba),
}

impl Background {
    /// Parse the manifest's `[canvas] background` value: the literal
    /// `transparent` or a hex color.
    pub fn parse(value: &str) -> Result<Background, ColorError> {
        if value.eq_ignore_ascii_case("transparent") {
            Ok(Background::Transparent)
        } else {
            Ok(Background::Color(Rgba::parse_hex(value)?))
        }
    }

    /// The color every pixel is initialized to.
    pub fn fill(self) -> Rgba {
        match self {
            Background::Transparent => Rgba::TRANSPARENT,
            Background::Color(color) => color,
        }
    }
}
