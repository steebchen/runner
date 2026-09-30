import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(new URL("../apps/desktop/public/suneiro-mark.svg", import.meta.url), "utf8");
const icon = source
  .replace('width="64" height="64" viewBox="0 0 64 64"', 'width="1024" height="1024" viewBox="0 0 1024 1024"')
  .replace('color="#20374e"', 'color="#f8f5ed"')
  .replace('<g ', '<rect x="100" y="100" width="824" height="824" rx="190" fill="#20374e"/>\n  <g transform="translate(100 100) scale(12.875)" ');
writeFileSync(new URL("../apps/desktop/app-icon.svg", import.meta.url), icon);
const output = mkdtempSync(join(tmpdir(), "suneiro-icons-"));
try {
  execFileSync("pnpm", ["--filter", "desktop", "tauri", "icon", "app-icon.svg", "--output", output], { cwd: root, stdio: "inherit" });
  // Tauri also generates mobile assets; this app currently ships desktop only.
  for (const file of readdirSync(output)) {
    if (/\.(png|ico|icns)$/.test(file)) {
      copyFileSync(join(output, file), join(root, "apps/desktop/src-tauri/icons", file));
    }
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
