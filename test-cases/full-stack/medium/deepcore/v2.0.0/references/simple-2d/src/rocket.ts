// Deepcore — the escape rocket, and the only way to win (specs/rocket.md).
//
// Five components fabricated in order at the Launch Pad: two on Credits alone,
// two that also consume an exotic material, and the Ignition Core that consumes
// the Core Sample and stops its timer. Installed components are permanent and
// survive a death.

import { CUES, ROCKET_COMPONENTS } from "./constants";
import type { RocketComponent } from "./constants";
import { cue } from "./audio";
import { note } from "./feedback";
import type { Draft } from "./state";

/** The material a component consumes, or `null` for Credits alone. */
type Requirement = RocketComponent["material"];

/** The next uninstalled component, or `null` once all five are in. */
export function nextComponent(
  installed: readonly string[],
): RocketComponent | null {
  for (const component of ROCKET_COMPONENTS) {
    if (!installed.includes(component.id)) return component;
  }
  return null;
}

/** Whether all five components are installed. */
export function allInstalled(installed: readonly string[]): boolean {
  return installed.length >= ROCKET_COMPONENTS.length;
}

/** Whether the satchel holds the material a component needs. */
export function hasMaterial(
  satchel: { resonite: number; cryenite: number; coreSample: boolean },
  material: Requirement,
): boolean {
  if (material === null) return true;
  if (material === "core-sample") return satchel.coreSample;
  return satchel[material] > 0;
}

/** Whether the next component can be fabricated as things stand. */
export function canFabricate(d: {
  installed: readonly string[];
  credits: number;
  satchel: { resonite: number; cryenite: number; coreSample: boolean };
}): boolean {
  const component = nextComponent(d.installed);
  if (!component) return false;
  return (
    d.credits >= component.credits && hasMaterial(d.satchel, component.material)
  );
}

/**
 * Fabricate the next component: deduct the Credits, consume the material, and
 * install it. A refusal changes nothing and shows the note that says why.
 */
export function fabricate(d: Draft): boolean {
  const component = nextComponent(d.installed);
  if (!component) {
    note(d, "THE ROCKET IS COMPLETE");
    return false;
  }
  if (d.credits < component.credits) {
    note(d, "NOT ENOUGH CREDITS");
    return false;
  }
  if (!hasMaterial(d.satchel, component.material)) {
    note(d, "MATERIAL MISSING");
    return false;
  }
  d.credits -= component.credits;
  if (component.material === "resonite") d.satchel.resonite -= 1;
  else if (component.material === "cryenite") d.satchel.cryenite -= 1;
  else if (component.material === "core-sample") {
    d.satchel.coreSample = false;
    // Installing the Ignition Core stops the countdown.
    d.coreTimer = null;
  }
  d.installed.push(component.id);
  cue(d, CUES.fabricate);
  note(d, `${component.name.toUpperCase()} INSTALLED`);
  return true;
}
