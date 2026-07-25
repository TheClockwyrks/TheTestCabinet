// The inspector: edit the entity picked with the Select tool. It shows only the
// fields the selected kind carries — a source's item/lane/period, a machine's
// recipe, a belt's tier, a facing for anything directional — and can delete it.
// Every edit routes through the design, so the sim replays and the change is visible
// at once.

import {
  ASSEMBLER_RECIPES,
  BELT_TIERS,
  DIRS,
  FURNACE_RECIPES,
  ITEMS,
  LANES,
  type DesignEntity,
  type Dir,
} from "../model";
import { RecipeInfo } from "./RecipeInfo";

interface InspectorProps {
  index: number | null;
  entity: DesignEntity | null;
  onUpdate: (index: number, patch: Partial<DesignEntity>) => void;
  onDelete: (index: number) => void;
}

export function Inspector({
  index,
  entity,
  onUpdate,
  onDelete,
}: InspectorProps) {
  if (index === null || !entity) {
    return (
      <aside className="inspector">
        <h2>Inspector</h2>
        <p className="hint">
          Pick the <strong>Select</strong> tool and click a component to edit
          it.
        </p>
      </aside>
    );
  }

  const patch = (p: Partial<DesignEntity>) => onUpdate(index, p);

  return (
    <aside className="inspector">
      <h2>Inspector</h2>
      <div className="inspect-head">
        <span className="badge">{entity.type}</span>
        <span className="coord">
          ({entity.x}, {entity.y})
        </span>
      </div>

      {"dir" in entity && (
        <Field label="Facing">
          <select
            value={entity.dir}
            onChange={(e) =>
              patch({ dir: e.target.value as Dir } as Partial<DesignEntity>)
            }
          >
            {DIRS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      )}

      {entity.type === "belt" && (
        <Field label="Tier">
          <select
            value={entity.tier}
            onChange={(e) =>
              patch({ tier: e.target.value } as Partial<DesignEntity>)
            }
          >
            {BELT_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      )}

      {entity.type === "source" && (
        <>
          <Field label="Item">
            <select
              value={entity.item}
              onChange={(e) =>
                patch({ item: e.target.value } as Partial<DesignEntity>)
              }
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
              value={entity.lane}
              onChange={(e) =>
                patch({ lane: e.target.value } as Partial<DesignEntity>)
              }
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
              value={entity.period}
              onChange={(e) =>
                patch({
                  period: Math.max(1, Number(e.target.value) || 1),
                } as Partial<DesignEntity>)
              }
            />
          </Field>
        </>
      )}

      {entity.type === "assembler" && (
        <Field label="Recipe">
          <select
            value={entity.recipe}
            onChange={(e) =>
              patch({ recipe: e.target.value } as Partial<DesignEntity>)
            }
          >
            {ASSEMBLER_RECIPES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <RecipeInfo recipe={entity.recipe} />
        </Field>
      )}

      {entity.type === "furnace" && (
        <Field label="Recipe (smelting)">
          <select
            value={entity.recipe}
            onChange={(e) =>
              patch({ recipe: e.target.value } as Partial<DesignEntity>)
            }
          >
            {FURNACE_RECIPES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <RecipeInfo recipe={entity.recipe} />
        </Field>
      )}

      <button type="button" className="danger" onClick={() => onDelete(index)}>
        Delete component
      </button>
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
