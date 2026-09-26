import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AESTHETIC_META } from "../ratings";
import { AestheticBadge } from "./AestheticBadge";

// The aesthetic badge is the second rating channel's chip, rendered beside the
// functional RatingBadge. It must name its channel (so a lone badge is never
// mistaken for a functional rating), carry its tier for the stylesheet, and mark
// the reserved Legendary tier apart from the rest.
describe("AestheticBadge", () => {
  it("renders the tier's label, names the channel, and exposes the description", () => {
    render(<AestheticBadge rating="amazing" />);
    const badge = screen.getByLabelText("Aesthetic: Amazing");
    expect(badge.textContent).toBe("Amazing");
    expect(badge.getAttribute("data-aesthetic")).toBe("amazing");
    expect(badge.getAttribute("title")).toContain(
      AESTHETIC_META.amazing.description,
    );
  });

  it("marks Legendary as its own tier so the stylesheet can shimmer it", () => {
    render(<AestheticBadge rating="legendary" />);
    const badge = screen.getByLabelText("Aesthetic: Legendary");
    expect(badge.getAttribute("data-aesthetic")).toBe("legendary");
    // The reserved tier's description says so, so a hover explains why it looks
    // different from Amazing (the normal maximum).
    expect(badge.getAttribute("title")).toMatch(/reserved/i);
  });

  it("renders every tier with a distinct data attribute", () => {
    const { container } = render(
      <>
        <AestheticBadge rating="legendary" />
        <AestheticBadge rating="amazing" />
        <AestheticBadge rating="good" />
        <AestheticBadge rating="okay" />
        <AestheticBadge rating="slop" />
      </>,
    );
    const tiers = [...container.querySelectorAll("[data-aesthetic]")].map(
      (el) => el.getAttribute("data-aesthetic"),
    );
    expect(tiers).toEqual(["legendary", "amazing", "good", "okay", "slop"]);
  });
});
