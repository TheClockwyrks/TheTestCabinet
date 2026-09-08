// The shared image store: what a run's captured images are named by, what is
// written once for the whole run, and what happens when writing is not available.
//
// Driven over a real directory rather than a mocked filesystem, because every
// property this store has is a property of the filesystem it uses: a name that is
// the content is only useful if two writers land on the same one, and a rename is
// only atomic if it is a rename. What is faked is the media directory itself —
// `openImageStore` takes one for exactly this suite, so a test never has to reach
// into `process.env` and leave it changed for the file that runs next.

import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  IMAGE_STORE_PREFIX,
  openImageStore,
  RUN_IMAGE_BUDGET,
} from "../src/replay/store";
import { MEDIA_DIR_ENV } from "../src/media";
import { retable, thinReplay } from "../src/replay/retable";
import { replayBytes } from "../src/engine/replay";
import type { RecordedFrame, Recording } from "../src/replay/format";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "tcab-image-store-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  delete process.env[MEDIA_DIR_ENV];
});

/** A bitmap entry carrying `bytes` as the PNG data URL a recorder produces. */
function bitmap(bytes: number[], width = 2, height = 2): unknown {
  return {
    kind: "bitmap",
    width,
    height,
    src: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

/** A pixel-buffer entry carrying `bytes` as the base64 RGBA a recorder produces. */
function pixels(bytes: number[], width = 1, height = 1): unknown {
  return {
    kind: "pixels",
    width,
    height,
    data: Buffer.from(bytes).toString("base64"),
  };
}

/** The store files in the directory, sorted. */
function stored(): string[] {
  return readdirSync(directory)
    .filter((file) => file.startsWith(IMAGE_STORE_PREFIX))
    .sort();
}

/** A recording of one frame drawing each of `images` once. */
function drawing(images: unknown[]): Recording {
  const frame: RecordedFrame = {
    count: 1,
    timeMs: 16,
    deltaMs: 16,
    surface: { width: 20, height: 10 },
    state: 0,
    stack: [],
    ops: images.map((_unused, i) => i),
  };
  return {
    format: 1,
    width: 20,
    height: 10,
    background: null,
    images,
    resources: [],
    ops: images.map((_unused, i) => ({
      op: "call" as const,
      method: "drawImage",
      args: [{ $img: i }, 0, 0],
    })),
    states: [
      { properties: {}, transform: null, lineDash: null, clip: [], path: [] },
    ],
    frames: [frame],
  };
}

it("names a file for the bytes inside it, and by kind and size as well", () => {
  const store = openImageStore({ directory })!;

  const written = store.put(bitmap([1, 2, 3, 4]))!;

  // Kind and dimensions are inside the hash so that a name means one image
  // whatever the store comes to hold: a payload with no header of its own — a bare
  // RGBA run, say — would otherwise let two differently shaped images of the same
  // length share a name.
  const digest = createHash("sha256")
    .update("bitmap|2x2|", "utf8")
    .update(Buffer.from([1, 2, 3, 4]))
    .digest("hex")
    .slice(0, 32);
  expect(written).toEqual({
    kind: "bitmap",
    width: 2,
    height: 2,
    store: `${IMAGE_STORE_PREFIX}${digest}.png`,
  });
  // The name is a single path segment carrying no `__`, so it can never collide
  // with a declared output — those are always `<verdict>__<output>.<ext>` — and it
  // routes through the flat-name validation-file route with nothing added.
  expect(written.store).not.toContain("/");
  expect(written.store).not.toContain("__");
  expect(readFileSync(join(directory, written.store))).toEqual(
    Buffer.from([1, 2, 3, 4]),
  );
});

it("writes a bitmap as the PNG bytes themselves, not as the text that carried them", () => {
  const store = openImageStore({ directory })!;

  const image = store.put(bitmap([9, 9, 9]))!;

  expect(image.store.endsWith(".png")).toBe(true);
  // Neither base64 nor gzipped a second time: a PNG is already compressed, and
  // base64 was only ever the cost of carrying it inside a JSON document.
  expect(readFileSync(join(directory, image.store))).toEqual(
    Buffer.from([9, 9, 9]),
  );
});

it("leaves a pixel buffer inline, where the recording's own gzip is already at work", () => {
  const store = openImageStore({ directory })!;
  const buffer = pixels([1, 2, 3, 255]);

  // NOT a limit of the format — the player resolves a stored entry of either kind.
  // It is arithmetic: raw RGBA is the most compressible payload a recording
  // carries, so a flat framebuffer that gzips to a few kilobytes inside the
  // recording would be written out as most of a megabyte, served uncompressed, and
  // charged against the run's budget at that rate. There is no duplication to win
  // back either, since a pixel buffer is captured afresh at every use.
  expect(store.put(buffer)).toBeNull();
  expect(thinReplay(drawing([buffer]), store).images[0]).toEqual(buffer);
  expect(stored()).toEqual([]);
});

it("writes one file for an image put again, by the same store and by another", () => {
  const first = openImageStore({ directory })!;
  const again = openImageStore({ directory })!;

  const a = first.put(bitmap([7, 7, 7]))!;
  const b = first.put(bitmap([7, 7, 7]))!;
  // A second store is the second vitest worker: it opened over the same directory
  // and has never seen the first one's writes in memory. Content addressing is
  // what makes the two agree without anything shared between them.
  const c = again.put(bitmap([7, 7, 7]))!;

  expect(b.store).toBe(a.store);
  expect(c.store).toBe(a.store);
  expect(stored()).toHaveLength(1);
});

it("leaves nothing behind but the store files it wrote", () => {
  const store = openImageStore({ directory })!;

  store.put(bitmap([1]));
  store.put(bitmap([2, 3, 4, 5]));

  // The temporary a write lands under before its rename must not survive, and if
  // one ever does it must not be named such that the driver's mirror or the
  // backend's snapshot would carry it.
  const all = readdirSync(directory);
  expect(all).toHaveLength(2);
  for (const file of all)
    expect(file.startsWith(IMAGE_STORE_PREFIX)).toBe(true);
});

it("refuses an entry whose payload it cannot decode, and writes nothing for it", () => {
  const store = openImageStore({ directory })!;

  // A bitmap that names a remote URL has no bytes here to address by, and an
  // entry of an unknown kind is not something this can name at all.
  expect(
    store.put({ kind: "bitmap", width: 1, height: 1, src: "/sprite.png" }),
  ).toBeNull();
  expect(
    store.put({ kind: "canvas", width: 1, height: 1, src: "x" }),
  ).toBeNull();
  expect(store.put({ kind: "pixels", width: 1, height: 1 })).toBeNull();
  expect(store.put(null)).toBeNull();
  expect(stored()).toEqual([]);
});

it("answers nothing at all when no run is collecting media", () => {
  delete process.env[MEDIA_DIR_ENV];

  // `null` means "inline everything", which is what a suite driven from a shell
  // gets and what keeps a hand-written showcase recording from acquiring
  // references to files nobody will publish.
  expect(openImageStore()).toBeNull();
  process.env[MEDIA_DIR_ENV] = "";
  expect(openImageStore()).toBeNull();
});

it("takes the run's media directory from the environment", () => {
  process.env[MEDIA_DIR_ENV] = directory;

  const store = openImageStore();

  expect(store).not.toBeNull();
  expect(store!.put(bitmap([4, 5]))).not.toBeNull();
  expect(stored()).toHaveLength(1);
});

it("counts what the run has already spent, so a late worker sees the early ones", () => {
  const early = openImageStore({ directory, budgetBytes: 8 })!;
  expect(early.put(bitmap([1, 2, 3, 4, 5, 6, 7, 8]))).not.toBeNull();

  // The second worker opens over a directory that is already at the ceiling. It
  // has no shared counter to consult; reading the directory on opening is how it
  // learns. The budget is approximate across workers exactly because each one only
  // reads it once — but a worker that starts after another has finished is exact.
  const late = openImageStore({ directory, budgetBytes: 8 })!;
  expect(late.put(bitmap([9, 9, 9, 9]))).toBeNull();
  expect(stored()).toHaveLength(1);
});

it("still resolves what it holds after the budget is spent", () => {
  const store = openImageStore({ directory, budgetBytes: 4 })!;
  const held = store.put(bitmap([1, 2, 3, 4]))!;

  // Past the ceiling a NEW image is refused and an image already stored is still
  // named, which is what makes running out degrade a run partially rather than
  // all at once: the images captured before the line are still drawn.
  expect(store.put(bitmap([5, 6, 7, 8]))).toBeNull();
  expect(store.put(bitmap([1, 2, 3, 4]))).toEqual(held);
});

it("the run budget is a ceiling on the whole run's images", () => {
  // Stated so the number moves in one place and a reader of the test knows the
  // suite is not asserting some smaller number of its own.
  expect(RUN_IMAGE_BUDGET).toBe(256 * 1024 * 1024);
});

it("writes an image once for a recording that draws it many times", () => {
  const store = openImageStore({ directory })!;
  const sprite = bitmap([3, 1, 4, 1, 5]);
  const recording = drawing([sprite, sprite, sprite]);

  const written = retable(recording, recording.frames, store);

  expect(written.images).toHaveLength(1);
  expect(stored()).toHaveLength(1);
  const entry = written.images[0] as { store?: string; src?: string };
  expect(entry.src).toBeUndefined();
  expect(entry.store).toBe(stored()[0]);
});

it("writes an image once for a run whose recordings each draw it", () => {
  const sprite = bitmap([2, 7, 1, 8]);

  // One store per recording, as the write path opens one: the file is written by
  // the first recording that names it and referenced by every one after.
  const first = thinReplay(drawing([sprite]), openImageStore({ directory }));
  const second = thinReplay(drawing([sprite]), openImageStore({ directory }));

  expect(stored()).toHaveLength(1);
  expect(first.images).toEqual(second.images);
  expect((first.images[0] as { store: string }).store).toBe(stored()[0]);
});

it("keeps an entry inline when there is no store, and when the store refuses it", () => {
  const remote = { kind: "bitmap", width: 1, height: 1, src: "/sprite.png" };

  // No store at all: the shape a recording written outside a run has always had.
  const inline = thinReplay(drawing([bitmap([1, 2])]), null);
  expect(inline.images[0]).toEqual(bitmap([1, 2]));

  // A store that refused: the caller keeps what it was handed, so a store that is
  // not working costs the run bytes and never a recording.
  const refused = thinReplay(drawing([remote]), openImageStore({ directory })!);
  expect(refused.images[0]).toEqual(remote);
  expect(stored()).toEqual([]);
});

it("a run past its ceiling keeps the rest of its images inline, and draws them all", () => {
  const store = openImageStore({ directory, budgetBytes: 4 })!;
  const carried = bitmap([1, 2, 3, 4]);
  const past = bitmap([5, 6, 7, 8, 9, 10, 11, 12]);
  const recording = drawing([carried, past]);

  const written = retable(recording, recording.frames, store);

  // The ceiling bounds the SHARED DIRECTORY, not the picture. An image past it is
  // written into the recording exactly as it was captured, which is what a
  // recording has always looked like — so running out costs the run the sharing
  // and never a frame a reviewer wanted to see.
  expect(stored()).toHaveLength(1);
  expect(written.images).toHaveLength(2);
  expect(written.images[0]).toEqual({
    kind: "bitmap",
    width: 2,
    height: 2,
    store: stored()[0],
  });
  expect(written.images[1]).toEqual(past);
  expect(
    written.ops.map((op) => (op.op === "call" ? op.args[0] : null)),
  ).toEqual([{ $img: 0 }, { $img: 1 }]);
});

it("an engine's replay is split the same way, on the same write path", () => {
  // A 2D engine's recorder produces INLINE entries and knows nothing about a
  // directory; the split happens in Node, on the way to disk, in the one place
  // both producers pass through. So an engine case and an engineless case share a
  // run's store without either engine growing a notion of one.
  process.env[MEDIA_DIR_ENV] = directory;
  const sprite = bitmap([1, 6, 1, 8, 0, 3]);

  const bytes = replayBytes(drawing([sprite]))!;

  const written = JSON.parse(gunzipSync(bytes).toString("utf8")) as Recording;
  expect(stored()).toHaveLength(1);
  expect(written.images).toEqual([
    { kind: "bitmap", width: 2, height: 2, store: stored()[0] },
  ]);
});
