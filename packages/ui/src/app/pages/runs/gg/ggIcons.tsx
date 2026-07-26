// Line-art icons for the Agents explorer's filesystem tree, in the same
// Lucide-style, 24×24, `currentColor` convention as the app's other marks
// (BellIcon, TrashIcon, DownloadIcon, …) so size and color come from CSS. They
// replace the ad-hoc Unicode glyphs the tree used to scan by: a folder per agent
// (open when expanded), and a distinct mark per monitor-view "file" so overview /
// activity / context / plan / board / tasks / knowledge read at a glance.

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
