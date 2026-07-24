// The FSM current-state strip (see gg/fsms). When a built-in finite state machine
// drives the run, it is a fixed, named process the agent is driven through — the
// agent cannot skip ahead, because the machine will not let it. gg is headless, so
// this strip is how the enforced process and where the run is in it become legible:
// the machine name beside its ordered states as a chip row, the current enforced
// state highlighted (e.g. write_tests → implement → verify, with the active one
// filled).
//
// `useGgRunState` keeps the latest `fsm_state` transition plus the ordered path of
// states seen so far. This renders nothing when no FSM drove the run (the capability
// was off), so a non-FSM run simply shows no strip.

import type { FsmProgress } from "./useGgRunState";
import panels from "./GgPanels.module.scss";

export function FsmStateStrip({ fsm }: { fsm: FsmProgress | null }) {
  if (!fsm) return null;
  // Fall back to just the current state if the ordered path has not been built yet
  // (a first transition before the post-pass fill), so the strip is never empty.
  const states = fsm.states.length > 0 ? fsm.states : [fsm.state];
  return (
    <div className={panels.fsmStrip}>
      <span className={panels.fsmLabel}>process</span>
      <span className={panels.fsmMachine}>{fsm.machine}</span>
      <ol className={panels.fsmStates}>
        {states.map((name, i) => {
          const position =
            i === fsm.stateIndex
              ? "current"
              : i < fsm.stateIndex
                ? "past"
                : "future";
          return (
            <li key={i} className={panels.fsmState} data-position={position}>
              {name || "…"}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
