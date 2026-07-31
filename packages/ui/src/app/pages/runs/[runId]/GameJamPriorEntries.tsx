import { Link } from "react-router";
import { Panel } from "@test-cabinet/ui";
import type { PriorGameJamEntryRef } from "@test-cabinet/run-record";
import { formatTimestamp } from "../../../format";
import { routes } from "../../../routes";
import styles from "./GameJamPriorEntries.module.scss";

// "Previous entries" — the part of a game-jam run's briefing that is specific to
// the run rather than authored on the jam.
//
// A repeated jam run is seeded with the gameplay READMEs of the same model's
// earlier entries (in a git-ignored `previous-entries/` folder) and told to build
// something clearly different. That briefing is invisible everywhere else: the rest
// of the Inputs tab is the jam's prompt and specs, identical for every run of it.
// So when a model turns in near-copies, this is what answers "was it actually shown
// what it built last time?" — including the negative answer, which is why a first
// entry says so explicitly instead of rendering nothing.
export function GameJamPriorEntries({
  entries,
}: {
  entries: PriorGameJamEntryRef[];
}) {
  if (entries.length === 0) {
    return (
      <Panel className={styles.callout}>
        <h2 className={styles.heading}>Previous entries</h2>
        <p className={styles.note}>
          None — this was this model&rsquo;s first entry for this jam, so it was
          briefed with no earlier games to differ from.
        </p>
      </Panel>
    );
  }
  return (
    <Panel className={styles.callout}>
      <h2 className={styles.heading}>
        Previous entries ({entries.length})
      </h2>
      <p className={styles.note}>
        Games this model had already built for this jam. Their player-facing
        READMEs were seeded into the run (git-ignored, not part of the
        submission), and the prompt asked for an entry genuinely distinct from
        them.
      </p>
      <ul className={styles.list}>
        {entries.map((entry, index) => (
          <li key={entry.runId} className={styles.item}>
            <span className={styles.position}>{index + 1}.</span>
            <Link to={routes.runDetail(entry.runId)}>{entry.runId}</Link>
            <span className={styles.finished}>
              finished {formatTimestamp(entry.finishedAt)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
