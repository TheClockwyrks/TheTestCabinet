// The memory treemap: every memory the agent ever held, as a tile whose AREA is the
// memory's body length in characters. A list of memories tells you what they are;
// this tells you where the budget actually went — one note that quietly grew to half
// the store is a rectangle you cannot miss and a row you can easily scroll past.
//
// The map itself is the shared {@link Treemap} primitive: the squarified layout, the
// sequential ramp, the surface gaps and the legend rules are the same wherever a
// magnitude is shown as area (a run's produced tree is the other caller). What lives
// here is only the vocabulary — what a tile *is*, and what its two extra states mean:
// a deleted memory is a state rather than another series, so it is neutral and dashed;
// a memory written by another holder of the same instance takes a distinct edge for the
// same reason. Both are named in the legend, so identity is never color alone.

import { Treemap, type TreemapTile } from "@test-cabinet/ui";

// One memory to place. `value` is what the area encodes (its body length in
// characters); `live` distinguishes a memory still held from one since deleted, and
// `byAnother` a memory this agent holds on a shared instance but did not write (see
// gg/memories) — which is a fact about authorship rather than about size, so it is
// carried by the tile's edge and never by its area.
export interface MemoryTile {
  name: string;
  value: number;
  lines: number;
  live: boolean;
  byAnother?: boolean;
}

const numberFmt = new Intl.NumberFormat("en-US");

// The edge color for a memory another holder wrote. The orchestration event color
// rather than the primitive's default second accent, because that is the color this
// surface already spends on "another agent did this".
const FOREIGN_EDGE = "var(--ttc-event-orchestration)";

export function MemoryTreemap({ tiles }: { tiles: MemoryTile[] }) {
  const placed: TreemapTile[] = tiles.map((tile) => ({
    key: tile.name,
    label: tile.name,
    value: tile.value,
    detail: numberFmt.format(tile.value),
    description: `${tile.name} — ${numberFmt.format(tile.value)} characters, ${numberFmt.format(tile.lines)} lines${
      tile.live ? "" : " (deleted)"
    }${tile.byAnother ? " (written by another holder)" : ""}`,
    muted: !tile.live,
    outlined: tile.byAnother,
  }));

  return (
    <Treemap
      tiles={placed}
      ariaLabel="Memory sizes, by characters of body"
      hint="area = characters"
      outlineColor={FOREIGN_EDGE}
      legend={[
        { kind: "ramp", label: "Held" },
        { kind: "muted", label: "Deleted" },
        { kind: "outlined", label: "Another holder" },
      ]}
      readout={(tile) => {
        const source = tiles.find((t) => t.name === tile.key);
        return (
          <>
            <strong>{tile.label}</strong> · {numberFmt.format(tile.value)} chars
            {source ? ` · ${numberFmt.format(source.lines)} lines` : ""} ·{" "}
            {Math.round(tile.share * 100)}% of all memory written
            {tile.muted ? " · deleted" : ""}
            {tile.outlined ? " · another holder" : ""}
          </>
        );
      }}
    />
  );
}
