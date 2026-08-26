import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  AssetLoader,
  decodedTexture,
  type AssetEventMap,
  type AssetLoaderOptions,
} from "./assets";

/**
 * The loader against fixtures constructed byte by byte, over a scripted
 * fetcher: the path rules, the six members' event-and-promise outcomes, the
 * material-folder semantics, and the boundedness claim. The *decoders'* own
 * corners (filters, color types, sample formats) belong to the png and wav
 * suites; here one well-formed and one malformed body per format is enough to
 * pin which loader decodes what and how a decode failure is announced.
 */

/** One announced attempt, as a test reads it back. */
type Announced =
  | { event: "asset:loaded"; payload: AssetEventMap["asset:loaded"] }
  | { event: "asset:failed"; payload: AssetEventMap["asset:failed"] };

/* -------------------------------------------------------------------------- */
/* Fixture builders                                                           */
/* -------------------------------------------------------------------------- */

/** One PNG chunk: big-endian length, ASCII type, data, and a zeroed CRC. */
function pngChunk(
  type: string,
  data: readonly number[] | Uint8Array,
): Uint8Array {
  const body = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

/** A small 8-bit RGBA PNG of the given pixels, one row. */
function png(width: number, rgba: readonly number[]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, 1);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = new Uint8Array(deflateSync(Uint8Array.from([0, ...rgba])));
  const chunks = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", []),
  ];
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A mono 16-bit integer PCM WAV of the given raw samples at 8 kHz. */
function wav(samples: readonly number[]): Uint8Array {
  const dataLength = samples.length * 2;
  const out = new Uint8Array(44 + dataLength);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) out[at + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // integer PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 16_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataLength, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return out;
}

/** A glTF binary: header, spec-padded JSON chunk, and an optional BIN chunk. */
function glb(json: object, bin?: Uint8Array): Uint8Array {
  const raw = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (raw.length % 4)) % 4;
  const jsonLength = raw.length + jsonPad;
  const binPad = bin === undefined ? 0 : (4 - (bin.length % 4)) % 4;
  const binLength = bin === undefined ? 0 : bin.length + binPad;
  const total = 12 + 8 + jsonLength + (bin === undefined ? 0 : 8 + binLength);

  const out = new Uint8Array(total).fill(0x20, 0, 12 + 8 + jsonLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(raw, 20);
  if (bin !== undefined) {
    const at = 20 + jsonLength;
    out.fill(0, at);
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
    out.set(bin, at + 8);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The scripted fetcher                                                       */
/* -------------------------------------------------------------------------- */

/** A response carrying `body`, readable every way the loader reads one. */
function respond(body: Uint8Array | string): Response {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  return {
    ok: true,
    status: 200,
    blob: () => Promise.resolve(new Blob([Uint8Array.from(bytes)])),
    text: () => Promise.resolve(new TextDecoder().decode(bytes)),
    arrayBuffer: () => {
      const copy = Uint8Array.from(bytes);
      return Promise.resolve(copy.buffer);
    },
  } as unknown as Response;
}

/** A response the server refused — reached, but not an asset. */
function missing(status = 404): Response {
  return {
    ok: false,
    status,
    blob: () => Promise.resolve(new Blob([])),
    text: () => Promise.resolve(""),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response;
}

/**
 * A loader over a scripted fetcher, plus the spy so requested URLs can be read
 * back and the list every announcement lands in.
 *
 * The recorder is the test's, not the loader's: the loader keeps nothing, so a
 * test that wants a history has to keep one itself — which is exactly the
 * position a driver is in.
 */
function loaderWith(
  response: (url: string) => Promise<Response>,
  options: Omit<AssetLoaderOptions, "fetch" | "emit"> = {},
) {
  const fetcher = vi.fn(response);
  const announced: Announced[] = [];
  const loader = new AssetLoader({
    ...options,
    fetch: fetcher,
    emit: (event, payload) => {
      announced.push({ event, payload } as Announced);
    },
  });
  return { loader, fetcher, announced };
}

/** A loader whose every fetch answers the same body. */
function loaderOf(body: Uint8Array | string) {
  return loaderWith(() => Promise.resolve(respond(body)));
}

/** A loader answering per URL from a table; an unlisted URL is a 404. */
function loaderServing(routes: Record<string, Uint8Array | string>) {
  return loaderWith((url) => {
    const body = routes[url];
    return Promise.resolve(body === undefined ? missing() : respond(body));
  });
}

/**
 * How much the loader is holding, counted without naming a field.
 *
 * The claim under test is that nothing here grows with the number of loads,
 * and the honest way to check it is to look at every own value the loader
 * carries and assert none of them is a collection with anything in it. (The
 * decoded payloads behind the handles live in module-level `WeakMap`s keyed by
 * handle identity, so they die with the handles a caller drops.)
 */
function retained(loader: AssetLoader): number {
  return Object.values(loader).reduce<number>((total, value) => {
    if (Array.isArray(value)) return total + value.length;
    if (value instanceof Map || value instanceof Set) return total + value.size;
    return total;
  }, 0);
}

describe("AssetLoader.resolve", () => {
  it("resolves a plain path under the default root", () => {
    expect(new AssetLoader().resolve("models/ship.glb")).toBe(
      "assets/models/ship.glb",
    );
  });

  it("takes a custom root, with or without its trailing slash", () => {
    expect(new AssetLoader({ root: "media" }).resolve("a.png")).toBe(
      "media/a.png",
    );
    expect(new AssetLoader({ root: "media/" }).resolve("a.png")).toBe(
      "media/a.png",
    );
  });

  it("leaves an empty root empty rather than making every path absolute", () => {
    expect(new AssetLoader({ root: "" }).resolve("a.png")).toBe("a.png");
  });

  it("refuses every way a path could name something outside the root", () => {
    const loader = new AssetLoader();
    for (const path of [
      "",
      "/etc/passwd",
      "//cdn.example.com/x.png",
      "../secret.png",
      "textures/../../secret.png",
      "https://cdn.example.com/x.png",
      "data:image/png;base64,AAAA",
      "blob:1234",
    ]) {
      expect(() => loader.resolve(path), path).toThrow();
    }
  });

  it("names why each refusal happened", () => {
    const loader = new AssetLoader();
    expect(() => loader.resolve("")).toThrow(/empty/);
    expect(() => loader.resolve("/a.png")).toThrow(/must not start with/);
    expect(() => loader.resolve("https://x/a.png")).toThrow(/absolute URL/);
    expect(() => loader.resolve("../a.png")).toThrow(/".." segment/);
  });

  it("does not mistake dots inside a name for an escape", () => {
    const loader = new AssetLoader();
    expect(loader.resolve("textures/hero..idle.png")).toBe(
      "assets/textures/hero..idle.png",
    );
    expect(loader.resolve("./ball.png")).toBe("assets/./ball.png");
  });

  it("announces nothing — resolving is URL arithmetic, not a load", () => {
    const { loader, announced, fetcher } = loaderOf("anything");

    loader.resolve("ball.png");
    expect(() => loader.resolve("../ball.png")).toThrow();

    expect(announced).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("AssetLoader.load", () => {
  it("fetches the resolved URL, returns the body, and announces the arrival", async () => {
    const body = new Blob(["level data"]);
    const { loader, fetcher, announced } = loaderWith(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(body),
      } as unknown as Response),
    );

    const blob = await loader.load("levels/one.json");

    expect(blob).toBe(body);
    expect(fetcher).toHaveBeenCalledWith("assets/levels/one.json");
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "levels/one.json", url: "assets/levels/one.json" },
      },
    ]);
  });

  it("resolves through the configured root", async () => {
    const { loader, fetcher } = loaderWith(
      () => Promise.resolve(respond("x")),
      { root: "build/media" },
    );

    await loader.load("a.bin");

    expect(fetcher).toHaveBeenCalledWith("build/media/a.bin");
  });

  it("announces exactly one event per call, in request order", async () => {
    const { loader, announced } = loaderOf("x");

    await loader.load("a.bin");
    await loader.load("b.bin");

    expect(announced.map((a) => [a.event, a.payload.path])).toEqual([
      ["asset:loaded", "a.bin"],
      ["asset:loaded", "b.bin"],
    ]);
  });
});

describe("AssetLoader.loadTexture", () => {
  it("decodes a PNG body to a handle carrying the documented plain fields", async () => {
    const { loader, announced } = loaderOf(
      png(2, [255, 0, 0, 255, 0, 255, 0, 128]),
    );

    const handle = await loader.loadTexture("textures/mark.png");

    expect(handle).toEqual({ path: "textures/mark.png", width: 2, height: 1 });
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "textures/mark.png", url: "assets/textures/mark.png" },
      },
    ]);
  });

  it("parks the decoded pixels behind the handle for the renderer", async () => {
    const { loader } = loaderOf(png(1, [10, 20, 30, 40]));

    const handle = await loader.loadTexture("t.png");

    expect(Array.from(decodedTexture(handle)?.pixels ?? [])).toEqual([
      10, 20, 30, 40,
    ]);
    // An object the loader did not produce has no pixels to offer.
    expect(decodedTexture({ path: "t.png", width: 1, height: 1 })).toBe(
      undefined,
    );
  });

  it("reports a body that arrived but is not a PNG, once", async () => {
    const { loader, announced } = loaderOf(
      new TextEncoder().encode("not a png"),
    );

    await expect(loader.loadTexture("t.png")).rejects.toThrow();

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
    expect(announced[0]?.payload.url).toBe("assets/t.png");
  });
});

describe("AssetLoader.loadAudio", () => {
  it("decodes a PCM WAV to an AudioBuffer-shaped value, with no context anywhere", async () => {
    const { loader, announced } = loaderOf(wav([0, 16_384, -32_768]));

    const decoded = await loader.loadAudio("audio/clip.wav");

    expect(decoded.sampleRate).toBe(8_000);
    expect(decoded.numberOfChannels).toBe(1);
    expect(decoded.duration).toBe(3 / 8_000);
    expect(Array.from(decoded.getChannelData(0))).toEqual([0, 0.5, -1]);
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "audio/clip.wav", url: "assets/audio/clip.wav" },
      },
    ]);
  });

  it("reports a body that arrived but is not a WAV, once", async () => {
    const { loader, announced } = loaderOf(
      new TextEncoder().encode("not audio"),
    );

    await expect(loader.loadAudio("clip.wav")).rejects.toThrow();

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
  });
});

describe("AssetLoader.loadMesh", () => {
  /** A one-node scene whose accessor declares its POSITION range. */
  const SHIP = {
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "hull", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [
      {
        componentType: 5126,
        count: 2,
        type: "VEC3",
        min: [-1, -2, -3],
        max: [1, 2, 3],
      },
    ],
    animations: [{ name: "spin" }, { name: "open" }],
  };

  it("decodes a glTF binary to a handle with bounds, nodes, and clips", async () => {
    const { loader, announced } = loaderOf(glb(SHIP));

    const handle = await loader.loadMesh("models/ship.glb");

    expect(handle.path).toBe("models/ship.glb");
    expect(handle.nodes).toEqual(["hull"]);
    expect(handle.clips).toEqual(["spin", "open"]);
    expect(handle.bounds).toEqual({
      min: { x: -1, y: -2, z: -3 },
      max: { x: 1, y: 2, z: 3 },
    });
    expect(announced.map((a) => a.event)).toEqual(["asset:loaded"]);
  });

  it("carries a node's transform into the bounds", async () => {
    const moved = {
      ...SHIP,
      nodes: [{ name: "hull", mesh: 0, translation: [10, 0, 0] }],
    };
    const { loader } = loaderOf(glb(moved));

    const handle = await loader.loadMesh("models/ship.glb");

    expect(handle.bounds).toEqual({
      min: { x: 9, y: -2, z: -3 },
      max: { x: 11, y: 2, z: 3 },
    });
  });

  it("computes the range from the binary chunk when min and max are absent", async () => {
    const positions = Float32Array.from([0, 0, 0, 2, 4, 6]);
    const computed = {
      ...SHIP,
      accessors: [
        { componentType: 5126, count: 2, type: "VEC3", bufferView: 0 },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 24 }],
    };
    const { loader } = loaderOf(
      glb(computed, new Uint8Array(positions.buffer)),
    );

    const handle = await loader.loadMesh("models/ship.glb");

    expect(handle.bounds).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 2, y: 4, z: 6 },
    });
  });

  it("rejects a body that is not a glTF binary, naming the defect", async () => {
    const { loader, announced } = loaderOf(
      new TextEncoder().encode("plain text, not glTF"),
    );

    await expect(loader.loadMesh("models/ship.glb")).rejects.toThrow(
      /not a glTF binary/,
    );

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
  });
});

describe("AssetLoader.loadMaterial", () => {
  const DOC_URL = "assets/materials/rust/material.json";

  it("loads the maps relative to the document's own directory, as one call and one event", async () => {
    const { loader, fetcher, announced } = loaderServing({
      [DOC_URL]: JSON.stringify({
        maps: { baseColor: "basecolor.png", roughness: "rough.png" },
      }),
      "assets/materials/rust/basecolor.png": png(
        2,
        [1, 2, 3, 255, 4, 5, 6, 255],
      ),
      "assets/materials/rust/rough.png": png(1, [128, 128, 128, 255]),
    });

    const handle = await loader.loadMaterial("materials/rust/material.json");

    expect(handle.path).toBe("materials/rust/material.json");
    expect(handle.maps.baseColor).toEqual({
      path: "materials/rust/basecolor.png",
      width: 2,
      height: 1,
    });
    expect(handle.maps.roughness).toEqual({
      path: "materials/rust/rough.png",
      width: 1,
      height: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    // The map fetches announce nothing of their own: a subscriber counts
    // materials, not textures, and the one event carries the document's pair.
    expect(announced).toEqual([
      {
        event: "asset:loaded",
        payload: { path: "materials/rust/material.json", url: DOC_URL },
      },
    ]);
  });

  it("reads the kebab-case array form the asset-generation tools write", async () => {
    const { loader } = loaderServing({
      [DOC_URL]: JSON.stringify({
        maps: [{ name: "base-color", path: "bc.png" }],
      }),
      "assets/materials/rust/bc.png": png(1, [9, 9, 9, 255]),
    });

    const handle = await loader.loadMaterial("materials/rust/material.json");

    expect(handle.maps.baseColor?.path).toBe("materials/rust/bc.png");
  });

  it("fails the whole load on a failing map, once, naming the map", async () => {
    const { loader, announced } = loaderServing({
      [DOC_URL]: JSON.stringify({
        maps: { baseColor: "basecolor.png", roughness: "gone.png" },
      }),
      "assets/materials/rust/basecolor.png": png(1, [1, 2, 3, 255]),
      // rough map unlisted: its fetch answers 404.
    });

    await expect(
      loader.loadMaterial("materials/rust/material.json"),
    ).rejects.toThrow(/404/);

    // Exactly one event — the double announcement is the regression this
    // guards — with the document's path and URL and the map named.
    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "materials/rust/material.json",
          url: DOC_URL,
          reason: expect.stringMatching(/map "roughness" \(gone\.png\)/),
        },
      },
    ]);
  });

  it("rejects a document with no maps field as missing its required fields", async () => {
    const { loader, announced } = loaderServing({ [DOC_URL]: "{}" });

    await expect(
      loader.loadMaterial("materials/rust/material.json"),
    ).rejects.toThrow(/required fields/);

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
  });

  it("refuses a map name outside the seven slots rather than dropping it", async () => {
    const { loader } = loaderServing({
      [DOC_URL]: JSON.stringify({ maps: { glossiness: "g.png" } }),
    });

    await expect(
      loader.loadMaterial("materials/rust/material.json"),
    ).rejects.toThrow(/unknown map "glossiness"/);
  });
});

describe("AssetLoader failures", () => {
  it("refuses an escaping path identically in every loader, announcing no URL", async () => {
    for (const call of [
      (l: AssetLoader) => l.load("../../etc/passwd"),
      (l: AssetLoader) => l.loadTexture("../../etc/passwd"),
      (l: AssetLoader) => l.loadAudio("../../etc/passwd"),
      (l: AssetLoader) => l.loadMesh("../../etc/passwd"),
      (l: AssetLoader) => l.loadMaterial("../../etc/passwd"),
    ]) {
      const { loader, fetcher, announced } = loaderOf("anything");

      await expect(call(loader)).rejects.toThrow(/escapes the asset root/);

      expect(fetcher).not.toHaveBeenCalled();
      expect(announced).toEqual([
        {
          event: "asset:failed",
          payload: {
            path: "../../etc/passwd",
            url: "",
            reason: expect.stringContaining("escapes the asset root"),
          },
        },
      ]);
    }
  });

  it("both announces and throws, so the game learns its mesh never arrived", async () => {
    const { loader, announced } = loaderWith(() => Promise.resolve(missing()));

    const rejection = await loader.load("ship.glb").then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect(announced).toHaveLength(1);
    expect(announced[0]?.payload.path).toBe("ship.glb");
  });

  it("names the status of a response the server refused", async () => {
    const { loader, announced } = loaderWith(() =>
      Promise.resolve(missing(503)),
    );

    await expect(loader.load("ship.glb")).rejects.toThrow(/503/);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "ship.glb",
          url: "assets/ship.glb",
          reason: expect.stringContaining("503"),
        },
      },
    ]);
  });

  it("rejects a network failure with the original error, announcing it once", async () => {
    const failure = new TypeError("Failed to fetch");
    const { loader, announced } = loaderWith(() => Promise.reject(failure));

    await expect(loader.load("ship.glb")).rejects.toBe(failure);

    expect(announced).toEqual([
      {
        event: "asset:failed",
        payload: {
          path: "ship.glb",
          url: "assets/ship.glb",
          reason: "Failed to fetch",
        },
      },
    ]);
  });

  it("does not call a load successful until the body has actually been read", async () => {
    const truncated = {
      ok: true,
      status: 200,
      blob: () => Promise.reject(new Error("stream closed")),
    } as unknown as Response;
    const { loader, announced } = loaderWith(() => Promise.resolve(truncated));

    await expect(loader.load("ship.glb")).rejects.toThrow(/stream closed/);

    expect(announced.map((a) => a.event)).toEqual(["asset:failed"]);
  });

  it("survives a thrown value that is not an Error", async () => {
    const { loader, announced } = loaderWith(() => Promise.reject("offline"));

    await expect(loader.load("ship.glb")).rejects.toBe("offline");

    expect(announced[0]?.event).toBe("asset:failed");
    expect(announced[0]).toMatchObject({ payload: { reason: "offline" } });
  });
});

describe("AssetLoader boundedness", () => {
  it("holds nothing that grows with the number of loads", async () => {
    let attempts = 0;
    const { loader, announced } = loaderWith(() => {
      attempts += 1;
      // Alternate the outcomes so a record of failures would grow just as a
      // record of successes would.
      return Promise.resolve(attempts % 2 === 0 ? missing() : respond("x"));
    });

    for (let i = 0; i < 200; i += 1) {
      await loader.load(`chunk-${i}.bin`).catch(() => undefined);
    }

    expect(announced).toHaveLength(200);
    expect(retained(loader)).toBe(0);
  });

  it("holds nothing after repeated loads of the same path either", async () => {
    const { loader } = loaderOf("x");

    for (let i = 0; i < 200; i += 1) {
      await loader.load("ship.glb");
    }

    expect(retained(loader)).toBe(0);
  });
});
