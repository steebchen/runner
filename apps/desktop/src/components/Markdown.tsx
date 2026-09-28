import { memo, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { openUrl } from "@tauri-apps/plugin-opener";

marked.setOptions({ gfm: true, breaks: false });

// Agent output is untrusted: always sanitize before it touches the DOM, since
// this webview can call into the app's IPC.
function render(text: string) {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { FORBID_TAGS: ["style", "img", "iframe", "form"] });
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const html = useMemo(() => render(text), [text]);
  return (
    <div
      className="md selectable"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (a?.href) {
          e.preventDefault();
          if (/^https?:/.test(a.href)) void openUrl(a.href);
        }
      }}
    />
  );
});
