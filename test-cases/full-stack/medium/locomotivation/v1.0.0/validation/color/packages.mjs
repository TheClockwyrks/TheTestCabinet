// Color: the red, blue, green, and amber packages each render in a mutually distinct color.
// One parcel of each color is placed on the ground and its rendered pixels sampled; every
// pair must stand clearly apart.

import { startFresh, settle, sampleColor, colorDistance, tileCenterX, tileCenterY } from "../_helpers.mjs";

const DISTINCT_MIN = 40;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.packages");

  await startFresh(api, 1);
  const cols = { red: 8, blue: 12, green: 16, amber: 20 };
  for (const [color, col] of Object.entries(cols)) {
    await api.call("spawnGroundPackage", { col, row: 12, color, weightClass: "parcel", archetype: "optional" });
  }
  await settle(api, 120);

  const colors = {};
  for (const [name, col] of Object.entries(cols)) {
    colors[name] = await sampleColor(api, tileCenterX(col), tileCenterY(12) - 9); // the parcel's face
  }

  const names = Object.keys(cols);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      check.expectGt(
        `${names[i]} and ${names[j]} packages render distinctly`,
        colorDistance(colors[names[i]], colors[names[j]]),
        DISTINCT_MIN,
      );
    }
  }

  await api.screenshot("scene");
  return check.verdict();
}
