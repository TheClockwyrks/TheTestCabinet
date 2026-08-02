// The Code tab's parts. The page itself lives with the other run-detail tabs
// (`[runId]/RunCodePage.tsx`); everything it is made of lives here, the way the gg tab's
// panels live beside it rather than inside the page.
export { CodeProvenanceStrip } from "./CodeProvenanceStrip";
export { CodeExplorer } from "./CodeExplorer";
export { CodeSymbolTable, MAX_SYMBOL_ROWS } from "./CodeSymbolTable";
export { CodeOutliers } from "./CodeOutliers";
export { CodeCyclesCallout } from "./CodeCyclesCallout";
export { CodeFigures } from "./CodeFigures";
export {
  buildCodeTree,
  codeBreadcrumb,
  findCodeNode,
  meanCyclomatic,
  symbolsUnder,
  type CodeTreeNode,
} from "./codeTree";
export {
  APPROXIMATE_MARK,
  APPROXIMATE_NOTE,
  codeFigureFamilies,
  codeMetric,
  familyHeading,
  formatCodeBytes,
  formatCodeNumber,
  formatMetricValue,
  isApproximate,
  lookupMetric,
  type CodeFigure,
} from "./codeFormat";
