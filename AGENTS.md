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
  src/workspace.rs        Repo config (runner.json / conductor.json merged with
                          per-repo app settings), script env, workspace naming
  src/recent.rs           "Recents" for Add repository, from Claude/Codex history
  src/attachments.rs      Images attached to prompts, copied into the data dir
  src/usage.rs            Cost of usage rows: agent-reported, or estimated from
                          tokens with user prices (Settings → Pricing)
  src/env.rs              Login-shell env capture (GUI apps lack the user's PATH)
  src/lib.rs              `Core`: the API the app calls (workspace lifecycle:
                          create -> archive (worktree removed, branch kept) -> restore)
  tests/                  Integration tests with a scripted fake ACP agent
  examples/               detect.rs, e2e.rs, catalog.rs, preset.rs, ask.rs, steer.rs,
                          usage.rs, image.rs (real agents), recent.rs, title.rs
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
- **Questions:** Runner advertises `elicitation.form`, so agents ask structured questions over ACP `elicitation/create` (Claude's AskUserQuestion, Codex's request_user_input). Questions are never auto-answered. `lib/questions.ts` normalizes both schema styles, `QuestionCard.tsx` walks the user through them, and the answer goes back as `{action: accept|decline|cancel, content}`. Real-agent check: `cargo run -p runner-core --example ask -- <repo> claude|codex`.
- **Menus and shortcuts:** app-level shortcuts are native menu items (`install_menu` in the Tauri crate) that emit a `menu` event; `runCommand` in `App.tsx` handles them, and the same ids are used for the in-page fallbacks.
- **Usage and cost:** every finished turn stores a `usage` row (tokens, model, cost). Claude/OpenCode report a running cost total per agent process, so a turn's cost is the difference between reports; the first report after a reconnect is compared with what's already recorded, because resumed sessions continue their old total. Codex reports tokens only; estimates are computed at read time from `Settings → Pricing`, so new prices apply retroactively. Real check: `cargo run -p runner-core --example usage -- <repo> claude|codex`.
- **Images:** pasted, picked or dropped images are stored by `attachments.rs` in the app data dir; prompts carry their paths (`Agents::prompt_with`) and send ACP image blocks when the agent advertises `promptCapabilities.image` (otherwise file links). `UserMessage` events keep the paths so history shows thumbnails. Real check: `cargo run -p runner-core --example image -- <repo> claude|codex`.
- **Branch names:** workspaces start on `<prefix><city>`; once the first task gets its (Haiku or heuristic) title, `Agents::name_branch` renames the branch to `<prefix><slug>` unless it was pushed (upstream set or the branch exists on origin) or `Settings.rename_branches` is off, and emits `WorkspaceBranch`.
- **Checkpoints:** before each prompt the agent layer snapshots the worktree (`git::checkpoint`: a commit of all non-ignored files, parent = HEAD, kept under `refs/runner/checkpoints/<session>/`) and emits a persisted `Checkpoint` event. `Core::restore_checkpoint` puts HEAD and files back (after taking an undo checkpoint) and queues a note for the workspace's agents with their next prompt.
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
