import { engineName } from "../../data/engines";
import type { EngineChoice } from "../../data/useEngineChoice";
import exec from "../runs/RunExec.module.scss";

// The Engine field on a scheduling editor's add-a-case row, shared by the plan
// editor's case picker and the ladder editor's rung list. A pin and a rung commit to
// an engine in exactly the same way, and a field written twice is a field that drifts
// — one editor would end up hiding what the other shows, and the two would stop being
// the same coordinate the new-run form launches.

/**
 * The engine a pin or a rung will name, as a field on the shared Test grid.
 *
 * Always on screen, unlike the new-run form's, which hides itself once the version has
 * decided. The engine is part of what the reviewer commits the plan to, and one they
 * were never shown is one they cannot check against the pill or the rung row it
 * produced — so a version offering a single engine names it, read-only, rather than
 * leaving the field out.
 */
export function CaseEngineField({
  choice,
  title,
}: {
  /** The selection over the resolved version's supported set. */
  choice: EngineChoice;
  /** What the engine means on this surface — a plan's cells, or a climb's rungs. */
  title: string;
}) {
  const { options, engine, setEngine } = choice;
  // What the field lists. A version that has not resolved yet offers nothing, and a
  // select with no options paints as an empty box beside an add button perfectly
  // willing to file an engineless pin — a field that says nothing about the pin it is
  // producing. So the fallback is the engine the pin would actually carry, which is
  // what `engine` already resolves to.
  const listed = options.length > 0 ? options : [engine];
  return (
    <label className={exec.field}>
      <span className={exec.fieldLabel}>Engine</span>
      <select
        className={exec.select}
        value={engine}
        onChange={(e) => setEngine(e.target.value)}
        // Nothing to choose is not nothing to say: the one engine on offer is still
        // the engine the pin carries, so the field shows it rather than leaving the
        // reviewer to infer it from the pill afterwards.
        disabled={listed.length <= 1}
        title={title}
      >
        {listed.map((slug) => (
          <option key={slug} value={slug}>
            {engineName(slug)}
          </option>
        ))}
      </select>
    </label>
  );
}
