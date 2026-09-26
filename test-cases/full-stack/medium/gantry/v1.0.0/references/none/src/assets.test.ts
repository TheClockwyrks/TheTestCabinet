// The produced files are loaded, decoded, and refused when wrong. The tests run
// in Node with no DOM, and the real committed files are read off disk through
// the very URLs `src/assets.ts` resolves, so what is verified is the loader as
// the page runs it — not a fixture standing in for it.

import type { PartMesh } from "@clockwyrks/voxel-runtime";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildModelGeometries,
  checkWav,
  CUE_URLS,
  decodeModel,
  loadAssets,
  MODEL_NAMES,
  MODEL_SCALE,
  MODEL_URLS,
  MUSIC_URL,
  type GantryAssets,
  type ModelName,
} from "./assets";
import { CUES, LOAD_CLASS_DIMENSIONS, VOXELS_PER_UNIT } from "./constants";

/**
 * Read the committed file an asset URL names. Under the test runner those URLs
 * are `file:` URLs to the files themselves. The project ships no `@types/node`,
 * so the built-in module is reached through a specifier the compiler does not
 * resolve rather than a typed import.
 */
async function readAsset(url: string): Promise<ArrayBuffer> {
  const specifier = "node:fs/promises";
  const fs = (await import(/* @vite-ignore */ specifier)) as {
    readFile(path: URL): Promise<Uint8Array>;
  };
  const bytes = await fs.readFile(new URL(url));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** A glb container carrying just the JSON given — no BIN chunk, no mesh. */
function glbOf(json: unknown): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padding = (4 - (text.length % 4)) % 4;
  const length = 12 + 8 + text.length + padding;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true); // version 2
  view.setUint32(8, length, true);
  view.setUint32(12, text.length + padding, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  const chunk = new Uint8Array(buffer, 20);
  chunk.fill(0x20);
  chunk.set(text);
  return buffer;
}

/**
 * A glb carrying one primitive with positions and nothing else: a mesh whose
 * attributes do not agree, which the game cannot draw.
 */
function glbWithPositionsOnly(): ArrayBuffer {
  const vertices = 3;
  const json = {
    asset: { version: "2.0" },
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertices, type: "VEC3" },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: vertices * 12 }],
    buffers: [{ byteLength: vertices * 12 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padding = (4 - (text.length % 4)) % 4;
  const jsonLength = text.length + padding;
  const binLength = vertices * 12;
  const length = 12 + 8 + jsonLength + 8 + binLength;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true); // version 2
  view.setUint32(8, length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  const chunk = new Uint8Array(buffer, 20, jsonLength);
  chunk.fill(0x20);
  chunk.set(text);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true); // "BIN\0"
  return buffer;
}

/** Bytes that are not any file the build ships. */
function rubbish(): ArrayBuffer {
  return new TextEncoder().encode("not a produced file at all").buffer;
}

/** The size of a mesh's bounding box, in the model's own voxel units. */
function extent(mesh: PartMesh): [number, number, number] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[i + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/** The same, in world units: the models are drawn at `MODEL_SCALE`. */
function worldExtent(mesh: PartMesh): [number, number, number] {
  const [x, y, z] = extent(mesh);
  return [x * MODEL_SCALE, y * MODEL_SCALE, z * MODEL_SCALE];
}

/** Serve the committed files, but hand this one back instead. */
function serving(url: string, bytes: ArrayBuffer) {
  return async (wanted: string): Promise<ArrayBuffer> =>
    wanted === url ? bytes : readAsset(wanted);
}

describe("the produced files' URLs", () => {
  it("names the eight models of specs/assets.md, in order", () => {
    expect(MODEL_NAMES).toEqual([
      "ring",
      "trolley",
      "hook",
      "counterweight",
      "mount",
      "crate",
      "container",
      "drum",
    ]);
    expect(Object.keys(MODEL_URLS).sort()).toEqual([...MODEL_NAMES].sort());
  });

  it("gives each model, each cue, and the music its own file", () => {
    const urls = [
      ...MODEL_NAMES.map((name) => MODEL_URLS[name]),
      ...CUES.map((cue) => CUE_URLS[cue]),
      MUSIC_URL,
    ];
    expect(urls).toHaveLength(20);
    expect(new Set(urls).size).toBe(20);
    for (const name of MODEL_NAMES) {
      expect(MODEL_URLS[name].endsWith(`/assets/models/${name}.glb`)).toBe(
        true,
      );
    }
    for (const cue of CUES) {
      expect(CUE_URLS[cue].endsWith(`/assets/audio/${cue}.wav`)).toBe(true);
    }
    expect(MUSIC_URL.endsWith("/assets/audio/music.wav")).toBe(true);
  });

  it("resolves every one page-relative, never root-absolute", async () => {
    const source = new TextDecoder().decode(
      await readAsset(new URL("./assets.ts", import.meta.url).href),
    );
    const resolved = source.match(
      /new URL\(\s*"\.\.\/assets\/[a-z-]+\/[a-z-]+\.(?:glb|wav)",\s*import\.meta\.url,?\s*\)/g,
    );
    expect(resolved).toHaveLength(20);
    expect(source).not.toMatch(/"\/assets\//);
  });

  it("draws the models at one voxel unit in VOXELS_PER_UNIT", () => {
    expect(MODEL_SCALE).toBe(1 / VOXELS_PER_UNIT);
  });
});

describe("loading the committed files", () => {
  let assets: GantryAssets;

  beforeAll(async () => {
    assets = await loadAssets(readAsset);
  });

  it("resolves with every model, every cue, and the music bed", () => {
    expect(Object.keys(assets.models).sort()).toEqual([...MODEL_NAMES].sort());
    expect(Object.keys(assets.cues).sort()).toEqual([...CUES].sort());
    expect(assets.music.byteLength).toBeGreaterThan(0);
  });

  it("decodes each model to an indexed mesh with per-vertex colors", () => {
    for (const name of MODEL_NAMES) {
      const mesh = assets.models[name];
      const vertices = mesh.positions.length / 3;
      expect(vertices).toBeGreaterThan(0);
      expect(mesh.normals.length).toBe(mesh.positions.length);
      expect(mesh.colors.length).toBe(mesh.positions.length);
      expect(mesh.indices.length % 3).toBe(0);
      expect(mesh.indices.length).toBeGreaterThan(0);
      for (let i = 0; i < mesh.colors.length; i += 1) {
        expect(mesh.colors[i]).toBeGreaterThanOrEqual(0);
        expect(mesh.colors[i]).toBeLessThanOrEqual(1);
      }
      for (let i = 0; i < mesh.indices.length; i += 1) {
        expect(mesh.indices[i]).toBeLessThan(vertices);
      }
    }
  });

  it("has the three load models filling their class boxes", () => {
    for (const cls of ["crate", "container", "drum"] as const) {
      const box = LOAD_CLASS_DIMENSIONS[cls];
      const [x, y, z] = worldExtent(assets.models[cls]);
      expect(x).toBeCloseTo(box.x, 0);
      expect(y).toBeCloseTo(box.y, 0);
      expect(z).toBeCloseTo(box.z, 0);
      expect(x).toBeGreaterThan(box.x - 0.25);
      expect(y).toBeGreaterThan(box.y - 0.25);
      expect(z).toBeGreaterThan(box.z - 0.25);
    }
  });

  it("has each part model about the size specs/assets.md intends", () => {
    // The specification calls these figures the intent, not a tolerance, so
    // they are checked loosely: a part a long way off would be the wrong part.
    const intended: Record<string, [number, number, number]> = {
      ring: [2.5, 2, 2.5],
      trolley: [1.5, 1, 1.5],
      hook: [0.6, 1, 0.6],
      counterweight: [1.5, 1.5, 1.5],
      mount: [1.5, 0.75, 1.5],
    };
    for (const [name, size] of Object.entries(intended)) {
      const measured = worldExtent(assets.models[name as ModelName]);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(Math.abs(measured[axis] - size[axis])).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it("hands every sound on as the WAV bytes the bus decodes", () => {
    for (const cue of CUES) {
      expect(checkWav(cue, assets.cues[cue])).toBe(assets.cues[cue]);
      expect(assets.cues[cue].byteLength).toBeGreaterThan(44);
    }
    expect(checkWav("music", assets.music)).toBe(assets.music);
  });
});

describe("a file that is missing or wrong", () => {
  it("rejects when one file cannot be got, naming it", async () => {
    const load = async (url: string): Promise<ArrayBuffer> => {
      if (url === CUE_URLS.creak) throw new Error("404");
      return readAsset(url);
    };
    await expect(loadAssets(load)).rejects.toThrow("404");
  });

  it("rejects a model that is not a glb, naming the model", async () => {
    await expect(
      loadAssets(serving(MODEL_URLS.hook, rubbish())),
    ).rejects.toThrow("hook.glb is not a readable glb");
  });

  it("rejects a glb that carries no mesh", async () => {
    await expect(
      loadAssets(
        serving(MODEL_URLS.drum, glbOf({ asset: { version: "2.0" } })),
      ),
    ).rejects.toThrow("drum.glb carries no usable mesh");
  });

  it("rejects a mesh whose attributes do not agree", () => {
    expect(() => decodeModel("crate", glbWithPositionsOnly())).toThrow(
      "crate.glb carries no usable mesh",
    );
    expect(() => decodeModel("crate", glbOf({}))).toThrow(
      "crate.glb carries no usable mesh",
    );
  });

  it("rejects a sound that is not a WAV, naming the cue", async () => {
    await expect(
      loadAssets(serving(CUE_URLS.collapse, rubbish())),
    ).rejects.toThrow("collapse.wav is not a WAV file");
  });

  it("rejects a music bed that is not a WAV", async () => {
    await expect(loadAssets(serving(MUSIC_URL, rubbish()))).rejects.toThrow(
      "music.wav is not a WAV file",
    );
  });

  it("rejects a WAV header that is truncated", () => {
    expect(() => checkWav("place", new ArrayBuffer(8))).toThrow(
      "place.wav is not a WAV file",
    );
  });
});

describe("the default loader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches every file from the URL the bundler emitted", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return { ok: true, status: 200, arrayBuffer: () => readAsset(url) };
    });
    const assets = await loadAssets();
    expect(Object.keys(assets.models)).toHaveLength(8);
    expect(asked).toHaveLength(20);
    expect(asked).toContain(MODEL_URLS.ring);
    expect(asked).toContain(CUE_URLS.motor);
    expect(asked).toContain(MUSIC_URL);
  });

  it("rejects a response that is not ok, with its status", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    await expect(loadAssets()).rejects.toThrow("(404)");
  });

  it("rejects when the fetch itself fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await expect(loadAssets()).rejects.toThrow("could not load");
  });
});

describe("building the geometry the scene draws", () => {
  it("wraps each mesh into one geometry with colors, in world units", async () => {
    const assets = await loadAssets(readAsset);
    const geometries = buildModelGeometries(assets.models);
    expect(Object.keys(geometries).sort()).toEqual([...MODEL_NAMES].sort());
    for (const name of MODEL_NAMES) {
      const mesh = assets.models[name];
      const geometry = geometries[name];
      const position = geometry.getAttribute("position");
      expect(position.itemSize).toBe(3);
      expect(position.count).toBe(mesh.positions.length / 3);
      expect(geometry.getAttribute("normal").count).toBe(position.count);
      expect(geometry.getAttribute("color").itemSize).toBe(3);
      expect(geometry.getIndex()?.count).toBe(mesh.indices.length);

      const box = geometry.boundingBox;
      expect(box).not.toBeNull();
      const size = worldExtent(mesh);
      expect(box!.max.x - box!.min.x).toBeCloseTo(size[0], 5);
      expect(box!.max.y - box!.min.y).toBeCloseTo(size[1], 5);
      expect(box!.max.z - box!.min.z).toBeCloseTo(size[2], 5);
    }
  });

  it("leaves the decoded meshes untouched", async () => {
    const assets = await loadAssets(readAsset);
    const before = Array.from(assets.models.mount.positions);
    buildModelGeometries(assets.models);
    expect(Array.from(assets.models.mount.positions)).toEqual(before);
  });
});
