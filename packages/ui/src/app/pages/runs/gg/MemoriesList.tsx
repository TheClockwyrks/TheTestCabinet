// The memories half of the Knowledge panel: the notes the model curates for
// itself (see gg/memories.md), each with its description and body length, plus how
// close the set is to gg's caps (count / per-memory / total length). Rendered as a
// list with a caps summary; the caps are what stop self-curated memory from
// crowding out the working context.

import type { GgMemoryState } from "./useGgRunState";
import styles from "./GgPanels.module.scss";

interface MemoriesListProps {
  memory: GgMemoryState | null;
}

export function MemoriesList({ memory }: MemoriesListProps) {
  if (!memory) {
    return (
      <p className={styles.empty}>
        No memories yet — the memories capability streams the model's self-curated
        notes here as it writes them.
      </p>
    );
  }

  const { memories, count, totalLen, caps } = memory;
  const numberFmt = new Intl.NumberFormat("en-US");

  return (
    <div className={styles.stack}>
      <p className={styles.caption}>
        {count} / {caps.maxCount} memories · {numberFmt.format(totalLen)} /{" "}
        {numberFmt.format(caps.maxTotalLen)} chars
      </p>
      {memories.length === 0 ? (
        <p className={styles.empty}>The model has not written any memories yet.</p>
      ) : (
        <ul className={styles.knowledgeList}>
          {memories.map((mem) => (
            <li key={mem.name} className={styles.knowledgeRow}>
              <div className={styles.knowledgeHead}>
                <span className={styles.knowledgeName}>{mem.name}</span>
                <span className={styles.knowledgeBadge}>
                  {numberFmt.format(mem.len)} / {numberFmt.format(caps.maxLenPerMemory)}
                </span>
              </div>
              <span className={styles.knowledgeDesc}>{mem.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
