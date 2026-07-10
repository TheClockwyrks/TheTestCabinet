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
  it("embeds the reference build inline when the variant declares one", () => {
    render(<ReferencePlayable referenceBuild={BUILD} variantName="Base" />);
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(BUILD);
  });

  it("shows a placeholder when the variant declares no reference build", () => {
    render(<ReferencePlayable referenceBuild={null} variantName="Base" />);
    expect(
      screen.getByText(/no reference implementation for this variant/i),
    ).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
