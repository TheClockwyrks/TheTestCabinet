import { createRoot } from "react-dom/client";
// Reach straight into the ui package source so the capture renders the *real*
// scene (and reads the *real* theme tokens) without pulling in the whole gallery
// app or its chrome. Vite compiles these sources on the fly; nothing here ships.
import SynthwaveScene from "../../../../packages/ui/src/app/components/backdrop/SynthwaveScene";
import "../../../../packages/ui/src/app/styles/theme.scss";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(<SynthwaveScene />);
