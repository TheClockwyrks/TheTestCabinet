import { useMemo } from "react";
import { worstStorageNotice } from "../../client/artifactStorage";
import { useArtifactStorage } from "../runtime/artifactStorage";
import styles from "./StorageNotice.module.scss";

// The standing notice about the artifact store, drawn in the page chrome directly
// under the topbar so it is on every page for as long as the condition lasts.
//
// It is a banner rather than a toast because it reports a state, not an event: a
// toast is dismissed and gone, while a queue that is on hold stays on hold, and an
// operator who arrives an hour later must still be told why nothing is starting.
// It therefore has no dismiss control, and it goes away on its own when the
// backend reports the store has room again.
//
// Renders nothing while there is nothing to say, so the layout mounts it
// unconditionally; the static site's store is never written to.
export function StorageNotice() {
  // Select the map itself, which keeps its identity until a status arrives, and
  // derive the notice from it: a selector that built the notice would hand the
  // store a fresh object on every read.
  const byWorker = useArtifactStorage((state) => state.byWorker);
  const notice = useMemo(
    () => worstStorageNotice(Object.values(byWorker)),
    [byWorker],
  );
  if (!notice) return null;
  return (
    <div
      className={styles.notice}
      data-tone={notice.tone}
      // A hold interrupts; a warning waits its turn with a screen reader.
      role={notice.tone === "hold" ? "alert" : "status"}
    >
      <strong className={styles.title}>{notice.title}</strong>
      <span className={styles.detail}>{notice.detail}</span>
    </div>
  );
}
