import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecordingCache,
  fetchRecording,
  parseRecording,
  RECORDING_FORMAT,
  type RecordedFrame,
} from "./format";

/**
 * Reading a file that claims to be an engine recording.
 *
 * What is checked here is the refusals, because they are the part that protects
 * the reviewer: a replay this console cannot read must produce a sentence the
 * reviewer can act on and no picture at all. A drawn approximation of a format we
 * guessed at would be evidence of nothing, shown beside a verdict that rests on it.
 *
 * The indices get the same attention as the shapes. A frame names its inherited
 * state and every operation it issued by index into tables the recording shares, so
 * an index outside a table is a frame that cannot be drawn — and one that would
 * otherwise be met halfway through a scrub rather than when the file was read.
 */

/** A minimal well-formed frame — enough shape for the parser to accept. */
function frame(overrides: Record<string, unknown> = {}): RecordedFrame {
  return {
    count: 1,
    timeMs: 16,
    deltaMs: 16,
    surface: { width: 800, height: 600 },
    state: 0,
    stack: [],
    ops: [0],
    ...overrides,
  } as unknown as RecordedFrame;
}

/**
 * `count` well-formed path segments, for the checks that are about how many a
 * state carries rather than about what is in one.
 *
 * Each carries a real operation, so what such a check establishes is that the
 * count alone is refused — a list of segments the parser has no other complaint
 * about.
 */
function segments(count: number): unknown[] {
  return Array.from({ length: count }, () => ({
    transform: null,
    ops: [{ op: "call", method: "rect", args: [0, 0, 1, 1] }],
  }));
}

/** A well-formed recording, as JSON reaches the parser. */
function recording(overrides: Record<string, unknown> = {}): unknown {
  return {
    format: RECORDING_FORMAT,
    width: 800,
    height: 600,
    background: "#101010",
    images: [],
    resources: [],
    ops: [{ op: "call", method: "fillRect", args: [0, 0, 10, 10] }],
    states: [
      {
        properties: { fillStyle: "#000000" },
        transform: [1, 0, 0, 1, 0, 0],
        lineDash: [],
        clip: [],
        path: [],
      },
    ],
    frames: [frame()],
    ...overrides,
  };
}

describe("reading a recording", () => {
  it("accepts a recording written in the format it knows", () => {
    const parsed = parseRecording(recording());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.width).toBe(800);
    expect(parsed.recording.background).toBe("#101010");
    expect(parsed.recording.frames).toHaveLength(1);
  });

  it("carries the shared tables through to the player", () => {
    const parsed = parseRecording(
      recording({
        images: [
          {
            kind: "bitmap",
            width: 8,
            height: 8,
            src: "data:image/png;base64,",
          },
        ],
        resources: [
          {
            make: { method: "createLinearGradient", args: [0, 0, 1, 0] },
            then: [{ op: "call", method: "addColorStop", args: [0, "#fff"] }],
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.images).toHaveLength(1);
    expect(parsed.recording.resources).toHaveLength(1);
    expect(parsed.recording.ops).toHaveLength(1);
    expect(parsed.recording.states).toHaveLength(1);
  });

  it("reads an explicit null background as the transparency it is", () => {
    const parsed = parseRecording(recording({ background: null }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.background).toBeNull();
  });

  it("accepts a recording with no frames, which is empty rather than damaged", () => {
    const parsed = parseRecording(recording({ frames: [] }));
    expect(parsed.ok).toBe(true);
  });

  it("carries a frame's truncation flag through to the player", () => {
    // A recorder bounds the three shadows it keeps — the save stack, the clip, the
    // current path — and says so on a frame it had to cut down. The player turns
    // that into a line under the canvas, so it has to survive the parse rather
    // than being dropped as a field the parser does not recognise.
    const parsed = parseRecording(
      recording({ frames: [frame({ truncated: true })] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.frames[0]?.truncated).toBe(true);
  });

  it("reads a frame that does not mention truncation as one that was not truncated", () => {
    // The flag names an exceptional frame and is written only when it is true:
    // `false` on every frame of a fifty-thousand-frame recording is bytes spent to
    // say nothing.
    const parsed = parseRecording(recording());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.frames[0]?.truncated).toBeUndefined();
  });
});

describe("refusing a recording", () => {
  it("refuses a format that is not the one format, naming both numbers", () => {
    const parsed = parseRecording(recording({ format: RECORDING_FORMAT + 1 }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    // The reviewer has to be able to act on this, so both figures are kept: the
    // number the file states and the one recording format there is. And it is one
    // terse declarative clause about the FILE — what the console decided to do
    // about it ("cannot be played", "probably not a recording") is error handling
    // rather than the error, and the anchored match is what keeps it out: a
    // sentence that grew a second clause fails here rather than passing on the two
    // figures alone.
    expect(parsed.message).toContain(String(RECORDING_FORMAT + 1));
    expect(parsed.message).toContain(String(RECORDING_FORMAT));
    expect(parsed.message).toMatch(
      /^This file states recording format \d+, not \d+\.$/,
    );
  });

  it("refuses a file that does not declare a format at all", () => {
    const parsed = parseRecording(recording({ format: undefined }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toMatch(/format/i);
  });

  it("refuses something that is not an object", () => {
    expect(parseRecording("not a recording").ok).toBe(false);
    expect(parseRecording([recording()]).ok).toBe(false);
    expect(parseRecording(null).ok).toBe(false);
  });

  it("refuses a recording that does not say what size it was drawn at", () => {
    expect(parseRecording(recording({ width: "800" })).ok).toBe(false);
  });

  it("refuses a recording that does not say what its frames were cleared to", () => {
    // Transparency is an explicit `null`, so an absent field is a document that
    // lost the field rather than one that was transparent. Reading the two as the
    // same thing draws every frame over a transparent page and says nothing —
    // every other absent field is refused, and this one is no different.
    const parsed = parseRecording(recording({ background: undefined }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toMatch(/cleared to/i);
  });

  it("refuses a recording missing a table its frames index into", () => {
    expect(parseRecording(recording({ ops: undefined })).ok).toBe(false);
    expect(parseRecording(recording({ states: undefined })).ok).toBe(false);
    expect(parseRecording(recording({ images: undefined })).ok).toBe(false);
    expect(parseRecording(recording({ resources: undefined })).ok).toBe(false);
  });

  it("refuses a damaged frame, naming which one it is", () => {
    const broken = frame({ surface: undefined });
    const parsed = parseRecording(recording({ frames: [frame(), broken] }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 1");
  });

  it("refuses a frame naming an operation the recording does not carry", () => {
    // The index is the whole of what a frame says about its drawing, so one past
    // the end of the table is a frame that would draw a different picture — caught
    // when the file is read rather than when a scrub reaches it.
    const parsed = parseRecording(
      recording({ frames: [frame({ ops: [0, 4] })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 0");
    expect(parsed.message).toContain("operation 4");
  });

  it("refuses a frame naming an inherited state the recording does not carry", () => {
    const parsed = parseRecording(recording({ frames: [frame({ state: 3 })] }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 0");
    expect(parsed.message).toContain("state 3");
  });

  it("refuses a frame naming a saved state the recording does not carry", () => {
    // The save stack is what a `restore` among the frame's operations pops to, so
    // an index outside the table is a frame that would draw everything after its
    // restore under a state that is not the one the build returned to.
    const parsed = parseRecording(
      recording({ frames: [frame({ stack: [0, 2] })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 0");
    expect(parsed.message).toContain("saved state 2");
  });

  it("refuses a frame that does not say what it had saved", () => {
    expect(
      parseRecording(recording({ frames: [frame({ stack: undefined })] })).ok,
    ).toBe(false);
  });

  it("refuses a save stack longer than the format carries, however valid each entry is", () => {
    // Range-checking each index and not the count leaves the whole cost of a
    // two-hundred-thousand-entry stack in range: the player applies a state and
    // pushes a level per entry, six and a half seconds inside one `drawFrame`,
    // with the reviewer's tab frozen for all of it. The bound is part of the
    // format — a recorder keeps the innermost sixty-four — so nothing a recorder
    // writes is refused here and everything this console did not write is.
    const parsed = parseRecording(
      recording({ frames: [frame({ stack: Array<number>(65).fill(0) })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 0");
    expect(parsed.message).toContain("65");
    expect(parsed.message).toContain("64");
  });

  it("accepts a save stack at the bound", () => {
    expect(
      parseRecording(
        recording({ frames: [frame({ stack: Array<number>(64).fill(0) })] }),
      ).ok,
    ).toBe(true);
  });

  it("refuses a frame that says it was truncated as something other than a yes", () => {
    const parsed = parseRecording(
      recording({ frames: [frame({ truncated: "yes" })] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 0");
  });

  it("refuses a frame naming an operation by something that is not an index", () => {
    const parsed = parseRecording(
      recording({ frames: [frame({ ops: ["0"] })] }),
    );
    expect(parsed.ok).toBe(false);
  });

  it("refuses an operation of an unknown kind, naming which one it is", () => {
    const parsed = parseRecording(
      recording({ ops: [{ op: "invoke", method: "fillRect", args: [] }] }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("operation 0");
  });

  it("refuses a call with no method name to dispatch on", () => {
    expect(
      parseRecording(recording({ ops: [{ op: "call", args: [] }] })).ok,
    ).toBe(false);
  });

  it("refuses a state that carries no properties or an unreadable transform", () => {
    expect(
      parseRecording(
        recording({
          states: [{ transform: null, lineDash: null, clip: [], path: [] }],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseRecording(
        recording({
          states: [
            {
              properties: {},
              transform: "none",
              lineDash: null,
              clip: [],
              path: [],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a transform that is not six numbers, rather than leaving it to be dropped", () => {
    // A transform of any other length cannot be applied at all, and a player that
    // met one could only draw the frame under whatever transform preceded it — the
    // wrong picture, reported as a clean one. So it is refused when the file is
    // read.
    const short = parseRecording(
      recording({
        states: [
          {
            properties: {},
            transform: [1, 0, 0],
            lineDash: null,
            clip: [],
            path: [],
          },
        ],
      }),
    );
    expect(short.ok).toBe(false);
    if (short.ok) return;
    expect(short.message).toContain("state 0");
    expect(short.message).toContain("six numbers");
    expect(
      parseRecording(
        recording({
          states: [
            {
              properties: {},
              transform: [1, 0, 0, 1, 0, 0, 0],
              lineDash: null,
              clip: [],
              path: [],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a state that says nothing about the path it was under", () => {
    // A state with no path is a state a player cannot put a `beginPath` between:
    // the clip's own outline would stay current and the frame's first bare `fill`
    // would fill it.
    expect(
      parseRecording(
        recording({
          states: [
            { properties: {}, transform: null, lineDash: null, clip: [] },
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a malformed path segment, naming which one it is", () => {
    const parsed = parseRecording(
      recording({
        states: [
          {
            properties: {},
            transform: null,
            lineDash: null,
            clip: [],
            path: [
              {
                transform: null,
                ops: [{ op: "call", method: "rect", args: [0, 0, 8, 8] }],
              },
              { transform: [2, 0, 0, 2], ops: [] },
            ],
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("state 0");
    expect(parsed.message).toContain("path segment (1)");
  });

  it("refuses a state that says nothing about the clip it was under", () => {
    // A clip is applied to a context and never read back from one, so a state
    // missing it is a state a player would draw unclipped without knowing.
    expect(
      parseRecording(
        recording({
          states: [
            { properties: {}, transform: null, lineDash: null, path: [] },
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a malformed clip segment, naming which one it is", () => {
    const parsed = parseRecording(
      recording({
        states: [
          {
            properties: {},
            transform: null,
            lineDash: null,
            path: [],
            clip: [
              {
                transform: [1, 0, 0, 1, 0, 0],
                ops: [{ op: "call", method: "clip", args: [] }],
              },
              { transform: null, ops: [{ op: "invoke", method: "clip" }] },
            ],
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("state 0");
    expect(parsed.message).toContain("clip segment (1)");
  });

  it("refuses a clip segment applied under a transform that is not six numbers", () => {
    expect(
      parseRecording(
        recording({
          states: [
            {
              properties: {},
              transform: null,
              lineDash: null,
              path: [],
              clip: [{ transform: [2, 0, 0, 2], ops: [] }],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseRecording(
        recording({
          states: [
            {
              properties: {},
              transform: null,
              lineDash: null,
              path: [],
              clip: [{ transform: null, ops: "clip" }],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  it("refuses a clip region carrying more segments than the format does, however valid each one is", () => {
    // The same hole the save stack's bound closes, in the other direction:
    // checking each segment's shape and not the count leaves the whole cost of a
    // two-hundred-thousand-segment region in range, and a clip intersects rather
    // than replaces, so every one of them is paid inside one `drawFrame` and paid
    // again on every frame that inherits the state. A recorder bounds the region
    // at 1024 path operations and opens a segment only to hold one, so nothing it
    // writes is refused here.
    const parsed = parseRecording(
      recording({
        states: [
          {
            properties: {},
            transform: null,
            lineDash: null,
            path: [],
            clip: segments(1025),
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("state 0");
    expect(parsed.message).toContain("clip segments");
    expect(parsed.message).toContain("1025");
    expect(parsed.message).toContain("1024");
  });

  it("refuses a current path carrying more segments than the format does, however valid each one is", () => {
    // Bounded for the reason the clip is, and separately from it: the two are
    // shadowed separately by the recorder and applied one after the other by the
    // player, so a document that spent the whole bound on the path would otherwise
    // be refused only if it had spent it on the clip.
    const parsed = parseRecording(
      recording({
        states: [
          {
            properties: {},
            transform: null,
            lineDash: null,
            clip: [],
            path: segments(1025),
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("state 0");
    expect(parsed.message).toContain("path segments");
    expect(parsed.message).toContain("1025");
    expect(parsed.message).toContain("1024");
  });

  it("accepts a clip region and a current path at the bound", () => {
    expect(
      parseRecording(
        recording({
          states: [
            {
              properties: {},
              transform: null,
              lineDash: null,
              clip: segments(1024),
              path: segments(1024),
            },
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  it("refuses a malformed image, naming which one it is", () => {
    const parsed = parseRecording(
      recording({
        images: [
          {
            kind: "bitmap",
            width: 8,
            height: 8,
            src: "data:image/png;base64,",
          },
          {
            kind: "sprite",
            width: 8,
            height: 8,
            src: "data:image/png;base64,",
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("image 1");
  });

  it("refuses an image carrying no pixels", () => {
    expect(
      parseRecording(
        recording({ images: [{ kind: "pixels", width: 8, height: 8 }] }),
      ).ok,
    ).toBe(false);
  });

  it("accepts a recipe made by each of the four producing calls", () => {
    const parsed = parseRecording(
      recording({
        resources: [
          { make: { method: "createLinearGradient", args: [] }, then: [] },
          { make: { method: "createRadialGradient", args: [] }, then: [] },
          { make: { method: "createConicGradient", args: [] }, then: [] },
          { make: { method: "createPattern", args: [] }, then: [] },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("refuses a recipe made by anything but a producing call", () => {
    // A recipe is re-issued against the context the player is drawing into, which
    // is faithful only for a call whose answer does not depend on that context. A
    // `getTransform()` accepted here would have the player ask THIS canvas what its
    // transform is and paint the rest of the frame under the answer, reporting the
    // frame as clean.
    const parsed = parseRecording(
      recording({
        resources: [{ make: { method: "getTransform", args: [] }, then: [] }],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("resource 0");
    expect(parsed.message).toContain("getTransform");
  });

  it("refuses a pixel buffer that carries a PNG instead of its bytes", () => {
    // The two kinds carry their pixels in different fields, because a `pixels`
    // entry is rebuilt from raw RGBA and a `bitmap` entry is decoded from a PNG.
    // An entry with the wrong one is an entry a player has nothing to rebuild.
    expect(
      parseRecording(
        recording({
          images: [
            {
              kind: "pixels",
              width: 8,
              height: 8,
              src: "data:image/png;base64,",
            },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseRecording(
        recording({
          images: [{ kind: "pixels", width: 1, height: 1, data: "AAAAAA==" }],
        }),
      ).ok,
    ).toBe(true);
  });

  it("refuses a bitmap that carries raw bytes instead of a PNG", () => {
    expect(
      parseRecording(
        recording({
          images: [{ kind: "bitmap", width: 1, height: 1, data: "AAAAAA==" }],
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts either kind of image kept beside the recording", () => {
    // A writer with a directory to put them in stores an image's bytes in a flat
    // file and leaves the entry naming it, so a sprite drawn in forty recordings
    // moves once and as a PNG rather than forty times as base64 inside a gzip that
    // cannot compress it. Both kinds may be stored, and the name is a FILE NAME —
    // the same namespace every other piece of the run's validation media lives in,
    // which is what lets the host resolve it with the function it already has.
    expect(
      parseRecording(
        recording({
          images: [
            { kind: "bitmap", width: 8, height: 8, store: "img.0a1b.png" },
            { kind: "pixels", width: 8, height: 8, store: "img.0a1b.bin" },
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  it("accepts an entry that carries its pixels both ways", () => {
    // Over-specified rather than damaged. The decoder prefers the stored bytes, so
    // there is one picture either way, and refusing the document would cost a
    // reviewer a whole replay over a redundancy.
    expect(
      parseRecording(
        recording({
          images: [
            {
              kind: "bitmap",
              width: 1,
              height: 1,
              src: "data:image/png;base64,",
              store: "img.0a1b.png",
            },
          ],
        }),
      ).ok,
    ).toBe(true);
  });

  it("refuses an entry that names an empty file beside the recording", () => {
    // An empty name resolves to the directory the media lives in, which either 404s
    // or — worse — answers something that is not the picture the build drew.
    const parsed = parseRecording(
      recording({
        images: [{ kind: "bitmap", width: 8, height: 8, store: "" }],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("image 0");
  });

  it("refuses a malformed resource, naming which one it is", () => {
    const parsed = parseRecording(
      recording({
        resources: [
          { make: { method: "createPattern", args: [] }, then: [] },
          { make: { args: [] }, then: [] },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("resource 1");
  });

  it("refuses a resource whose steps are not operations", () => {
    expect(
      parseRecording(
        recording({
          resources: [
            {
              make: { method: "createLinearGradient", args: [] },
              then: [{ op: "call", args: [] }],
            },
          ],
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseRecording(
        recording({
          resources: [
            { make: { method: "createLinearGradient", args: [] }, then: 3 },
          ],
        }),
      ).ok,
    ).toBe(false);
  });
});

/**
 * Fetching a recording.
 *
 * A recording is stored and served gzipped: it is a document of coordinates and
 * repeated method names, and it is the reviewer's browser that pays to move and
 * parse it. Every host declares that framing (`Content-Type: application/json`
 * with `Content-Encoding: gzip`), so the browser inflates the body and the player
 * is handed JSON. What is checked here is that a body which is not a recording
 * reaches the reviewer as a sentence rather than as a blank player.
 */
describe("fetching a recording", () => {
  // A recording is immutable, so a URL fetched once is answered from the cache for
  // the rest of the session — which is the point of the cache and a trap for a test
  // that serves a different body at the same URL. Each case starts cold.
  beforeEach(() => {
    clearRecordingCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearRecordingCache();
  });

  /** Answer the next fetch with `body`, as a 200. */
  function serves(body: BodyInit): void {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
  }

  it("reads the JSON the browser inflated on the way past", async () => {
    // The response declares `Content-Encoding: gzip`, so the body reaching the
    // player is the document itself — which is what `fetch` hands back here.
    serves(JSON.stringify(recording()));
    const fetched = await fetchRecording("https://example.test/serve.json.gz");
    expect(fetched.frames).toHaveLength(1);
    expect(fetched.width).toBe(800);
  });

  it("refuses a body that is not JSON", async () => {
    serves("this is not a recording");
    await expect(
      fetchRecording("https://example.test/serve.json.gz"),
    ).rejects.toThrow(/not valid JSON/i);
  });

  it("reports a miss as a miss rather than as a damaged replay", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    await expect(
      fetchRecording("https://example.test/serve.json.gz"),
    ).rejects.toThrow(/404/);
  });
});
