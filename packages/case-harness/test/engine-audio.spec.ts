// Decoding a produced `.wav`, and the graph that never sounds.
//
// The decode is checked against a REAL FILE on disk — `test/host/root/assets/
// tone.wav`, sixteen-bit stereo PCM with a `LIST` chunk of ODD size wedged
// between `fmt ` and `data`, so the chunk walk and its pad byte are exercised by
// the fixture rather than only by a buffer this file built. Everything the four
// harnesses disagreed about is pinned here: which of the two decodes a case gets,
// and what each does with a file that declares less than it should.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

import {
  createAudioContextStub,
  decodeWavChannels,
  decodeWavHeader,
  inertAudioNode,
  installAudioContext,
  silentAudioBuffer,
  tolerantAudioBuffer,
  UNREADABLE_DURATION_S,
  UNREADABLE_SAMPLE_RATE,
  wavAudioBuffer,
  type AudioBufferLike,
} from "../src/engine/audio";

/** The fixture: 44100 Hz, two channels, sixteen-bit, four frames. */
const TONE = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL("./host/root/assets/tone.wav", import.meta.url)),
  ),
);

/** The site fixture's own wave: 8000 Hz, one channel, eight-bit, NO frames. */
const SILENCE = new Uint8Array(
  readFileSync(fileURLToPath(new URL("./build/silence.wav", import.meta.url))),
);

/** Everything the teardown of a check has to give back. */
const teardowns: (() => void)[] = [];

afterEach(() => {
  for (const teardown of teardowns.reverse()) teardown();
  teardowns.length = 0;
});

/* -------------------------------------------------------------------------- */
/* Building a wave by hand, for the shapes no fixture should be committed for  */
/* -------------------------------------------------------------------------- */

interface WaveParts {
  riff?: string;
  wave?: string;
  fmt?: {
    tag: number;
    channels: number;
    sampleRate: number;
    bits: number;
    /** Extra bytes after the sixteen a `fmt ` chunk must carry. */
    extension?: number[];
  };
  data?: number[];
}

/** A RIFF/WAVE file with exactly the chunks named, and nothing else. */
function wave(parts: WaveParts): Uint8Array {
  const chunks: Buffer[] = [];
  if (parts.fmt !== undefined) {
    const extension = parts.fmt.extension ?? [];
    const body = Buffer.alloc(16 + extension.length);
    body.writeUInt16LE(parts.fmt.tag, 0);
    body.writeUInt16LE(parts.fmt.channels, 2);
    body.writeUInt32LE(parts.fmt.sampleRate, 4);
    body.writeUInt32LE(0, 8);
    body.writeUInt16LE(0, 12);
    body.writeUInt16LE(parts.fmt.bits, 14);
    Buffer.from(extension).copy(body, 16);
    const chunk = Buffer.alloc(8 + body.length);
    chunk.write("fmt ", 0, "latin1");
    chunk.writeUInt32LE(body.length, 4);
    body.copy(chunk, 8);
    chunks.push(chunk);
  }
  if (parts.data !== undefined) {
    const body = Buffer.from(parts.data);
    const chunk = Buffer.alloc(8 + body.length + (body.length % 2));
    chunk.write("data", 0, "latin1");
    chunk.writeUInt32LE(body.length, 4);
    body.copy(chunk, 8);
    chunks.push(chunk);
  }
  const body = Buffer.concat([
    Buffer.from(parts.wave ?? "WAVE", "latin1"),
    ...chunks,
  ]);
  const file = Buffer.alloc(8 + body.length);
  file.write(parts.riff ?? "RIFF", 0, "latin1");
  file.writeUInt32LE(body.length, 4);
  body.copy(file, 8);
  return new Uint8Array(file);
}

/* -------------------------------------------------------------------------- */
/* The two decodes                                                            */
/* -------------------------------------------------------------------------- */

it("decodes a real file's samples, de-interleaved, one array per channel", () => {
  const decoded = decodeWavChannels(TONE);
  expect(decoded.sampleRate).toBe(44100);
  expect(decoded.channels).toBe(2);
  expect(decoded.bitsPerSample).toBe(16);
  expect(decoded.format).toBe("pcm");
  expect(decoded.frames).toHaveLength(2);

  const [left, right] = decoded.frames;
  expect(left).toBeDefined();
  expect(right).toBeDefined();
  expect(Array.from(left ?? [])).toEqual([0, -1, 0.25, 100 / 32768]);
  expect(Array.from(right ?? [])).toEqual([
    32767 / 32768,
    0.5,
    -0.25,
    -100 / 32768,
  ]);
});

it("walks past a chunk of odd size, pad byte and all", () => {
  // The fixture carries a five-byte `LIST` between `fmt ` and `data`. A walk that
  // did not round the size up would land one byte short and read no `data` chunk
  // at all, so reaching the samples above IS the check — this states it.
  expect(decodeWavHeader(TONE).length).toBe(4);
});

it("reads the figures alone, and decodes nothing, for the cheap half", () => {
  const header = decodeWavHeader(TONE);
  expect(header).toEqual({
    sampleRate: 44100,
    channels: 2,
    bitsPerSample: 16,
    format: "pcm",
    length: 4,
    duration: 4 / 44100,
  });
});

it("reads a real file that declares no frames as no frames", () => {
  const header = decodeWavHeader(SILENCE);
  expect(header.sampleRate).toBe(8000);
  expect(header.channels).toBe(1);
  expect(header.bitsPerSample).toBe(8);
  expect(header.length).toBe(0);
  expect(header.duration).toBe(0);
  expect(decodeWavChannels(SILENCE).frames[0]).toHaveLength(0);
});

/* -------------------------------------------------------------------------- */
/* Every depth the tools can write                                            */
/* -------------------------------------------------------------------------- */

it("converts unsigned eight-bit around its midpoint", () => {
  const file = wave({
    fmt: { tag: 1, channels: 1, sampleRate: 8000, bits: 8 },
    data: [128, 255, 0, 192],
  });
  expect(Array.from(decodeWavChannels(file).frames[0] ?? [])).toEqual([
    0,
    127 / 128,
    -1,
    0.5,
  ]);
});

it("converts signed twenty-four-bit across the sign boundary", () => {
  const file = wave({
    fmt: { tag: 1, channels: 1, sampleRate: 8000, bits: 24 },
    // 0, +8388607 (0x7fffff), -8388608 (0x800000)
    data: [0, 0, 0, 0xff, 0xff, 0x7f, 0x00, 0x00, 0x80],
  });
  const decoded = Array.from(decodeWavChannels(file).frames[0] ?? []);
  expect(decoded[0]).toBe(0);
  expect(decoded[1]).toBeCloseTo(1, 6);
  expect(decoded[2]).toBe(-1);
});

it("converts thirty-two-bit IEEE float untouched", () => {
  const samples = Buffer.alloc(8);
  samples.writeFloatLE(0.5, 0);
  samples.writeFloatLE(-0.25, 4);
  const file = wave({
    fmt: { tag: 3, channels: 1, sampleRate: 8000, bits: 32 },
    data: Array.from(samples),
  });
  const decoded = decodeWavChannels(file);
  expect(decoded.format).toBe("float");
  expect(Array.from(decoded.frames[0] ?? [])).toEqual([0.5, -0.25]);
});

it("reads WAVE_FORMAT_EXTENSIBLE through to the format its GUID names", () => {
  const samples = Buffer.alloc(4);
  samples.writeFloatLE(0.75, 0);
  // A 40-byte `fmt `: sixteen, then `cbSize`, the valid bits, the channel mask,
  // and a sub-format GUID whose first two bytes are the real tag.
  const extension = [22, 0, 32, 0, 0, 0, 0, 0, 3, 0];
  while (extension.length < 24) extension.push(0);
  const file = wave({
    fmt: { tag: 0xfffe, channels: 1, sampleRate: 8000, bits: 32, extension },
    data: Array.from(samples),
  });
  const decoded = decodeWavChannels(file);
  expect(decoded.format).toBe("float");
  expect(Array.from(decoded.frames[0] ?? [])).toEqual([0.75]);
});

it("reads a depth it cannot convert as silence, and still reports the depth", () => {
  const file = wave({
    fmt: { tag: 1, channels: 1, sampleRate: 8000, bits: 12 },
    data: [1, 2, 3, 4],
  });
  const decoded = decodeWavChannels(file);
  expect(decoded.bitsPerSample).toBe(12);
  expect(Array.from(decoded.frames[0] ?? [])).toEqual([0, 0, 0, 0]);
});

/* -------------------------------------------------------------------------- */
/* What a file that is not a wave does                                        */
/* -------------------------------------------------------------------------- */

it("refuses a body that is not RIFF, and one that is RIFF but not WAVE", () => {
  expect(() => decodeWavChannels(new Uint8Array([1, 2, 3]))).toThrow(
    /not a RIFF\/WAVE file/,
  );
  const avi = wave({
    wave: "AVI ",
    fmt: { tag: 1, channels: 1, sampleRate: 8000, bits: 16 },
    data: [0, 0],
  });
  expect(() => decodeWavChannels(avi)).toThrow(/not a RIFF\/WAVE file/);
});

it("refuses a file with no usable `fmt ` chunk unless a case names a fallback", () => {
  const file = wave({ data: [0, 0, 0, 0] });
  expect(() => decodeWavHeader(file)).toThrow(/no usable `fmt ` chunk/);
  const lenient = decodeWavHeader(file, {
    defaults: { sampleRate: 44100, channels: 1, bitsPerSample: 16 },
  });
  expect(lenient.sampleRate).toBe(44100);
  expect(lenient.channels).toBe(1);
  expect(lenient.length).toBe(2);
});

it("refuses a file with no `data` chunk unless a case allows it", () => {
  const file = wave({
    fmt: { tag: 1, channels: 1, sampleRate: 8000, bits: 16 },
  });
  expect(() => decodeWavHeader(file)).toThrow(/no `data` chunk/);
  const allowed = decodeWavHeader(file, { allowMissingData: true });
  expect(allowed.length).toBe(0);
  expect(allowed.sampleRate).toBe(8000);
});

/* -------------------------------------------------------------------------- */
/* The two buffers                                                            */
/* -------------------------------------------------------------------------- */

it("hands an engine a buffer holding the file's samples, or one holding silence", () => {
  const real = wavAudioBuffer(TONE);
  expect(real.numberOfChannels).toBe(2);
  expect(real.length).toBe(4);
  expect(real.sampleRate).toBe(44100);
  expect(real.duration).toBeCloseTo(4 / 44100, 12);
  expect(real.getChannelData(1)[0]).toBeCloseTo(32767 / 32768, 6);
  // A channel nothing decoded answers an empty array rather than throwing.
  expect(real.getChannelData(7)).toHaveLength(0);
  // The copy members are carried because gantry's buffer carried them: copying
  // out reads what the buffer holds, copying in is a no-op over a decoded cue.
  const out = new Float32Array(2);
  real.copyFromChannel(out, 1, 1);
  expect(Array.from(out)).toEqual([0.5, -0.25]);
  real.copyToChannel(new Float32Array([1, 1, 1, 1]), 0);
  expect(real.getChannelData(0)[0]).toBe(0);

  const silent = silentAudioBuffer(TONE);
  expect(silent.numberOfChannels).toBe(2);
  expect(silent.length).toBe(4);
  expect(silent.duration).toBeCloseTo(4 / 44100, 12);
  expect(Array.from(silent.getChannelData(0))).toEqual([0, 0, 0, 0]);
  // One shared array behind every channel: nothing may hear it and nothing writes.
  expect(silent.getChannelData(1)).toBe(silent.getChannelData(0));
});

/* -------------------------------------------------------------------------- */
/* The inert graph                                                            */
/* -------------------------------------------------------------------------- */

it("answers every member of a node, and answers the same one twice", () => {
  const node = inertAudioNode() as Record<string, never> & {
    gain: { value: number; setValueAtTime(v: number, t: number): unknown };
    connect: (to: unknown) => unknown;
    somethingNobodyHasHeardOf: () => unknown;
  };
  expect(node.gain).toBe(node.gain);
  expect(typeof node.connect).toBe("function");
  expect(() => node.connect({})).not.toThrow();
  expect(() => node.somethingNobodyHasHeardOf()).not.toThrow();
  // Both callable and parameter-shaped, because a name alone does not say which.
  expect(node.gain.setValueAtTime(0.5, 0)).toBe(node.gain);
});

it("keeps what is written to a node, and is never a thenable", async () => {
  const node = inertAudioNode();
  (node as { loop?: unknown }).loop = true;
  expect((node as { loop?: unknown }).loop).toBe(true);
  const gain = node.gain as { value: number };
  gain.value = 0.3;
  expect((node.gain as { value: number }).value).toBe(0.3);
  // A node answering `then` with a function would hang an `await` forever.
  expect((node as { then?: unknown }).then).toBeUndefined();
  await expect(Promise.resolve(node)).resolves.toBe(node);
});

/* -------------------------------------------------------------------------- */
/* The context                                                                */
/* -------------------------------------------------------------------------- */

interface Stub {
  sampleRate: number;
  currentTime: number;
  state: string;
  destination: unknown;
  decodeAudioData(data: ArrayBuffer | Uint8Array): Promise<AudioBufferLike>;
  createBuffer(channels: number, length: number, rate: number): AudioBufferLike;
  resume(): Promise<void>;
  createSomethingTheEngineInvented(): unknown;
}

it("decodes through whichever decode the case named, and never a default", async () => {
  const Stubbed = createAudioContextStub({ decode: wavAudioBuffer });
  const context = new Stubbed() as unknown as Stub;
  const decoded = await context.decodeAudioData(TONE);
  expect(decoded.getChannelData(1)[0]).toBeCloseTo(32767 / 32768, 6);

  const Silent = createAudioContextStub({ decode: silentAudioBuffer });
  const quiet = new Silent() as unknown as Stub;
  expect(
    Array.from((await quiet.decodeAudioData(TONE)).getChannelData(1)),
  ).toEqual([0, 0, 0, 0]);
});

it("takes an ArrayBuffer as readily as a view, and rejects with an Error", async () => {
  const Stubbed = createAudioContextStub({ decode: silentAudioBuffer });
  const context = new Stubbed() as unknown as Stub;
  const copy = TONE.slice().buffer;
  expect((await context.decodeAudioData(copy)).length).toBe(4);
  await expect(
    context.decodeAudioData(new Uint8Array([1, 2, 3])),
  ).rejects.toThrow(/not a RIFF\/WAVE file/);
});

it("answers a node for every member the engine's synthesizer invents", () => {
  const Stubbed = createAudioContextStub({
    decode: silentAudioBuffer,
    sampleRate: 44100,
  });
  const context = new Stubbed() as unknown as Stub;
  expect(context.sampleRate).toBe(44100);
  expect(context.state).toBe("running");
  expect(context.currentTime).toBe(0);
  expect(context.destination).toBeDefined();
  const node = context.createSomethingTheEngineInvented() as {
    connect: () => unknown;
  };
  expect(typeof node.connect).toBe("function");
  const buffer = context.createBuffer(2, 8, 48000);
  expect(buffer.length).toBe(8);
  expect(buffer.duration).toBeCloseTo(8 / 48000, 12);
});

it("is not a thenable either, so an engine may await the context it built", async () => {
  const Stubbed = createAudioContextStub({ decode: silentAudioBuffer });
  const context = new Stubbed();
  expect((context as { then?: unknown }).then).toBeUndefined();
  await expect(Promise.resolve(context)).resolves.toBe(context);
});

/* -------------------------------------------------------------------------- */
/* Installing it, and giving it back                                          */
/* -------------------------------------------------------------------------- */

/** The globals, as this file may read and write them. */
const bag = globalThis as unknown as Record<string, unknown>;

it("installs where the host has none, and puts the absence back", () => {
  expect(bag.AudioContext).toBeUndefined();
  const teardown = installAudioContext({ decode: silentAudioBuffer });
  teardowns.push(teardown);
  expect(typeof bag.AudioContext).toBe("function");
  teardown();
  expect("AudioContext" in bag).toBe(false);
  // Idempotent: a second call on one teardown gives up one hold, not two.
  teardown();
  expect("AudioContext" in bag).toBe(false);
});

it("counts its holders, so one harness's teardown never strands another", () => {
  const first = installAudioContext({ decode: silentAudioBuffer });
  const second = installAudioContext({ decode: silentAudioBuffer });
  teardowns.push(first, second);
  const installed = bag.AudioContext;
  expect(installed).toBeDefined();

  first();
  // Still standing, and still the SAME context: the second holder never got its
  // own, so it is decoding through the first caller's decode.
  expect(bag.AudioContext).toBe(installed);
  second();
  expect("AudioContext" in bag).toBe(false);
});

it("refuses a second install that would decode a cue differently", () => {
  teardowns.push(installAudioContext({ decode: silentAudioBuffer }));
  // Joining silently would have the second harness read SILENCE off a channel it
  // asked to have decoded, with nothing to tell it so.
  expect(() => installAudioContext({ decode: wavAudioBuffer })).toThrow(
    /already installed .* different `decode`/,
  );
  expect(() =>
    installAudioContext({ decode: silentAudioBuffer, sampleRate: 44100 }),
  ).toThrow(/already installed .* sampleRate 48000; this call asks for 44100/);
  // The same decode and the same rate joins, as two harnesses of one project do.
  expect(() =>
    teardowns.push(installAudioContext({ decode: silentAudioBuffer })),
  ).not.toThrow();
});

it("seeds only the `fmt ` figures that are missing, not all three", () => {
  // A `fmt ` declaring a rate and a depth but no channel count keeps both.
  const partial = wave({
    fmt: { tag: 1, channels: 0, sampleRate: 48000, bits: 24 },
    data: [0, 0, 0, 0, 0, 0],
  });
  const header = decodeWavHeader(partial, {
    defaults: { sampleRate: 44100, channels: 1, bitsPerSample: 16 },
  });
  expect(header.sampleRate).toBe(48000);
  expect(header.bitsPerSample).toBe(24);
  expect(header.channels).toBe(1);
  expect(header.length).toBe(2);
});

it("leaves a host that really has Web Audio alone, unless told to replace it", () => {
  const real = class Real {};
  bag.AudioContext = real;
  teardowns.push(() => {
    delete bag.AudioContext;
  });

  const left = installAudioContext({ decode: silentAudioBuffer });
  expect(bag.AudioContext).toBe(real);
  left();
  expect(bag.AudioContext).toBe(real);

  const replaced = installAudioContext({
    decode: silentAudioBuffer,
    replace: true,
  });
  expect(bag.AudioContext).not.toBe(real);
  replaced();
  expect(bag.AudioContext).toBe(real);
});

/* ---- the decode that never throws ------------------------------------------ */

/**
 * WHY THIS HALF EXISTS, AND WHY IT IS PINNED HERE.
 *
 * `wavAudioBuffer` and `silentAudioBuffer` throw on a file they cannot read.
 * Under an engine that is not one lost point: `specs/assets.md` has a build bind
 * its cues from `initialize`, so a rejected decode leaves the cue undeclared and
 * the build's own `play` throws from inside `update` — one malformed produced
 * file and the project falls over entirely. Two cases adopted the throwing half
 * during their migration and had to put the lenient reading back.
 *
 * No reference carries a malformed file, so no verdict digest can show this. The
 * only place the difference is visible is here.
 */
it("the tolerant buffer answers silence for a file nothing could read", () => {
  const notAWave = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(() => silentAudioBuffer(notAWave)).toThrow(/not a RIFF\/WAVE file/);

  const buffer = tolerantAudioBuffer(notAWave);
  expect(buffer.duration).toBe(UNREADABLE_DURATION_S);
  expect(buffer.sampleRate).toBe(UNREADABLE_SAMPLE_RATE);
  expect(buffer.numberOfChannels).toBe(1);
  expect(buffer.length).toBe(UNREADABLE_SAMPLE_RATE * UNREADABLE_DURATION_S);
  // Silence, so nothing can hear what was not read.
  expect(buffer.getChannelData(0).some((sample) => sample !== 0)).toBe(false);
});

it("the tolerant buffer reads a file it CAN read exactly as the strict one does", () => {
  const lenient = tolerantAudioBuffer(TONE);
  const strict = silentAudioBuffer(TONE);
  expect(lenient.sampleRate).toBe(strict.sampleRate);
  expect(lenient.numberOfChannels).toBe(strict.numberOfChannels);
  expect(lenient.length).toBe(strict.length);
  expect(lenient.duration).toBe(strict.duration);
});

it('`samples: "decoded"` hands back the real samples, and still never throws', () => {
  const decoded = tolerantAudioBuffer(TONE, { samples: "decoded" });
  expect(decoded.getChannelData(0)).toEqual(
    wavAudioBuffer(TONE).getChannelData(0),
  );
  // The same option on a file that cannot be read still answers silence.
  const unreadable = tolerantAudioBuffer(new Uint8Array([9, 9, 9, 9]), {
    samples: "decoded",
  });
  expect(unreadable.duration).toBe(UNREADABLE_DURATION_S);
});

it("a case's own fallback figures are what an unreadable file reports", () => {
  const buffer = tolerantAudioBuffer(new Uint8Array([0]), {
    defaults: { sampleRate: 22050, channels: 2, bitsPerSample: 16 },
  });
  expect(buffer.sampleRate).toBe(22050);
  expect(buffer.numberOfChannels).toBe(2);
});
