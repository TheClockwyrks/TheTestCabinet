import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Treemap, placeTreemapTiles, type TreemapTile } from "./Treemap";

// The encoding is the contract: a tile's AREA is its value. Everything else about the
// component — the labels, the legend, the drilling — is in service of that, so the
// placement is asserted as geometry rather than as a call count.

function tile(key: string, value: number, extra: Partial<TreemapTile> = {}) {
  return { key, label: key, value, ...extra };
}

describe("placeTreemapTiles", () => {
  it("gives each tile an area proportional to its value", () => {
    const placed = placeTreemapTiles([
      tile("a", 60),
      tile("b", 30),
      tile("c", 10),
    ]);
    const area = (key: string) => {
      const found = placed.find((t) => t.key === key)!;
      return found.w * found.h;
    };
    // Ratios, not absolutes: the map's coordinate space is an implementation detail,
    // but "b is three times c" must survive it.
    expect(area("a") / area("c")).toBeCloseTo(6, 1);
    expect(area("b") / area("c")).toBeCloseTo(3, 1);
  });

  it("reports each tile's share of the total", () => {
    const placed = placeTreemapTiles([tile("a", 3), tile("b", 1)]);
    expect(placed.find((t) => t.key === "a")!.share).toBeCloseTo(0.75);
  });

  it("drops non-positive tiles rather than drawing invisible hit targets", () => {
    const placed = placeTreemapTiles([tile("a", 5), tile("zero", 0)]);
    expect(placed.map((t) => t.key)).toEqual(["a"]);
  });

  it("places the largest tile first, whatever order it was given in", () => {
    const placed = placeTreemapTiles([tile("small", 1), tile("big", 9)]);
    expect(placed[0]!.key).toBe("big");
  });
});

describe("Treemap", () => {
  it("labels only the tiles the text fits in, and describes every one", () => {
    const { container } = render(
      <Treemap
        tiles={[
          tile("dominant", 100, { detail: "100" }),
          // A sliver: too small to hold a label, but still a tile with a name.
          tile("sliver", 1, { detail: "1" }),
        ]}
        ariaLabel="Sizes"
        hint="area = things"
      />,
    );
    const drawn = [...container.querySelectorAll("text")].map(
      (node) => node.textContent,
    );
    expect(drawn).toContain("dominant");
    // A clipped label is worse than none, so the sliver simply has none.
    expect(drawn).not.toContain("sliver");
    // The name is never lost: the tooltip carries it whether or not the tile could
    // draw it.
    const described = [...container.querySelectorAll("title")].map(
      (node) => node.textContent,
    );
    expect(described).toEqual(["dominant", "sliver"]);
  });

  // A legend key for a state nothing is in is worse than no key: it invites the reader
  // to hunt for a tile that is not there.
  it("draws a legend key only for a state that occurs", () => {
    render(
      <Treemap
        tiles={[tile("a", 5), tile("b", 3, { muted: true })]}
        ariaLabel="Sizes"
        hint="area = things"
        legend={[
          { kind: "ramp", label: "Parsed" },
          { kind: "muted", label: "Not parsed" },
          { kind: "outlined", label: "Directory" },
        ]}
      />,
    );
    expect(screen.getByText("Parsed")).toBeInTheDocument();
    expect(screen.getByText("Not parsed")).toBeInTheDocument();
    expect(screen.queryByText("Directory")).toBeNull();
  });

  it("names the encoding, so the map is never read as a layout", () => {
    render(
      <Treemap
        tiles={[tile("a", 5)]}
        ariaLabel="Sizes"
        hint="area = code lines"
      />,
    );
    expect(screen.getByText("area = code lines")).toBeInTheDocument();
  });

  // A drillable map has to be operable without a mouse, so an activatable tile is a
  // real button with a real focus stop rather than a click handler on a rectangle.
  it("activates a tile from the mouse and from the keyboard", () => {
    const onActivate = vi.fn();
    render(
      <Treemap
        tiles={[tile("src", 10, { description: "src — directory" })]}
        ariaLabel="Sizes"
        hint="area = things"
        onActivate={onActivate}
      />,
    );
    const button = screen.getByRole("button", { name: "src — directory" });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onActivate.mock.calls[0]![0]).toMatchObject({ key: "src" });
  });

  it("is not a button when nothing can be opened", () => {
    render(
      <Treemap tiles={[tile("a", 5)]} ariaLabel="Sizes" hint="area = things" />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("swaps the legend for the hovered tile's readout", () => {
    const { container } = render(
      <Treemap
        tiles={[tile("a", 3), tile("b", 1)]}
        ariaLabel="Sizes"
        hint="area = things"
        legend={[{ kind: "ramp", label: "Parsed" }]}
        readout={(t) => <>{`${t.label} is ${Math.round(t.share * 100)}%`}</>}
      />,
    );
    expect(screen.getByText("Parsed")).toBeInTheDocument();
    // The largest tile is placed first, so the first group is `a`.
    fireEvent.mouseEnter(container.querySelectorAll("svg > g")[0]!);
    expect(screen.getByText("a is 75%")).toBeInTheDocument();
    expect(screen.queryByText("Parsed")).toBeNull();
  });

  it("renders nothing when every tile is empty", () => {
    const { container } = render(
      <Treemap
        tiles={[tile("a", 0), tile("b", 0)]}
        ariaLabel="Sizes"
        hint="area = things"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
