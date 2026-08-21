import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ValidationMedia } from "../../../data/galleryContext";
import { RECORDING_FORMAT } from "../replay/format";
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
      state: { properties: {}, transform: null, lineDash: null },
      ops: [{ op: "call", method: "fillRect", args: [i, 0, 4, 4] }],
    });
  }
  return {
    format: RECORDING_FORMAT,
    width: 320,
    height: 180,
    background: "#000000",
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

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("moves both panes when the one scrubber moves", async () => {
    serve(2, 6);
    render(<ValidationReplayPair media={media()} />);
    await waitFor(() => expect(screen.getByRole("slider")).toBeEnabled());

    const scrub = screen.getByRole("slider");
    // The scrubber spans the longer recording, so the run's own build is reachable
    // to its last frame.
    expect(scrub).toHaveAttribute("max", "5");
    fireEvent.change(scrub, { target: { value: "3" } });

    // One index, read by both panes: the position advances, and the shorter side
    // reports that it is now past its end rather than blanking.
    expect(screen.getByText("4 / 6")).toBeInTheDocument();
    expect(screen.getByText(/holding on its last frame/)).toBeInTheDocument();

    // Each pane reports the frame the ENGINE counted, which is how a reviewer sees
    // that a shared index really is the same moment: this run is on its fourth
    // frame, and the reference — two frames long — is held on its last.
    expect(screen.getByText(/engine frame 3/)).toBeInTheDocument();
    expect(screen.getByText(/engine frame 1/)).toBeInTheDocument();
  });

  it("holds the shorter recording on its last frame, and says so", async () => {
    serve(2, 6);
    render(<ValidationReplayPair media={media()} />);

    // The pair is paced by the longer recording, so every frame of this run's build
    // is reachable; the reference simply stops advancing once it runs out.
    await waitFor(() => {
      expect(screen.getByText(/ends at frame 2 of 6/)).toBeInTheDocument();
    });
    expect(screen.getByText("1 / 6")).toBeInTheDocument();
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
