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

  // gg attributes a `memory_revision` to the agent that made the write, so a linked
  // holder's own stream carries the history of ITS writes and nothing else, while its
  // snapshot is the whole store. Listing only the history would report a store of two
  // notes as the one this agent happened to type; listing the snapshot unmarked would
  // claim it wrote them all.
  it("marks a memory it holds but did not write, on a linked instance", () => {
    render(
      <MemoriesList
        memory={memory({
          scope: "inherited",
          memories: [
            {
              name: "controls",
              description: "Input scheme.",
              len: 20,
              lines: 1,
            },
            { name: "runbook", description: "How to roll.", len: 40, lines: 2 },
          ],
          count: 2,
          history: [
            {
              name: "controls",
              revisions: [
                {
                  revision: 1,
                  change: "written",
                  description: "Input scheme.",
                  body: "WASD.",
                  len: 20,
                  lines: 1,
                },
              ],
              live: true,
              description: "Input scheme.",
              len: 20,
              lines: 1,
            },
          ],
        })}
      />,
    );
    // Both are listed — the store is the store, whoever wrote it…
    expect(screen.getAllByText("controls").length).toBeGreaterThan(0);
    expect(screen.getAllByText("runbook").length).toBeGreaterThan(0);
    // …and exactly the one this agent did not write is attributed, which is also why
    // it shows no revision history.
    expect(screen.getAllByText("another holder").length).toBe(1);
  });

  it("attributes nothing on an isolated instance, where there is nobody else", () => {
    render(
      <MemoriesList
        memory={memory({
          scope: "isolated",
          memories: [
            {
              name: "controls",
              description: "Input scheme.",
              len: 20,
              lines: 1,
            },
          ],
          history: [],
        })}
      />,
    );
    expect(screen.queryByText("another holder")).not.toBeInTheDocument();
  });
});
