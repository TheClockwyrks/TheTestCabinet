// The entry point `index.html` loads.
//
// Everything the game is stands up inside `startGame`: the runtime layer, the
// produced assets, the renderer, the frame loop, and the debug surface
// (`specs/instrumentation.md`). This module's whole job is to find the canvas
// the page supplies, hand it over, and hold the page in the meantime — the
// produced models and sounds are fetched before the first frame is drawn, so
// without this the canvas sits black for as long as that takes, and a failure
// to boot would leave the reason in the console alone.

import { startGame } from "./app";
import { TAGLINE_TEXT, TITLE_TEXT } from "./constants";

/** Where the page's stage canvas is (`index.html`). */
const STAGE_SELECTOR = "#stage";

/** The yard's own ground, so the boot panel is not a different field. */
const BOOT_BACKGROUND = "#161a1f";

const PANEL_CSS = [
  "position:fixed",
  "inset:0",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "justify-content:center",
  "gap:14px",
  "padding:24px",
  "box-sizing:border-box",
  "font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
  "letter-spacing:0.16em",
  "text-align:center",
  "pointer-events:none",
  `background:${BOOT_BACKGROUND}`,
].join(";");

/**
 * The panel the page shows while the produced assets are fetched, and the one
 * it shows instead if the boot fails. The canvas is the renderer's and may or
 * may not have taken a context by the time either is wanted, so both are plain
 * DOM over the top rather than something drawn into the stage.
 */
function bootPanel(heading: string, detail: string, tone: string): HTMLElement {
  const panel = document.createElement("div");
  panel.setAttribute("role", "status");
  panel.style.cssText = PANEL_CSS;

  const title = document.createElement("strong");
  title.textContent = heading;
  title.style.cssText = "font-size:26px;letter-spacing:0.3em;color:#e8ddc8";

  const line = document.createElement("span");
  line.textContent = detail;
  line.style.cssText = `max-width:60ch;color:${tone}`;

  panel.append(title, line);
  return panel;
}

/** Find the stage canvas, stand the game up on it, and start the loop. */
async function boot(): Promise<void> {
  const canvas = document.querySelector(STAGE_SELECTOR);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`no canvas at ${STAGE_SELECTOR}`);
  }
  const loading = bootPanel(TITLE_TEXT, TAGLINE_TEXT, "#c8ab6a");
  document.body.append(loading);
  try {
    await startGame(canvas);
  } finally {
    loading.remove();
  }
}

boot().catch((reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error("Gantry failed to start", reason);
  document.body.append(bootPanel("GANTRY FAILED TO START", message, "#d4634a"));
});
