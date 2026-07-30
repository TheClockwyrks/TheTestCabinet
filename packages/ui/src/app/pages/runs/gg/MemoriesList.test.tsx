// The Memories panel's **scope badge** — the one thing about a memory panel that a
// snapshot of the set cannot tell you.
//
// Once a memory instance can be shared between agents (see gg/memories), two agents'
// panels showing the same three notes might be showing ONE store they are curating
// together, or two stores that happen to agree. Those are very different runs, and the
// difference is invisible in the memories themselves — so the snapshot carries the
// holder's scope and whether it may write, and the panel says so.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GgMemoryState } from "./useGgRunState";
import { MemoriesList } from "./MemoriesList";

// A one-memory scratchpad panel, varying only how its holder bound the instance.
function memory(over: Partial<GgMemoryState> = {}): GgMemoryState {
  return {
    strategy: "scratchpad",
    memories: [
      { name: "controls", description: "Input scheme.", len: 20, lines: 1 },
    ],
    count: 1,
    totalLen: 20,
    totalLines: 1,
    peak: { count: 1, totalLen: 20, totalLines: 1 },
    caps: {
      maxCount: 8,
      maxLenPerMemory: 2000,
      maxTotalLen: 8000,
      maxLenIndex: null,
      maxLenDescription: null,
      maxResults: null,
    },
    scope: "isolated",
    writable: true,
    history: [],
    ...over,
  };
}

describe("MemoriesList", () => {
  it("badges a shared instance and says who else holds it", () => {
    render(<MemoriesList memory={memory({ scope: "shared" })} />);
    expect(screen.getByText("shared")).toBeInTheDocument();
    expect(
      screen.getByText("Shared with every instance of this agent"),
    ).toBeInTheDocument();
    expect(screen.queryByText("read-only")).not.toBeInTheDocument();
  });

  it("marks a read-only inherited handle as one", () => {
    render(
      <MemoriesList memory={memory({ scope: "read-only", writable: false })} />,
    );
    expect(screen.getByText("read-only")).toBeInTheDocument();
    expect(
      screen.getByText(/Inherited from this agent's spawner/),
    ).toHaveTextContent("may read them, not change them");
  });

  it("badges nothing for an isolated instance, which is what memory always was", () => {
    render(<MemoriesList memory={memory()} />);
    expect(screen.queryByText("isolated")).not.toBeInTheDocument();
    // The panel itself still renders: the badge is additive, not a gate.
    expect(screen.getAllByText("controls").length).toBeGreaterThan(0);
  });

  it("badges nothing for a record written before scoping existed", () => {
    render(<MemoriesList memory={memory({ scope: "" })} />);
    expect(screen.getAllByText("controls").length).toBeGreaterThan(0);
    expect(screen.queryByText("read-only")).not.toBeInTheDocument();
  });
});
