import { useState } from "react";
import { Panel } from "@clockwyrks/ui";
// The very player a run's Results tab launches per scored scenario. It is engine
// agnostic — a module URL and a scenario URL — so the reference drives it unchanged,
// and a reference factory is watched exactly the way the run compared against it is.
import { PlaybackOverlay } from "../../runs/[runId]/LatticePlaybackSection";
import {
  REFERENCE_ENGINE_URL,
  REFERENCE_SCENARIOS,
  referenceLabel,
} from "../../runs/lattice/reference";
import styles from "./ReferencePlaybackView.module.scss";

/**
 * A performance case's reference, rendered natively on the case-detail Reference
 * tab: its scored factories, played through the authoritative engine.
 *
 * This is the third shape a reference takes, beside `ReferencePlayable` (an
 * end-to-end variant's deployed build, iframed) and `ReferenceSheetView` (an asset
 * variant's published frames). A performance case produces neither a site nor an
 * image — what it produces is an *engine* — so its reference is what that engine
 * does: the scored factories running correctly. Before this, a reader could watch a
 * model's submitted factory on a run and had nothing to compare it against.
 *
 * Both halves ship with the bundle (see `../../runs/lattice/reference.ts`), so this
 * needs no run, no backend, and no snapshot bucket — it renders identically on the
 * console, the desktop app, and the static site. That is why it takes no props: a
 * performance case's reference is a property of the case's shipped bundle, not of the
 * selected variant (v1 declares a single one) or of the host.
 *
 * Nothing loads until a viewer presses Play. The reference engine and a scenario are
 * a few hundred KB between them, and stepping the window builds thousands of frames
 * in memory, so auto-playing three factories on tab open would be an expensive
 * surprise — the same reason a run's playback is launched per row rather than mounted.
 */
export function ReferencePlaybackView() {
  // One player at a time (it covers the viewport); the launched slug selects which
  // factory it plays.
  const [launched, setLaunched] = useState<string | null>(null);
  const active =
    REFERENCE_SCENARIOS.find((scenario) => scenario.slug === launched) ?? null;

  return (
    <>
      <Panel>
        {/* No prose. The tab is already called Reference, and every other case
            type's reference opens straight onto the thing itself — a build, or the
            frames. This one needs the playback renderer, so the rows exist to be
            clicked; the name is the whole label a viewer needs. The list carries
            the heading a sighted reader gets from the tab. */}
        <ul className={styles.list} aria-label="Reference factories">
          {REFERENCE_SCENARIOS.map((scenario) => (
            <li key={scenario.slug} className={styles.row}>
              <span className={styles.name}>{referenceLabel(scenario)}</span>
              <button
                type="button"
                className={styles.launch}
                onClick={() => setLaunched(scenario.slug)}
              >
                ▶ Play
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      {active ? (
        <PlaybackOverlay
          scenarioUrl={active.scenarioUrl}
          moduleUrl={REFERENCE_ENGINE_URL}
          label={referenceLabel(active)}
          onExit={() => setLaunched(null)}
        />
      ) : null}
    </>
  );
}
