//! Text rendering with a small set of baked, pure-Rust fonts.
//!
//! Rather than depend on a TTF crate and bundle binary font files, the `ui` tool
//! ships one compact 5×7 vector-grid glyph set and exposes it under several named
//! fonts (`ui fonts`) that differ in weight, tracking, and advance (proportional vs.
//! monospaced). A glyph's 5×7 coverage grid is bilinearly upscaled to the requested
//! pixel size, so text stays smooth (anti-aliased) at any size, and an optional
//! bold weight thickens strokes by a dilation pass. Lowercase maps to uppercase —
//! the baked set is a caps display face, which is what HUD labels, titles, and
//! insignia want.

use crate::color::Color;
use crate::layer::{Document, Selection};

/// Horizontal alignment of each wrapped line within the text block.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Align {
    /// Left-align (the default).
    Left,
    /// Center each line.
    Center,
    /// Right-align each line.
    Right,
}

/// A baked font: a display name plus how it renders the shared glyph grid.
#[derive(Debug, Clone, Copy)]
pub struct Font {
    /// The name a model passes to `--font` and `ui fonts` lists.
    pub name: &'static str,
    /// Whether the face renders bold (a stroke-thickening pass).
    pub bold: bool,
    /// Extra tracking between glyphs, as a fraction of the glyph cell.
    pub tracking: f32,
}

/// The baked fonts the `ui` image ships. All share the 5×7 glyph grid; they differ
/// in weight and tracking so a model can pick a body face, a bold face, or a wide
/// display face.
pub const FONTS: &[Font] = &[
    Font {
        name: "sans",
        bold: false,
        tracking: 0.0,
    },
    Font {
        name: "sans-bold",
        bold: true,
        tracking: 0.0,
    },
    Font {
        name: "inter",
        bold: false,
        tracking: 0.0,
    },
    Font {
        name: "inter-bold",
        bold: true,
        tracking: 0.0,
    },
    Font {
        name: "display",
        bold: false,
        tracking: 0.25,
    },
    Font {
        name: "display-bold",
        bold: true,
        tracking: 0.25,
    },
    Font {
        name: "mono",
        bold: false,
        tracking: 0.15,
    },
];

/// Look up a baked font by name (case-insensitive), falling back to the first face.
pub fn font_by_name(name: &str) -> Font {
    FONTS
        .iter()
        .copied()
        .find(|f| f.name.eq_ignore_ascii_case(name))
        .unwrap_or(FONTS[0])
}

/// The glyph cell is 5 columns by 7 rows, advanced by one column of spacing.
const GLYPH_W: usize = 5;
const GLYPH_H: usize = 7;

impl Document {
    /// Draw `content` on `layer` starting at the top-left `(x, y)`, wrapped to
    /// `wrap` pixels (when `Some`), at `size` px cap height, in `font`, aligned per
    /// `align`, with `letter_spacing` extra pixels between glyphs. Clipped by the
    /// active selection.
    #[allow(clippy::too_many_arguments)]
    pub fn draw_text(
        &mut self,
        layer: usize,
        content: &str,
        font: Font,
        size: f32,
        color: Color,
        align: Align,
        letter_spacing: f32,
        wrap: Option<f32>,
        x: f32,
        y: f32,
    ) {
        let scale = (size / GLYPH_H as f32).max(0.5);
        let glyph_w = GLYPH_W as f32 * scale;
        let glyph_h = GLYPH_H as f32 * scale;
        let advance = glyph_w + (font.tracking * glyph_w) + scale + letter_spacing;
        let line_h = glyph_h + scale * 2.0;

        let lines = wrap_lines(content, advance, wrap);
        let block_w = lines
            .iter()
            .map(|l| line_width(l, advance))
            .fold(0.0f32, f32::max);

        for (row, line) in lines.iter().enumerate() {
            let line_w = line_width(line, advance);
            let start_x = match align {
                Align::Left => x,
                Align::Center => x + (block_w - line_w) * 0.5,
                Align::Right => x + (block_w - line_w),
            };
            let line_y = y + row as f32 * line_h;
            let mut pen = start_x;
            for ch in line.chars() {
                self.blit_glyph(layer, ch, font.bold, pen, line_y, scale, color);
                pen += advance;
            }
        }
    }

    /// Rasterize one glyph at the pen position, depositing `color` by coverage.
    #[allow(clippy::too_many_arguments)]
    fn blit_glyph(
        &mut self,
        layer: usize,
        ch: char,
        bold: bool,
        px: f32,
        py: f32,
        scale: f32,
        color: Color,
    ) {
        let grid = glyph_grid(ch);
        let w = self.width;
        let h = self.height;
        let sel: Option<&Selection> = self.selection.as_ref();
        let raster = &mut self.layers[layer].raster;
        let cell_w = GLYPH_W as f32 * scale;
        let cell_h = GLYPH_H as f32 * scale;
        let x0 = px.floor() as i64;
        let y0 = py.floor() as i64;
        let x1 = (px + cell_w).ceil() as i64;
        let y1 = (py + cell_h).ceil() as i64;
        for oy in y0..y1 {
            for ox in x0..x1 {
                if ox < 0 || oy < 0 || ox >= w as i64 || oy >= h as i64 {
                    continue;
                }
                // Map back into the 5×7 grid and sample coverage bilinearly.
                let gx = (ox as f32 + 0.5 - px) / scale - 0.5;
                let gy = (oy as f32 + 0.5 - py) / scale - 0.5;
                let mut cov = sample_grid(&grid, gx, gy);
                if bold {
                    cov = cov.max(sample_grid(&grid, gx - 0.5, gy)).max(sample_grid(
                        &grid,
                        gx + 0.5,
                        gy,
                    ));
                }
                if cov <= 0.0 {
                    continue;
                }
                let i = (oy as u32 * w + ox as u32) as usize;
                let s = sel.map(|s| s.coverage[i]).unwrap_or(1.0);
                let alpha = cov * color.a * s;
                if alpha > 0.0 {
                    raster.pixels[i] = crate::blend::composite_over(
                        raster.pixels[i],
                        color,
                        crate::blend::BlendMode::Normal,
                        alpha,
                    );
                }
            }
        }
    }
}

/// Bilinearly sample a 5×7 `0/1` coverage grid at continuous cell coordinates.
fn sample_grid(grid: &[[u8; GLYPH_W]; GLYPH_H], x: f32, y: f32) -> f32 {
    let at = |cx: i64, cy: i64| -> f32 {
        if cx < 0 || cy < 0 || cx >= GLYPH_W as i64 || cy >= GLYPH_H as i64 {
            0.0
        } else {
            grid[cy as usize][cx as usize] as f32
        }
    };
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    let top = at(x0, y0) * (1.0 - fx) + at(x0 + 1, y0) * fx;
    let bot = at(x0, y0 + 1) * (1.0 - fx) + at(x0 + 1, y0 + 1) * fx;
    top * (1.0 - fy) + bot * fy
}

/// The pixel width of a rendered line.
fn line_width(line: &str, advance: f32) -> f32 {
    let n = line.chars().count();
    if n == 0 { 0.0 } else { n as f32 * advance }
}

/// Break `content` into lines: honor explicit newlines, and word-wrap to `wrap`
/// pixels when given.
fn wrap_lines(content: &str, advance: f32, wrap: Option<f32>) -> Vec<String> {
    let mut out = Vec::new();
    for raw in content.split('\n') {
        match wrap {
            None => out.push(raw.to_string()),
            Some(limit) => {
                let max_chars = ((limit / advance).floor() as usize).max(1);
                let mut line = String::new();
                for word in raw.split_whitespace() {
                    let candidate = if line.is_empty() {
                        word.len()
                    } else {
                        line.chars().count() + 1 + word.len()
                    };
                    if candidate > max_chars && !line.is_empty() {
                        out.push(std::mem::take(&mut line));
                    }
                    if !line.is_empty() {
                        line.push(' ');
                    }
                    line.push_str(word);
                }
                out.push(line);
            }
        }
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

/// The 5×7 coverage grid for a character (uppercased; unknown printable → a block,
/// space → empty).
fn glyph_grid(ch: char) -> [[u8; GLYPH_W]; GLYPH_H] {
    let upper = ch.to_ascii_uppercase();
    let rows = glyph_rows(upper);
    let mut grid = [[0u8; GLYPH_W]; GLYPH_H];
    for (r, row) in rows.iter().enumerate() {
        for (c, byte) in row.bytes().take(GLYPH_W).enumerate() {
            grid[r][c] = u8::from(byte == b'#');
        }
    }
    grid
}

/// The string-art rows for a glyph. Kept as readable `#`/`.` art so the baked font
/// is auditable.
fn glyph_rows(ch: char) -> [&'static str; GLYPH_H] {
    match ch {
        ' ' => [
            ".....", ".....", ".....", ".....", ".....", ".....", ".....",
        ],
        '0' => [
            ".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###.",
        ],
        '1' => [
            "..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###.",
        ],
        '2' => [
            ".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####",
        ],
        '3' => [
            "#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###.",
        ],
        '4' => [
            "...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#.",
        ],
        '5' => [
            "#####", "#....", "####.", "....#", "....#", "#...#", ".###.",
        ],
        '6' => [
            "..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###.",
        ],
        '7' => [
            "#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#...",
        ],
        '8' => [
            ".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###.",
        ],
        '9' => [
            ".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##..",
        ],
        'A' => [
            ".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#",
        ],
        'B' => [
            "####.", "#...#", "#...#", "####.", "#...#", "#...#", "####.",
        ],
        'C' => [
            ".###.", "#...#", "#....", "#....", "#....", "#...#", ".###.",
        ],
        'D' => [
            "###..", "#..#.", "#...#", "#...#", "#...#", "#..#.", "###..",
        ],
        'E' => [
            "#####", "#....", "#....", "####.", "#....", "#....", "#####",
        ],
        'F' => [
            "#####", "#....", "#....", "####.", "#....", "#....", "#....",
        ],
        'G' => [
            ".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###.",
        ],
        'H' => [
            "#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#",
        ],
        'I' => [
            ".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###.",
        ],
        'J' => [
            "..###", "...#.", "...#.", "...#.", "#..#.", "#..#.", ".##..",
        ],
        'K' => [
            "#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#",
        ],
        'L' => [
            "#....", "#....", "#....", "#....", "#....", "#....", "#####",
        ],
        'M' => [
            "#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#",
        ],
        'N' => [
            "#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#",
        ],
        'O' => [
            ".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###.",
        ],
        'P' => [
            "####.", "#...#", "#...#", "####.", "#....", "#....", "#....",
        ],
        'Q' => [
            ".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#",
        ],
        'R' => [
            "####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#",
        ],
        'S' => [
            ".####", "#....", "#....", ".###.", "....#", "....#", "####.",
        ],
        'T' => [
            "#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#..",
        ],
        'U' => [
            "#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###.",
        ],
        'V' => [
            "#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#..",
        ],
        'W' => [
            "#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#",
        ],
        'X' => [
            "#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#",
        ],
        'Y' => [
            "#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..",
        ],
        'Z' => [
            "#####", "....#", "...#.", "..#..", ".#...", "#....", "#####",
        ],
        '.' => [
            ".....", ".....", ".....", ".....", ".....", ".##..", ".##..",
        ],
        ',' => [
            ".....", ".....", ".....", ".....", ".##..", ".##..", ".#...",
        ],
        ':' => [
            ".....", ".##..", ".##..", ".....", ".##..", ".##..", ".....",
        ],
        '-' => [
            ".....", ".....", ".....", "#####", ".....", ".....", ".....",
        ],
        '_' => [
            ".....", ".....", ".....", ".....", ".....", ".....", "#####",
        ],
        '!' => [
            "..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#..",
        ],
        '?' => [
            ".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#..",
        ],
        '/' => [
            "....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#....",
        ],
        '(' => [
            "..##.", ".#...", ".#...", ".#...", ".#...", ".#...", "..##.",
        ],
        ')' => [
            ".##..", "...#.", "...#.", "...#.", "...#.", "...#.", ".##..",
        ],
        '+' => [
            ".....", "..#..", "..#..", "#####", "..#..", "..#..", ".....",
        ],
        '#' => [
            ".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#.",
        ],
        '%' => [
            "##..#", "##.#.", "..#..", ".#...", "#..##", "...##", ".....",
        ],
        '&' => [
            ".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#",
        ],
        '*' => [
            ".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", ".....",
        ],
        '\'' => [
            "..#..", "..#..", "..#..", ".....", ".....", ".....", ".....",
        ],
        _ => [
            "#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####",
        ],
    }
}

#[cfg(test)]
#[path = "text.test.rs"]
mod tests;
