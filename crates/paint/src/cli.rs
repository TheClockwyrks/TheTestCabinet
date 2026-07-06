//! Shared CLI plumbing for the four binaries: reading the seeded config, the shared
//! operation log (append + replay), re-rendering a target's composited preview,
//! emitting `ui.json` / `material.json`, and streaming a live frame.
//!
//! The four binaries (`paint`, `ui`, `texture`, `pbr`) differ only in their clap
//! operation vocabulary; the file/preview/stream mechanics live here so paint and ui
//! (and texture and pbr) interleave over one shared log and layer store, exactly as
//! the [`draw`](test_cabinet_draw) tools share their `cli` module.

use std::fs;
use std::path::Path;

use serde::de::DeserializeOwned;

use crate::color::Color;
use crate::config::{
    LiveConfig, MaterialConfig, MaterialJson, MaterialMapOut, PaintConfig, UiElementOut, UiJson,
};
use crate::layer::Workspace;
use crate::nine_slice::{self, NineSlice};
use crate::op::{Action, Op, replay};
use crate::raster::{Raster, WrapMode};

/// Apply one UI operation (`paint`/`ui`): append it to the shared log, re-composite
/// the affected element to its emitted PNG, refresh `ui.json`, and stream the live
/// frame. Returns a human-readable confirmation line.
pub fn apply_ui_op(
    config_path: &Path,
    element: Option<String>,
    op: Op,
) -> Result<String, String> {
    let config: PaintConfig = read_config(config_path)?;
    let template = config.workspace()?;
    let target = template.resolve_name(element.as_deref())?;
    let op_name = op.name();
    let actions = append(&config.actions, Action::targeted(element, op))?;
    let composite = composite_target(&template, &actions, &target)?;
    let png = write_png(&composite, &config.preview_for(&target))?;
    let ws = replay_workspace(&template, &actions)?;
    write_ui_json(&config.ui_json, &config, &ws)?;
    if let Some(live) = &config.live {
        send_live_preview(live, template.target_index(&target), op_name, actions.len(), &png);
    }
    Ok(format!(
        "applied {op_name} to {target} ({} operation{})",
        actions.len(),
        plural(actions.len())
    ))
}

/// Apply one material operation (`texture`/`pbr` mutations): append it, re-composite
/// the affected map to its emitted single-tile PNG, refresh `material.json`, and
/// stream a 2×2-tiled live frame so seams are visible.
pub fn apply_material_op(
    config_path: &Path,
    map: Option<String>,
    op: Op,
) -> Result<String, String> {
    let config: MaterialConfig = read_config(config_path)?;
    let template = config.workspace()?;
    let target = map.unwrap_or_else(|| "base-color".to_string());
    let op_name = op.name();
    let actions = append(&config.actions, Action::targeted(Some(target.clone()), op))?;
    let composite = composite_target(&template, &actions, &target)?;
    let png = write_png(&composite, &config.preview_for(&target))?;
    write_material_json(&config.material_json, &config, 1.0)?;
    if let Some(live) = &config.live {
        let tiled = tile_2x2(&composite).to_png_bytes();
        send_live_preview(live, template.target_index(&target), op_name, actions.len(), &tiled);
    }
    let _ = png;
    Ok(format!(
        "applied {op_name} to {target} ({} operation{})",
        actions.len(),
        plural(actions.len())
    ))
}

/// Re-render every UI element's preview from the current log (the `render` command
/// and `init`), refreshing `ui.json`.
pub fn recomposite_ui(config_path: &Path) -> Result<(), String> {
    let config: PaintConfig = read_config(config_path)?;
    let template = config.workspace()?;
    let actions = read_actions(&config.actions)?;
    for el in config.element_list() {
        let composite = composite_target(&template, &actions, &el.name)?;
        write_png(&composite, &config.preview_for(&el.name))?;
    }
    let ws = replay_workspace(&template, &actions)?;
    write_ui_json(&config.ui_json, &config, &ws)
}

/// Re-render every material map's preview from the current log, refreshing
/// `material.json`.
pub fn recomposite_material(config_path: &Path) -> Result<(), String> {
    let config: MaterialConfig = read_config(config_path)?;
    let template = config.workspace()?;
    let actions = read_actions(&config.actions)?;
    for map in &config.maps {
        let composite = composite_target(&template, &actions, map)?;
        write_png(&composite, &config.preview_for(map))?;
    }
    write_material_json(&config.material_json, &config, 1.0)
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

/// Read a JSON config file into `T`.
pub fn read_config<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let raw =
        fs::read_to_string(path).map_err(|e| format!("reading {}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("invalid config {}: {e}", path.display()))
}

/// Read the shared operation log, treating an absent file as empty.
pub fn read_actions(path: &Path) -> Result<Vec<Action>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            serde_json::from_str(&raw).map_err(|e| format!("invalid log {}: {e}", path.display()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("reading {}: {e}", path.display())),
    }
}

/// Write the shared operation log as pretty JSON, creating parents as needed.
pub fn write_actions(path: &Path, actions: &[Action]) -> Result<(), String> {
    ensure_parent(path)?;
    let mut json =
        serde_json::to_string_pretty(actions).map_err(|e| format!("serializing log: {e}"))?;
    json.push('\n');
    fs::write(path, json).map_err(|e| format!("writing {}: {e}", path.display()))
}

/// Seed the log with the asset seed as the first `init` entry.
pub fn init_log(path: &Path, seed: u64) -> Result<(), String> {
    write_actions(path, &[Action::global(Op::Init { seed })])
}

/// Append one action and return the full log (read → push → write).
pub fn append(path: &Path, action: Action) -> Result<Vec<Action>, String> {
    let mut actions = read_actions(path)?;
    actions.push(action);
    write_actions(path, &actions)?;
    Ok(actions)
}

/// Replay `actions` into a fresh copy of `template` and return the composited
/// `target` document.
pub fn composite_target(
    template: &Workspace,
    actions: &[Action],
    target: &str,
) -> Result<Raster, String> {
    let mut ws = template.clone();
    replay(&mut ws, actions)?;
    let doc = ws
        .documents
        .get(target)
        .ok_or_else(|| format!("no document `{target}`"))?;
    Ok(doc.composite())
}

/// Replay `actions` and return the whole replayed workspace (for `ui.json`
/// nine-slice reads and multi-target renders).
pub fn replay_workspace(template: &Workspace, actions: &[Action]) -> Result<Workspace, String> {
    let mut ws = template.clone();
    replay(&mut ws, actions)?;
    Ok(ws)
}

/// Write a raster to a preview/emitted PNG, creating parents.
pub fn write_png(raster: &Raster, path: &Path) -> Result<Vec<u8>, String> {
    ensure_parent(path)?;
    let bytes = raster.to_png_bytes();
    fs::write(path, &bytes).map_err(|e| format!("writing {}: {e}", path.display()))?;
    Ok(bytes)
}

/// Write already-encoded PNG bytes to a path, creating parents.
pub fn write_png_bytes(bytes: &[u8], path: &Path) -> Result<(), String> {
    ensure_parent(path)?;
    fs::write(path, bytes).map_err(|e| format!("writing {}: {e}", path.display()))
}

/// Tile a raster 2×2 into a new raster twice its size — how a material map's preview
/// is shown so seams (or their absence) are immediately visible.
pub fn tile_2x2(src: &Raster) -> Raster {
    let (w, h) = (src.width, src.height);
    let mut out = Raster::filled(w * 2, h * 2, Color::TRANSPARENT);
    for ty in 0..h * 2 {
        for tx in 0..w * 2 {
            let c = src.get_or_transparent((tx % w) as i64, (ty % h) as i64, WrapMode::Clamp);
            out.pixels[(ty * w * 2 + tx) as usize] = c;
        }
    }
    out
}

/// Emit `ui.json` beside the workspace, describing every element (size, emitted
/// path, and any nine-slice insets from the replayed workspace).
pub fn write_ui_json(
    path: &Path,
    config: &PaintConfig,
    ws: &Workspace,
) -> Result<(), String> {
    let mut elements = Vec::new();
    for el in config.element_list() {
        let nine_slice: Option<NineSlice> = ws
            .documents
            .get(&el.name)
            .and_then(|d| d.nine_slice)
            .or(el.nine_slice);
        elements.push(UiElementOut {
            name: el.name.clone(),
            width: el.width,
            height: el.height,
            path: config.preview_for(&el.name).to_string_lossy().into_owned(),
            nine_slice,
        });
    }
    let json = serde_json::to_string_pretty(&UiJson { elements })
        .map_err(|e| format!("serializing ui.json: {e}"))?;
    ensure_parent(path)?;
    fs::write(path, json + "\n").map_err(|e| format!("writing {}: {e}", path.display()))
}

/// Emit `material.json` beside the workspace: the emitted maps (path + color space),
/// the tiling scale, and the map size.
pub fn write_material_json(
    path: &Path,
    config: &MaterialConfig,
    tiling: f32,
) -> Result<(), String> {
    let maps = config
        .maps
        .iter()
        .filter(|m| MaterialConfig::is_emitted(m))
        .map(|m| MaterialMapOut {
            name: m.clone(),
            path: config.preview_for(m).to_string_lossy().into_owned(),
            color_space: MaterialConfig::color_space(m),
        })
        .collect();
    let json = serde_json::to_string_pretty(&MaterialJson {
        maps,
        tiling,
        size: config.size,
    })
    .map_err(|e| format!("serializing material.json: {e}"))?;
    ensure_parent(path)?;
    fs::write(path, json + "\n").map_err(|e| format!("writing {}: {e}", path.display()))
}

/// Render an element's nine-slice stretch preview to `out` at `(width, height)`.
pub fn nine_slice_preview(
    template: &Workspace,
    actions: &[Action],
    target: &str,
    width: u32,
    height: u32,
    out: &Path,
) -> Result<(), String> {
    let composite = composite_target(template, actions, target)?;
    let ws = replay_workspace(template, actions)?;
    let ns = ws
        .documents
        .get(target)
        .and_then(|d| d.nine_slice)
        .unwrap_or(NineSlice {
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
        });
    let stretched = nine_slice::stretch(&composite, ns, width, height);
    write_png(&stretched, out)?;
    Ok(())
}

/// Stream a just-rendered frame to the run's live-preview endpoint, best-effort.
///
/// Identical wire form to the [`draw`](test_cabinet_draw) tool: one JSON header line
/// (`{ token, frame, operation, operationCount, length }`) then exactly `length` raw
/// PNG bytes. `frame` carries the element/map index. Every error is swallowed — a
/// paint operation never fails because the live view is slow or absent.
pub fn send_live_preview(
    live: &LiveConfig,
    frame: u32,
    operation: &str,
    operation_count: usize,
    image: &[u8],
) {
    let _ = try_send(live, frame, operation, operation_count, image);
}

fn try_send(
    live: &LiveConfig,
    frame: u32,
    operation: &str,
    operation_count: usize,
    image: &[u8],
) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    const TIMEOUT: Duration = Duration::from_millis(750);
    let addr = live
        .endpoint
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| Error::new(ErrorKind::NotFound, "live endpoint resolved to no address"))?;
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT)?;
    stream.set_write_timeout(Some(TIMEOUT))?;
    let mut header = serde_json::to_vec(&serde_json::json!({
        "token": live.token,
        "frame": frame,
        "operation": operation,
        "operationCount": operation_count,
        "length": image.len(),
    }))?;
    header.push(b'\n');
    stream.write_all(&header)?;
    stream.write_all(image)?;
    stream.flush()
}

/// Create a path's parent directory tree if it has one.
pub fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent).map_err(|e| format!("creating {}: {e}", parent.display()))?;
    }
    Ok(())
}

/// Parse a brush profile name.
pub fn parse_brush(value: &str) -> Result<crate::paint_core::BrushKind, String> {
    use crate::paint_core::BrushKind::*;
    match value {
        "round-soft" => Ok(RoundSoft),
        "round-hard" => Ok(RoundHard),
        "airbrush" => Ok(Airbrush),
        "textured" => Ok(Textured),
        other => Err(format!("unknown brush `{other}`")),
    }
}

/// Parse a blend-mode name.
pub fn parse_blend(value: &str) -> Result<crate::blend::BlendMode, String> {
    use crate::blend::BlendMode::*;
    Ok(match value {
        "normal" => Normal,
        "multiply" => Multiply,
        "screen" => Screen,
        "overlay" => Overlay,
        "add" => Add,
        "subtract" => Subtract,
        "darken" => Darken,
        "lighten" => Lighten,
        "soft-light" => SoftLight,
        "hard-light" => HardLight,
        "color-dodge" => ColorDodge,
        "color-burn" => ColorBurn,
        other => return Err(format!("unknown blend mode `{other}`")),
    })
}

/// Parse a layer-effect name.
pub fn parse_effect(value: &str) -> Result<crate::effects::EffectKind, String> {
    use crate::effects::EffectKind::*;
    Ok(match value {
        "bevel" => Bevel,
        "inner-shadow" => InnerShadow,
        "drop-shadow" => DropShadow,
        "stroke" => Stroke,
        "glow" => Glow,
        other => return Err(format!("unknown effect `{other}`")),
    })
}

/// Parse a noise-basis name.
pub fn parse_noise(value: &str) -> Result<crate::proc::NoiseKind, String> {
    use crate::proc::NoiseKind::*;
    Ok(match value {
        "perlin" => Perlin,
        "worley" => Worley,
        "fbm" => Fbm,
        "ridged" => Ridged,
        other => return Err(format!("unknown noise type `{other}`")),
    })
}

/// Parse a pattern name.
pub fn parse_pattern(value: &str) -> Result<crate::proc::PatternKind, String> {
    use crate::proc::PatternKind::*;
    Ok(match value {
        "bricks" => Bricks,
        "hex" => Hex,
        "planks" => Planks,
        "checker" => Checker,
        "weave" => Weave,
        other => return Err(format!("unknown pattern `{other}`")),
    })
}

/// Parse a text alignment.
pub fn parse_align(value: &str) -> Result<crate::text::Align, String> {
    use crate::text::Align::*;
    Ok(match value {
        "left" => Left,
        "center" => Center,
        "right" => Right,
        other => return Err(format!("unknown align `{other}`")),
    })
}

/// Parse a `#rrggbb`/`#rrggbbaa` color (a clap value parser).
pub fn parse_color(value: &str) -> Result<Color, String> {
    Color::parse_hex(value).map_err(|e| e.to_string())
}

/// Parse an `x,y` pair.
pub fn parse_pair(value: &str) -> Result<(f32, f32), String> {
    let (x, y) = value
        .split_once(',')
        .ok_or_else(|| format!("`{value}` is not an x,y pair"))?;
    Ok((
        x.trim().parse().map_err(|_| format!("bad x in `{value}`"))?,
        y.trim().parse().map_err(|_| format!("bad y in `{value}`"))?,
    ))
}

/// Parse a space-separated list of `x,y` points (`"3,4 10,12 …"`).
pub fn parse_points(value: &str) -> Result<Vec<(f32, f32)>, String> {
    value.split_whitespace().map(parse_pair).collect()
}

/// Parse a comma-separated list of `pos:#color` gradient stops
/// (`"0:#000000,1:#ffffff"`).
pub fn parse_stops(value: &str) -> Result<Vec<(f32, Color)>, String> {
    value
        .split(',')
        .map(|s| {
            let (pos, col) = s
                .split_once(':')
                .ok_or_else(|| format!("`{s}` is not pos:#color"))?;
            let pos: f32 = pos.trim().parse().map_err(|_| format!("bad stop pos `{pos}`"))?;
            Ok((pos, parse_color(col.trim())?))
        })
        .collect()
}
