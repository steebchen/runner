import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Loader2, RefreshCw, Search, X } from "lucide-react";
import type { Catalog, LoadoutEntry } from "../lib/api";
import { actions, useStore } from "../lib/store";
import { AGENT_NAMES, AgentIcon, findModel, modelName, sameEntry } from "../lib/models";
import { useReorder } from "../lib/reorder";

/** Settings → Default models: the loadout shown in the model picker. */
export function ModelSettings() {
  const settings = useStore((s) => s.settings)!;
  const catalogs = useStore((s) => s.catalogs);
  const statuses = useStore((s) => s.agentStatus);
  const [refreshing, setRefreshing] = useState(false);
  const loadout = settings.loadout;
  const { itemProps, overIndex } = useReorder(loadout, (next) => actions.saveSettings({ loadout: next }));

  const save = (next: LoadoutEntry[]) => actions.saveSettings({ loadout: next });
  const toggle = (agent: string, model: string) => {
    const entry = { agent, model };
    if (loadout.some((l) => sameEntry(l, entry))) save(loadout.filter((l) => !sameEntry(l, entry)));
    else {
      const effort = catalogs[agent]?.efforts.find((e) => e.value === "high")?.value ?? null;
      save([...loadout, { ...entry, effort }]);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await actions.ensureCatalogs(true);
    setRefreshing(false);
  };

  const agents = settings.enabledAgents;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center">
          <div className="text-xs text-muted">Featured in the model picker. Drag to reorder; the first is the default for new workspaces.</div>
          <span className="flex-1" />
          <button onClick={refresh} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-muted hover:bg-hover hover:text-fg">
            <RefreshCw size={11} className={clsx(refreshing && "animate-spin")} /> Refresh models
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {loadout.length === 0 && (
            <div className="w-full rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
              Pick models below to feature them.
            </div>
          )}
          {loadout.map((entry, i) => (
            <div
              key={`${entry.agent}:${entry.model}`}
              {...itemProps(i)}
              className={clsx(
                "group relative flex w-32 cursor-grab flex-col items-start gap-1 rounded-lg border bg-elevated px-3 pt-6 pb-2.5",
                overIndex === i ? "border-accent" : "border-border",
              )}
            >
              {i === 0 && (
                <span className="absolute top-1.5 left-1.5 rounded border border-border px-1 font-mono text-[9px] tracking-wider text-muted">
                  DEFAULT
                </span>
              )}
              <button
                onClick={() => save(loadout.filter((_, j) => j !== i))}
                className="absolute top-1.5 right-1.5 hidden rounded p-0.5 text-faint group-hover:block hover:bg-hover hover:text-fg"
                title="Remove"
              >
                <X size={11} />
              </button>
              <AgentIcon agent={entry.agent} size={18} />
              <span className="mt-1 w-full truncate text-[13px] font-medium">
                {modelName(entry.agent, findModel(catalogs, entry.agent, entry.model), entry.model)}
              </span>
              <EffortSelect
                catalog={catalogs[entry.agent]}
                value={entry.effort ?? null}
                onChange={(effort) => save(loadout.map((l, j) => (j === i ? { ...l, effort } : l)))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {agents.map((agent) => {
          const status = statuses?.find((s) => s.id === agent);
          const catalog = catalogs[agent];
          const models =
            agent === "opencode"
              ? settings.opencodeModels.map((v) => findModel(catalogs, agent, v) ?? { value: v, name: v })
              : (catalog?.models ?? []);
          return (
            <div key={agent}>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
                <AgentIcon agent={agent} size={12} /> {AGENT_NAMES[agent] ?? agent}
              </div>
              <div className="space-y-1">
                {status && !status.installed ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-2 text-center text-xs text-muted">Not installed</div>
                ) : !catalog ? (
                  <div className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted">
                    <Loader2 size={11} className="animate-spin" /> Discovering models…
                  </div>
                ) : (
                  models.map((m) => {
                    const on = loadout.some((l) => sameEntry(l, { agent, model: m.value }));
                    return (
                      <button
                        key={m.value}
                        onClick={() => toggle(agent, m.value)}
                        className={clsx(
                          "flex w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs",
                          on ? "border-accent/50 bg-accent/10" : "border-border bg-elevated hover:bg-hover",
                        )}
                        title={m.value}
                      >
                        <span className="truncate">{modelName(agent, m)}</span>
                        <span className="flex-1" />
                        {on && <Check size={12} className="shrink-0 text-accent" />}
                      </button>
                    );
                  })
                )}
                {agent === "opencode" && catalog && status?.installed !== false && <OpenCodeModels catalog={catalog} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EffortSelect({ catalog, value, onChange }: { catalog?: Catalog; value: string | null; onChange: (v: string | null) => void }) {
  const efforts = catalog?.efforts ?? [];
  if (!efforts.length) return <span className="font-mono text-[10px] tracking-wider text-faint uppercase">default</span>;
  return (
    <label className="relative font-mono text-[10px] tracking-wider text-muted uppercase hover:text-fg" onClick={(e) => e.stopPropagation()}>
      {efforts.find((e) => e.value === value)?.name ?? "default"} ▾
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="absolute inset-0 cursor-pointer opacity-0">
        {efforts.map((e) => (
          <option key={e.value} value={e.value}>
            {e.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Searchable checklist of OpenCode's (many) models, grouped by provider. */
function OpenCodeModels({ catalog }: { catalog: Catalog }) {
  const selected = useStore((s) => s.settings!.opencodeModels);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, typeof catalog.models>();
    for (const m of catalog.models) {
      if (q && !`${m.name} ${m.value}`.toLowerCase().includes(q)) continue;
      const provider = m.name.includes("/") ? m.name.split("/")[0] : m.value.split("/")[0];
      if (!map.has(provider)) map.set(provider, []);
      map.get(provider)!.push(m);
    }
    return [...map.entries()];
  }, [catalog, query]);

  const toggle = (value: string) =>
    actions.saveSettings({
      opencodeModels: selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted hover:bg-hover hover:text-fg"
      >
        {selected.length ? `Configure models (${selected.length})` : "Configure models"}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-40 mt-1 w-80 overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={13} className="text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${catalog.models.length} models`}
              className="selectable flex-1 bg-transparent text-xs outline-none"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {groups.slice(0, 40).map(([provider, models]) => (
              <div key={provider}>
                <div className="px-2 pt-2 pb-1 text-[11px] text-muted">{provider}</div>
                {models.slice(0, 60).map((m) => (
                  <label key={m.value} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-hover">
                    <input type="checkbox" checked={selected.includes(m.value)} onChange={() => toggle(m.value)} />
                    <span className="truncate">{m.name.includes("/") ? m.name.split("/").slice(1).join("/") : m.name}</span>
                  </label>
                ))}
              </div>
            ))}
            {groups.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted">No models match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

