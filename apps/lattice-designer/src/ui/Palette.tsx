// The palette: pick what to place and configure it before you drop it. The kind
// picker also has a Select tool (no placement — click an entity to inspect it). The
// options shown below adapt to the kind: a belt's tier, a source's item/lane/period,
// or a machine's recipe (only recipes valid for that machine, per the smelting split).

import {
  ASSEMBLER_RECIPES,
  BELT_TIERS,
  ENTITY_KINDS,
  FURNACE_RECIPES,
  isDirectional,
  ITEMS,
  LANES,
  type BeltTier,
  type EntityKind,
  type Item,
  type Lane,
  type ToolOptions,
} from "../model";
import type { Tool } from "./App";

interface PaletteProps {
  tool: Tool;
  onKind: (kind: EntityKind | "select") => void;
  onRotate: () => void;
  onOpts: (patch: Partial<ToolOptions>) => void;
}

const KIND_LABELS: Record<EntityKind | "select", string> = {
  select: "Select",
  belt: "Belt",
  splitter: "Splitter",
  inserter: "Inserter",
  assembler: "Assembler",
  furnace: "Furnace",
  source: "Source",
  sink: "Sink",
};

export function Palette({ tool, onKind, onRotate, onOpts }: PaletteProps) {
  const directional = tool.kind !== "select" && isDirectional(tool.kind);

  return (
    <aside className="palette">
      <h2>Components</h2>
      <div className="kind-grid">
        <button
          type="button"
          className={tool.kind === "select" ? "kind active" : "kind"}
          onClick={() => onKind("select")}
        >
          {KIND_LABELS.select}
        </button>
        {ENTITY_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={tool.kind === kind ? "kind active" : "kind"}
            onClick={() => onKind(kind)}
          >
            {KIND_LABELS[kind]}
          </button>
        ))}
      </div>

      <div className="field">
        <span className="field-label">Facing</span>
        <div className="facing">
          <button
            type="button"
            onClick={onRotate}
            disabled={!directional}
            title="Rotate (R)"
          >
            ⟳ Rotate
          </button>
          <span className="dir">{directional ? tool.dir : "—"}</span>
        </div>
      </div>

      {tool.kind === "belt" && (
        <Field label="Tier">
          <select
            value={tool.opts.tier}
            onChange={(e) => onOpts({ tier: e.target.value as BeltTier })}
          >
            {BELT_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      )}

      {tool.kind === "source" && (
        <>
          <Field label="Item">
            <select
              value={tool.opts.item}
              onChange={(e) => onOpts({ item: e.target.value as Item })}
            >
              {ITEMS.map((it) => (
                <option key={it} value={it}>
                  {it}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lane">
            <select
              value={tool.opts.lane}
              onChange={(e) => onOpts({ lane: e.target.value as Lane })}
            >
              {LANES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period (ticks)">
            <input
              type="number"
              min={1}
              value={tool.opts.period}
              onChange={(e) =>
                onOpts({ period: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </Field>
        </>
      )}

      {tool.kind === "assembler" && (
        <Field label="Recipe">
          <select
            value={tool.opts.assemblerRecipe}
            onChange={(e) =>
              onOpts({
                assemblerRecipe: e.target
                  .value as ToolOptions["assemblerRecipe"],
              })
            }
          >
            {ASSEMBLER_RECIPES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      )}

      {tool.kind === "furnace" && (
        <Field label="Recipe (smelting)">
          <select
            value={tool.opts.furnaceRecipe}
            onChange={(e) =>
              onOpts({
                furnaceRecipe: e.target.value as ToolOptions["furnaceRecipe"],
              })
            }
          >
            {FURNACE_RECIPES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      )}

      <p className="hint">
        Left-click to place (drag to paint belts). Right-click deletes a
        component and anything riding it. Press <kbd>R</kbd> to rotate.
      </p>
    </aside>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
