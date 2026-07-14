import { Link } from "react-router";
import { useModelConfig } from "../data/useModelConfig";
import { routes } from "../routes";
import styles from "./AddModelFromRunControl.module.scss";

interface AddModelFromRunControlProps {
  /**
   * A run of the unknown/derived model to seed the config draft from. When set,
   * the form calls `seedModelFromRun(runId)` to prefill the provider, aliases, and
   * OpenRouter slug it can infer from the run.
   */
  runId?: string;
  /**
   * The canonical model id to pre-claim, when only an id is known (a derived
   * model's detail page, where there is no single run to seed from). Ignored when
   * {@link runId} is given.
   */
  alias?: string;
  /** The control's label. Defaults to "Add this model". */
  label?: string;
  /** Extra class for host-specific placement. */
  className?: string;
}

// A gated affordance for curating a model the catalog only knows from runs — a
// derived (`isConfigured === false`) model, or a run whose model id resolves to
// no catalog entry. It links to the blank config form seeded from the run
// (`?fromRun`) or pre-claiming the id (`?alias`). Shown only where configuring
// models is possible (see {@link useModelConfig}); rendered as `null` — hidden —
// on a read-only or logged-out host rather than a disabled button.
export function AddModelFromRunControl({
  runId,
  alias,
  label = "Add this model",
  className,
}: AddModelFromRunControlProps) {
  const config = useModelConfig();
  if (!config) return null;

  // Prefer seeding from a concrete run; fall back to pre-claiming the bare id.
  const to = runId
    ? routes.modelNew({ fromRun: runId })
    : routes.modelNew(alias ? { alias } : undefined);
  const cls = className ? `${styles.add} ${className}` : styles.add;

  return (
    <Link className={cls} to={to}>
      {label}
    </Link>
  );
}
