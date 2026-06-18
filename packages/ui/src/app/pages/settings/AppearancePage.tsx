import { Panel } from "@test-cabinet/ui";
import { SettingsLayout } from "../../layouts/settings/SettingsLayout";
import { SunToggle } from "../../components/SunToggle";
import exec from "../runs/RunExec.module.scss";

// The Appearance tab (`/settings/appearance`): visual preferences for the
// console. Today this hosts the synthwave-sun toggle (formerly in the topbar);
// the toggle itself still reads/writes the persisted backdrop setting.
export function AppearancePage() {
  return (
    <SettingsLayout tab="appearance">
      <Panel>
        <p className={exec.sectionLabel}>Backdrop</p>
        <p className={exec.muted}>
          Show or hide the synthwave sun behind the gallery. The choice persists
          across visits.
        </p>
        <SunToggle />
      </Panel>
    </SettingsLayout>
  );
}
