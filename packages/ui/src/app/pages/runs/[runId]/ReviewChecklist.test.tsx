import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReviewModel } from "../../../data/galleryContext";
import { ReviewChecklist } from "./ReviewChecklist";

// A model with two domains, a whole-item, a sub-itemed item, and an un-domained
// ("General") item, so the grouping, numbering, and sub-item lettering are all
// exercised.
const model: ReviewModel = {
  domains: [
    { id: "core", name: "Core", description: "The core loop." },
    { id: "polish", name: "Polish", description: "The finish." },
  ],
  items: [
    { id: "loop", title: "Has a game loop", text: "", weight: 2, domain: "core" },
    {
      id: "controls",
      title: "Controls work",
      text: "",
      weight: 3,
      domain: "core",
      subItems: [
        { id: "kb", title: "Keyboard" },
        { id: "mouse", title: "Mouse" },
      ],
    },
    { id: "sound", title: "Has sound", text: "", weight: 1, domain: "polish" },
    { id: "misc", title: "Some general item", text: "", weight: 1 },
  ],
};

describe("ReviewChecklist (read-only definition, no verdicts)", () => {
  it("renders every declared item and sub-item unanswered", () => {
    render(<ReviewChecklist model={model} />);

    // Every whole-item and sub-item title is present.
    expect(screen.getByText(/Has a game loop/)).toBeTruthy();
    expect(screen.getByText(/Controls work/)).toBeTruthy();
    expect(screen.getByText(/Keyboard/)).toBeTruthy();
    expect(screen.getByText(/Mouse/)).toBeTruthy();
    expect(screen.getByText(/Has sound/)).toBeTruthy();
    expect(screen.getByText(/Some general item/)).toBeTruthy();

    // Nothing is judged: no Pass/Fail markers appear anywhere.
    expect(screen.queryByText("Pass")).toBeNull();
    expect(screen.queryByText("Fail")).toBeNull();

    // The un-domained item falls under a "General" group heading.
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
  });

  it("groups items under their domain names and shows weights", () => {
    render(<ReviewChecklist model={model} />);
    expect(screen.getByRole("heading", { name: "Core" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Polish" })).toBeTruthy();
    // A whole-item shows its flat weight; the sub-itemed parent shows its own.
    expect(screen.getByText(/\(2 pts\)/)).toBeTruthy();
    expect(screen.getByText(/\(3 pts\)/)).toBeTruthy();
  });
});

describe("ReviewChecklist (verdict mode)", () => {
  it("shows the reviewer's Pass/Fail markers and hides unjudged sub-items", () => {
    render(
      <ReviewChecklist
        model={model}
        verdicts={[
          { id: "loop", status: "pass" },
          // Only the keyboard sub-item was judged; the mouse one is omitted.
          { id: "controls.kb", status: "fail", note: "sticky" },
          { id: "sound", status: "pass" },
          { id: "misc", status: "pass" },
        ]}
      />,
    );
    expect(screen.getAllByText("Pass").length).toBeGreaterThan(0);
    expect(screen.getByText("Fail")).toBeTruthy();
    // The reviewer's note rides beneath its row.
    expect(screen.getByText("sticky")).toBeTruthy();
    // The un-judged Mouse sub-item is not rendered in verdict mode.
    expect(screen.queryByText(/Mouse/)).toBeNull();
    // The sub-itemed parent shows its passed/total tally (0 of 1 judged passed).
    const controls = screen.getByText(/Controls work/).closest("li")!;
    expect(within(controls).getByText("0/1")).toBeTruthy();
  });
});
