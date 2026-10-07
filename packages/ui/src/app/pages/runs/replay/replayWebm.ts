// Render a recording to a WebM clip.
//
// A recording is not a video: it is the draw commands a build issued, redrawn
// onto a canvas by the player. To hand a reviewer a file they can drop into a
// chat or a ticket, the recording is played through once — every frame drawn
// onto an offscreen canvas and pushed into a `MediaRecorder` over the canvas's
// capture stream — and the clip that comes out is what the player shows, at the
// pace the player shows it (see `timelineFor`: the recording's own frame
// durations, with the same floor and ceiling the on-screen clock applies).
//
// The pacing is wall-clock on purpose. A `MediaRecorder` stamps each captured
// frame with the time it arrived, so the only way to make frame 12 land 16 ms
// after frame 11 in the file is to draw it 16 ms later. An export therefore takes
// about as long as the recording runs; the control that triggers it says so by
// staying busy for the duration. Frames are scheduled against absolute deadlines
// from the moment the export started rather than by chaining relative waits, so a
// timer that fires late does not push every frame after it later still. The
// limit of the approach is a page the browser has put to sleep: a background tab
// throttles timers to a second or more, and frames stamped that far apart make a
// clip paced nothing like the player. The export must be left in the foreground.
//
// The browser pieces it leans on — a canvas to draw into, its capture stream,
// the recorder, and a clock to wait on — are taken through `WebmHost` so the
// export can be exercised without any of them. The default host is the
// browser's.

import { drawFrame, type ReplayResources } from "./drawFrame";
import type { Recording } from "./format";
import { timelineFor } from "./useReplayClock";

/** The container types tried, most efficient codec first. */
export const WEBM_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

/** A recorder over a capture — as much of the DOM `MediaRecorder` as the export
 * uses. */
export interface WebmRecorder {
  start(): void;
  stop(): void;
  /** Called with each chunk of encoded video as it becomes available. */
  onData(listener: (chunk: Blob) => void): void;
  /** Called once the recorder has stopped and delivered its last chunk. */
  onStop(listener: () => void): void;
  /** Called when the recorder fails; `reason` is whatever the browser gave. */
  onError(listener: (reason: unknown) => void): void;
}

/** A drawing surface the export renders frames onto. */
export interface WebmCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
}

/** A capture stream over a canvas, at zero frames per second: only the frames
 * explicitly requested are pushed, so every recorded frame lands in the file
 * exactly once, when it is asked for. */
export interface WebmCapture {
  /** Push the canvas's current pixels into the stream as one frame. */
  requestFrame(): void;
  /** End the stream, once the recorder is done with it. */
  stop(): void;
}

/** What the export needs from the browser. */
export interface WebmHost {
  createCanvas(width: number, height: number): WebmCanvas;
  /** A zero-fps capture over a canvas this host created. */
  capture(canvas: WebmCanvas): WebmCapture;
  /** Whether the browser can record the given container/codec. */
  isTypeSupported(mimeType: string): boolean;
  /** A recorder over a capture this host created. */
  createRecorder(capture: WebmCapture, mimeType: string): WebmRecorder;
  /** A monotonic clock, in milliseconds. */
  now(): number;
  /** Resolve after `ms` of wall-clock time. */
  wait(ms: number): Promise<void>;
}

/** The size a recording exports at: its first frame's surface, or its logical
 * design size where the surface was never laid out (as the player sizes its
 * canvas). Every frame is scaled to this, so a surface that changed mid-recording
 * cannot change the clip's dimensions, which a recorder does not tolerate. */
export function exportSize(recording: Recording): {
  width: number;
  height: number;
} {
  const first = recording.frames[0];
  const width =
    first !== undefined && first.surface.width > 0
      ? first.surface.width
      : recording.width;
  const height =
    first !== undefined && first.surface.height > 0
      ? first.surface.height
      : recording.height;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/** The first WebM type the host can record, or `null` if it records none. */
export function pickWebmType(
  host: Pick<WebmHost, "isTypeSupported">,
): string | null {
  return WEBM_MIME_TYPES.find((type) => host.isTypeSupported(type)) ?? null;
}

/** A canvas the browser host minted, with the element behind it. */
interface BrowserCanvas extends WebmCanvas {
  readonly element: HTMLCanvasElement;
}

/** A capture the browser host minted, with the stream its recorder records. */
interface BrowserCapture extends WebmCapture {
  readonly stream: MediaStream;
}

/** The browser's own canvas, capture stream, recorder, and timers. */
export function browserWebmHost(): WebmHost {
  return {
    createCanvas(width, height): BrowserCanvas {
      const element = document.createElement("canvas");
      element.width = width;
      element.height = height;
      return {
        element,
        get width() {
          return element.width;
        },
        set width(value) {
          element.width = value;
        },
        get height() {
          return element.height;
        },
        set height(value) {
          element.height = value;
        },
        getContext: (kind) => element.getContext(kind),
      };
    },
    capture(canvas): BrowserCapture {
      const { element } = canvas as BrowserCanvas;
      if (typeof element.captureStream !== "function") {
        throw new Error("This browser cannot capture frames from a canvas.");
      }
      const stream = element.captureStream(0);
      const track = stream.getVideoTracks()[0] as
        | (MediaStreamTrack & { requestFrame?: () => void })
        | undefined;
      if (track === undefined || typeof track.requestFrame !== "function") {
        throw new Error("This browser cannot capture frames from a canvas.");
      }
      return {
        stream,
        requestFrame: () => track.requestFrame!(),
        stop: () => track.stop(),
      };
    },
    isTypeSupported(mimeType) {
      return (
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(mimeType)
      );
    },
    createRecorder(capture, mimeType) {
      const recorder = new MediaRecorder((capture as BrowserCapture).stream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
      });
      return {
        start: () => recorder.start(),
        stop: () => recorder.stop(),
        onData: (listener) =>
          recorder.addEventListener("dataavailable", (event) =>
            listener(event.data),
          ),
        onStop: (listener) => recorder.addEventListener("stop", listener),
        onError: (listener) =>
          recorder.addEventListener("error", (event) =>
            listener(
              "error" in event && event.error instanceof Error
                ? event.error
                : event,
            ),
          ),
      };
    },
    now: () => performance.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

/**
 * Render `recording` to a WebM blob, paced as the player paces it.
 *
 * Rejects when the browser cannot record WebM or cannot draw into a canvas, and
 * as soon as the recorder itself fails; the control that triggers the export
 * reports that rather than doing nothing.
 */
export async function encodeReplayWebm(
  recording: Recording,
  resources: ReplayResources,
  host: WebmHost = browserWebmHost(),
): Promise<Blob> {
  if (recording.frames.length === 0) {
    throw new Error("This recording captured no frames.");
  }
  const mimeType = pickWebmType(host);
  if (mimeType === null) {
    throw new Error(
      `This browser cannot record WebM video (tried ${WEBM_MIME_TYPES.join(", ")}).`,
    );
  }
  const { width, height } = exportSize(recording);
  const output = host.createCanvas(width, height);
  const outputCtx = output.getContext("2d");
  // Each frame is drawn at its own surface size — the recording's operations are
  // in that surface's device pixels — and then scaled onto the output, so a frame
  // whose surface differs from the first still lands in the clip.
  const scratch = host.createCanvas(width, height);
  const scratchCtx = scratch.getContext("2d");
  if (outputCtx === null || scratchCtx === null) {
    throw new Error("This browser did not give the export a 2D canvas.");
  }
  const capture = host.capture(output);
  try {
    const recorder = host.createRecorder(capture, mimeType);
    const chunks: Blob[] = [];
    recorder.onData((chunk) => {
      if (chunk.size > 0) chunks.push(chunk);
    });
    // Settles when the recorder has delivered its last chunk — or rejects the
    // moment it fails, which the draw loop below races against so a recorder
    // that dies early ends the export early rather than after every frame.
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onStop(resolve);
      recorder.onError((reason) =>
        reject(
          reason instanceof Error
            ? reason
            : new Error(
                `The browser's video recorder failed (${String(reason)}).`,
              ),
        ),
      );
    });
    recorder.start();
    try {
      const holds = timelineFor([recording]);
      const started = host.now();
      let due = 0;
      for (let index = 0; index < recording.frames.length; index += 1) {
        const shot = recording.frames[index]!;
        const frameWidth =
          shot.surface.width > 0 ? shot.surface.width : recording.width;
        const frameHeight =
          shot.surface.height > 0 ? shot.surface.height : recording.height;
        if (scratch.width !== frameWidth) scratch.width = frameWidth;
        if (scratch.height !== frameHeight) scratch.height = frameHeight;
        drawFrame(scratchCtx, recording, resources, index);
        outputCtx.setTransform(1, 0, 0, 1, 0, 0);
        outputCtx.clearRect(0, 0, width, height);
        outputCtx.drawImage(scratchCtx.canvas, 0, 0, width, height);
        capture.requestFrame();
        // Held for what the frame is worth, so the next one is stamped that
        // much later — this is what paces the clip. The deadline is absolute,
        // so a late timer costs this frame only and not every frame after it.
        due += holds[index] ?? 0;
        await Promise.race([
          host.wait(Math.max(0, due - (host.now() - started))),
          stopped,
        ]);
      }
      // The file ends at the last frame it was handed, so the last recorded
      // frame is pushed once more after its hold: that is what gives it a
      // duration rather than a bare final timestamp.
      capture.requestFrame();
    } finally {
      // A recorder that already failed is no longer active and refuses `stop`;
      // the failure is what `stopped` reports, and must not be replaced here.
      try {
        recorder.stop();
      } catch {
        // Reported through `stopped`.
      }
    }
    await stopped;
    return new Blob(chunks, { type: mimeType.split(";")[0] });
  } finally {
    capture.stop();
  }
}
