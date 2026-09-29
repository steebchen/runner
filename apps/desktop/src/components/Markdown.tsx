import { memo, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { openUrl } from "@tauri-apps/plugin-opener";
import { highlightBlock } from "../lib/highlight";

marked.setOptions({ gfm: true, breaks: false });
marked.use({
  renderer: {
    code({ text, lang }) {
      const html = highlightBlock(text, lang);
      return html === null ? false : `<pre><code class="hljs">${html}</code></pre>\n`;
    },
  },
});

// Agent output is untrusted: always sanitize before it touches the DOM, since
// this webview can call into the app's IPC.
function render(text: string) {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { FORBID_TAGS: ["style", "img", "iframe", "form"] });
  // Copy buttons for code blocks. Added after sanitizing; any "<pre>" in the
  // agent's text is escaped by then, so only real blocks match.
  return html.replace(/<pre>/g, '<div class="code-block"><button class="code-copy" type="button">Copy</button><pre>').replace(/<\/pre>/g, "</pre></div>");
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => render(text), [text]);
  return (
    <div
      className="md selectable"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const copy = (e.target as HTMLElement).closest(".code-copy");
        if (copy) {
          const code = copy.parentElement?.querySelector("pre")?.textContent ?? "";
          void navigator.clipboard.writeText(code).then(() => {
            copy.textContent = "Copied";
            setTimeout(() => (copy.textContent = "Copy"), 1200);
          });
          return;
        }
        const a = (e.target as HTMLElement).closest("a");
        if (a?.href) {
          e.preventDefault();
          if (/^https?:/.test(a.href)) void openUrl(a.href);
        }
      }}
    />
  );
});
