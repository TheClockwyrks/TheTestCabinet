import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  MaterialResultView,
  UiResultView,
} from "../../../data/galleryContext";
import {
  MaterialResultSection,
  UiResultSection,
} from "./UiMaterialResultSection";

describe("UiResultSection", () => {
  const view: UiResultView = {
    elements: [
      {
        name: "panel",
        imageUrl: "element-0.png",
        width: 64,
        height: 64,
        nineSlice: { left: 8, right: 8, top: 8, bottom: 8 },
        detail: null,
      },
      {
        name: "icon",
        imageUrl: "element-1.png",
        width: 32,
        height: 32,
        nineSlice: null,
        detail: null,
      },
    ],
    detail: null,
  };

  it("shows each element and a stretch preview only for a nine-slice element", () => {
    render(<UiResultSection view={view} />);
    expect(screen.getByText("panel")).toBeInTheDocument();
    expect(screen.getByText("icon")).toBeInTheDocument();
    // The nine-slice element renders both its static art and a stretch preview; the
    // plain element renders only its art.
    expect(
      screen.getByLabelText("Nine-slice stretch preview"),
    ).toBeInTheDocument();
    expect(screen.getByAltText("panel")).toHaveAttribute("src", "element-0.png");
  });
});

describe("MaterialResultSection", () => {
  const view: MaterialResultView = {
    maps: [
      {
        name: "base-color",
        imageUrl: "map-0.png",
        colorSpace: "srgb",
        detail: null,
      },
      {
        name: "normal",
        imageUrl: "map-1.png",
        colorSpace: "linear",
        detail: null,
      },
    ],
    size: 512,
    tiling: 2,
    baseColorUrl: "map-0.png",
    detail: null,
  };

  it("lists each map with its color space and the tiling scale", () => {
    // Under jsdom WebGL is unavailable, so the lit preview falls back to the 2×2
    // tiling — the section still renders every map without a WebGL context.
    render(<MaterialResultSection view={view} />);
    expect(screen.getByText("base-color")).toBeInTheDocument();
    expect(screen.getByText("normal")).toBeInTheDocument();
    expect(screen.getByText(/tiling 2/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("2×2 tiling").length).toBeGreaterThan(0);
  });
});
