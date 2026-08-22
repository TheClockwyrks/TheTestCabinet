import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
 */

/** A minimal well-formed frame — enough shape for the parser to accept. */
function frame(): RecordedFrame {
  return {
    count: 1,
    timeMs: 16,
    deltaMs: 16,
    surface: { width: 800, height: 600 },
    state: {
      properties: { fillStyle: "#000000" },
      transform: [1, 0, 0, 1, 0, 0],
      lineDash: [],
    },
    ops: [{ op: "call", method: "fillRect", args: [0, 0, 10, 10] }],
  };
}

/** A well-formed recording, as JSON reaches the parser. */
function recording(overrides: Record<string, unknown> = {}): unknown {
  return {
    format: RECORDING_FORMAT,
    width: 800,
    height: 600,
    background: "#101010",
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

  it("reads a missing background as transparent rather than refusing it", () => {
    const parsed = parseRecording(recording({ background: undefined }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recording.background).toBeNull();
  });

  it("accepts a recording with no frames, which is empty rather than damaged", () => {
    const parsed = parseRecording(recording({ frames: [] }));
    expect(parsed.ok).toBe(true);
  });
});

describe("refusing a recording", () => {
  it("refuses a format it does not know, naming both versions", () => {
    const parsed = parseRecording(recording({ format: RECORDING_FORMAT + 1 }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    // The reviewer has to be able to act on this: which format the file is, which
    // one this console plays, and what to do about it.
    expect(parsed.message).toContain(String(RECORDING_FORMAT + 1));
    expect(parsed.message).toContain(String(RECORDING_FORMAT));
    expect(parsed.message).toMatch(/newer console/i);
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

  it("refuses a damaged frame, naming which one it is", () => {
    const broken = { ...frame(), state: undefined };
    const parsed = parseRecording(recording({ frames: [frame(), broken] }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 1");
  });

  it("refuses a frame carrying an operation of an unknown kind", () => {
    const broken = {
      ...frame(),
      ops: [{ op: "invoke", method: "fillRect", args: [] }],
    };
    const parsed = parseRecording(recording({ frames: [broken] }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("frame 0");
  });

  it("refuses a call with no method name to dispatch on", () => {
    const broken = { ...frame(), ops: [{ op: "call", args: [] }] };
    expect(parseRecording(recording({ frames: [broken] })).ok).toBe(false);
  });
});

/**
 * Fetching a recording.
 *
 * A recording is stored and served gzipped, because the format restates each
 * frame's inherited drawing state so that any frame can be drawn on its own and is
 * therefore repetitive by design. Every host declares that framing
 * (`Content-Type: application/json` with `Content-Encoding: gzip`), so the browser
 * inflates the body and the player is handed JSON. What is checked here is that a
 * body which is not a recording reaches the reviewer as a sentence rather than as a
 * blank player.
 */
describe("fetching a recording", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
