import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord, RunShowcase } from "@test-cabinet/run-record";
import { ShowcaseSection } from "./ShowcaseSection";

// The gallery hands the section a run-scoped resolver; the static site's is a
// build-time map from run id to served file name to snapshot URL, and the
// consoles' an endpoint join — either way the section only ever calls the
// function. Resolving from a map here exercises exactly the static-gallery
// path: a name the snapshot published resolves, anything else is null.
const snapshotUrls: Record<string, Record<string, string>> = {
  "run-1": {
    "title.png": "https://cdn.example/media/runs/run-1/showcase/title.png",
    "clip.json.gz":
      "https://cdn.example/media/runs/run-1/showcase/clip.json.gz",
    "cover.png": "https://cdn.example/media/runs/run-1/showcase/cover.png",
  },
};
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => ({
    showcaseMediaUrl: (runId: string, file: string) =>
      snapshotUrls[runId]?.[file] ?? null,
  }),
}));

// The launch affordance is PlayableSection's business (and separately tested);
// the showcase only has to keep it on the page.
vi.mock("../PlayableSection", () => ({
  PlayableSection: ({ run }: { run: RunRecord }) => (
    <p>playable launch for {run.id}</p>
  ),
}));

// The replay player fetches and decodes a recording; the showcase's contract is
// only that a replay entry mounts it on the resolved URL.
vi.mock("../replay/ReplayPlayer", () => ({
  ReplayPlayer: ({ url, label }: { url: string; label: string }) => (
    <p>
      replay player {label} @ {url}
    </p>
  ),
}));

const run = { id: "run-1" } as unknown as RunRecord;

function showcase(overrides?: Partial<RunShowcase>): RunShowcase {
  return {
    description: "A **great** game.",
    media: [
      { file: "title.png", name: "Title screen", kind: "image" },
      { file: "clip.json.gz", name: "A round", kind: "replay" },
      { file: "cover.png", name: "Cover art", kind: "image" },
    ],
    ...overrides,
  };
}

describe("the showcase section", () => {
  it("stages the carousel's first entry with its URL resolved from the map", () => {
    render(<ShowcaseSection run={run} showcase={showcase()} />);
    const staged = screen.getByRole("img", { name: "Title screen" });
    expect(staged.getAttribute("src")).toBe(
      "https://cdn.example/media/runs/run-1/showcase/title.png",
    );
    expect(screen.getByText("Title screen")).toBeTruthy();
  });

  it("keeps the record's carousel order in the thumbnail strip", () => {
    render(<ShowcaseSection run={run} showcase={showcase()} />);
    const thumbs = screen.getAllByRole("tab");
    expect(thumbs.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Show Title screen",
      "Show A round",
      "Show Cover art",
    ]);
    expect(thumbs[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("mounts the replay player on a selected replay entry", () => {
    render(<ShowcaseSection run={run} showcase={showcase()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Show A round" }));
    expect(
      screen.getByText(
        "replay player A round @ https://cdn.example/media/runs/run-1/showcase/clip.json.gz",
      ),
    ).toBeTruthy();
  });

  it("steps the stage with the prev/next controls", () => {
    render(<ShowcaseSection run={run} showcase={showcase()} />);
    const prev = screen.getByRole("button", { name: "Previous media" });
    expect(prev.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next media" }));
    expect(screen.getByText(/replay player A round/)).toBeTruthy();
    fireEvent.click(prev);
    expect(screen.getByRole("img", { name: "Title screen" })).toBeTruthy();
  });

  it("rewrites the description's relative image references and leaves absolute ones alone", () => {
    render(
      <ShowcaseSection
        run={run}
        showcase={showcase({
          description:
            "![Cover](cover.png)\n\n![Elsewhere](https://elsewhere.example/pic.png)",
        })}
      />,
    );
    expect(screen.getByRole("img", { name: "Cover" }).getAttribute("src")).toBe(
      "https://cdn.example/media/runs/run-1/showcase/cover.png",
    );
    expect(
      screen.getByRole("img", { name: "Elsewhere" }).getAttribute("src"),
    ).toBe("https://elsewhere.example/pic.png");
  });

  it("keeps the gated playable launch on the page", () => {
    render(<ShowcaseSection run={run} showcase={showcase()} />);
    expect(screen.getByText("playable launch for run-1")).toBeTruthy();
  });

  it("notes a file the host cannot serve instead of mounting a broken viewer", () => {
    render(
      <ShowcaseSection
        run={run}
        showcase={showcase({
          media: [{ file: "missing.png", name: "Lost", kind: "image" }],
        })}
      />,
    );
    expect(
      screen.getByText(/Lost \(missing\.png\) is not available/),
    ).toBeTruthy();
  });

  it("renders the description alone when the carousel is empty", () => {
    render(<ShowcaseSection run={run} showcase={showcase({ media: [] })} />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("great")).toBeTruthy();
  });
});
