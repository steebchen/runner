import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGS = { bash, c, cpp, csharp, css, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

const BY_EXT: Record<string, keyof typeof LANGS> = {
  sh: "bash", bash: "bash", zsh: "bash",
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp",
  css: "css", scss: "scss", sass: "scss", less: "scss",
  go: "go",
  ini: "ini", toml: "ini", cfg: "ini", conf: "ini", env: "ini",
  java: "java",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  json: "json", jsonc: "json",
  kt: "kotlin", kts: "kotlin",
  md: "markdown", mdx: "markdown",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sql: "sql",
  swift: "swift",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml", svelte: "xml",
  yml: "yaml", yaml: "yaml",
};

/** Highlight.js language for a file path, if we have one. */
export function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  if (name === "makefile") return "bash";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return BY_EXT[ext] ?? null;
}

const cache = new Map<string, string>();

/** One line of code as highlighted, escaped HTML. Lines are highlighted on
 * their own (diffs are fragments), so multi-line strings or comments may be
 * colored imperfectly. */
export function highlightLine(text: string, language: string | null): string | null {
  if (!language || text.length > 2000) return null;
  const key = `${language}\0${text}`;
  let html = cache.get(key);
  if (html === undefined) {
    try {
      html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
    cache.set(key, html);
  }
  return html;
}

/** A fenced code block's contents as highlighted HTML, or null if the
 * language is unknown. `lang` may be a name or alias ("ts", "sh", "rs"). */
export function highlightBlock(code: string, lang: string | undefined): string | null {
  const name = lang?.trim().split(/\s/)[0].toLowerCase();
  if (!name || !hljs.getLanguage(name) || code.length > 100_000) return null;
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
