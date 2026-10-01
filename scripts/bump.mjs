#!/usr/bin/env node
// Set the app version everywhere it is written down: `pnpm bump 0.2.0`.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  console.error("usage: pnpm bump <version>   (e.g. 0.2.0)");
  process.exit(1);
}

const edit = (path, from, to) => {
  const text = readFileSync(path, "utf8");
  if (!from.test(text)) throw new Error(`no version found in ${path}`);
  writeFileSync(path, text.replace(from, to));
};

// First `version = "…"` is [workspace.package]; the crates inherit it.
edit("Cargo.toml", /^version = ".*"$/m, `version = "${version}"`);
edit("apps/desktop/src-tauri/tauri.conf.json", /"version": ".*"/, `"version": "${version}"`);
edit("apps/desktop/package.json", /"version": ".*"/, `"version": "${version}"`);
execSync("cargo update --workspace --offline", { stdio: "inherit" });

console.log(`\nVersion is now ${version}. To release:\n  git commit -am "Release v${version}" && git tag v${version} && git push origin HEAD v${version}`);
