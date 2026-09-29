# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. `CLAUDE.md` is a symlink to this file, so edit this one.

## Project

Runner is a desktop app that runs coding agents (Claude Code, Codex, OpenCode) in parallel. Each task gets its own git worktree, and the app handles chat, diff review, PRs and terminals. It's similar to conductor.build.

- **Goals:** a fast, efficient UI; macOS first, but keep Linux and Windows possible; open source with paid add-ons later.
- **Agents run on the user's own logins** (Claude subscription, ChatGPT, OpenCode auth). Runner never stores or proxies credentials; it only runs the official CLIs and their login commands.
- **One protocol for all agents:** every agent speaks the Agent Client Protocol (ACP) over stdio. Claude and Codex run through adapters (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`); OpenCode is native (`opencode acp`).

## Layout

```
crates/core/              Rust core, UI-agnostic (no Tauri dependency)
  src/acp.rs              JSON-RPC/ACP client over agent stdio
  src/agent.rs            Agent sessions: spawn, resume, prompt, permissions,
                          plan/auto-accept mode mapping, auto titles
  src/git.rs              git CLI wrappers: worktrees, changed files, diffs
  src/forge.rs            GitHub via the `gh` CLI (PR list/create/merge); `Core`
                          polls `gh pr list` once per repo and emits WorkspacePr
  src/pty.rs              Terminals (portable-pty)
  src/store.rs            SQLite (WAL); batched, chunk-merged transcript log
  src/setup.rs            Agent detection (installed / signed in) + Settings
  src/title.rs            Quick heuristic titles + Haiku summaries via `claude -p`
  src/catalog.rs          Per-agent model/effort catalog, discovered from ACP
                          configOptions (short discovery session or live sessions)
  src/workspace.rs        runner.json config, workspace naming
  src/env.rs              Login-shell env capture (GUI apps lack the user's PATH)
  src/lib.rs              `Core`: the API the app calls (workspace lifecycle:
                          create -> archive (worktree removed, branch kept) -> restore)
  tests/                  Integration tests with a scripted fake ACP agent
  examples/               detect.rs, e2e.rs, catalog.rs, preset.rs (real agents), title.rs
apps/desktop/src-tauri/   Thin Tauri 2 layer: commands + one batched event channel
apps/desktop/src/         React 19 UI
  lib/api.ts              Typed wrappers for every Tauri command + event types
  lib/store.ts            zustand store; handleEvents folds core events per frame
  lib/transcript.ts       Pure reducer: ACP updates -> transcript items
  components/             Sidebar, Home (all workspaces, archive/restore),
                          WorkspaceView, Chat, ChangesPanel, TerminalPanel,
                          PrActions, Settings, ...
  dev/mock.ts             Fake backend for running the UI in a plain browser
```

## Commands

```sh
pnpm install
pnpm dev                                   # run the app (Tauri + Vite, hot reload)
cargo test --workspace                     # Rust tests
cargo clippy --workspace --all-targets     # must stay warning-free
pnpm typecheck                             # TypeScript
pnpm build                                 # Runner.app + .dmg
pnpm --filter desktop dev                  # UI only; open http://localhost:1420 (uses dev/mock.ts)
cargo run -p runner-core --example detect  # what agent CLIs/logins Runner sees
cargo run -p runner-core --example e2e -- <repo> claude   # real end-to-end run
# Real GitHub PR/checks e2e (opens, merges and closes PRs on a private fixture repo whose CI fails if a `FAIL` file exists):
RUNNER_E2E_GH_REPO=steebchen/runner-e2e-test cargo test -p runner-core --test github_e2e -- --ignored --nocapture
```

## Architecture rules

- **Keep logic in `crates/core`.** The Tauri crate maps commands and forwards events, nothing more. Core must not depend on Tauri, so a CLI, headless daemon or remote runner can reuse it.
- **Shell out to `git` and `gh`** rather than using libgit2 or the GitHub API. That way the user's config and credentials apply.
- **Every spawned process uses `env::tokio_command` / `env::std_command`**, so it gets the user's login-shell PATH.
- **Events are the only way the UI learns about changes.** Core emits `Event`s; transcript events are persisted and replayed by the same reducer (`transcript.ts`). Add new UI-visible state as an `Event` variant plus a `CoreEvent` type in `api.ts`.
- **Agent differences live in the core.** The UI renders ACP `configOptions` generically. Agent-specific mapping (e.g. plan vs. bypass modes) goes in `agent.rs`, with unit tests.
- **Models:** the picker (`ModelPicker.tsx`) shows the user's loadout (`Settings.loadout`, first entry = default for new workspaces) and searches all Claude/Codex models plus the OpenCode models chosen in settings. Picking another agent's model opens a new chat, which replaces the current chat if it's empty. New sessions get model/effort via `Core::create_session(.., model, effort)`, applied on connect.
- **Permissions:** sessions auto-accept every permission request by default. Plan mode (Shift+Tab in the composer) forwards requests to the user. Agent permission pickers are hidden in the UI.
- **Platform-specific code stays isolated** (e.g. `open -a` in the Tauri layer), so Linux and Windows remain additive.

## UI and performance

- Never re-render the whole transcript for a streamed chunk. The reducer replaces only the changed items; rows are memoized; long lists (transcript, diffs) are virtualized.
- Subscribe to the narrowest zustand slice possible (per session or per workspace).
- Agent output is untrusted. Markdown is sanitized with DOMPurify before it touches the DOM.
- Terminals live outside React (`TerminalPanel.tsx` registry) and use xterm's DOM renderer.
- Styling uses Tailwind v4 with the CSS color tokens in `styles.css`. Support light and dark themes (`data-theme` override or system).
- `localStorage` is only for per-device conveniences like panel widths. Anything durable goes through core/SQLite.

## Working agreement

- **Always commit your work.** Make small, focused commits with clear messages as you complete each logical change. Don't leave finished work uncommitted.
- Before committing, run `cargo test --workspace`, `cargo clippy --workspace --all-targets` and `pnpm typecheck`, and fix what you broke.
- Add or update tests for core logic (see `crates/core/tests/agent_session.rs` and the unit tests in each module).
- Keep `dev/mock.ts` in sync when adding commands or events, so the UI stays runnable in a browser.
- Update this file when you change architecture, commands or conventions.
