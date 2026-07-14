import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { VariantSummary } from "../data/testCases";
import { VariantInputsView } from "./VariantViews";

// A variant carrying one prose spec, one script starter, and one shipped package,
// so the Inputs view exercises every tag the two roles + packages produce.
function variant(overrides: Partial<VariantSummary> = {}): VariantSummary {
  return {
    slug: "base",
    name: "Base",
    description: null,
    prompt: "Build it.",
    seededInputs: [
      { path: "specs/brief.md", kind: "text", role: "spec", text: "# Brief" },
      {
        path: "build.py",
        kind: "text",
        role: "script",
        text: "import bpy\n",
      },
    ],
    packages: [
      {
        name: "@test-cabinet/particle-runtime",
        description: "Plays a produced particle system live on a canvas.",
      },
    ],
    referenceScreenshots: [],
    reviewItems: [],
    domains: [],
    referenceBuild: null,
    ...overrides,
  };
}

describe("VariantInputsView", () => {
  it("tags a script starter and a shipped package distinctly from a spec", () => {
    render(<VariantInputsView variant={variant()} />);

    // The header tags tell prompt from spec from script from package.
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.getByText("Spec")).toBeInTheDocument();
    expect(screen.getByText("Script")).toBeInTheDocument();
    expect(screen.getByText("Package")).toBeInTheDocument();

    // The script keeps its path; the package entry is keyed by its npm name.
    expect(screen.getByText("build.py")).toBeInTheDocument();
    expect(
      screen.getByText("@test-cabinet/particle-runtime"),
    ).toBeInTheDocument();
  });

  it("reveals the package's UI-only description when expanded", () => {
    render(<VariantInputsView variant={variant()} />);

    // Bodies are collapsed until opened; expand the package panel by its name.
    fireEvent.click(screen.getByText("@test-cabinet/particle-runtime"));
    expect(
      screen.getByText("Plays a produced particle system live on a canvas."),
    ).toBeInTheDocument();
  });

  it("tags every seeded file a Spec when no role is a script", () => {
    render(
      <VariantInputsView
        variant={variant({
          seededInputs: [
            { path: "specs/brief.md", kind: "text", text: "# Brief" },
          ],
          packages: [],
        })}
      />,
    );

    expect(screen.getByText("Spec")).toBeInTheDocument();
    expect(screen.queryByText("Script")).not.toBeInTheDocument();
    expect(screen.queryByText("Package")).not.toBeInTheDocument();
  });
});
