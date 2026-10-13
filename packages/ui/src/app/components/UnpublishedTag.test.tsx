import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnpublishedTag } from "./UnpublishedTag";
import {
  ARTIFACTS_NOT_STORED_LABEL,
  ARTIFACTS_RECLAIMED_LABEL,
} from "../../client/artifactPresence";

describe("UnpublishedTag", () => {
  it("reads as plain unpublished for a run that can still be published", () => {
    const { container } = render(<UnpublishedTag />);

    expect(screen.getByRole("img", { name: "Unpublished" })).toBeTruthy();
    expect(
      container.querySelector("[data-artifacts-missing]"),
      "an ordinary unpublished run carries no missing-artifacts mark",
    ).toBeNull();
  });

  it("says a run's artifacts are not stored and that it cannot be published", () => {
    const { container } = render(<UnpublishedTag artifactsMissing />);

    // One marker, not two: the same triangle, relabelled with the reason.
    const icon = screen.getByRole("img");
    const label = icon.getAttribute("aria-label") ?? "";
    expect(label).toContain("Unpublished");
    expect(label).toContain(ARTIFACTS_NOT_STORED_LABEL);
    expect(label).toContain("cannot be published");

    const tag = container.querySelector("[data-artifacts-missing='true']");
    expect(tag).not.toBeNull();
    // The hover tooltip carries the same sentence as the accessible name.
    expect(tag!.getAttribute("title")).toBe(label);
  });

  it("stays the plain marker for a run whose artifacts were removed after retention", () => {
    const { container } = render(<UnpublishedTag artifactsReclaimed />);

    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label).toContain("Unpublished");
    expect(label).toContain(ARTIFACTS_RECLAIMED_LABEL);
    expect(label).toContain("removed after the retention period");

    // Nothing is wrong, so it does not take the colour of a fault.
    expect(container.querySelector("[data-artifacts-missing]")).toBeNull();
    const tag = container.querySelector("[data-artifacts-reclaimed='true']");
    expect(tag).not.toBeNull();
    expect(tag!.getAttribute("title")).toBe(label);
    expect(tag!.className).not.toContain("missing");
  });

  it("reads a tree that is both reclaimed and not stored as reclaimed", () => {
    const { container } = render(
      <UnpublishedTag artifactsMissing artifactsReclaimed />,
    );

    expect(container.querySelector("[data-artifacts-missing]")).toBeNull();
    expect(
      container.querySelector("[data-artifacts-reclaimed='true']"),
    ).not.toBeNull();
    expect(
      screen.getByRole("img").getAttribute("aria-label") ?? "",
    ).not.toContain(ARTIFACTS_NOT_STORED_LABEL);
  });
});
