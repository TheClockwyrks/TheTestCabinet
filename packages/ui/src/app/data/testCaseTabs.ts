// The catalog's type tabs — the same partitioning the `/test-cases` page groups
// cases under, extracted here so other surfaces (notably the coverage plan
// editor) can bucket a case under the same category the catalog shows it in.
//
// Asset-generation is split into five asset-family tabs — "2D" (sprite + paint),
// "3D" (voxel/mesh/skinned), "Blender" (glTF characters), "Particle", and
// "Audio"; the other tabs map one-to-one to a test type.

import {
  isAudioAssetKind,
  isBlenderAssetKind,
  isParticleAssetKind,
  isVoxelAssetKind,
} from "../../client";
import type { CatalogTab } from "../routes";
import type { TestCaseSummary } from "./testCases";

/** The catalog's type tabs, in display order. */
export const CATALOG_TABS: ReadonlyArray<{ tab: CatalogTab; label: string }> = [
  { tab: "end-to-end", label: "E2E" },
  { tab: "full-stack", label: "Full-stack" },
  { tab: "2d", label: "2D" },
  { tab: "3d", label: "3D" },
  { tab: "blender", label: "Blender" },
  { tab: "particle", label: "Particle" },
  { tab: "audio", label: "Audio" },
  { tab: "adversarial", label: "Adversarial" },
  { tab: "performance", label: "Performance" },
];

// Whether a case belongs under a given tab. The five asset-family tabs all scope
// to asset-generation cases, partitioned by the case's asset kind: 3D is the
// voxel/mesh/skinned family, Blender is the glTF-character family, Particle and
// Audio are their own families, and 2D is the remainder (the sprite and paint
// kinds, plus a case with no asset kind, which defaults to `sprite`). The other
// tabs map straight to a test type.
export function inTab(testCase: TestCaseSummary, tab: CatalogTab): boolean {
  // Game jams share the catalog pipeline but are presented on their own pages
  // (Other → Game Jams), never on the Test Cases catalog — so no tab ever claims
  // one. (They also match none of the type/asset checks below; this guard makes
  // the exclusion explicit and independent of the tab set.)
  if (testCase.testType === "game-jam") return false;
  switch (tab) {
    case "2d":
      return (
        testCase.testType === "asset-generation" &&
        !isVoxelAssetKind(testCase.assetKind) &&
        !isBlenderAssetKind(testCase.assetKind) &&
        !isParticleAssetKind(testCase.assetKind) &&
        !isAudioAssetKind(testCase.assetKind)
      );
    case "3d":
      return (
        testCase.testType === "asset-generation" &&
        isVoxelAssetKind(testCase.assetKind)
      );
    case "blender":
      return (
        testCase.testType === "asset-generation" &&
        isBlenderAssetKind(testCase.assetKind)
      );
    case "particle":
      return (
        testCase.testType === "asset-generation" &&
        isParticleAssetKind(testCase.assetKind)
      );
    case "audio":
      return (
        testCase.testType === "asset-generation" &&
        isAudioAssetKind(testCase.assetKind)
      );
    case "end-to-end":
      return testCase.testType === "end-to-end";
    case "full-stack":
      return testCase.testType === "full-stack";
    case "adversarial":
      return testCase.testType === "adversarial";
    case "performance":
      return testCase.testType === "performance";
  }
}

/** The tab a case is filed under, or `null` when no tab claims it. */
export function tabOf(testCase: TestCaseSummary): CatalogTab | null {
  return CATALOG_TABS.find((entry) => inTab(testCase, entry.tab))?.tab ?? null;
}

/** The human-facing label for a tab, falling back to the raw value. */
export function tabLabel(tab: CatalogTab): string {
  return CATALOG_TABS.find((entry) => entry.tab === tab)?.label ?? tab;
}
