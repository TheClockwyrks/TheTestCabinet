import { describe, expect, it } from "vitest";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import { artifactsNotStored, markArtifactsNotStored } from "./artifactPresence";

// A card carrying only an id: presence is keyed on nothing else.
function card(id: string): RunSummary {
  return { id, publishedAt: "" } as unknown as RunSummary;
}

describe("artifact presence on a summary card", () => {
  it("marks exactly the cards the backend named as not stored", () => {
    const [kept, lost] = markArtifactsNotStored(
      [card("kept"), card("lost")],
      ["lost"],
    );
    expect(artifactsNotStored(kept!)).toBe(false);
    expect(artifactsNotStored(lost!)).toBe(true);
  });

  it("reads a card nothing was said about as not known to be missing", () => {
    // Unknown is not "missing": a run a backend has not reconciled, and every card
    // from a source that does not track presence, stays publishable-looking.
    expect(artifactsNotStored(card("unknown"))).toBe(false);
  });

  it("hands the cards back untouched when the page names none", () => {
    const cards = [card("a"), card("b")];
    for (const none of [undefined, null, []]) {
      expect(markArtifactsNotStored(cards, none)).toBe(cards);
    }
  });

  it("leaves the card it was given unmarked", () => {
    const original = card("lost");
    markArtifactsNotStored([original], ["lost"]);
    expect(artifactsNotStored(original)).toBe(false);
  });

  it("ignores an id that is not on the page", () => {
    const [only] = markArtifactsNotStored([card("a")], ["elsewhere"]);
    expect(artifactsNotStored(only!)).toBe(false);
  });
});
