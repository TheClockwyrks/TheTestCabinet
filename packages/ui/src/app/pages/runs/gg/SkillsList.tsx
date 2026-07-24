// The skills half of the Knowledge panel: the ahead-of-time skills the model was
// offered, each with its one-line description and whether the model has read it
// (loading its body into context). See gg/skills.md. Rendered as a list; the read
// state is the only per-skill signal, so it drives a compact badge.

import type { GgSkillState } from "@test-cabinet/run-record/gg";
import styles from "./GgPanels.module.scss";

interface SkillsListProps {
  skills: GgSkillState[];
}

export function SkillsList({ skills }: SkillsListProps) {
  if (skills.length === 0) {
    return (
      <p className={styles.empty}>
        No skills offered — the skills capability streams the catalog at session
        start when it is enabled.
      </p>
    );
  }

  const readCount = skills.filter((s) => s.read).length;

  return (
    <div className={styles.stack}>
      <p className={styles.caption}>
        {readCount} of {skills.length} read
      </p>
      <ul className={styles.knowledgeList}>
        {skills.map((skill) => (
          <li key={skill.name} className={styles.knowledgeRow}>
            <div className={styles.knowledgeHead}>
              <span className={styles.knowledgeName}>{skill.name}</span>
              <span
                className={styles.knowledgeBadge}
                data-read={skill.read ? "" : undefined}
              >
                {skill.read ? "read" : "unread"}
              </span>
            </div>
            <span className={styles.knowledgeDesc}>{skill.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
