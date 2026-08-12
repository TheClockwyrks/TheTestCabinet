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

    // The read-only definition view shows no verdict marker at all — not even the
    // blank checkbox glyph, which just clutters an unanswerable rubric.
    expect(screen.queryByText("☐")).toBeNull();
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
    const controls = screen.getByText(/Controls work/).closest("div")!;
    expect(within(controls).getByText("0/1")).toBeTruthy();
  });
});

// The categories grammar (`[review] format = 2`): the case may still declare
// scoring domains for its qualitative ratings, but no checklist point rolls up to
// one — every top-level item is a scoring category, so its title heads its own
// points and there is no synthetic "General" bucket.
const categorized: ReviewModel = {
  domains: [
    { id: "single-player", name: "Single player", description: "Solo." },
    { id: "versus", name: "Versus", description: "Two players." },
  ],
  items: [
    {
      id: "gameplay",
      title: "Gameplay",
      text: "",
      weight: 2,
      subItems: [
        { id: "scoring", title: "Scores on a goal", description: "A goal.", weight: 1 },
        { id: "match-win", title: "Match win at 11", description: "First to 11.", weight: 1 },
      ],
    },
    {
      id: "ball",
      title: "Ball",
      text: "",
      weight: 1,
      subItems: [{ id: "trail", title: "Motion trail", weight: 1 }],
    },
  ],
};

describe("ReviewChecklist (categories grammar, no domained items)", () => {
  it("heads each category by its title with no 'General' bucket", () => {
    render(<ReviewChecklist model={categorized} />);
    // Every category is its own heading…
    expect(screen.getByRole("heading", { name: "Gameplay" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ball" })).toBeTruthy();
    // …and no "General" heading is invented for the domainless points.
    expect(screen.queryByRole("heading", { name: "General" })).toBeNull();
    // The declared (but unassigned) scoring domains do not head checklist blocks.
    expect(screen.queryByRole("heading", { name: "Single player" })).toBeNull();
    // Each category's points list beneath it, with their prose.
    expect(screen.getByText(/Scores on a goal/)).toBeTruthy();
    expect(screen.getByText("A goal.")).toBeTruthy();
    expect(screen.getByText(/Motion trail/)).toBeTruthy();
  });

  it("shows only graded points under a category in verdict mode", () => {
    render(
      <ReviewChecklist
        model={categorized}
        verdicts={[{ id: "gameplay.scoring", status: "pass" }]}
      />,
    );
    // The graded point renders with its marker…
    expect(screen.getByText(/Scores on a goal/)).toBeTruthy();
    expect(screen.getByText("Pass")).toBeTruthy();
    // …its ungraded sibling does not, and the wholly-ungraded "Ball" category is
    // dropped entirely (no heading).
    expect(screen.queryByText(/Match win at 11/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Ball" })).toBeNull();
  });

  it("surfaces a scoring-excluded (errata) point 'not scored' even when unrated", () => {
    // A category whose middle sub-item an erratum excluded from scoring
    // (`scored: false`), which the reviewer left unrated — it must still show,
    // marked "not scored", while an ordinary unrated sibling stays hidden.
    const withExcluded: ReviewModel = {
      domains: [],
      items: [
        {
          id: "foundations",
          title: "Foundations",
          text: "",
          weight: 3,
          subItems: [
            { id: "ace-only", title: "Ace only", weight: 1 },
            { id: "reject-offsuit", title: "Reject off-suit", weight: 1, scored: false },
            { id: "build-up", title: "Build up", weight: 1 },
          ],
        },
      ],
    };
    render(
      <ReviewChecklist
        model={withExcluded}
        verdicts={[{ id: "foundations.ace-only", status: "pass" }]}
      />,
    );
    // The graded point renders with its marker…
    expect(screen.getByText(/Ace only/)).toBeTruthy();
    // …the excluded point renders too, marked "not scored", despite no verdict…
    expect(screen.getByText(/Reject off-suit/)).toBeTruthy();
    expect(screen.getByText("not scored")).toBeTruthy();
    // …keeping the status gutter, marked "Skip" (not the unanswered box), so it reads
    // as not considered while staying aligned with its rated sibling…
    expect(screen.getByText("Skip")).toBeTruthy();
    expect(screen.queryByText("☐")).toBeNull();
    // …while the ordinary ungraded sibling stays hidden.
    expect(screen.queryByText(/Build up/)).toBeNull();
  });
});
