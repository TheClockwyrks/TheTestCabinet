//! The skinned binary-glTF (`.glb`) encoder — one continuous mesh bound to a skeleton.
//!
//! This builds on the per-part `.glb` layout `test-cabinet-model-core` defines (the
//! same `POSITION` / `NORMAL` / `COLOR_0` / index attributes, encoded into one buffer
//! whose bytes are the glb BIN chunk) and adds the structures that make it a **skin**:
//! a `JOINTS_0` (u16 `VEC4`) and `WEIGHTS_0` (F32 `VEC4`) attribute per vertex, a glTF
//! **skin** with its inverse-bind-matrices accessor (F32 `MAT4`) and joint-node list,
//! and the **bone node hierarchy**. All the bulk binary — the per-vertex weights and
//! the inverse-bind matrices — lives in the `.glb`, never in JSON, per the
//! data-format principle.
//!
//! A model consumes the skin by linear-blend skinning: the runtime supplies per-bone
//! matrices (sampled from `rig.json`) and reads `JOINTS_0` / `WEIGHTS_0` plus the
//! inverse-bind matrices from here.

use glam::Mat4;
use serde_json::{Value, json};

use test_cabinet_model_core::part_mesh_to_glb;

use crate::skeleton::Bone;
use crate::skin::VertexSkin;

/// `glTF` — the 12-byte glb header magic.
const GLB_MAGIC: &[u8; 4] = b"glTF";
/// The glb JSON chunk's four-CC type.
const CHUNK_JSON: &[u8; 4] = b"JSON";
/// The glb BIN chunk's four-CC type.
const CHUNK_BIN: &[u8; 4] = b"BIN\0";
/// F32 accessor component type.
const COMPONENT_F32: u64 = 5126;
/// U32 accessor component type.
const COMPONENT_U32: u64 = 5125;
/// U16 accessor component type (`JOINTS_0`).
const COMPONENT_U16: u64 = 5123;
/// `ARRAY_BUFFER` bufferView target (vertex attributes).
const TARGET_ARRAY_BUFFER: u64 = 34962;
/// `ELEMENT_ARRAY_BUFFER` bufferView target (indices).
const TARGET_ELEMENT_ARRAY_BUFFER: u64 = 34963;

/// Encode a skinned character into a single skinned `.glb` (glTF 2.0 binary).
///
/// `positions` / `normals` / `colors` / `indices` are the extracted mesh (the same
/// `PartMesh` shape the other kinds emit); `skins` is one [`VertexSkin`] per vertex;
/// `bones` gives the skeleton names + hierarchy; `node_locals` and `inverse_binds` are
/// the per-bone local bind transform and inverse-bind matrix (in bone order). The mesh
/// may be empty (an unrendered/hollow character), in which case only the skeleton + skin
/// are emitted; a rig with no bones at all degrades to an ordinary per-part glb.
#[allow(clippy::too_many_arguments)]
pub fn skinned_glb(
    positions: &[f32],
    normals: &[f32],
    colors: &[f32],
    indices: &[u32],
    skins: &[VertexSkin],
    bones: &[Bone],
    node_locals: &[Mat4],
    inverse_binds: &[Mat4],
) -> Vec<u8> {
    // No skeleton: nothing skin-specific to emit, so fall back to the shared per-part
    // encoder (which also handles the empty-mesh case).
    if bones.is_empty() {
        return part_mesh_to_glb(positions, normals, colors, indices);
    }

    let has_mesh = !positions.is_empty() && !indices.is_empty();
    // The mesh node (when present) is node 0, so bone nodes start at 1; with no mesh the
    // bones occupy nodes 0..N.
    let bone_base = if has_mesh { 1 } else { 0 };
    let bone_count = bones.len();

    // Build the BIN payload and the accessors/bufferViews that index into it. Vertex
    // attributes come first (only when there is a mesh), then the inverse-bind matrices.
    let mut bin: Vec<u8> = Vec::new();
    let mut accessors: Vec<Value> = Vec::new();
    let mut buffer_views: Vec<Value> = Vec::new();

    let mut mesh_json = Value::Null;
    if has_mesh {
        let vertex_count = positions.len() / 3;

        let (mut min, mut max) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
        for v in positions.chunks_exact(3) {
            for a in 0..3 {
                min[a] = min[a].min(v[a]);
                max[a] = max[a].max(v[a]);
            }
        }

        // POSITION.
        let pos_acc = push_f32_vec3(&mut bin, &mut accessors, &mut buffer_views, positions);
        if let Some(acc) = accessors[pos_acc].as_object_mut() {
            acc.insert("min".into(), json!(min));
            acc.insert("max".into(), json!(max));
        }
        // NORMAL, COLOR_0.
        let norm_acc = push_f32_vec3(&mut bin, &mut accessors, &mut buffer_views, normals);
        let col_acc = push_f32_vec3(&mut bin, &mut accessors, &mut buffer_views, colors);
        // JOINTS_0 (u16 VEC4), WEIGHTS_0 (f32 VEC4).
        let joints_acc = push_joints(
            &mut bin,
            &mut accessors,
            &mut buffer_views,
            skins,
            vertex_count,
        );
        let weights_acc = push_weights(
            &mut bin,
            &mut accessors,
            &mut buffer_views,
            skins,
            vertex_count,
        );
        // Indices.
        let idx_acc = push_indices(&mut bin, &mut accessors, &mut buffer_views, indices);

        mesh_json = json!({
            "primitives": [ {
                "attributes": {
                    "POSITION": pos_acc,
                    "NORMAL": norm_acc,
                    "COLOR_0": col_acc,
                    "JOINTS_0": joints_acc,
                    "WEIGHTS_0": weights_acc
                },
                "indices": idx_acc,
                "mode": 4
            } ]
        });
    }

    // Inverse-bind matrices accessor (F32 MAT4, one per bone), with no bufferView
    // target (it is not vertex/index data).
    let ibm_acc = push_mat4(&mut bin, &mut accessors, &mut buffer_views, inverse_binds);

    // Bone nodes and the skeleton hierarchy.
    let mut nodes: Vec<Value> = Vec::new();
    if has_mesh {
        nodes.push(json!({ "mesh": 0, "skin": 0 }));
    }
    for (i, bone) in bones.iter().enumerate() {
        let children: Vec<u64> = bones
            .iter()
            .enumerate()
            .filter(|(_, b)| b.parent.as_deref() == Some(bone.name.as_str()))
            .map(|(j, _)| (bone_base + j) as u64)
            .collect();
        let local = node_locals
            .get(i)
            .copied()
            .unwrap_or(Mat4::IDENTITY)
            .to_cols_array();
        let mut node = json!({ "name": bone.name, "matrix": local });
        if !children.is_empty() {
            node.as_object_mut()
                .unwrap()
                .insert("children".into(), json!(children));
        }
        nodes.push(node);
    }

    // Scene roots: the mesh node (if any) plus every root bone (no parent, or a parent
    // not present in the skeleton).
    let bone_name = |name: &str| bones.iter().any(|b| b.name == name);
    let root_bone_nodes: Vec<u64> = bones
        .iter()
        .enumerate()
        .filter(|(_, b)| b.parent.as_deref().map(bone_name) != Some(true))
        .map(|(i, _)| (bone_base + i) as u64)
        .collect();
    let skeleton_root = root_bone_nodes.first().copied().unwrap_or(bone_base as u64);
    let mut scene_nodes: Vec<u64> = Vec::new();
    if has_mesh {
        scene_nodes.push(0);
    }
    scene_nodes.extend(root_bone_nodes);

    let joints: Vec<u64> = (0..bone_count).map(|i| (bone_base + i) as u64).collect();
    let skin = json!({
        "inverseBindMatrices": ibm_acc,
        "joints": joints,
        "skeleton": skeleton_root
    });

    let mut doc = json!({
        "asset": { "version": "2.0", "generator": "test-cabinet" },
        "scene": 0,
        "scenes": [ { "nodes": scene_nodes } ],
        "nodes": nodes,
        "skins": [ skin ],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [ { "byteLength": bin.len() } ]
    });
    if has_mesh {
        doc.as_object_mut()
            .unwrap()
            .insert("meshes".into(), json!([mesh_json]));
    }

    assemble_glb(&doc, &bin)
}

/// Append an F32 `VEC3` accessor + bufferView over `data`, returning the accessor index.
fn push_f32_vec3(
    bin: &mut Vec<u8>,
    accessors: &mut Vec<Value>,
    buffer_views: &mut Vec<Value>,
    data: &[f32],
) -> usize {
    let offset = bin.len();
    for &f in data {
        bin.extend_from_slice(&f.to_le_bytes());
    }
    let bv = buffer_views.len();
    buffer_views.push(json!({
        "buffer": 0, "byteOffset": offset, "byteLength": data.len() * 4,
        "target": TARGET_ARRAY_BUFFER
    }));
    let acc = accessors.len();
    accessors.push(json!({
        "bufferView": bv, "componentType": COMPONENT_F32,
        "count": data.len() / 3, "type": "VEC3"
    }));
    acc
}

/// Append the `JOINTS_0` accessor (u16 `VEC4`) over `skins`, returning the accessor
/// index.
fn push_joints(
    bin: &mut Vec<u8>,
    accessors: &mut Vec<Value>,
    buffer_views: &mut Vec<Value>,
    skins: &[VertexSkin],
    vertex_count: usize,
) -> usize {
    let offset = bin.len();
    for vi in 0..vertex_count {
        let j = skins.get(vi).copied().unwrap_or_default().joints;
        for &b in &j {
            bin.extend_from_slice(&b.to_le_bytes());
        }
    }
    let bv = buffer_views.len();
    buffer_views.push(json!({
        "buffer": 0, "byteOffset": offset, "byteLength": vertex_count * 4 * 2,
        "target": TARGET_ARRAY_BUFFER
    }));
    let acc = accessors.len();
    accessors.push(json!({
        "bufferView": bv, "componentType": COMPONENT_U16,
        "count": vertex_count, "type": "VEC4"
    }));
    acc
}

/// Append the `WEIGHTS_0` accessor (F32 `VEC4`) over `skins`, returning the accessor
/// index.
fn push_weights(
    bin: &mut Vec<u8>,
    accessors: &mut Vec<Value>,
    buffer_views: &mut Vec<Value>,
    skins: &[VertexSkin],
    vertex_count: usize,
) -> usize {
    let offset = bin.len();
    for vi in 0..vertex_count {
        let w = skins.get(vi).copied().unwrap_or_default().weights;
        for &f in &w {
            bin.extend_from_slice(&f.to_le_bytes());
        }
    }
    let bv = buffer_views.len();
    buffer_views.push(json!({
        "buffer": 0, "byteOffset": offset, "byteLength": vertex_count * 4 * 4,
        "target": TARGET_ARRAY_BUFFER
    }));
    let acc = accessors.len();
    accessors.push(json!({
        "bufferView": bv, "componentType": COMPONENT_F32,
        "count": vertex_count, "type": "VEC4"
    }));
    acc
}

/// Append the U32 `SCALAR` index accessor over `indices`, returning the accessor index.
fn push_indices(
    bin: &mut Vec<u8>,
    accessors: &mut Vec<Value>,
    buffer_views: &mut Vec<Value>,
    indices: &[u32],
) -> usize {
    let offset = bin.len();
    for &i in indices {
        bin.extend_from_slice(&i.to_le_bytes());
    }
    let bv = buffer_views.len();
    buffer_views.push(json!({
        "buffer": 0, "byteOffset": offset, "byteLength": indices.len() * 4,
        "target": TARGET_ELEMENT_ARRAY_BUFFER
    }));
    let acc = accessors.len();
    accessors.push(json!({
        "bufferView": bv, "componentType": COMPONENT_U32,
        "count": indices.len(), "type": "SCALAR"
    }));
    acc
}

/// Append the F32 `MAT4` accessor (column-major) over `mats`, returning the accessor
/// index. Used for the inverse-bind matrices; carries no bufferView target.
fn push_mat4(
    bin: &mut Vec<u8>,
    accessors: &mut Vec<Value>,
    buffer_views: &mut Vec<Value>,
    mats: &[Mat4],
) -> usize {
    let offset = bin.len();
    for m in mats {
        for f in m.to_cols_array() {
            bin.extend_from_slice(&f.to_le_bytes());
        }
    }
    let bv = buffer_views.len();
    buffer_views.push(json!({
        "buffer": 0, "byteOffset": offset, "byteLength": mats.len() * 16 * 4
    }));
    let acc = accessors.len();
    accessors.push(json!({
        "bufferView": bv, "componentType": COMPONENT_F32,
        "count": mats.len(), "type": "MAT4"
    }));
    acc
}

/// Wrap a glTF JSON document and a BIN payload into the glb container.
fn assemble_glb(doc: &Value, bin: &[u8]) -> Vec<u8> {
    let mut json_bytes = serde_json::to_vec(doc).expect("glTF JSON always serializes");
    while !json_bytes.len().is_multiple_of(4) {
        json_bytes.push(b' ');
    }
    let mut bin_bytes = bin.to_vec();
    while !bin_bytes.len().is_multiple_of(4) {
        bin_bytes.push(0);
    }

    let total = 12 + 8 + json_bytes.len() + 8 + bin_bytes.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(GLB_MAGIC);
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(CHUNK_JSON);
    out.extend_from_slice(&json_bytes);
    out.extend_from_slice(&(bin_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(CHUNK_BIN);
    out.extend_from_slice(&bin_bytes);
    out
}

/// A skinned glb decoded back into its skin data, for round-trip verification. The base
/// mesh (positions/normals/colors/indices) is read with the shared
/// [`glb_to_part_mesh`](test_cabinet_model_core::glb_to_part_mesh) decoder; this carries
/// only the skin-specific fields.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedSkin {
    /// The `JOINTS_0` bone indices, one `[u16; 4]` per vertex.
    pub joints: Vec<[u16; 4]>,
    /// The `WEIGHTS_0` weights, one `[f32; 4]` per vertex.
    pub weights: Vec<[f32; 4]>,
    /// The number of joints the glTF skin lists (the bone count).
    pub skin_joint_count: usize,
    /// The number of inverse-bind matrices in the skin.
    pub inverse_bind_count: usize,
}

/// Decode the skin-specific data of a skinned glb. Returns `Err` with a readable reason
/// when the bytes are not a well-formed skinned glb.
pub fn decode_skinned_glb(bytes: &[u8]) -> Result<DecodedSkin, String> {
    let (doc, bin) = split_glb(bytes)?;

    let skins = doc
        .get("skins")
        .and_then(|s| s.as_array())
        .and_then(|a| a.first())
        .ok_or("skinned glb has no skin")?;
    let skin_joint_count = skins
        .get("joints")
        .and_then(|j| j.as_array())
        .map(|a| a.len())
        .ok_or("skin has no joints list")?;
    let ibm_acc = skins
        .get("inverseBindMatrices")
        .and_then(|v| v.as_u64())
        .ok_or("skin has no inverseBindMatrices")? as usize;

    let accessors = doc
        .get("accessors")
        .and_then(|a| a.as_array())
        .ok_or("glb has no accessors")?;
    let buffer_views = doc
        .get("bufferViews")
        .and_then(|a| a.as_array())
        .ok_or("glb has no bufferViews")?;

    let inverse_bind_count = accessors
        .get(ibm_acc)
        .and_then(|a| a.get("count"))
        .and_then(|c| c.as_u64())
        .ok_or("inverse-bind accessor has no count")? as usize;

    // The mesh may be absent (a hollow character): then there are no per-vertex skins.
    let Some(attributes) = doc
        .get("meshes")
        .and_then(|m| m.get(0))
        .and_then(|m| m.get("primitives"))
        .and_then(|p| p.get(0))
        .and_then(|p| p.get("attributes"))
    else {
        return Ok(DecodedSkin {
            joints: Vec::new(),
            weights: Vec::new(),
            skin_joint_count,
            inverse_bind_count,
        });
    };

    let joints_acc = attr_index(attributes, "JOINTS_0")?;
    let weights_acc = attr_index(attributes, "WEIGHTS_0")?;
    let joints = read_u16_vec4(accessors, buffer_views, bin, joints_acc)?;
    let weights = read_f32_vec4(accessors, buffer_views, bin, weights_acc)?;

    Ok(DecodedSkin {
        joints,
        weights,
        skin_joint_count,
        inverse_bind_count,
    })
}

/// Split a glb into its JSON document and BIN chunk.
fn split_glb(bytes: &[u8]) -> Result<(Value, &[u8]), String> {
    if bytes.len() < 12 || &bytes[0..4] != GLB_MAGIC {
        return Err("not a glb (bad header)".to_string());
    }
    let total = read_u32(bytes, 8)? as usize;
    let mut off = 12;
    let mut json_bytes: Option<&[u8]> = None;
    let mut bin_bytes: &[u8] = &[];
    let end = total.min(bytes.len());
    while off + 8 <= end {
        let chunk_len = read_u32(bytes, off)? as usize;
        let chunk_type = &bytes[off + 4..off + 8];
        let start = off + 8;
        let stop = start
            .checked_add(chunk_len)
            .filter(|s| *s <= bytes.len())
            .ok_or("glb chunk length exceeds file")?;
        let data = &bytes[start..stop];
        if chunk_type == CHUNK_JSON {
            json_bytes = Some(data);
        } else if chunk_type == CHUNK_BIN {
            bin_bytes = data;
        }
        off = stop;
    }
    let json_bytes = json_bytes.ok_or("glb has no JSON chunk")?;
    let doc = serde_json::from_slice(json_bytes)
        .map_err(|err| format!("glb JSON chunk is not valid JSON: {err}"))?;
    Ok((doc, bin_bytes))
}

/// The accessor index a primitive attribute names.
fn attr_index(attributes: &Value, name: &str) -> Result<usize, String> {
    attributes
        .get(name)
        .and_then(|v| v.as_u64())
        .map(|i| i as usize)
        .ok_or_else(|| format!("glb primitive is missing the {name} attribute"))
}

/// The `(byte start, count)` of an accessor after checking its component type.
fn accessor_view(
    accessors: &[Value],
    buffer_views: &[Value],
    acc_idx: usize,
    expect_component: u64,
) -> Result<(usize, usize), String> {
    let acc = accessors
        .get(acc_idx)
        .ok_or("accessor index out of range")?;
    if acc.get("componentType").and_then(|v| v.as_u64()) != Some(expect_component) {
        return Err(format!(
            "accessor {acc_idx} has an unexpected componentType"
        ));
    }
    let count = acc
        .get("count")
        .and_then(|v| v.as_u64())
        .ok_or("accessor has no count")? as usize;
    let bv_idx = acc
        .get("bufferView")
        .and_then(|v| v.as_u64())
        .ok_or("accessor has no bufferView")? as usize;
    let bv = buffer_views.get(bv_idx).ok_or("bufferView out of range")?;
    let bv_off = bv.get("byteOffset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let acc_off = acc.get("byteOffset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    Ok((bv_off + acc_off, count))
}

/// Read a U16 `VEC4` accessor as `[u16; 4]` per element.
fn read_u16_vec4(
    accessors: &[Value],
    buffer_views: &[Value],
    bin: &[u8],
    acc_idx: usize,
) -> Result<Vec<[u16; 4]>, String> {
    let (start, count) = accessor_view(accessors, buffer_views, acc_idx, COMPONENT_U16)?;
    let mut out = Vec::with_capacity(count);
    for e in 0..count {
        let mut quad = [0u16; 4];
        for (c, slot) in quad.iter_mut().enumerate() {
            let b = start + (e * 4 + c) * 2;
            let s = bin.get(b..b + 2).ok_or("u16 accessor reads past BIN")?;
            *slot = u16::from_le_bytes([s[0], s[1]]);
        }
        out.push(quad);
    }
    Ok(out)
}

/// Read an F32 `VEC4` accessor as `[f32; 4]` per element.
fn read_f32_vec4(
    accessors: &[Value],
    buffer_views: &[Value],
    bin: &[u8],
    acc_idx: usize,
) -> Result<Vec<[f32; 4]>, String> {
    let (start, count) = accessor_view(accessors, buffer_views, acc_idx, COMPONENT_F32)?;
    let mut out = Vec::with_capacity(count);
    for e in 0..count {
        let mut quad = [0f32; 4];
        for (c, slot) in quad.iter_mut().enumerate() {
            let b = start + (e * 4 + c) * 4;
            let s = bin.get(b..b + 4).ok_or("f32 accessor reads past BIN")?;
            *slot = f32::from_le_bytes([s[0], s[1], s[2], s[3]]);
        }
        out.push(quad);
    }
    Ok(out)
}

/// Read a little-endian `u32` at `off`, bounds-checked.
fn read_u32(bytes: &[u8], off: usize) -> Result<u32, String> {
    bytes
        .get(off..off + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| "glb truncated reading a u32".to_string())
}

#[cfg(test)]
#[path = "gltf.test.rs"]
mod tests;
