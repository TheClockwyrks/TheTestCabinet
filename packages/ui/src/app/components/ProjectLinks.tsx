import type { ComponentType } from "react";
import { GitHubIcon } from "./GitHubIcon";
import styles from "./ProjectLinks.module.scss";

/** The Test Cabinet's own source repository. */
export const GITHUB_REPO_URL =
  "https://github.com/TheClockwyrks/TheTestCabinet";

/** One place the project lives outside the cabinet itself. */
export interface ProjectLink {
  /** The short name the link is shown under. */
  label: string;
  /** What a screen reader and the hover title say the link leads to. */
  description: string;
  href: string;
  Icon: ComponentType<{ className?: string }>;
}

/**
 * The project's links off-site, in the order they are shown. One list, so every place
 * that offers them offers the same set, and adding one is a single entry here.
 */
export const PROJECT_LINKS: ReadonlyArray<ProjectLink> = [
  {
    label: "GitHub",
    description: "The Test Cabinet on GitHub",
    href: GITHUB_REPO_URL,
    Icon: GitHubIcon,
  },
];

// The project's links as a row of labelled chips, each its mark beside its name. Sized
// to ride a page header's trailing edge, and wraps as the list grows.
export function ProjectLinks() {
  return (
    <nav className={styles.links} aria-label="Project links">
      {PROJECT_LINKS.map(({ label, description, href, Icon }) => (
        <a
          key={href}
          href={href}
          className={styles.link}
          target="_blank"
          rel="noreferrer"
          aria-label={description}
          title={description}
        >
          <Icon className={styles.icon} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}
