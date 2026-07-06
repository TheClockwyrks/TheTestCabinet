//! The engine's color type and the canvas/preview background.
//!
//! Every raster in the engine stores **straight (non-premultiplied) RGBA** as
//! `f32` channels in `0..=1`, so blend-mode math and alpha compositing run at full
//! precision and only quantize to 8-bit when a preview or the flattened asset is
//! encoded. Colors on the command line are `#rrggbb` or `#rrggbbaa`, exactly as the
//! [`draw`](test_cabinet_draw) tool and the binary docs specify.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// A straight-RGBA color, each channel a linear `f32` in `0..=1` for compositing.
///
/// "Linear" here means "not premultiplied", not a color space: the 8-bit values a
/// `#rrggbb` string carries are stored as-is divided by 255, and encoded back the
/// same way. Color-space tagging (sRGB vs. linear) is a **material** concern
/// recorded per map in `material.json`, not a property of this type.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Color {
    /// Red, `0..=1`.
    pub r: f32,
    /// Green, `0..=1`.
    pub g: f32,
    /// Blue, `0..=1`.
    pub b: f32,
    /// Alpha (coverage), `0..=1`.
    pub a: f32,
}

impl Color {
    /// Fully-transparent black — the cleared state of a new layer.
    pub const TRANSPARENT: Color = Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 0.0,
    };

    /// A color from four `0..=1` channels.
    pub fn new(r: f32, g: f32, b: f32, a: f32) -> Color {
        Color { r, g, b, a }
    }

    /// A color from four 8-bit channels.
    pub fn from_rgba8(rgba: [u8; 4]) -> Color {
        Color {
            r: rgba[0] as f32 / 255.0,
            g: rgba[1] as f32 / 255.0,
            b: rgba[2] as f32 / 255.0,
            a: rgba[3] as f32 / 255.0,
        }
    }

    /// Quantize to four 8-bit channels (rounded, clamped).
    pub fn to_rgba8(self) -> [u8; 4] {
        [to_u8(self.r), to_u8(self.g), to_u8(self.b), to_u8(self.a)]
    }

    /// The `#rrggbbaa` hex form, used as the wire form in the operation log.
    pub fn to_hex(self) -> String {
        let [r, g, b, a] = self.to_rgba8();
        format!("#{r:02x}{g:02x}{b:02x}{a:02x}")
    }

    /// Parse a `#rrggbb` or `#rrggbbaa` hex string.
    pub fn parse_hex(value: &str) -> Result<Color, ColorError> {
        let hex = value.strip_prefix('#').unwrap_or(value);
        let bytes = match hex.len() {
            6 | 8 => hex,
            _ => return Err(ColorError::BadLength(value.to_string())),
        };
        let mut channels = [0u8; 4];
        channels[3] = 255;
        for (i, chunk) in bytes.as_bytes().chunks_exact(2).enumerate() {
            let pair =
                std::str::from_utf8(chunk).map_err(|_| ColorError::BadDigit(value.to_string()))?;
            channels[i] = u8::from_str_radix(pair, 16)
                .map_err(|_| ColorError::BadDigit(value.to_string()))?;
        }
        Ok(Color::from_rgba8(channels))
    }

    /// The luminance (Rec. 601 weights) of the color's RGB, ignoring alpha — used by
    /// grayscale conversions, height/curvature reads, and mask painting.
    pub fn luma(self) -> f32 {
        0.299 * self.r + 0.587 * self.g + 0.114 * self.b
    }
}

fn to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

impl Serialize for Color {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for Color {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Color, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Color::parse_hex(&raw).map_err(serde::de::Error::custom)
    }
}

/// The initial state every pixel of a fresh document starts in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Background {
    /// Fully transparent (the default for a UI element or a normal map's clear).
    Transparent,
    /// A solid opaque color.
    Solid(Color),
}

impl Background {
    /// Parse `transparent` or a hex color.
    pub fn parse(value: &str) -> Result<Background, ColorError> {
        if value.eq_ignore_ascii_case("transparent") {
            Ok(Background::Transparent)
        } else {
            Ok(Background::Solid(Color::parse_hex(value)?))
        }
    }

    /// The color a pixel starts as.
    pub fn fill(self) -> Color {
        match self {
            Background::Transparent => Color::TRANSPARENT,
            Background::Solid(color) => color,
        }
    }
}

/// A color parse failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ColorError {
    /// The hex body was not 6 or 8 digits.
    BadLength(String),
    /// A hex digit was not valid.
    BadDigit(String),
}

impl fmt::Display for ColorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ColorError::BadLength(v) => write!(f, "`{v}` is not #rrggbb or #rrggbbaa"),
            ColorError::BadDigit(v) => write!(f, "`{v}` has an invalid hex digit"),
        }
    }
}

impl std::error::Error for ColorError {}

#[cfg(test)]
#[path = "color.test.rs"]
mod tests;
