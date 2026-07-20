import { useEffect, useState } from "react";
import styles from "./Avatar.module.scss";

// A circular account avatar: the account's profile picture when one is available
// and loads, otherwise a deterministic initials chip derived from the display
// name. Shared by the top bar, the account Profile tab, and the reviewer
// attribution beside a review. The picture URL is resolved by the transport (top
// bar / reviews) — an absent or failing image falls back to initials, so a
// reviewer with no picture (a 404) still renders cleanly.

export interface AvatarProps {
  // The display name the initials come from (and the alt text / title).
  name: string;
  // The resolved profile-picture URL, or null/absent to show initials only.
  pictureUrl?: string | null;
  // The rendered diameter in pixels. Defaults to a compact inline size.
  size?: number;
  className?: string;
}

// The first letters of up to two words of the name, uppercased — e.g. "Ada
// Lovelace" -> "AL", "ada" -> "A". Falls back to "?" for an empty name.
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((word) => word[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

// A stable hue derived from the name, so a given account keeps the same initials
// chip color across the app. A cheap string hash into the 0–359 hue circle.
function hueOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

export function Avatar({
  name,
  pictureUrl,
  size = 24,
  className,
}: AvatarProps) {
  // Track a failed image load so we fall back to initials. Reset whenever the URL
  // changes (a replaced picture, or navigating between reviewers).
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [pictureUrl]);

  const dimension = { width: `${size}px`, height: `${size}px` };
  const rootClass = className ? `${styles.avatar} ${className}` : styles.avatar;
  const label = name.trim() || "Account";

  if (pictureUrl && !failed) {
    return (
      <img
        className={rootClass}
        style={dimension}
        src={pictureUrl}
        alt={label}
        title={label}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`${rootClass} ${styles.initials}`}
      style={{
        ...dimension,
        // The chip color is derived from the name; the glyph stays readable on it.
        background: `hsl(${hueOf(label)}deg 45% 42%)`,
        fontSize: `${Math.round(size * 0.42)}px`,
      }}
      title={label}
      aria-label={label}
      role="img"
    >
      {initialsOf(label)}
    </span>
  );
}
