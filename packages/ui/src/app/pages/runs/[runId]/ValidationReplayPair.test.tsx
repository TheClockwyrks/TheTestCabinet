import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidationMedia } from "../../../data/galleryContext";
import { clearRecordingCache, RECORDING_FORMAT } from "../replay/format";
import { clearPreparedRecordingCache } from "../replay/ReplayPlayer";
import * as webm from "../replay/replayWebm";
import * as download from "./download";
import { ValidationReplayPair } from "./ValidationReplayPair";

/**
 * The reviewer's side-by-side replay comparison.
 *
 * The property under test is the one that separates this pairing from the video
 * one: the two panes are driven by a single transport reporting a single frame
 * index, so there is no drift to reason about and no way for the reference and the
 * run to be showing different moments. Nothing is drawn here — jsdom has no canvas
 * backend (see `src/test/setup.ts`) — which is fine, because what has to be right
 * is the wiring, and the drawing has its own tests.
 */

/** A recording of `count` frames, as the fetched JSON. */
function body(count: number): unknown {
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    frames.push({
      count: i,
      timeMs: 16 * (i + 1),
      deltaMs: 16,
      surface: { width: 320, height: 180 },
      state: 0,
      stack: [],
      ops: [i],
    });
  }
  return {
    format: RECORDING_FORMAT,
    width: 320,
    height: 180,
    background: "#000000",
    images: [],
    resources: [],
    ops: frames.map((_, i) => ({
      op: "call",
      method: "fillRect",
      args: [i, 0, 4, 4],
    })),
    states: [
      { properties: {}, transform: null, lineDash: null, clip: [], path: [] },
    ],
    frames,
  };
}

/** A validation output captured as a replay on both sides. */
function media(): ValidationMedia {
  return {
    itemId: "movement",
    subItemId: null,
    verdictId: "movement",
    id: "walk",
    name: "Walk cycle",
    kind: "replay",
    actualUrl: "https://example.test/runs/r1/movement__walk.json",
    baselineUrl: "https://example.test/cases/movement__walk.json",
    // Each side resolves a stored image out of its own namespace, exactly as the
    // gallery builds them: run-scoped for the actual, case-scoped for the baseline.
    actualStoreUrl: (file) => `https://example.test/runs/r1/${file}`,
    baselineStoreUrl: (file) => `https://example.test/cases/${file}`,
  };
}

/** Serve the baseline `baseline` frames long and the actual `actual` frames long. */
function serve(baseline: number, actual: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(body(url.includes("/cases/") ? baseline : actual)),
    ),
  );
}

// A recording is immutable, so a URL loaded once is answered from the process-wide
// cache for the rest of the session — which is the point of the cache and a trap for
// a suite that serves a different body at the same two URLs in every case. Each case
// starts cold.
beforeEach(() => {
  clearRecordingCache();
  clearPreparedRecordingCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearRecordingCache();
  clearPreparedRecordingCache();
});

describe("the replay comparison", () => {
  it("drives both panes from one transport", async () => {
    serve(5, 5);
    render(<ValidationReplayPair media={media()} />);

    await waitFor(() => {
      expect(screen.getAllByRole("img", { name: /Walk cycle/ })).toHaveLength(
        2,
      );
    });
    // One scrubber and one speed control for the pair — not one each. This is what
    // makes the two panes the same moment by construction rather than by two
    // players happening to keep step.
    expect(screen.getAllByRole("slider")).toHaveLength(1);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
  });

  it("holds its loaded recordings when the gallery hands it new resolvers", async () => {
    serve(5, 5);
    // Exactly what the console does: `validationMediaFor` mints a fresh pair of
    // store resolvers on every call, and the gallery context is rebuilt on every
    // render of the app shell. If either resolver reached the fetch effect's
    // dependencies, this re-render would blank both panes to a spinner and
    // re-download the recordings — and every stored image beside them — losing the
    // reviewer's place each time a run finished anywhere in the console.
    const { rerender } = render(<ValidationReplayPair media={media()} />);
    await waitFor(() => {
      expect(screen.getAllByRole("img", { name: /Walk cycle/ })).toHaveLength(
        2,
      );
    });
    const fetched = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .length;

    rerender(<ValidationReplayPair media={media()} />);

    expect(screen.getAllByRole("img", { name: /Walk cycle/ })).toHaveLength(2);
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(fetched);
  });

  it("moves both panes when the one scrubber moves", async () => {
    serve(2, 6);
    render(<ValidationReplayPair media={media()} />);
    await waitFor(() => expect(screen.getByRole("slider")).toBeEnabled());

    const scrub = screen.getByRole("slider");
    // The scrubber spans the longer recording, so the run's own build is reachable
    // to its last frame.
    expect(scrub).toHaveAttribute("max", "5");
    fireEvent.change(scrub, { target: { value: "3" } });

    // One index, read by both panes: the position advances for the pair rather than
    // for either pane on its own.
    expect(screen.getByText("4 / 6")).toBeInTheDocument();

    // Both panes are still drawn past the shorter one's end: the reference holds on
    // its last frame rather than blanking, which is what makes the comparison
    // readable at every position of the scrubber.
    expect(screen.getAllByRole("img", { name: /Walk cycle/ })).toHaveLength(2);
  });

  it("states each side's own length beside its label", async () => {
    serve(2, 6);
    render(<ValidationReplayPair media={media()} />);

    // The pair is paced by the longer recording, so every frame of this run's build
    // is reachable; the reference simply stops advancing once it runs out. Each
    // label row carries its OWN recording's length, so the two figures read against
    // each other are what say the reference stopped drawing first.
    await waitFor(() => {
      expect(screen.getByText("2 frames")).toBeInTheDocument();
    });
    expect(screen.getByText("6 frames")).toBeInTheDocument();
    expect(screen.getByText("1 / 6")).toBeInTheDocument();
  });

  it("renders a side to a WebM clip on request, once it has loaded", async () => {
    serve(5, 3);
    const encode = vi
      .spyOn(webm, "encodeReplayWebm")
      .mockResolvedValue(new Blob(["webm"], { type: "video/webm" }));
    const save = vi
      .spyOn(download, "downloadBlob")
      .mockImplementation(() => {});
    render(<ValidationReplayPair media={media()} />);

    // Nothing to render until the recording (and its images) have arrived.
    const reference = screen.getByRole("button", {
      name: "Download reference",
    });
    expect(reference).toBeDisabled();
    await waitFor(() => expect(reference).toBeEnabled());

    fireEvent.click(reference);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // The export is of THIS side's recording — the five-frame reference, not the
    // three-frame run beside it — and is named for the output and the side.
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode.mock.calls[0]![0].frames).toHaveLength(5);
    expect(save.mock.calls[0]![1]).toBe("walk-cycle-reference.webm");

    fireEvent.click(screen.getByRole("button", { name: "Download this run" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(encode.mock.calls[1]![0].frames).toHaveLength(3);
    expect(save.mock.calls[1]![1]).toBe("walk-cycle-run.webm");
  });

  it("says why a side cannot be played instead of showing an empty pane", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/cases/")
          ? new Response(null, { status: 404 })
          : Response.json(body(3)),
      ),
    );
    render(<ValidationReplayPair media={media()} />);

    await waitFor(() => {
      expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    });
    // The run's own side still plays: one side failing is not both sides failing.
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("refuses a recording written in a format it does not know", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ ...(body(2) as object), format: RECORDING_FORMAT + 1 }),
      ),
    );
    render(<ValidationReplayPair media={media()} />);

    await waitFor(() => {
      expect(
        screen.getAllByText(new RegExp(`format ${RECORDING_FORMAT + 1}`)),
      ).toHaveLength(2);
    });
    // Nothing is drawn for either side: a picture assembled from a format we guessed
    // at would be evidence of nothing.
    expect(screen.queryByRole("img", { name: /Walk cycle/ })).toBeNull();
  });
});
