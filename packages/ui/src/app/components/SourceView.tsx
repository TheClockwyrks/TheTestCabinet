import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import styles from "./SourceView.module.scss";

// A source file rendered inline: the text verbatim in the console's monospace,
// syntax-highlighted when the file's extension names a language the console
// recognizes, plain otherwise. Deliberately NOT a boxed code block — the file
// browsers this serves (the Inputs tab's viewer) already frame their content,
// and a second container inside the pane reads as chrome, not content.
//
// Highlighting is a bundled subset of highlight.js grammars — the languages
// test cases actually seed (web sources, manifests, the odd build script) —
// registered once at module load. The lookup leans on each grammar's own
// aliases (`ts`, `rs`, `py`, `toml`, `html`, …), so the file extension is the
// query and an extension no grammar claims simply renders unhighlighted.
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

/** The grammar name (or alias) the path's extension resolves to, if any. */
function languageFor(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot === -1 || dot === path.length - 1) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return hljs.getLanguage(ext) !== undefined ? ext : null;
}

export function SourceView({ path, text }: { path: string; text: string }) {
  // Re-highlighting on every render would tokenize the whole file each time the
  // hosting pane re-renders; the file identity (path + text) keys the work.
  const highlighted = useMemo(() => {
    const language = languageFor(path);
    if (language === null) return null;
    // `highlight` HTML-escapes everything outside the token markup it emits,
    // so handing its output to dangerouslySetInnerHTML is safe.
    return hljs.highlight(text, { language }).value;
  }, [path, text]);
  return (
    <pre className={styles.source}>
      {highlighted !== null ? (
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      ) : (
        <code>{text}</code>
      )}
    </pre>
  );
}
