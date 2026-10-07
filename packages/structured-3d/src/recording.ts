/**
 * Frame recording: the engine's flight recorder, as video.
 *
 * A recording is a video of the frames the engine drew. Armed, the recorder takes
 * the picture the game submitted once per engine frame — the scene as the pipeline
 * left it on the stage canvas, with the screen layer composited over it — and hands
 * it to the browser's WebCodecs `VideoEncoder`, which produces VP9. The chunks it
 * emits are written into a WebM container this module also builds, and
 * `stopRecording` hands back the bytes.
 *
 * A 2D engine can record the *calls* a build issued and replay them against another
 * context, because the picture is the list of calls. A 3D engine cannot: the picture
 * is the product of the whole graphics pipeline — materials, shaders, shadow maps,
 * fog, post-effects, the depth buffer, the driver — and no list of calls a player
 * could reissue reproduces it on another machine. So the evidence here is the pixels
 * themselves, which is what makes a recording of a 3D build trustworthy as review
 * material: whatever the build drew is what a reviewer sees. That the pipeline is
 * the engine's rather than the game's does not change the argument — a render mode
 * substituted a material, a collision overlay drew a wireframe over the world, and
 * both are in the frame because the renderer drew them.
 *
 * Six decisions shape the recorder, and each of them is what makes a later property
 * true:
 *
 * 1. **The frame is composed by the recorder, not read off one canvas.** The stage
 *    canvas holds the 3D picture and the screen canvas holds the screen layer — the
 *    screen-space components and whatever a `DrawComponent` drew — and the two are
 *    only ever one picture on the composited output, which does not exist as a
 *    readable surface at the moment the recorder wants it. So the recorder keeps a
 *    capture canvas of its own, clears it, draws the stage into it and then the
 *    screen over it, and encodes that. Clearing matters: the capture canvas is
 *    reused frame after frame, and a frame the game left transparent would otherwise
 *    show the previous frame's pixels through it rather than the black the encoder
 *    produces when it discards alpha.
 * 2. **The capture happens between the screen pass and the diagnostics overlay.**
 *    That is the sixth substep of the render step in the engine's frame order, and
 *    it is what puts the overlay outside every recording. A reviewer therefore sees
 *    the picture the game submitted whether or not the person driving the suite had
 *    the panel up, and two recordings of the same scenario do not differ because one
 *    of them was being watched.
 * 3. **The recording has one size, fixed when the recorder is armed.** It is the
 *    stage canvas's backing store at that moment. A `VideoEncoder` is configured
 *    once with a width and a height and every frame it is given must match them, so
 *    a frame drawn at another size — the window was resized, the device pixel ratio
 *    changed — is drawn *scaled* into the capture canvas rather than dropped or
 *    encoded at its own size. A recording that changed size half way through would
 *    be a video most players refuse and every frame-indexing player mis-seeks.
 * 4. **A frame is timestamped in simulated time, not wall-clock time.** The engine's
 *    accumulated `timeMs` in microseconds is what the encoder is given, so two
 *    recordings of the same scenario under the same scripted clock carry the same
 *    timestamps and a frame in one names its counterpart in the other. That is what
 *    lets a viewer scrub two recordings of the same scenario with one
 *    control. It is the *engine's* accumulated time rather than the world's for a
 *    reason a Structured engine has and a Simple one does not: `world.time` restarts
 *    at zero at every level transition, and a recording timed off it would run
 *    backwards at the moment a level changed. Simulated time can also repeat — a
 *    clock may deliver a zero delta — so a frame whose time is not past the previous
 *    frame's is timed one microsecond after it: a container whose timestamps did not
 *    strictly increase would have two frames a player could not tell apart by the
 *    only address it has.
 * 5. **Keyframes are asked for rather than hoped for.** Every sixtieth frame is
 *    encoded with `keyFrame: true`, starting at the first, so a seek costs at most
 *    sixty frames of decode however the encoder's own rate control would have felt
 *    about the content. A container Cluster opens at each keyframe, which is what
 *    makes those keyframes findable without decoding anything.
 * 6. **Recording is bracketed by its owner and costs nothing outside the bracket.**
 *    A suite arms the recorder once the scenario is posed and disarms it once the
 *    behavior has happened, so the reviewer's evidence opens on the situation the
 *    requirement describes rather than on the setup that got there. While disarmed
 *    the recorder holds no canvas, no encoder and no frames, and a captured frame is
 *    one field test away from doing nothing at all.
 *
 * The recorder must never break the frame it is capturing. Composition and encoding
 * run behind a guard, and a host failure — an encoder that rejects a frame, a canvas
 * that will not read back — is remembered and reported from `stop`, where a caller
 * is in a position to hear about it, rather than thrown out of the middle of a frame
 * the game is still drawing.
 *
 * What is deliberately outside a recording: the diagnostics overlay, and anything
 * drawn after the composite. What is deliberately *inside* it: the background and
 * the letterbox bars, because they are part of the picture a player will see and a
 * recording cropped to the letterboxed rectangle would disagree in size with the
 * canvas it was taken from.
 */

import type { FrameInfo, RecordedFrame, Recording } from "./contract";

/* -------------------------------------------------------------------------- */
/* The figures the format and the encoder are fixed at                        */
/* -------------------------------------------------------------------------- */

/**
 * The most frames one recording holds.
 *
 * A minute of sixty-frame-a-second play, which is longer than any single claim a
 * verdict unit makes and short enough that a reviewer's browser can hold the decoded
 * frames. Capture stops there and the recorder stays armed, so a suite that recorded
 * past the bound gets whole frames and a recording that says `ended`, rather than a
 * truncated container or an unbalanced-call error from the disarm it did not make.
 */
export const FRAME_BOUND = 3600;

/**
 * How many frames apart a keyframe is asked for.
 *
 * A seek decodes forward from the nearest earlier keyframe, so this is the worst
 * case a player pays to land on a frame: sixty frames, one second of play. Asking
 * for them rather than leaving them to the encoder's rate control is what makes that
 * a bound rather than an expectation — an encoder given a still scene will happily
 * emit one keyframe and three thousand deltas.
 */
export const KEYFRAME_INTERVAL = 60;

/**
 * Nanoseconds per container timecode tick, which is what makes a tick a microsecond.
 *
 * Matroska timestamps are integers in ticks and the scale says what a tick is worth.
 * The default of a million — one millisecond — would round every frame's timestamp
 * to the millisecond it fell in, and a scenario stepped at a sub-millisecond delta
 * would land several frames on one timestamp. A thousand makes the container's
 * timestamps exactly the microsecond timestamps the encoder was given.
 */
export const TIMECODE_SCALE_NS = 1000;

/**
 * The codec string the encoder is configured with: VP9, profile 0, level 1.0, 8-bit.
 *
 * Profile 0 is 8-bit 4:2:0, which is what a canvas's pixels become and what every
 * VP9 decoder supports. The level is a floor rather than a promise — an encoder
 * raises it for a resolution that needs more — and 1.0 is the lowest, so no
 * configuration is refused for naming a level below the picture it was given.
 */
export const VP9_CODEC = "vp09.00.10.08";

/** The frame rate the encoder is told to expect, for its rate control alone. */
const NOMINAL_FRAMERATE = 60;

/**
 * The bits a pixel of a frame is budgeted, before the frame rate is applied.
 *
 * A recording is review evidence, so a compression artifact that looks like a
 * rendering artifact costs more than the bytes would have. Seven hundredths of a bit
 * per pixel is a generous VP9 budget for game content — roughly four megabits a
 * second at 720p — and VP9's rate control spends far less than it on the still
 * stretches every scenario has.
 */
const BITS_PER_PIXEL = 0.07;

/** The floor the budget is raised to, so a small picture is not starved. */
const MINIMUM_BITRATE = 1_000_000;

/* -------------------------------------------------------------------------- */
/* The WebM container writer                                                  */
/* -------------------------------------------------------------------------- */

/*
 * Everything from here to the end of this section is the container, and nothing in
 * it knows about the engine. A WebM file is EBML — a tree of elements, each an id, a
 * size, and a payload that is either bytes or more elements — and this writes the
 * subset a single-track VP9 video file needs:
 *
 *     EBML                    the magic and the doc type
 *     Segment
 *       Info                  the timecode scale and the duration
 *       Tracks
 *         TrackEntry          one video track, V_VP9, at the recording's size
 *       Cluster*              a timecode and the frames that hang off it
 *         SimpleBlock*        one encoded frame
 *
 * There is no muxer dependency in this repository and adding one to an engine
 * package that ships into every seeded run is not worth a few hundred lines, so the
 * writer is here. It writes known sizes throughout rather than the unknown-size
 * Segment a live stream uses, because the whole capture is in hand before a byte is
 * written and a file with known sizes is the one every player handles best.
 */

/** One encoded frame, as it came out of the encoder and goes into the container. */
export interface CapturedChunk {
  /** Whether the frame decodes on its own or only from the keyframe before it. */
  readonly type: "key" | "delta";
  /** The presentation timestamp in microseconds, which is one container tick. */
  readonly timestampUs: number;
  /** The encoded bytes, exactly as the encoder produced them. */
  readonly data: Uint8Array;
}

/** What the container needs to know about the track it is carrying. */
export interface WebmVideo {
  /** The frame width in device pixels. */
  readonly width: number;
  /** The frame height in device pixels. */
  readonly height: number;
  /** Where the last frame stops being shown, in microseconds. */
  readonly durationUs: number;
}

/** Element ids, written as the bytes they are: the marker is part of the id. */
const ID = {
  ebml: 0x1a45dfa3,
  ebmlVersion: 0x4286,
  ebmlReadVersion: 0x42f7,
  ebmlMaxIdLength: 0x42f2,
  ebmlMaxSizeLength: 0x42f3,
  docType: 0x4282,
  docTypeVersion: 0x4287,
  docTypeReadVersion: 0x4285,
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  muxingApp: 0x4d80,
  writingApp: 0x5741,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackUid: 0x73c5,
  flagLacing: 0x9c,
  codecId: 0x86,
  trackType: 0x83,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  cluster: 0x1f43b675,
  timecode: 0xe7,
  simpleBlock: 0xa3,
} as const;

/** The one track a recording holds, numbered from one as Matroska requires. */
const TRACK_NUMBER = 1;

/** `TrackType` for video. */
const TRACK_TYPE_VIDEO = 1;

/**
 * The furthest a block's timestamp may sit from its Cluster's.
 *
 * A `SimpleBlock` carries its timestamp as a *signed sixteen-bit* offset from the
 * Cluster's own, in ticks — and a tick here is a microsecond, so one Cluster spans
 * at most about thirty-three milliseconds however many frames that is. A writer that
 * ignored this would emit blocks whose offsets wrapped, and a player would show the
 * frames of a long Cluster in an order nothing chose. So a Cluster is closed and
 * another opened whenever the next frame would not fit, on top of the Cluster that
 * opens at every keyframe.
 */
const MAX_BLOCK_OFFSET = 32767;

/** What the file says produced it, in both of the places Matroska asks. */
const APPLICATION = "@clockwyrks/structured-3d";

/**
 * The whole file: the EBML header, then one Segment holding the capture.
 *
 * A capture with no frames still produces a valid file — a header, an Info and a
 * Tracks, and no Clusters — rather than an empty buffer, so a caller that writes
 * whatever it was handed writes something a player can open and report as empty.
 */
export function writeWebm(
  chunks: readonly CapturedChunk[],
  video: WebmVideo,
): Uint8Array {
  return concat([header(), segment(chunks, video)]);
}

/** The EBML header: what kind of document this is and how to read its elements. */
function header(): Uint8Array {
  return element(
    ID.ebml,
    concat([
      unsigned(ID.ebmlVersion, 1),
      unsigned(ID.ebmlReadVersion, 1),
      unsigned(ID.ebmlMaxIdLength, 4),
      unsigned(ID.ebmlMaxSizeLength, 8),
      ascii(ID.docType, "webm"),
      unsigned(ID.docTypeVersion, 2),
      unsigned(ID.docTypeReadVersion, 2),
    ]),
  );
}

/** The Segment: the metadata a player reads first, then the frames. */
function segment(
  chunks: readonly CapturedChunk[],
  video: WebmVideo,
): Uint8Array {
  return element(
    ID.segment,
    concat([info(video), tracks(video), ...clusters(chunks)]),
  );
}

/** Info: what a timecode tick is worth, how long the segment runs, and who wrote it. */
function info(video: WebmVideo): Uint8Array {
  return element(
    ID.info,
    concat([
      unsigned(ID.timecodeScale, TIMECODE_SCALE_NS),
      ascii(ID.muxingApp, APPLICATION),
      ascii(ID.writingApp, APPLICATION),
      // Duration is a float in ticks, which the scale above makes microseconds. It
      // is where the last frame stops being shown rather than where it starts, so a
      // player's scrubber reaches the end of the last frame instead of its front
      // edge.
      double(ID.duration, video.durationUs),
    ]),
  );
}

/** Tracks: the single VP9 video track, at the size every frame was encoded at. */
function tracks(video: WebmVideo): Uint8Array {
  return element(
    ID.tracks,
    element(
      ID.trackEntry,
      concat([
        unsigned(ID.trackNumber, TRACK_NUMBER),
        // A track UID must be non-zero and unique within the segment, and there is
        // exactly one track, so it is the track number.
        unsigned(ID.trackUid, TRACK_NUMBER),
        unsigned(ID.trackType, TRACK_TYPE_VIDEO),
        // Lacing packs several small frames into one block. Video frames are never
        // small enough for it to pay, and saying so lets a player skip the check.
        unsigned(ID.flagLacing, 0),
        ascii(ID.codecId, "V_VP9"),
        element(
          ID.video,
          concat([
            unsigned(ID.pixelWidth, video.width),
            unsigned(ID.pixelHeight, video.height),
          ]),
        ),
      ]),
    ),
  );
}

/**
 * The frames, grouped into Clusters.
 *
 * A Cluster opens at every keyframe, so the keyframes are the Cluster boundaries and
 * a player seeking to a time finds the Cluster covering it and decodes from its
 * front. It also opens whenever the next frame's offset from the open Cluster's
 * timecode would overflow the signed sixteen bits a `SimpleBlock` carries, which at
 * microsecond ticks happens every thirty-three milliseconds or so — a Cluster that
 * begins on a delta frame is legal, and the alternative is a file whose timestamps
 * wrap.
 */
function clusters(chunks: readonly CapturedChunk[]): Uint8Array[] {
  const written: Uint8Array[] = [];
  let open: Uint8Array[] = [];
  let timecode = 0;

  const close = (): void => {
    if (open.length === 0) return;
    written.push(
      element(ID.cluster, concat([unsigned(ID.timecode, timecode), ...open])),
    );
    open = [];
  };

  for (const chunk of chunks) {
    const overflows = chunk.timestampUs - timecode > MAX_BLOCK_OFFSET;
    if (open.length === 0 || chunk.type === "key" || overflows) {
      close();
      timecode = chunk.timestampUs;
    }
    open.push(simpleBlock(chunk, timecode));
  }
  close();
  return written;
}

/**
 * One encoded frame as a `SimpleBlock`: track, offset, flags, then the bytes.
 *
 * `SimpleBlock` rather than the `BlockGroup` a Matroska file may use because a
 * BlockGroup exists to carry a duration and the references a non-keyframe depends
 * on, and neither is needed here: the frames are in presentation order, each one
 * runs until the next one's timestamp, and VP9 out of a realtime encoder references
 * only the frame before it.
 */
function simpleBlock(chunk: CapturedChunk, timecode: number): Uint8Array {
  const payload = new Uint8Array(4 + chunk.data.length);
  // The track number is an EBML variable-size integer, and track 1 fits the
  // one-byte form: the 0x80 marker plus the number itself.
  payload[0] = 0x80 | TRACK_NUMBER;
  new DataView(payload.buffer).setInt16(1, chunk.timestampUs - timecode, false);
  // Bit 7 is the keyframe flag. The rest — invisible, lacing, discardable — are all
  // zero for a plain video frame.
  payload[3] = chunk.type === "key" ? 0x80 : 0x00;
  payload.set(chunk.data, 4);
  return element(ID.simpleBlock, payload);
}

/* --- EBML primitives ------------------------------------------------------ */

/** An element: its id, the size of its payload, and the payload. */
function element(id: number, payload: Uint8Array): Uint8Array {
  return concat([bigEndian(id), vint(payload.length), payload]);
}

/** An element whose payload is an unsigned integer, in as few bytes as it needs. */
function unsigned(id: number, value: number): Uint8Array {
  return element(id, bigEndian(value));
}

/** An element whose payload is ASCII text, unterminated as EBML strings are. */
function ascii(id: number, value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let at = 0; at < value.length; at += 1) bytes[at] = value.charCodeAt(at);
  return element(id, bytes);
}

/** An element whose payload is a double, which is how Matroska carries a duration. */
function double(id: number, value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return element(id, bytes);
}

/**
 * An EBML variable-size integer, which is how every element's size is written.
 *
 * The leading zero bits say how many bytes the integer occupies and the first one
 * bit terminates that count, so the value has seven bits per byte to live in. A
 * value whose seven-bit form is all ones is reserved — it is how a size says
 * "unknown" — so each length tops out one short of its range and the next length up
 * takes over.
 */
function vint(value: number): Uint8Array {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `a WebM element size must be a non-negative number, and this one was ${String(value)}`,
    );
  }
  let length = 1;
  while (length <= 8 && value >= 2 ** (7 * length) - 1) length += 1;
  if (length > 8) {
    throw new Error(
      `a WebM element of ${String(value)} bytes is past the eight-byte size an EBML integer can state`,
    );
  }
  const bytes = new Uint8Array(length);
  let rest = value;
  for (let at = length - 1; at >= 0; at -= 1) {
    bytes[at] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  bytes[0] = (bytes[0] ?? 0) | (0x80 >> (length - 1));
  return bytes;
}

/**
 * A number as big-endian bytes, in as few as carry it and never fewer than one.
 *
 * This writes both element ids and unsigned payloads, which is not a coincidence: an
 * EBML id already carries its own length marker in its leading bits, so the id
 * `0x1a45dfa3` *is* its four bytes and the minimal encoding is the right one.
 * Division rather than shifts, because a shift in JavaScript is a thirty-two-bit
 * operation and a timecode in microseconds passes that inside two hours.
 */
function bigEndian(value: number): Uint8Array {
  const bytes: number[] = [];
  let rest = Math.max(0, Math.round(value));
  do {
    bytes.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  } while (rest > 0);
  return Uint8Array.from(bytes);
}

/** The parts, end to end, in one buffer. */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const joined = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
}

/* -------------------------------------------------------------------------- */
/* The recorder                                                               */
/* -------------------------------------------------------------------------- */

/** What one armed recording holds, and the whole of what disarming drops. */
interface Session {
  /** The encoder this recording's frames go to, configured at its size. */
  readonly encoder: VideoEncoder;
  /** The `VideoFrame` constructor, taken when the host was checked for it. */
  readonly videoFrame: typeof VideoFrame;
  /** The surface each frame is composed onto, at the recording's size. */
  readonly canvas: HTMLCanvasElement;
  /** That surface's context, obtained once. */
  readonly context: CanvasRenderingContext2D;
  /** The frame size every frame of this recording is encoded at. */
  readonly width: number;
  readonly height: number;
  /**
   * The frame counter the recorder was armed at, past which capture begins.
   *
   * A frame whose `count` is not greater than this was already in progress when the
   * arming happened, and it is turned away: see {@link FrameRecorder.start}.
   */
  readonly armedAfterFrame: number;
  /** The frames captured so far, in order. */
  readonly frames: RecordedFrame[];
  /** The encoded frames the encoder has emitted so far, in order. */
  readonly chunks: CapturedChunk[];
  /** The first host failure, shared with the encoder's own error callback. */
  readonly failure: { error: Error | null };
  /** The timestamp the previous frame was given, or `null` before the first. */
  lastTimestampUs: number | null;
  /** Whether the frame bound turned a frame away. */
  ended: boolean;
}

/**
 * The recorder: one instance per engine, armed and disarmed by its owner.
 *
 * It holds the two canvases the engine draws on for its whole life and nothing else
 * until it is armed, which is what "costs nothing while idle" means literally: a
 * disarmed recorder's `capture` is a null test, and no canvas, encoder, or frame
 * exists to be paid for. Both canvases outlive every level transition — the pipeline
 * keeps drawing on the same two surfaces whatever world is open — so a recording
 * that spans a transition holds one continuous picture rather than stopping at the
 * boundary.
 *
 * The unbalanced-call refusals live here rather than only on the engine's members,
 * so the invariant holds however the recorder is driven. Neither is a soft failure:
 * a second arming that silently discarded the frames captured so far, or a second
 * disarming that handed back an empty recording, would report "the build drew
 * nothing" — a claim about the build, when what happened is a claim about the
 * caller.
 */
export class FrameRecorder {
  private session: Session | null = null;

  constructor(
    /** The canvas the pipeline renders the world pass onto. */
    private readonly stage: HTMLCanvasElement,
    /** The canvas the screen layer is drawn onto, composited over the stage. */
    private readonly screen: HTMLCanvasElement,
  ) {}

  /** Whether frames are being captured. */
  get active(): boolean {
    return this.session !== null;
  }

  /**
   * Arm the recorder: fix the size, build the capture surface, open the encoder.
   *
   * The size is taken here and held for the recording's life, because a
   * `VideoEncoder` is configured once and every frame it is given must match — see
   * decision 3 in this module's header.
   *
   * `armedAfterFrame` is where the recording's first frame is bounded away from the
   * frame the arming happened in. The engine passes its current frame counter, and
   * {@link capture} turns away any frame not past it: a game that arms the recorder
   * from inside a controller's tick, an actor's or a component's tick, a game mode's
   * tick, or a `DrawComponent`'s `draw` is arming part-way through a frame the
   * recorder has only half a picture of, and the recording begins at the next whole
   * frame instead. A caller driving the recorder directly, with no frame in flight,
   * leaves it at the default and every `capture` from here on is taken.
   */
  start(armedAfterFrame = 0): void {
    if (this.session !== null) {
      throw new Error(
        "engine.startRecording() was called while already recording: call engine.stopRecording() first",
      );
    }

    const codecs = webCodecs();
    if (codecs === null) {
      throw new Error(
        "engine.startRecording() needs the WebCodecs VideoEncoder and VideoFrame, which this host does not provide: a recording is a video the browser's encoder produces, so there is nothing to fall back to",
      );
    }

    const width = this.stage.width;
    const height = this.stage.height;
    const canvas = this.stage.ownerDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error(
        "engine.startRecording() could not obtain a 2d context to compose frames onto: a recording is the stage and the screen layer drawn into one surface, and there is no surface",
      );
    }

    // The three mutable pieces are locals first so the encoder's callbacks can close
    // over them: the callbacks are supplied to the constructor, so they cannot name
    // a session object the constructor's result is part of.
    const frames: RecordedFrame[] = [];
    const chunks: CapturedChunk[] = [];
    const failure: { error: Error | null } = { error: null };

    const encoder = new codecs.encoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({
          type: chunk.type,
          timestampUs: chunk.timestamp,
          data,
        });
      },
      // A `VideoEncoder` reports asynchronously, so a failure surfaces here rather
      // than out of the `encode` that caused it. Keeping the first one and reporting
      // it from `stop` is what lets the frame that provoked it finish drawing.
      error: (cause) => {
        failure.error ??= asError(cause);
      },
    });
    encoder.configure({
      codec: VP9_CODEC,
      width,
      height,
      bitrate: Math.max(
        MINIMUM_BITRATE,
        Math.round(width * height * NOMINAL_FRAMERATE * BITS_PER_PIXEL),
      ),
      framerate: NOMINAL_FRAMERATE,
      // Realtime latency keeps the encoder from buffering frames to look ahead,
      // which for this container matters twice over: chunks reach `output` in the
      // order they were encoded, so the blocks are in presentation order, and the
      // encoder emits no frame that references one after it.
      latencyMode: "realtime",
      // Said rather than assumed. The composed picture has an alpha channel wherever
      // the pipeline left the canvas clear, and what a recording shows there is
      // black.
      alpha: "discard",
    });

    this.session = {
      encoder,
      videoFrame: codecs.frame,
      canvas,
      context,
      width,
      height,
      armedAfterFrame,
      frames,
      chunks,
      failure,
      lastTimestampUs: null,
      ended: false,
    };
  }

  /**
   * Capture one frame: compose it, time it, and hand it to the encoder.
   *
   * Called by the engine after the pipeline's world pass has rendered and every
   * screen-space component has drawn, and before the diagnostics overlay draws —
   * which is what keeps the overlay out of every recording and keeps the render mode
   * in force, the collision overlay, and a `DrawComponent`'s drawing inside it.
   *
   * The frame the recorder was armed in is turned away. This runs near the end of
   * the frame, so a `startRecording` reached from inside that same frame's ticks or
   * a `DrawComponent`'s `draw` would otherwise put a frame the recorder watched only
   * the tail of at the head of the recording — and two recordings of one scenario,
   * one armed between frames and one armed from inside the game, would disagree
   * about which frame they start on.
   *
   * The stage canvas is read back through `drawImage` in the same task the scene was
   * rendered in, which is the only time a WebGL drawing buffer is guaranteed to
   * still hold the picture: the browser clears it when it composites, not when the
   * render call returns.
   */
  capture(frame: FrameInfo): void {
    const session = this.session;
    if (session === null) return;
    // Before every other guard, because a frame the arming boundary turns away is
    // not a frame this recording has: it must not fail it, count against its bound,
    // or take its first keyframe.
    if (frame.count <= session.armedAfterFrame) return;
    // A recording that has already failed encodes nothing more. The frames it holds
    // are whole, and `stop` is where the caller hears why there are no more of them.
    if (session.failure.error !== null) return;
    if (session.frames.length >= FRAME_BOUND) {
      // The recorder stays armed. Its owner disarms it, and the recording says the
      // bound is what stopped the capture rather than the disarm.
      session.ended = true;
      return;
    }

    const timestamp = nextTimestamp(frame.timeMs, session.lastTimestampUs);
    const keyFrame = session.frames.length % KEYFRAME_INTERVAL === 0;

    try {
      // Clear first: the capture canvas is reused, and a frame the pipeline left
      // transparent would otherwise show the previous frame through it.
      session.context.clearRect(0, 0, session.width, session.height);
      // The five-argument form scales, so a stage canvas whose backing store changed
      // since the recorder was armed lands at the recording's size rather than at
      // its own. The screen layer follows the stage's size, so both scale alike.
      session.context.drawImage(
        this.stage,
        0,
        0,
        session.width,
        session.height,
      );
      session.context.drawImage(
        this.screen,
        0,
        0,
        session.width,
        session.height,
      );

      const video = new session.videoFrame(session.canvas, { timestamp });
      try {
        session.encoder.encode(video, { keyFrame });
      } finally {
        // A `VideoFrame` holds a GPU or system-memory buffer until it is closed, and
        // one leaked per frame is a leak of the whole recording's pixels. Closed in
        // a `finally` so a rejected `encode` leaks nothing either.
        video.close();
      }
    } catch (cause) {
      session.failure.error ??= asError(cause);
      return;
    }

    session.lastTimestampUs = timestamp;
    session.frames.push({
      count: frame.count,
      timeMs: frame.timeMs,
      deltaMs: frame.lastDeltaMs,
    });
  }

  /**
   * Disarm, flush the encoder, and hand back everything captured since {@link start}.
   *
   * Not an `async` method, so the unbalanced-call refusal is thrown where the mistake
   * is rather than handed back as a rejected promise a caller who did not await could
   * miss entirely. Everything after that refusal is asynchronous, because the last
   * frames are still inside the encoder when this is called and the container cannot
   * be closed until their bytes are out of it.
   */
  stop(): Promise<Recording> {
    const session = this.session;
    if (session === null) {
      throw new Error(
        "engine.stopRecording() was called while not recording: call engine.startRecording() first",
      );
    }
    // Disarmed before the flush is awaited: a frame captured while the encoder is
    // draining belongs to no recording, and leaving the session in place would let
    // one in behind the frames already accounted for.
    this.session = null;
    return finish(session);
  }

  /**
   * Drop an armed capture without producing anything, as `engine.destroy()` does.
   *
   * Nothing is flushed and nothing is returned: the frames were evidence for a check
   * that is no longer running, and an encoder torn down mid-recording is asked to
   * release what it holds rather than to finish it.
   */
  discard(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    closeEncoder(session.encoder);
  }
}

/**
 * The tail of {@link FrameRecorder.stop}, on a session no longer reachable.
 *
 * `flush` resolves only once the last chunk has reached the output callback, so
 * every frame's bytes are in `chunks` by the time the container is written. The
 * encoder is closed either way, because a failed recording still holds a codec.
 */
async function finish(session: Session): Promise<Recording> {
  try {
    await session.encoder.flush();
  } catch (cause) {
    session.failure.error ??= asError(cause);
  }
  closeEncoder(session.encoder);

  const failure = session.failure.error;
  if (failure !== null) {
    throw new Error(
      `the recording's VideoEncoder failed and the capture is incomplete: ${failure.message}`,
      { cause: failure },
    );
  }

  return {
    video: writeWebm(session.chunks, {
      width: session.width,
      height: session.height,
      durationUs: durationOf(session),
    }),
    width: session.width,
    height: session.height,
    frames: session.frames,
    ended: session.ended,
  };
}

/**
 * Where the recording stops being shown, in microseconds.
 *
 * The last frame's timestamp is where it *starts*, and a duration ending there would
 * leave a player's scrubber unable to reach the final frame. Its own delta is what
 * it was worth, so the two together are where the video ends.
 */
function durationOf(session: Session): number {
  const last = session.frames.at(-1);
  if (last === undefined || session.lastTimestampUs === null) return 0;
  return session.lastTimestampUs + Math.round(last.deltaMs * 1000);
}

/**
 * The timestamp a frame at `timeMs` is given, in microseconds.
 *
 * Simulated time rounded to the nearest microsecond, except that a frame whose time
 * is not past the previous frame's — a clock that delivered a zero delta, a scripted
 * clock replaying the same instant — is timed one microsecond later, so timestamps
 * strictly increase and every frame is addressable by its own.
 */
function nextTimestamp(timeMs: number, previous: number | null): number {
  const micros = Math.round(timeMs * 1000);
  if (previous === null) return micros;
  return Math.max(micros, previous + 1);
}

/** Closes an encoder that is not already closed, since closing twice is refused. */
function closeEncoder(encoder: VideoEncoder): void {
  if (encoder.state !== "closed") encoder.close();
}

/**
 * The host's WebCodecs constructors, or `null` where it has none.
 *
 * Read off the global rather than referenced directly: `VideoEncoder` is a browser
 * global, and naming it in a module that a validator loads under Node would throw a
 * `ReferenceError` at the point of use rather than the diagnosis
 * {@link FrameRecorder.start} raises.
 */
function webCodecs(): {
  encoder: typeof VideoEncoder;
  frame: typeof VideoFrame;
} | null {
  const host = globalThis as {
    VideoEncoder?: typeof VideoEncoder;
    VideoFrame?: typeof VideoFrame;
  };
  if (host.VideoEncoder === undefined || host.VideoFrame === undefined) {
    return null;
  }
  return { encoder: host.VideoEncoder, frame: host.VideoFrame };
}

/**
 * Whatever was thrown or reported, as an `Error`.
 *
 * A `VideoEncoder` reports a `DOMException`, a `drawImage` on a tainted canvas
 * throws a `SecurityError`, and a broken host may throw a string. All three end up
 * in the same message, so the diagnosis a caller reads says what happened rather
 * than `[object Object]`.
 */
function asError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new Error(String(cause));
}
