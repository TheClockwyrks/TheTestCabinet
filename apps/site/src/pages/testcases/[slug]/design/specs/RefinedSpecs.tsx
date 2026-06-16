import { Panel } from "../../../../../components/Panel";
import type { SpecsViewProps } from "../types";
import { SpecFileBrowser } from "../../SpecFileBrowser";
import styles from "./RefinedSpecs.module.scss";

// The "refined" Specifications view: today's two-pane file browser (a directory
// tree beside the selected file), kept as-is inside a panel with the lead-in
// copy. This is the small-tweaks baseline — the file browser already mirrors the
// seeded repository exactly, so the refinement is polish, not a rethink.
export function RefinedSpecs({ testCase, variant }: SpecsViewProps) {
  return (
    <Panel>
      <p className={styles.lead}>
        Every run of {testCase.name} ({variant.name}) starts from a fresh
        repository containing exactly these files.
      </p>
      <SpecFileBrowser key={variant.slug} variant={variant} />
    </Panel>
  );
}
