import { Asterisk, Hexagon, SquareTerminal } from "lucide-react";
import type { Catalog, Choice, ConfigOption, LoadoutEntry, SelectOption, Settings } from "./api";

export const AGENT_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };

/** Small, recognizable (non-trademark) glyph per agent. */
export function AgentIcon({ agent, size = 13 }: { agent: string; size?: number }) {
  if (agent === "claude") return <Asterisk size={size} strokeWidth={2.75} className="shrink-0 text-[#d97757]" />;
  if (agent === "codex") return <Hexagon size={size} strokeWidth={2.25} className="shrink-0 text-[#6b7cff]" />;
  return <SquareTerminal size={size} strokeWidth={2.25} className="shrink-0 text-muted" />;
}

/** Codex reports "6 Astra"; show "GPT-6 Astra". */
export function modelName(agent: string, choice: Pick<Choice, "name" | "value"> | undefined, fallback = ""): string {
  const name = choice?.name ?? fallback;
  if (agent === "codex" && /^\d/.test(name)) return `GPT-${name}`;
  // OpenCode prefixes the provider ("Z.ai/GLM-5.3"); the model part is enough.
  if (agent === "opencode" && name.includes("/")) return name.slice(name.indexOf("/") + 1);
  return name;
}

export function findModel(catalogs: Record<string, Catalog>, agent: string, value: string) {
  return catalogs[agent]?.models.find((m) => m.value === value);
}

export function effortName(catalogs: Record<string, Catalog>, agent: string, effort?: string | null) {
  if (!effort) return "Default";
  return catalogs[agent]?.efforts.find((e) => e.value === effort)?.name ?? effort;
}

/** Models offered by search: everything for Claude/Codex, only configured ones for OpenCode. */
export function searchableModels(catalogs: Record<string, Catalog>, settings: Settings): { agent: string; model: Choice }[] {
  const out: { agent: string; model: Choice }[] = [];
  for (const agent of settings.enabledAgents) {
    const models = catalogs[agent]?.models ?? [];
    for (const m of models) {
      if (agent === "opencode" && !settings.opencodeModels.includes(m.value)) continue;
      out.push({ agent, model: m });
    }
  }
  return out;
}

export const sameEntry = (a: LoadoutEntry, b: LoadoutEntry) => a.agent === b.agent && a.model === b.model;

export function flatOptions(option: ConfigOption | undefined): SelectOption[] {
  return (option?.options ?? []).flatMap((o: any) => ("options" in o ? o.options : [o]));
}

export const modelOption = (config: ConfigOption[]) => config.find((c) => c.id === "model") ?? config.find((c) => c.category === "model");
export const effortOption = (config: ConfigOption[]) => config.find((c) => c.category === "thought_level");
export const fastOption = (config: ConfigOption[]) => config.find((c) => /fast/i.test(c.id));
