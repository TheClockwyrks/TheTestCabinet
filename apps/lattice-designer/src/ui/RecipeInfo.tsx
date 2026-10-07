// A small read-out of what a machine's recipe needs and makes: the required input
// items (with counts), the output, and the craft cost. Shown under a recipe dropdown
// so it is clear what has to be routed into the machine to produce its item.

import { RECIPES } from "../model";

export function RecipeInfo({ recipe }: { recipe: string }) {
  const r = RECIPES[recipe];
  if (!r) return null;
  return (
    <div className="recipe-info">
      <div className="recipe-line">
        <span className="recipe-tag">Requires</span>
        <span className="recipe-items">
          {r.inputs.map((io) => (
            <span key={io.item} className="recipe-item">
              {io.item} <span className="recipe-count">×{io.count}</span>
            </span>
          ))}
        </span>
      </div>
      <div className="recipe-line">
        <span className="recipe-tag">Produces</span>
        <span className="recipe-items">
          {r.outputs.map((io) => (
            <span key={io.item} className="recipe-item">
              {io.item} <span className="recipe-count">×{io.count}</span>
            </span>
          ))}
        </span>
      </div>
      <div className="recipe-line recipe-craft">{r.craft} ticks to craft</div>
    </div>
  );
}
