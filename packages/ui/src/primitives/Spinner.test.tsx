import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner, type SpinnerVariant } from "./Spinner";
import flapSvg from "./loading/arcade-flap.svg?raw";
import marchSvg from "./loading/arcade-march.svg?raw";
import squadronSvg from "./loading/arcade-squadron.svg?raw";

// The marks' own source, so the ratio each `<img>` states is checked against the
// drawing rather than against a number restated here: a redrawn mark whose
// proportions changed fails this test instead of shipping a spinner that jumps
// shape the moment its SVG lands.
const SOURCES: Record<SpinnerVariant, string> = {
  flap: flapSvg,
  march: marchSvg,
  squadron: squadronSvg,
};

function declaredSize(variant: SpinnerVariant): {
  width: string;
  height: string;
} {
  const svg = SOURCES[variant];
  const width = /\bwidth="(\d+)"/.exec(svg);
  const height = /\bheight="(\d+)"/.exec(svg);
  if (width?.[1] === undefined || height?.[1] === undefined) {
    throw new Error(`arcade-${variant}.svg declares no width/height`);
  }
  return { width: width[1], height: height[1] };
}

const VARIANTS: SpinnerVariant[] = ["flap", "march", "squadron"];

describe("Spinner", () => {
  // Regression: an `<img>` carrying no dimensions has no intrinsic ratio until
  // its SVG has loaded, so whichever axis the stylesheet leaves as `auto` lays
  // out at zero until then. The fitted `squadron` sizes by height, so a showcase
  // replay's loading state drew its arcade cabinet 0px wide — a thin vertical
  // bar that sprang open once the 73KB SVG arrived.
  it.each(VARIANTS)(
    "states %s's aspect ratio before the SVG loads",
    (variant) => {
      render(<Spinner variant={variant} label="Loading…" />);
      const art = screen.getByRole("status").querySelector("img");
      const { width, height } = declaredSize(variant);
      expect(art?.getAttribute("width")).toBe(width);
      expect(art?.getAttribute("height")).toBe(height);
    },
  );
});
