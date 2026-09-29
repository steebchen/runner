import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronRight, FileCode } from "lucide-react";
import { api, type Repo, type RepoConfig } from "../lib/api";
import { actions, toast, useStore } from "../lib/store";

let focusRepo: string | null = null;

/** Open Settings with one repository's section expanded. */
export function openRepoSettings(repoId: string) {
  focusRepo = repoId;
  actions.openSettings(true);
}

/** Per-repository scripts and files to copy. A committed runner.json (or
 * conductor.json) takes precedence per script; these fill the gaps. */
export function RepoSettings() {
  const repos = useStore((s) => s.repos);
  if (!repos.length) return <div className="text-xs text-muted">Add a repository to configure it.</div>;
  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {repos.map((r) => (
        <RepoCard key={r.id} repo={r} />
      ))}
    </div>
  );
}

const SCRIPTS: { key: keyof RepoConfig["scripts"]; label: string; hint: string; placeholder: string }[] = [
  { key: "setup", label: "Setup script", hint: "Runs in each new workspace, e.g. to install dependencies.", placeholder: "pnpm install" },
  { key: "run", label: "Run script", hint: "Started by the Run button in the terminal panel.", placeholder: "pnpm dev --port $RUNNER_PORT" },
  { key: "archive", label: "Archive script", hint: "Runs before a workspace's worktree is removed.", placeholder: "docker compose down" },
];

function RepoCard({ repo }: { repo: Repo }) {
  const [open, setOpen] = useState(() => focusRepo === repo.id);
  useEffect(() => {
    if (focusRepo !== repo.id) return;
    focusRepo = null;
    requestAnimationFrame(() => document.getElementById(`repo-${repo.id}`)?.scrollIntoView({ block: "start" }));
  }, [repo.id]);
  const [config, setConfig] = useState<RepoConfig | null>(null);
  const [file, setFile] = useState<{ name: string; config: RepoConfig } | null>(null);

  useEffect(() => {
    if (!open || config) return;
    api
      .repoSettings(repo.id)
      .then((r) => {
        setConfig(r.config);
        setFile(r.file);
      })
      .catch((e) => toast(String(e)));
  }, [open, config, repo.id]);

  const save = (next: RepoConfig) => {
    setConfig(next);
    void api.saveRepoSettings(repo.id, next).catch((e) => toast(String(e)));
  };

  return (
    <div id={`repo-${repo.id}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-hover/50">
        <ChevronRight size={13} className={clsx("text-muted transition-transform", open && "rotate-90")} />
        <span className="font-medium">{repo.name}</span>
        <span className="truncate font-mono text-[11px] text-faint">{repo.path}</span>
      </button>
      {open && config && (
        <div className="space-y-4 px-3 pt-1 pb-4 pl-8">
          {file && (
            <div className="flex items-start gap-2 rounded-md bg-hover/60 px-2.5 py-2 text-[11px] text-muted">
              <FileCode size={12} className="mt-px shrink-0" />
              <span>
                <span className="font-mono">{file.name}</span> in the repository is used first; the settings below only apply where it leaves
                something out.
              </span>
            </div>
          )}
          {SCRIPTS.map((s) => {
            const fromFile = file?.config.scripts[s.key];
            return (
              <div key={s.key}>
                <div className="mb-1.5 text-xs font-medium">{s.label}</div>
                <ScriptInput
                  value={config.scripts[s.key] ?? ""}
                  placeholder={fromFile ? `${fromFile}   (from ${file!.name})` : s.placeholder}
                  onCommit={(v) => save({ ...config, scripts: { ...config.scripts, [s.key]: v.trim() || null } })}
                />
                <div className="mt-1 text-[11px] text-muted">{s.hint}</div>
              </div>
            );
          })}
          <div>
            <div className="mb-1.5 text-xs font-medium">Files to copy</div>
            <ScriptInput
              value={config.copy.join("\n")}
              placeholder={".env\n.env.local"}
              onCommit={(v) =>
                save({
                  ...config,
                  copy: v
                    .split(/[\n,]/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
            <div className="mt-1 text-[11px] text-muted">
              Gitignored files copied from the main checkout into new workspaces, one per line. Scripts and terminals get{" "}
              <span className="font-mono">$RUNNER_ROOT_PATH</span>, <span className="font-mono">$RUNNER_WORKSPACE_PATH</span> and{" "}
              <span className="font-mono">$RUNNER_PORT</span> (first of 10 ports reserved for the workspace).
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScriptInput({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const rows = Math.min(6, Math.max(1, v.split("\n").length, placeholder.split("\n").length));
  return (
    <textarea
      value={v}
      rows={rows}
      spellCheck={false}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      className="selectable block w-full resize-y rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-faint focus:border-accent"
    />
  );
}
