// Line-art icons for the Instances explorer's filesystem tree, in the same
// Lucide-style, 24×24, `currentColor` convention as the app's other marks
// (BellIcon, TrashIcon, DownloadIcon, …) so size and color come from CSS. They
// replace the ad-hoc Unicode glyphs the tree used to scan by: a disclosure caret, a
// folder per agent (open when expanded), and a distinct mark per monitor-view "file"
// so overview / activity / context / plan / board / tasks / knowledge read at a glance.

interface IconProps {
  className?: string;
}

// A shared frame so every icon draws identically (fill none, round joins) and only
// its paths differ.
function Icon({
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// The disclosure caret on a folder row: a chevron pointing right when closed, rotated a
// quarter turn to point down when open (`.fsCaretOpen`).
//
// It is drawn rather than typed because the tree hangs its indent guideline off this
// mark's point. A text caret ("▸"/"▾") sits wherever the font's glyph box puts it inside
// the caret slot — left of the slot's centre, as it turned out — so the guideline, which
// drops down the slot's centre line, visibly missed the arrow it is meant to descend
// from. This one fills its box, and rotated open its point is on the box's vertical
// centre line, so the line lands exactly under the tip.
export function ChevronIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <polyline points="9 6 15 12 9 18" />
    </Icon>
  );
}

// A closed folder — an agent's collapsed folder in the tree.
export function FolderIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" />
    </Icon>
  );
}

// An open folder — an agent's expanded folder in the tree.
export function FolderOpenIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M6 19a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" />
      <path d="M4 19l2.2-7.3A1 1 0 0 1 7.4 11H22l-2.4 7.4a1 1 0 0 1-1 .6Z" />
    </Icon>
  );
}

// Overview — a small dashboard of tiles (the whole-scope read-out).
export function OverviewIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </Icon>
  );
}

// Activity — a telemetry pulse line.
export function ActivityIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </Icon>
  );
}

// Context — stacked layers, the window's composition by source.
export function ContextIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="M2 12l10 5 10-5" />
      <path d="M2 17l10 5 10-5" />
    </Icon>
  );
}

// Prompt — a speech bubble of instruction lines: the prompt the agent was given
// (for a subagent, the brief its parent handed it).
export function PromptIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M21 12a7 7 0 0 1-7 7H9l-5 3v-4a7 7 0 0 1 5-12h5a7 7 0 0 1 7 6Z" />
      <path d="M8.5 10h7" />
      <path d="M8.5 13.5h4" />
    </Icon>
  );
}

// Requests — a request/response exchange (two opposed message chevrons), the exact
// messages sent to and returned from the model.
export function RequestsIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3 8h13l-3-3M16 8l3 3" />
      <path d="M21 16H8l3 3M8 16l-3-3" />
    </Icon>
  );
}

// Metrics — a line trending up across axes: the per-request metrics graphs
// (throughput, cost, cache-read share, reasoning share) over the run.
export function MetricsIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 4v15a1 1 0 0 0 1 1h15" />
      <path d="M7 15l4-5 3 3 5-7" />
    </Icon>
  );
}

// Compaction — arrows collapsing toward a middle rule: the window summarized and
// squeezed back down at a boundary.
export function CompactionIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 12h16" />
      <path d="M8 5l-3 3 3 3" />
      <path d="M16 5l3 3-3 3" />
      <path d="M8 19l-3-3 3-3" />
      <path d="M16 19l3-3-3-3" />
    </Icon>
  );
}

// Plan — a clipboard of ordered steps.
export function PlanIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
      <path d="M8 11h8" />
      <path d="M8 15h6" />
    </Icon>
  );
}

// Board — kanban columns of epics and issues.
export function BoardIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </Icon>
  );
}

// Epic — a stack of grouped cards: the epic-summary "file" at the head of an epic
// folder in the Project explorer.
export function EpicIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="3" y="4" width="14" height="10" rx="1" />
      <path d="M7 18h14" />
      <path d="M7 21h11" />
    </Icon>
  );
}

// Issue — a single ticket card with a status dot: one issue "file" under its epic
// folder in the Project explorer.
export function IssueIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 10h8" />
      <path d="M8 14h5" />
    </Icon>
  );
}

// Tasks — a checked list.
export function TasksIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M11 7h9" />
      <path d="M11 12h9" />
      <path d="M11 17h9" />
      <path d="M3 7l1.5 1.5L7 6" />
      <path d="M3 16l1.5 1.5L7 15" />
    </Icon>
  );
}

// Knowledge — an open book (skills and memories).
export function KnowledgeIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 7a3 3 0 0 0-3-3H2v13h7a3 3 0 0 1 3 3" />
      <path d="M12 7a3 3 0 0 1 3-3h7v13h-7a3 3 0 0 0-3 3" />
    </Icon>
  );
}
