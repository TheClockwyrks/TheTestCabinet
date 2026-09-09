// Serving a build's own produced files to an engine's loader.
//
// The tree under `test/host/root/` is laid out as a build's workspace is: the
// committed files at the root, and a `public/` and a `dist/` beside them carrying
// a file of the SAME path with different contents. That is the whole point of the
// fixture — the root ORDER is what decides which of the three answers, the four
// harnesses this was extracted from disagreed about it, and a check that read the
// wrong one would read a build's staged copy for its committed one and never say
// so.
//
// Every check here installs onto `globalThis` and every check gives it back, in
// an `afterEach` that runs whatever the check did: a leaked shim would be read by
// the NEXT spec file this worker runs, against a fixture site it knows nothing
// about.

import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

import {
  DEFAULT_ASSET_ROOTS,
  installAssetHost,
  resolveAsset,
  standingAssetHost,
  type AssetHost,
} from "../src/engine/assets";

/** The workspace the fixture tree stands in for. */
const WORKSPACE = fileURLToPath(new URL("./host/root", import.meta.url));

/** The globals, as this file may read and write them. */
const bag = globalThis as unknown as Record<string, unknown>;

/** Every host a check installed, taken down however the check ended. */
const opened: AssetHost[] = [];

/** What the process's `fetch` was before a check replaced it by hand. */
let heldFetch: typeof globalThis.fetch | undefined;

/** The platform's own `structuredClone`, before any host stood over it. */
const nativeClone = globalThis.structuredClone;

afterEach(() => {
  for (const host of opened.reverse()) host.uninstall();
  opened.length = 0;
  if (heldFetch !== undefined) {
    globalThis.fetch = heldFetch;
    heldFetch = undefined;
  }
});

/** Install, and see it taken down whatever the check does. */
function open(options: Parameters<typeof installAssetHost>[0]): AssetHost {
  const host = installAssetHost(options);
  opened.push(host);
  return host;
}

/** Stand a countable `fetch` in for the platform's, so nothing reaches a network. */
function stubUpstream(): { calls: string[] } {
  const calls: string[] = [];
  heldFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    calls.push(typeof input === "string" ? input : String(input));
    return new Response("upstream", { status: 200 });
  }) as typeof globalThis.fetch;
  return { calls };
}

/* -------------------------------------------------------------------------- */
/* The root order, which is the whole reason it is a config value             */
/* -------------------------------------------------------------------------- */

it("serves the file the FIRST root that carries it holds", async () => {
  open({ workspaceRoot: WORKSPACE, roots: [".", "public", "dist"] });
  expect(await (await fetch("pick.txt")).text()).toBe("root\n");
});

it("serves a different file for a different order, over the same tree", async () => {
  const first = open({
    workspaceRoot: WORKSPACE,
    roots: ["public", "dist", "."],
  });
  expect(await (await fetch("pick.txt")).text()).toBe("public\n");
  first.uninstall();

  open({ workspaceRoot: WORKSPACE, roots: ["dist", "."] });
  expect(await (await fetch("pick.txt")).text()).toBe("dist\n");
});

it("defaults to the committed tree first, and says so as a value", async () => {
  expect(DEFAULT_ASSET_ROOTS).toEqual([".", "public", "dist"]);
  open({ workspaceRoot: WORKSPACE });
  expect(await (await fetch("pick.txt")).text()).toBe("root\n");
});

it('reads `""` and `"."` as the same root', () => {
  expect(resolveAsset("pick.txt", WORKSPACE, [""])).toEqual(
    resolveAsset("pick.txt", WORKSPACE, ["."]),
  );
});

it("falls through the roots in order until one carries the path", () => {
  // Only `dist/` and `public/` carry `pick.txt` here, so the first two roots miss.
  const resolved = resolveAsset("pick.txt", WORKSPACE, [
    "assets",
    "public",
    ".",
  ]);
  expect(resolved.kind).toBe("served");
  expect(resolved.kind === "served" && resolved.file).toMatch(
    /public[/\\]pick\.txt$/,
  );
});

/* -------------------------------------------------------------------------- */
/* Which URLs are the shim's, and which are not                               */
/* -------------------------------------------------------------------------- */

it("hands anything carrying a scheme to the platform, untouched", async () => {
  const upstream = stubUpstream();
  const host = open({ workspaceRoot: WORKSPACE });
  const answer = await fetch("https://example.invalid/pick.txt");
  expect(await answer.text()).toBe("upstream");
  expect(upstream.calls).toEqual(["https://example.invalid/pick.txt"]);
  expect(host.requests()[0]).toMatchObject({ offOrigin: true, status: 0 });
});

it("drops a query and a fragment, because the file on disk carries neither", async () => {
  open({ workspaceRoot: WORKSPACE });
  expect(await (await fetch("pick.txt?v=2")).text()).toBe("root\n");
  expect(await (await fetch("./pick.txt#top")).text()).toBe("root\n");
});

it("reads a root-relative URL as one under the workspace", async () => {
  open({ workspaceRoot: WORKSPACE });
  expect(await (await fetch("/pick.txt")).text()).toBe("root\n");
});

it("404s a relative URL no root carries, as a served page would", async () => {
  const host = open({ workspaceRoot: WORKSPACE });
  const answer = await fetch("assets/nothing-here.png");
  expect(answer.status).toBe(404);
  expect(answer.ok).toBe(false);
  expect(host.requests().at(-1)).toMatchObject({ status: 404, file: null });
});

it("hands a missing file to the platform instead, when a case asks for that", async () => {
  const upstream = stubUpstream();
  const host = open({ workspaceRoot: WORKSPACE, onMissing: "upstream" });
  expect(await (await fetch("assets/nothing-here.png")).text()).toBe(
    "upstream",
  );
  expect(upstream.calls).toEqual(["assets/nothing-here.png"]);
  expect(host.requests().at(-1)).toMatchObject({ status: 0, file: null });
});

it("refuses a URL that climbs out of the workspace, and reads nothing", async () => {
  const host = open({ workspaceRoot: WORKSPACE });
  const answer = await fetch("../../package.json");
  expect(answer.status).toBe(400);
  expect(host.requests().at(-1)).toMatchObject({ status: 400, file: null });
  expect(resolveAsset("a/../../out", WORKSPACE).kind).toBe("escaped");
});

it("serves only what is under the prefix a case named, and hands on the rest", async () => {
  const upstream = stubUpstream();
  open({ workspaceRoot: WORKSPACE, onlyUnder: "assets/" });
  expect((await fetch("assets/tone.wav")).status).toBe(200);
  // `pick.txt` really is there, and is still not this shim's to answer.
  expect(await (await fetch("pick.txt")).text()).toBe("upstream");
  expect(upstream.calls).toEqual(["pick.txt"]);
});

it("tests the prefix on the COLLAPSED path, so nothing climbs out from under it", () => {
  // Tested before the climb collapses, `assets/../pick.txt` begins with
  // `assets/` and would be served out of the project's own tree — which is the
  // one thing the prefix exists to stop.
  expect(
    resolveAsset("assets/../pick.txt", WORKSPACE, undefined, "assets/").kind,
  ).toBe("unclaimed");
  expect(
    resolveAsset("assets/tone.wav", WORKSPACE, undefined, "assets/").kind,
  ).toBe("served");
});

it("reads no file to answer where one is, and 404s one it cannot read", async () => {
  // THE RESOLVER STATS, IT DOES NOT READ. It is documented as one a case may ask
  // without installing anything, and proving a multi-megabyte model exists must
  // not read it — nor must serving it read it twice. A file that stats and does
  // not read separates the two: the resolver still says where it is, and the
  // shim, which does the one read, answers the build the same way it answers a
  // file that was never there.
  const at = `${WORKSPACE}/unreadable.bin`;
  writeFileSync(at, "secret");
  chmodSync(at, 0o000);
  try {
    expect(resolveAsset("unreadable.bin", WORKSPACE).kind).toBe("served");
    open({ workspaceRoot: WORKSPACE });
    expect((await fetch("unreadable.bin")).status).toBe(404);
  } finally {
    chmodSync(at, 0o600);
    rmSync(at);
  }
});

it("answers a path that names a directory as one no root carries", () => {
  expect(resolveAsset("public", WORKSPACE, ["."]).kind).toBe("missing");
});

it("throws, naming the case, when there is nothing to hand a URL on to", async () => {
  heldFetch = globalThis.fetch;
  // A host with no `fetch` at all, which is what a pre-18 Node is.
  delete (globalThis as { fetch?: unknown }).fetch;
  open({ workspaceRoot: WORKSPACE, onMissing: "upstream", label: "orrery" });
  await expect(fetch("assets/nothing-here.png")).rejects.toThrow(
    /orrery: nothing to fetch "assets\/nothing-here.png" with/,
  );
});

/* -------------------------------------------------------------------------- */
/* What a served body is                                                      */
/* -------------------------------------------------------------------------- */

it("answers a real Response, whose body may be read more than one way", async () => {
  open({ workspaceRoot: WORKSPACE });
  const answer = await fetch("assets/tone.wav");
  expect(answer.ok).toBe(true);
  expect(answer.status).toBe(200);
  const blob = await answer.blob();
  // The same Blob every time, which is what image attribution is keyed by — and
  // reading it consumes nothing, so the bytes are still there afterwards.
  expect(await answer.blob()).toBe(blob);
  const bytes = new Uint8Array(await answer.arrayBuffer());
  expect(bytes).toEqual(
    new Uint8Array(readFileSync(`${WORKSPACE}/assets/tone.wav`)),
  );
});

/* -------------------------------------------------------------------------- */
/* The log                                                                    */
/* -------------------------------------------------------------------------- */

it("records every request, in order, with what answered it", async () => {
  const host = open({ workspaceRoot: WORKSPACE });
  await fetch("pick.txt");
  await fetch("assets/nothing-here.png");
  expect(host.urls()).toEqual(["pick.txt", "assets/nothing-here.png"]);
  const [served, missing] = host.requests();
  expect(served).toMatchObject({ offOrigin: false, status: 200 });
  expect(served?.file).toMatch(/root[/\\]pick\.txt$/);
  expect(missing).toMatchObject({ status: 404, file: null });
});

it("lets a harness read its own build's traffic out of a per-worker log", async () => {
  const host = open({ workspaceRoot: WORKSPACE });
  await fetch("pick.txt");
  const mark = host.mark();
  await fetch("assets/tone.wav");
  expect(host.requestsSince(mark).map((entry) => entry.url)).toEqual([
    "assets/tone.wav",
  ]);
  host.clear();
  expect(host.requests()).toEqual([]);
  await fetch("pick.txt");
  expect(host.urls()).toEqual(["pick.txt"]);
});

it("reads the standing log without holding it, or answers that there is none", async () => {
  expect(standingAssetHost()).toBeNull();
  const host = open({ workspaceRoot: WORKSPACE });
  await fetch("pick.txt");
  const reading = standingAssetHost();
  expect(reading?.urls()).toEqual(["pick.txt"]);
  // Reading through it may neither pull the shims out from under the harness nor
  // empty the traffic record that harness is about to read.
  reading?.uninstall();
  reading?.clear();
  expect(standingAssetHost()).not.toBeNull();
  expect(host.urls()).toEqual(["pick.txt"]);
  host.uninstall();
  expect(standingAssetHost()).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* The image shims                                                            */
/* -------------------------------------------------------------------------- */

it("decodes a produced image, and remembers which file it came from", async () => {
  const host = open({ workspaceRoot: WORKSPACE, images: true });
  const answer = await fetch("assets/swatch.png");
  const decoded = (await createImageBitmap(await answer.blob())) as unknown as {
    width: number;
    height: number;
  };
  expect(decoded.width).toBe(3);
  expect(decoded.height).toBe(2);
  expect(host.sourceOf(decoded)).toBe("assets/swatch.png");
  // Something the build painted itself was never fetched and names no source.
  expect(host.sourceOf({})).toBeNull();
});

it("names the decoded image type as `ImageBitmap`, or leaves the name alone", () => {
  const named = open({ workspaceRoot: WORKSPACE, images: true });
  expect(bag.ImageBitmap).toBeDefined();
  named.uninstall();
  expect("ImageBitmap" in bag).toBe(false);

  open({ workspaceRoot: WORKSPACE, images: true, nameImageBitmap: false });
  expect("ImageBitmap" in bag).toBe(false);
  expect(typeof bag.createImageBitmap).toBe("function");
});

it("shims neither image member unless a case asks for them", () => {
  open({ workspaceRoot: WORKSPACE });
  expect("createImageBitmap" in bag).toBe(false);
  expect("ImageBitmap" in bag).toBe(false);
  expect(globalThis.structuredClone).toBe(nativeClone);
});

it("carries a decoded image through `structuredClone`, as a browser does", async () => {
  // Unnamed on purpose: a build clones its state whether or not the type is.
  const host = open({
    workspaceRoot: WORKSPACE,
    images: true,
    nameImageBitmap: false,
  });
  const sprite = (await createImageBitmap(
    await (await fetch("assets/swatch.png")).blob(),
  )) as unknown as { width: number };
  // The platform's own clone refuses the library's image, which is the whole
  // reason the shim stands.
  expect(() => nativeClone({ sprite })).toThrow(/could not be cloned/);

  const state = {
    sprites: { swatch: [sprite, sprite] },
    nodes: [{ c: 1, r: 2 }],
    kinds: new Map([["swatch", sprite]]),
    seen: new Set([sprite]),
  };
  const cloned = structuredClone(state);
  expect(cloned).not.toBe(state);
  expect(cloned.nodes).toEqual([{ c: 1, r: 2 }]);
  expect(cloned.nodes).not.toBe(state.nodes);
  // By reference, so the copy is still the decoded picture and still names its
  // source.
  expect(cloned.sprites.swatch[0]).toBe(sprite);
  expect(cloned.sprites.swatch[1]).toBe(sprite);
  expect(cloned.kinds.get("swatch")).toBe(sprite);
  expect(cloned.seen.has(sprite)).toBe(true);
  const [carried] = cloned.sprites.swatch;
  expect(carried?.width).toBe(3);
  expect(host.sourceOf(carried ?? {})).toBe("assets/swatch.png");
});

it("clones everything else exactly as the platform does", async () => {
  open({ workspaceRoot: WORKSPACE, images: true });
  const sprite = await createImageBitmap(
    await (await fetch("assets/swatch.png")).blob(),
  );
  class Foe {
    constructor(readonly kind: string) {}
  }
  const shared = { hit: false };
  const cyclic: { back: unknown; sprite: ImageBitmap } = {
    back: null,
    sprite,
  };
  cyclic.back = cyclic;
  const state = {
    when: new Date(0),
    a: shared,
    b: shared,
    foe: new Foe("glitch"),
    cyclic,
    bytes: new Uint8Array([1, 2, 3]),
  };
  const cloned = structuredClone(state);
  expect(cloned.when).toBeInstanceOf(Date);
  expect(cloned.when.getTime()).toBe(0);
  expect(cloned.a).toBe(cloned.b);
  expect(cloned.a).not.toBe(shared);
  expect(cloned.foe).toEqual({ kind: "glitch" });
  expect(Object.getPrototypeOf(cloned.foe)).toBe(Object.prototype);
  expect(cloned.cyclic.back).toBe(cloned.cyclic);
  expect(cloned.cyclic.sprite).toBe(sprite);
  expect(cloned.bytes).toEqual(new Uint8Array([1, 2, 3]));
  // A value the platform refuses is still refused, by the platform.
  expect(() => structuredClone({ f: () => 1 })).toThrow(/could not be cloned/);
  expect(structuredClone(7)).toBe(7);
  expect(structuredClone(null)).toBeNull();
});

it("hands what it does not rebuild to the platform, image or no image", async () => {
  // Every case below carries an image, so the value IS rebuilt around it — which
  // is where a walk that flattened whatever it did not recognise would answer
  // for the platform instead of asking it.
  open({ workspaceRoot: WORKSPACE, images: true });
  const sprite = await createImageBitmap(
    await (await fetch("assets/swatch.png")).blob(),
  );

  // Refused by the platform, with the platform's own error.
  const refusal = (value: unknown): string => {
    try {
      structuredClone(value);
      return "cloned";
    } catch (error) {
      return (error as Error).name;
    }
  };
  expect(refusal({ sprite, weak: new WeakMap() })).toBe("DataCloneError");
  expect(refusal({ sprite, later: Promise.resolve(1) })).toBe("DataCloneError");
  expect(refusal({ sprite, where: new URL("http://x/") })).toBe(
    "DataCloneError",
  );

  // Encoded whole by the platform, and back as what it was.
  const blob = new Blob(["hi"], { type: "text/plain" });
  const withBlob = structuredClone({
    sprite,
    blob,
    view: new DataView(new ArrayBuffer(2)),
  });
  expect(withBlob.sprite).toBe(sprite);
  expect(withBlob.blob).toBeInstanceOf(Blob);
  expect(withBlob.blob).not.toBe(blob);
  expect(withBlob.blob.type).toBe("text/plain");
  expect(await withBlob.blob.text()).toBe("hi");
  expect(withBlob.view).toBeInstanceOf(DataView);
  expect(withBlob.view.byteLength).toBe(2);

  // An array's holes and named properties are the platform's to keep, so the
  // rebuild keeps them.
  const sparse = [sprite, , 3] as unknown[] & { named?: unknown };
  sparse.named = { sprite };
  const cloned = structuredClone({ sparse });
  expect(cloned.sparse.length).toBe(3);
  expect(1 in cloned.sparse).toBe(false);
  expect(cloned.sparse[0]).toBe(sprite);
  expect(cloned.sparse[2]).toBe(3);
  expect((cloned.sparse.named as { sprite: unknown }).sprite).toBe(sprite);

  // A null-prototype object is walked like a plain one and comes back plain,
  // and a symbol-keyed property is dropped, which is what the platform does.
  const bare = Object.create(null) as { sprite: ImageBitmap };
  bare.sprite = sprite;
  const hidden = Symbol("hidden");
  const withBare = structuredClone({ bare, [hidden]: sprite, shown: 1 });
  expect(Object.getPrototypeOf(withBare.bare)).toBe(Object.prototype);
  expect(withBare.bare.sprite).toBe(sprite);
  expect(Object.getOwnPropertySymbols(withBare)).toEqual([]);
  expect(withBare.shown).toBe(1);
});

/* -------------------------------------------------------------------------- */
/* The document shim                                                          */
/* -------------------------------------------------------------------------- */

it("hands out a scratch canvas, and nothing else of a document", () => {
  open({ workspaceRoot: WORKSPACE, documentElement: true, label: "orrery" });
  const documented = bag.document as {
    createElement(tag: string): {
      width: number;
      getContext(id: string): unknown;
    };
  };
  const canvas = documented.createElement("CANVAS");
  expect(canvas.width).toBe(1);
  expect(canvas.getContext("2d")).toBeTruthy();
  expect(() => documented.createElement("div")).toThrow(
    /orrery: this process has no document element "div"/,
  );
});

it("shims no document unless a case asks for one", () => {
  open({ workspaceRoot: WORKSPACE });
  expect("document" in bag).toBe(false);
});

/* -------------------------------------------------------------------------- */
/* Installing twice, and taking it down                                       */
/* -------------------------------------------------------------------------- */

it("puts every global back exactly as it found it", () => {
  const before = globalThis.fetch;
  const host = open({
    workspaceRoot: WORKSPACE,
    images: true,
    documentElement: true,
  });
  expect(globalThis.fetch).not.toBe(before);
  host.uninstall();
  expect(globalThis.fetch).toBe(before);
  expect("createImageBitmap" in bag).toBe(false);
  expect("ImageBitmap" in bag).toBe(false);
  expect(globalThis.structuredClone).toBe(nativeClone);
  expect("document" in bag).toBe(false);
  // Idempotent, so an `afterEach` that also ran in an `afterAll` is harmless.
  host.uninstall();
  expect(globalThis.fetch).toBe(before);
});

it("joins the standing install rather than standing up a second", async () => {
  const first = open({ workspaceRoot: WORKSPACE });
  const shimmed = globalThis.fetch;
  const second = open({ workspaceRoot: WORKSPACE });
  expect(globalThis.fetch).toBe(shimmed);
  // One log, shared: the shims are one installation and the traffic is one stream.
  await fetch("pick.txt");
  expect(second.requests()).toBe(first.requests());
});

it("counts its holders, so one harness's teardown never strands another", async () => {
  const before = globalThis.fetch;
  const first = open({ workspaceRoot: WORKSPACE });
  const second = open({ workspaceRoot: WORKSPACE });

  first.uninstall();
  expect(globalThis.fetch).not.toBe(before);
  expect(await (await fetch("pick.txt")).text()).toBe("root\n");

  second.uninstall();
  expect(globalThis.fetch).toBe(before);
});

it("installs afresh once the last holder has gone", async () => {
  const first = open({ workspaceRoot: WORKSPACE, roots: ["."] });
  first.uninstall();
  open({ workspaceRoot: WORKSPACE, roots: ["public"] });
  expect(await (await fetch("pick.txt")).text()).toBe("public\n");
});

it("refuses a second install that would serve a different tree", () => {
  open({ workspaceRoot: WORKSPACE, roots: [".", "public"] });
  expect(() =>
    installAssetHost({ workspaceRoot: WORKSPACE, roots: ["public", "."] }),
  ).toThrow(/already installed .* roots \["\.","public"\]/);
  expect(() =>
    installAssetHost({
      workspaceRoot: `${WORKSPACE}/public`,
      roots: [".", "public"],
    }),
  ).toThrow(/already installed .* workspaceRoot/);
  expect(() =>
    installAssetHost({
      workspaceRoot: WORKSPACE,
      roots: [".", "public"],
      onMissing: "upstream",
    }),
  ).toThrow(
    /already installed .* onMissing "404", this call asks for "upstream"/,
  );
});

it("lets a second install that says the same thing through, label and all", () => {
  open({ workspaceRoot: WORKSPACE, roots: ["."], label: "orrery" });
  expect(() =>
    open({ workspaceRoot: WORKSPACE, roots: ["."], label: "volute" }),
  ).not.toThrow();
});
