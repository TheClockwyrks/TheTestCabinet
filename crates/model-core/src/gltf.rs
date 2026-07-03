//! The per-part binary-glTF (`.glb`) container the voxel family stores geometry in.
//!
//! Every voxel-family tool emits one `.glb` per part instead of the old
//! uncompressed JSON number arrays (`mesh.json`). The **internal `PartMesh` contract
//! is unchanged** — the four flat arrays `positions` / `normals` / `colors` /
//! `indices` — only the on-disk / on-wire encoding changes. This module is the
//! single place that ENCODES those arrays into a `.glb` and DECODES a `.glb` back
//! into them, so the Rust write side (the meshing binaries) and the Rust read side
//! (the validator and the live-preview listener) share one implementation, and the
//! separate TypeScript / Node readers interoperate through the **glTF 2.0 spec**
//! rather than through this code.
//!
//! ## The exact per-part format
//!
//! A `.glb` holding **one mesh with one primitive**: a `POSITION` (F32 `VEC3`, with
//! the required per-axis `min`/`max`), a `NORMAL` (F32 `VEC3`), a `COLOR_0` (F32
//! `VEC3`, the same linear `0..1` RGB the `colors` array carries), and U32 `SCALAR`
//! `indices`, all into one buffer whose bytes are the glb BIN chunk
//! (`positions ++ normals ++ colors ++ indices`, little-endian). An **empty part**
//! (zero vertices — an attach socket) becomes a valid glb with an empty scene and
//! **no** meshes/accessors/bufferViews and an empty BIN chunk (count-0 accessors are
//! invalid glTF); decoding it yields empty arrays.

use serde_json::json;

/// The four flat arrays a part's surface mesh decodes back into — the `PartMesh`
/// shape every voxel-family consumer reads, decoupled from any one crate's `Mesh`
/// type so both `core` (the validator, the live listener) and the binaries can build
/// their own struct from it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PartMeshArrays {
    /// Vertex positions, 3 floats (x, y, z) per vertex.
    pub positions: Vec<f32>,
    /// Vertex normals, 3 floats per vertex.
    pub normals: Vec<f32>,
    /// Vertex colors, 3 floats (r, g, b) in `0..1` per vertex.
    pub colors: Vec<f32>,
    /// Triangle indices into the vertex arrays, 3 per triangle.
    pub indices: Vec<u32>,
}

/// `glTF` — the 12-byte glb header's magic, and the ASCII prefix every emitted file
/// begins with.
const GLB_MAGIC: &[u8; 4] = b"glTF";
/// The glb JSON chunk's four-CC type (`0x4E4F534A`).
const CHUNK_JSON: &[u8; 4] = b"JSON";
/// The glb BIN chunk's four-CC type (`0x004E4942`).
const CHUNK_BIN: &[u8; 4] = b"BIN\0";
/// F32 accessor component type.
const COMPONENT_F32: u64 = 5126;
/// U32 accessor component type.
const COMPONENT_U32: u64 = 5125;
/// `ARRAY_BUFFER` bufferView target (vertex attributes).
const TARGET_ARRAY_BUFFER: u64 = 34962;
/// `ELEMENT_ARRAY_BUFFER` bufferView target (indices).
const TARGET_ELEMENT_ARRAY_BUFFER: u64 = 34963;

/// Encode a part's four flat arrays into a per-part `.glb` (glTF 2.0 binary).
///
/// The four arrays must be the `PartMesh` shape: `positions`/`normals`/`colors` are
/// parallel `3 * vertexCount` float arrays and `indices` a triangle list. A part
/// with no geometry (empty `positions` or `indices`) encodes to a valid glb with an
/// empty scene and no mesh — see the module docs.
pub fn part_mesh_to_glb(
    positions: &[f32],
    normals: &[f32],
    colors: &[f32],
    indices: &[u32],
) -> Vec<u8> {
    // An empty part becomes a valid glb with an empty scene and no mesh: count-0
    // accessors are invalid glTF, so none are emitted.
    if positions.is_empty() || indices.is_empty() {
        return assemble_glb(&empty_json(), &[]);
    }

    let vertex_count = positions.len() / 3;

    // The POSITION accessor requires per-axis min/max over the positions.
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for v in positions.chunks_exact(3) {
        for a in 0..3 {
            min[a] = min[a].min(v[a]);
            max[a] = max[a].max(v[a]);
        }
    }

    // BIN payload: positions ++ normals ++ colors ++ indices, little-endian. f32 and
    // u32 are naturally 4-byte, so the concatenation stays 4-byte aligned.
    let pos_len = positions.len() * 4;
    let norm_len = normals.len() * 4;
    let col_len = colors.len() * 4;
    let idx_len = indices.len() * 4;
    let mut bin = Vec::with_capacity(pos_len + norm_len + col_len + idx_len);
    for &f in positions {
        bin.extend_from_slice(&f.to_le_bytes());
    }
    for &f in normals {
        bin.extend_from_slice(&f.to_le_bytes());
    }
    for &f in colors {
        bin.extend_from_slice(&f.to_le_bytes());
    }
    for &i in indices {
        bin.extend_from_slice(&i.to_le_bytes());
    }

    let pos_off = 0;
    let norm_off = pos_len;
    let col_off = pos_len + norm_len;
    let idx_off = pos_len + norm_len + col_len;

    let doc = json!({
        "asset": { "version": "2.0", "generator": "test-cabinet" },
        "scene": 0,
        "scenes": [ { "nodes": [0] } ],
        "nodes": [ { "mesh": 0 } ],
        "meshes": [ {
            "primitives": [ {
                "attributes": { "POSITION": 0, "NORMAL": 1, "COLOR_0": 2 },
                "indices": 3,
                "mode": 4
            } ]
        } ],
        "accessors": [
            { "bufferView": 0, "componentType": COMPONENT_F32, "count": vertex_count, "type": "VEC3", "min": min, "max": max },
            { "bufferView": 1, "componentType": COMPONENT_F32, "count": vertex_count, "type": "VEC3" },
            { "bufferView": 2, "componentType": COMPONENT_F32, "count": vertex_count, "type": "VEC3" },
            { "bufferView": 3, "componentType": COMPONENT_U32, "count": indices.len(), "type": "SCALAR" }
        ],
        "bufferViews": [
            { "buffer": 0, "byteOffset": pos_off, "byteLength": pos_len, "target": TARGET_ARRAY_BUFFER },
            { "buffer": 0, "byteOffset": norm_off, "byteLength": norm_len, "target": TARGET_ARRAY_BUFFER },
            { "buffer": 0, "byteOffset": col_off, "byteLength": col_len, "target": TARGET_ARRAY_BUFFER },
            { "buffer": 0, "byteOffset": idx_off, "byteLength": idx_len, "target": TARGET_ELEMENT_ARRAY_BUFFER }
        ],
        "buffers": [ { "byteLength": bin.len() } ]
    });

    assemble_glb(&doc, &bin)
}

/// Decode a per-part `.glb` back into the four flat `PartMesh` arrays. An empty-part
/// glb (no meshes) decodes to all-empty arrays.
///
/// Returns `Err` with a human-readable reason when the bytes are not a well-formed
/// glb of the expected per-part shape.
pub fn glb_to_part_mesh(bytes: &[u8]) -> Result<PartMeshArrays, String> {
    if bytes.len() < 12 {
        return Err("glb too short for a 12-byte header".to_string());
    }
    if &bytes[0..4] != GLB_MAGIC {
        return Err("not a glb (bad magic)".to_string());
    }
    let total = read_u32(bytes, 8)? as usize;

    // Walk the chunks after the header, capturing the JSON and (optional) BIN chunks.
    let mut off = 12;
    let mut json_bytes: Option<&[u8]> = None;
    let mut bin_bytes: &[u8] = &[];
    let end = total.min(bytes.len());
    while off + 8 <= end {
        let chunk_len = read_u32(bytes, off)? as usize;
        let chunk_type = &bytes[off + 4..off + 8];
        let data_start = off + 8;
        let data_end = data_start
            .checked_add(chunk_len)
            .ok_or("glb chunk length overflows")?;
        if data_end > bytes.len() {
            return Err("glb chunk length exceeds file".to_string());
        }
        let data = &bytes[data_start..data_end];
        if chunk_type == CHUNK_JSON {
            json_bytes = Some(data);
        } else if chunk_type == CHUNK_BIN {
            bin_bytes = data;
        }
        off = data_end;
    }

    let json_bytes = json_bytes.ok_or("glb has no JSON chunk")?;
    let doc: serde_json::Value = serde_json::from_slice(json_bytes)
        .map_err(|err| format!("glb JSON chunk is not valid JSON: {err}"))?;

    // An empty part carries no meshes → all-empty arrays.
    let has_mesh = doc
        .get("meshes")
        .and_then(|m| m.as_array())
        .is_some_and(|a| !a.is_empty());
    if !has_mesh {
        return Ok(PartMeshArrays::default());
    }

    let accessors = doc
        .get("accessors")
        .and_then(|a| a.as_array())
        .ok_or("glb has a mesh but no accessors")?;
    let buffer_views = doc
        .get("bufferViews")
        .and_then(|a| a.as_array())
        .ok_or("glb has a mesh but no bufferViews")?;
    let primitive = doc
        .get("meshes")
        .and_then(|m| m.get(0))
        .and_then(|m| m.get("primitives"))
        .and_then(|p| p.get(0))
        .ok_or("glb mesh has no primitive")?;
    let attributes = primitive
        .get("attributes")
        .ok_or("glb primitive has no attributes")?;

    let pos_acc = attr_index(attributes, "POSITION")?;
    let norm_acc = attr_index(attributes, "NORMAL")?;
    let col_acc = attr_index(attributes, "COLOR_0")?;
    let idx_acc = primitive
        .get("indices")
        .and_then(|v| v.as_u64())
        .ok_or("glb primitive has no indices accessor")? as usize;

    let positions = read_f32_vec3(accessors, buffer_views, bin_bytes, pos_acc)?;
    let normals = read_f32_vec3(accessors, buffer_views, bin_bytes, norm_acc)?;
    let colors = read_f32_vec3(accessors, buffer_views, bin_bytes, col_acc)?;
    let indices = read_u32_scalar(accessors, buffer_views, bin_bytes, idx_acc)?;

    Ok(PartMeshArrays {
        positions,
        normals,
        colors,
        indices,
    })
}

/// The minimal glTF JSON for an empty part: a scene with no nodes and no mesh.
fn empty_json() -> serde_json::Value {
    json!({
        "asset": { "version": "2.0", "generator": "test-cabinet" },
        "scene": 0,
        "scenes": [ { "nodes": [] } ],
        "nodes": [],
        "meshes": [],
        "accessors": [],
        "bufferViews": [],
        "buffers": []
    })
}

/// Wrap a glTF JSON document and a BIN payload into the glb container: the 12-byte
/// header, the JSON chunk (space-padded to 4 bytes), and the BIN chunk (zero-padded
/// to 4 bytes).
fn assemble_glb(doc: &serde_json::Value, bin: &[u8]) -> Vec<u8> {
    let mut json_bytes = serde_json::to_vec(doc).expect("glTF JSON always serializes");
    while json_bytes.len() % 4 != 0 {
        json_bytes.push(b' ');
    }
    let mut bin_bytes = bin.to_vec();
    while bin_bytes.len() % 4 != 0 {
        bin_bytes.push(0);
    }

    let total = 12 + 8 + json_bytes.len() + 8 + bin_bytes.len();
    let mut out = Vec::with_capacity(total);
    // Header.
    out.extend_from_slice(GLB_MAGIC);
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    // JSON chunk.
    out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(CHUNK_JSON);
    out.extend_from_slice(&json_bytes);
    // BIN chunk.
    out.extend_from_slice(&(bin_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(CHUNK_BIN);
    out.extend_from_slice(&bin_bytes);
    out
}

/// Read a little-endian `u32` at `off`, bounds-checked.
fn read_u32(bytes: &[u8], off: usize) -> Result<u32, String> {
    bytes
        .get(off..off + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| "glb truncated reading a u32".to_string())
}

/// The accessor index a primitive attribute names.
fn attr_index(attributes: &serde_json::Value, name: &str) -> Result<usize, String> {
    attributes
        .get(name)
        .and_then(|v| v.as_u64())
        .map(|i| i as usize)
        .ok_or_else(|| format!("glb primitive is missing the {name} attribute"))
}

/// The `(bufferView byteOffset, accessor byteOffset, count)` for an accessor, after
/// checking its component type.
fn accessor_view<'a>(
    accessors: &'a [serde_json::Value],
    buffer_views: &'a [serde_json::Value],
    acc_idx: usize,
    expect_component: u64,
) -> Result<(usize, usize), String> {
    let acc = accessors
        .get(acc_idx)
        .ok_or("glb accessor index out of range")?;
    if acc.get("componentType").and_then(|v| v.as_u64()) != Some(expect_component) {
        return Err(format!(
            "glb accessor {acc_idx} has an unexpected componentType (wanted {expect_component})"
        ));
    }
    let count = acc
        .get("count")
        .and_then(|v| v.as_u64())
        .ok_or("glb accessor has no count")? as usize;
    let bv_idx = acc
        .get("bufferView")
        .and_then(|v| v.as_u64())
        .ok_or("glb accessor has no bufferView")? as usize;
    let bv = buffer_views
        .get(bv_idx)
        .ok_or("glb bufferView index out of range")?;
    let bv_off = bv.get("byteOffset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let acc_off = acc.get("byteOffset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    Ok((bv_off + acc_off, count))
}

/// Read an F32 `VEC3` accessor as a flat `3 * count` float array.
fn read_f32_vec3(
    accessors: &[serde_json::Value],
    buffer_views: &[serde_json::Value],
    bin: &[u8],
    acc_idx: usize,
) -> Result<Vec<f32>, String> {
    let (start, count) = accessor_view(accessors, buffer_views, acc_idx, COMPONENT_F32)?;
    let n = count * 3;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let b = start + i * 4;
        let slice = bin
            .get(b..b + 4)
            .ok_or("glb f32 accessor reads past the BIN chunk")?;
        out.push(f32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]));
    }
    Ok(out)
}

/// Read a U32 `SCALAR` accessor as a flat `count` index array.
fn read_u32_scalar(
    accessors: &[serde_json::Value],
    buffer_views: &[serde_json::Value],
    bin: &[u8],
    acc_idx: usize,
) -> Result<Vec<u32>, String> {
    let (start, count) = accessor_view(accessors, buffer_views, acc_idx, COMPONENT_U32)?;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let b = start + i * 4;
        let slice = bin
            .get(b..b + 4)
            .ok_or("glb u32 accessor reads past the BIN chunk")?;
        out.push(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_small_mesh() {
        let positions = vec![0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let normals = vec![0.0f32, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
        let colors = vec![1.0f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        let indices = vec![0u32, 1, 2];

        let glb = part_mesh_to_glb(&positions, &normals, &colors, &indices);
        assert_eq!(&glb[0..4], b"glTF", "starts with the glTF magic");
        assert_eq!(glb.len() % 4, 0, "the total glb length is 4-byte aligned");

        let out = glb_to_part_mesh(&glb).expect("decode the round-tripped glb");
        assert_eq!(out.positions, positions);
        assert_eq!(out.normals, normals);
        assert_eq!(out.colors, colors);
        assert_eq!(out.indices, indices);
    }

    #[test]
    fn round_trips_an_empty_mesh() {
        let glb = part_mesh_to_glb(&[], &[], &[], &[]);
        assert_eq!(&glb[0..4], b"glTF", "an empty part is still a valid glb");
        assert_eq!(glb.len() % 4, 0);

        let out = glb_to_part_mesh(&glb).expect("decode the empty glb");
        assert!(out.positions.is_empty());
        assert!(out.normals.is_empty());
        assert!(out.colors.is_empty());
        assert!(out.indices.is_empty());
    }
}
