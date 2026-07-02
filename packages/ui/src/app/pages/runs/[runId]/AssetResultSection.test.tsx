import { render, screen } from "@testing-library/react";
import type { AssetSheet } from "@test-cabinet/run-record";
import { describe, expect, it, vi } from "vitest";
import type { AssetFrameView } from "../../../data/galleryContext";

// encodeSpriteGif touches canvas/fetch (absent under jsdom) and is exercised in
// the browser, not here; SequenceRow's job under test is which frames it wires up
// and whether it offers a download at all.
vi.mock("./spriteGif", () => ({ encodeSpriteGif: vi.fn() }));

import { SequenceRow } from "./AssetResultSection";

function frame(index: number): AssetFrameView {
  return {
    index,
    regeneratedUrl: `regenerated-${index}.png`,
    previewUrl: null,
    actionsUrl: null,
    cheatDivergence: null,
    operationCount: 0,
    detail: null,
  };
}

const sheet: AssetSheet = {
  frameWidth: 16,
  frameHeight: 16,
  frames: [0, 1, 2],
  sequences: [],
};

describe("SequenceRow GIF download", () => {
  it("offers a download for a multi-frame sequence", () => {
    render(
      <SequenceRow
        sheet={sheet}
        sequence={{ slug: "walk", name: "Walk", frames: [0, 1, 2], fps: 8 }}
        frames={[frame(0), frame(1), frame(2)]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Download GIF" }),
    ).toBeInTheDocument();
  });

  it("offers no download for a single-frame (still) sequence", () => {
    render(
      <SequenceRow
        sheet={sheet}
        sequence={{ slug: "idle", name: "Idle", frames: [0], fps: 1 }}
        frames={[frame(0)]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Download GIF" })).toBeNull();
  });

  it("offers no download when no frame is servable", () => {
    const unservable = { ...frame(0), regeneratedUrl: null };
    render(
      <SequenceRow
        sheet={sheet}
        sequence={{ slug: "walk", name: "Walk", frames: [0, 1], fps: 8 }}
        frames={[unservable, { ...frame(1), regeneratedUrl: null }]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Download GIF" })).toBeNull();
  });
});
