# Runner

Run Claude Code, Codex and OpenCode in parallel, each in its own git worktree, then review the diffs and ship PRs from one fast desktop app.

Runner uses the agent CLIs you already have and the subscriptions you're already signed in to (Claude Pro/Max, ChatGPT). It never proxies or stores credentials.

## Features

- **Workspaces**: every task gets its own git worktree and branch (`runner/<city>`), created from the latest upstream base branch.
- **Agents over ACP**: Claude Code, Codex and OpenCode all speak the [Agent Client Protocol](https://agentclientprotocol.com), so the chat UI, tool calls, plans, permission prompts and model/mode pickers work the same for every agent.
- **Review**: the changed-files list and diff against the merge base, line comments sent back to the agent, and per-file discard.
- **Ship**: create a PR (commit, push and `gh pr create`), view CI checks, "fix failing checks", merge, and archive.
- **Terminals**: per-workspace shells plus a one-click `run` script.
- **Settings**: detects installed agents and their login status, installs or signs in through an embedded terminal, and sets the default agent, branch prefix, workspaces folder, editor and theme.

## Requirements

- macOS (Linux and Windows are planned; the core is platform-neutral)
- Rust 1.85+, Node 20+, pnpm
- `git`, and optionally `gh` (for PRs)
- At least one agent: `claude`, `codex` or `opencode`. The Claude and Codex ACP adapters run via `npx`.

## Development

```sh
pnpm install
pnpm dev           # Tauri app with hot reload
pnpm test          # Rust tests (core, including a scripted ACP agent)
pnpm typecheck
pnpm build         # Runner.app + .dmg in target/release/bundle
```

UI-only work: run `pnpm --filter desktop dev` and open http://localhost:1420. In a plain browser, a fake backend (`src/dev/mock.ts`) streams scripted agent output. It is only loaded in dev mode.

Real end-to-end smoke test against your installed agents:

```sh
cargo run -p runner-core --example detect                 # what Runner sees
cargo run -p runner-core --example e2e -- /path/to/repo claude
```

## Repository config: `runner.json`

Optional, committed at the repo root:

```json
{
  "scripts": {
    "setup": "pnpm install",
    "run": "pnpm dev",
    "archive": "docker compose down"
  },
  "copy": [".env", ".env.local"]
}
```

`setup` runs in each new worktree (output appears in the Setup tab). `copy` brings gitignored files over from the main checkout. Scripts get `RUNNER_ROOT_PATH`, `RUNNER_WORKSPACE_NAME` and `RUNNER_WORKSPACE_PATH`.

## Architecture

```
apps/desktop/src          React 19 UI (zustand, TanStack Virtual, xterm.js)
apps/desktop/src-tauri    Thin Tauri 2 bindings: commands + event channel
crates/core               Everything else, UI-agnostic:
  acp.rs                  JSON-RPC/ACP client over agent stdio
  agent.rs                Sessions: spawn, resume, prompt, permissions, config
  git.rs / forge.rs       git worktrees & diffs / GitHub via `gh`
  pty.rs                  Terminals (portable-pty)
  store.rs                SQLite (WAL), batched append-only transcript log
  setup.rs                Agent detection + settings
```

Performance notes:

- Core events are buffered and flushed to the UI once per frame over a single Tauri channel.
- Each session's transcript is folded incrementally, and only changed rows re-render.
- The transcript and diff are virtualized.
- Terminals live outside React, so switching workspaces never recreates them.
- Streamed chunks are merged before they're written to SQLite.

## Keyboard

| | |
|---|---|
| ⌘N | New workspace |
| ⌘1–9 | Switch workspace |
| ⌘O | Open workspace in editor |
| ⇧⌘O | Add repository |
| ⌘, | Settings |
| Enter / ⇧Enter | Send / newline |
| Esc | Stop agent |
| ⇧Tab | Toggle plan mode / auto-accept |

## License

Apache-2.0
