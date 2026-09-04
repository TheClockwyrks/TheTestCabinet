/**
 * A self-contained PCM WAV decoder: bytes in, per-channel float samples out.
 *
 * This module is a deliberate, byte-identical COPY carried by both 3D engine
 * packages — `packages/simple-3d/src/wav.ts` and
 * `packages/structured-3d/src/wav.ts` are the same file, not an import of one
 * another. Each engine package is vendored into run repositories and has to
 * stay self-contained, so neither can depend on the other or on a shared
 * helper package; the two copies are held identical by the recording-parity
 * suites. Change one copy and you must change the other byte for byte.
 *
 * The decoder exists because the docs promise that "decoding needs no audio
 * context": a file-backed cue is a PCM WAV, the container the asset-generation
 * tools produce, and the engine decodes it itself, so `audio.load` and
 * `assets.loadAudio` resolve identically in a browser and in Node. The
 * decoded channels feed an `AudioBuffer` where a real context exists, and an
 * `AudioBuffer`-shaped value where none does. The subset is what those tools
 * write: 16-bit integer PCM (format 1) and 32-bit float PCM (format 3), any
 * channel count, deinterleaved here into one `Float32Array` per channel in
 * the `-1..1` range Web Audio speaks. Everything else is refused by name.
 */

/** A decoded WAV: one `Float32Array` per channel, in `-1..1`. */
export interface DecodedWav {
  /** The sample rate, in frames per second. */
  readonly sampleRate: number;
  /** The clip's length in seconds: frames divided by the sample rate. */
  readonly duration: number;
  /** One array per channel, each `frames` long, in file channel order. */
  readonly channels: readonly Float32Array[];
}

/** The four bytes at `at`, as an ASCII tag. */
function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at] ?? 0,
    bytes[at + 1] ?? 0,
    bytes[at + 2] ?? 0,
    bytes[at + 3] ?? 0,
  );
}

/**
 * Decodes a RIFF/WAVE file carrying 16-bit integer or 32-bit float PCM.
 *
 * Throws an `Error` naming the value and the fix for anything outside that
 * subset: a non-RIFF file, a compressed or extensible format code, a bit
 * depth the format code does not pair with, or a truncated `data` chunk.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  if (
    bytes.length < 12 ||
    tag(bytes, 0) !== "RIFF" ||
    tag(bytes, 8) !== "WAVE"
  ) {
    throw new Error(
      "wav: the bytes do not open with a RIFF/WAVE header: the file is not a WAV",
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let sawFormat = false;
  let data: Uint8Array | null = null;

  // Walk the chunks; only `fmt ` and `data` matter to a decode.
  let at = 12;
  while (at + 8 <= bytes.length) {
    const chunkTag = tag(bytes, at);
    const length = view.getUint32(at + 4, true);
    const dataStart = at + 8;
    if (dataStart + length > bytes.length) {
      throw new Error(
        `wav: the "${chunkTag}" chunk runs past the end of the file: the file is truncated`,
      );
    }

    if (chunkTag === "fmt ") {
      if (length < 16) {
        throw new Error(
          `wav: the fmt chunk holds ${length} bytes where the format needs 16: the file is corrupt`,
        );
      }
      format = view.getUint16(dataStart, true);
      channelCount = view.getUint16(dataStart + 2, true);
      sampleRate = view.getUint32(dataStart + 4, true);
      bitsPerSample = view.getUint16(dataStart + 14, true);
      sawFormat = true;
    } else if (chunkTag === "data") {
      data = bytes.subarray(dataStart, dataStart + length);
    }

    // Chunks are word-aligned: an odd length is followed by a pad byte.
    at = dataStart + length + (length % 2);
  }

  if (!sawFormat) {
    throw new Error(
      "wav: the file carries no fmt chunk: the file is not a playable WAV",
    );
  }
  if (data === null) {
    throw new Error(
      "wav: the file carries no data chunk: there are no samples to decode",
    );
  }
  if (format !== 1 && format !== 3) {
    throw new Error(
      `wav: format code ${format} is not supported: only integer PCM (1) and float PCM (3) are, so re-export the clip as plain PCM`,
    );
  }
  if (format === 1 && bitsPerSample !== 16) {
    throw new Error(
      `wav: ${bitsPerSample}-bit integer PCM is not supported: only 16-bit is, so re-export the clip at 16 bits per sample`,
    );
  }
  if (format === 3 && bitsPerSample !== 32) {
    throw new Error(
      `wav: ${bitsPerSample}-bit float PCM is not supported: only 32-bit is, so re-export the clip at 32 bits per sample`,
    );
  }
  if (channelCount < 1) {
    throw new Error(
      "wav: the fmt chunk declares 0 channels: the file is corrupt",
    );
  }
  if (sampleRate <= 0) {
    throw new Error(
      `wav: the fmt chunk declares a sample rate of ${sampleRate}: the file is corrupt`,
    );
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = bytesPerSample * channelCount;
  const frames = Math.floor(data.length / frameBytes);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    channels.push(new Float32Array(frames));
  }

  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sampleAt = frame * frameBytes + channel * bytesPerSample;
      const target = channels[channel];
      if (target === undefined) continue;
      target[frame] =
        format === 1
          ? // 16-bit PCM maps its asymmetric integer range onto -1..1 by the
            // conventional divisor 32768, so -32768 lands exactly at -1.
            dataView.getInt16(sampleAt, true) / 32768
          : dataView.getFloat32(sampleAt, true);
    }
  }

  return { sampleRate, duration: frames / sampleRate, channels };
}
