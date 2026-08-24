import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayableEmbed, ReferencePlayable } from "./PlayableEmbed";

const BUILD = "https://example.pages.dev/";

describe("PlayableEmbed", () => {
  it("gates a run's build behind a caveat and only loads it on launch", () => {
    render(<PlayableEmbed src={BUILD} title="Playable build" mode="gated" />);

    // The caveat and the explicit Launch control are shown; nothing has loaded.
    expect(screen.getByText(/exactly as it was written/i)).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();

    // Launching mounts the iframe in the fullscreen overlay, and Back closes it
    // back to the gate.
    fireEvent.click(screen.getByRole("button", { name: /launch/i }));
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(BUILD);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("loads a reference build inline with no caveat and a fullscreen toggle", () => {
    render(<PlayableEmbed src={BUILD} title="Reference build" mode="inline" />);

    // No caveat, and the build is already loaded inline. A Fullscreen toggle
    // lifts it into the overlay (from which Back returns inline).
    expect(
      screen.queryByText(/exactly as it was written/i),
    ).not.toBeInTheDocument();
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(BUILD);
    fireEvent.click(screen.getByRole("button", { name: /fullscreen/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(BUILD);
  });
});

describe("ReferencePlayable", () => {
  it("embeds the anchored engine's reference build inline", () => {
    render(
      <ReferencePlayable
        referenceBuilds={{ none: BUILD }}
        variantName="Base"
        engine="none"
        version="v1.0.0"
      />,
    );
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(BUILD);
    // The engine follows the page header's anchor; there is no switch here.
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("shows a placeholder when the variant declares no reference build", () => {
    render(
      <ReferencePlayable
        referenceBuilds={{}}
        variantName="Base"
        engine="none"
        version="v1.0.0"
      />,
    );
    expect(
      screen.getByText(/no reference implementation for this variant/i),
    ).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("names the engines that do have builds when the anchored one has none", () => {
    // Builds exist, just not for the anchored engine — say which coordinate
    // lacks one and which engines to re-anchor to, rather than the flat "no
    // reference implementation" of a variant with none at all.
    render(
      <ReferencePlayable
        referenceBuilds={{ "simple-2d": BUILD }}
        variantName="Base"
        engine="none"
        version="v1.2.0"
      />,
    );
    expect(
      screen.getByText(/no reference build for None at v1\.2\.0/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/published for Simple 2D/i)).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
