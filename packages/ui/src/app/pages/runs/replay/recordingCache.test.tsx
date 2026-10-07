import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecording, clearPreparedRecordingCache } from "./ReplayPlayer";
import {
  clearRecordingCache,
  RECORDING_FORMAT,
  type RecordedFrame,
} from "./format";

/**
 * Leaving a replay and coming back.
 *
 * Every tab of a run's detail page is its own route, so clicking from the Play tab
 * to the run's images and back does not hide the player — it unmounts it and mounts
 * a new one. A reviewer on a slow link reported what that used to cost: the spinner
 * came back and the recording was downloaded and re-decoded from scratch, for a
 * document that cannot have changed since they were looking at it a moment before.
 *
 * So what is asserted here is the frame count, not just the final picture. A
 * remount must report `loading: false` on its FIRST frame and must not fetch again.
 */

/** A minimal well-formed frame — enough shape for the parser to accept. */
function frame(): RecordedFrame {
  return {
    count: 1,
    timeMs: 16,
    deltaMs: 16,
    surface: { width: 800, height: 600 },
    state: 0,
    stack: [],
    ops: [0],
  } as unknown as RecordedFrame;
}

/** A recording carrying no images, so the load is the fetch and nothing else. */
function recording(): unknown {
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
  };
}

/** Every URL `fetch` was asked for, in order. */
let fetched: string[];

beforeEach(() => {
  fetched = [];
  clearRecordingCache();
  clearPreparedRecordingCache();
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    fetched.push(String(input));
    return Promise.resolve(new Response(JSON.stringify(recording())));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearRecordingCache();
  clearPreparedRecordingCache();
});

/** What `useRecording` reported, in render order. */
function probe() {
  const frames: string[] = [];
  function Probe({ url }: { url: string | null }) {
    const { recording: loaded, error, loading } = useRecording(url);
    const shown = loading
      ? "loading"
      : (error ?? (loaded ? `${loaded.frames.length} frames` : "nothing"));
    frames.push(shown);
    return <p data-testid="replay">{shown}</p>;
  }
  return { frames, Probe };
}

const URL_A = "https://example.test/runs/1/replay.json.gz";
const URL_B = "https://example.test/runs/2/replay.json.gz";

describe("a replay the session has already loaded", () => {
  it("comes back with no spinner and no second fetch", async () => {
    // The first visit to the Play tab: a spinner, then the replay.
    const first = probe();
    const mounted = render(<first.Probe url={URL_A} />);
    expect(first.frames[0]).toBe("loading");
    await screen.findByText("1 frames");
    expect(fetched).toEqual([URL_A]);

    // Clicking to another tab unmounts the player whole.
    mounted.unmount();

    // Clicking back. This is the reported bug: not one frame of loading state, and
    // not one more request for a document that cannot have changed.
    const again = probe();
    render(<again.Probe url={URL_A} />);
    expect(again.frames[0]).toBe("1 frames");
    expect(again.frames).not.toContain("loading");
    expect(screen.getByTestId("replay")).toHaveTextContent("1 frames");
    await act(async () => {
      await Promise.resolve();
    });
    expect(again.frames).not.toContain("loading");
    expect(fetched).toEqual([URL_A]);
  });

  it("hands two panes naming one URL a single request", async () => {
    // The validation pair mounts two players at once; a case whose reference clip
    // is the run's own proof names the same URL twice.
    const { Probe } = probe();
    render(
      <>
        <Probe url={URL_A} />
        <Probe url={URL_A} />
      </>,
    );
    await screen.findAllByText("1 frames");
    expect(fetched).toEqual([URL_A]);
  });

  it("draws a different replay without going back to the network for the first", async () => {
    const { frames, Probe } = probe();
    const view = render(<Probe url={URL_A} />);
    await screen.findByText("1 frames");
    view.rerender(<Probe url={URL_B} />);
    await screen.findByText("1 frames");
    expect(fetched).toEqual([URL_A, URL_B]);

    // Back to the first — the pane the reviewer was comparing against.
    const before = frames.length;
    view.rerender(<Probe url={URL_A} />);
    expect(frames.slice(before)).not.toContain("loading");
    expect(fetched).toEqual([URL_A, URL_B]);
  });

  it("reports a miss as a miss and retries it on the next mount", async () => {
    vi.mocked(globalThis.fetch).mockImplementationOnce((input) => {
      fetched.push(String(input));
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const first = probe();
    const mounted = render(<first.Probe url={URL_A} />);
    await screen.findByText(/404/);
    mounted.unmount();

    // A failure is never cached, so coming back genuinely refetches.
    const again = probe();
    render(<again.Probe url={URL_A} />);
    await screen.findByText("1 frames");
    expect(fetched).toEqual([URL_A, URL_A]);
  });

  it("says there is nothing on a side with no recording", () => {
    const { frames, Probe } = probe();
    render(<Probe url={null} />);
    expect(frames).toEqual(["nothing"]);
    expect(fetched).toEqual([]);
  });
});
