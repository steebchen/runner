import { Channel, invoke } from "@tauri-apps/api/core";

export type Repo = { id: string; name: string; path: string; defaultBranch: string };

export type Workspace = {
  id: string;
  repoId: string;
  name: string;
  branch: string;
  baseBranch: string;
  path: string;
  status: string;
  createdAt: number;
};

export type Session = {
  id: string;
  workspaceId: string;
  agentId: string;
  acpSessionId: string | null;
  title: string;
  createdAt: number;
};

export type AgentDef = { id: string; name: string; command: string; args: string[] };

export type Settings = {
  enabledAgents: string[];
  defaultAgent: string;
  branchPrefix: string;
  workspacesRoot: string;
  editor: string;
  theme: "system" | "light" | "dark";
};

export type AgentStatus = {
  id: string;
  name: string;
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  account: string | null;
  installCommand: string;
  loginCommand: string;
  logoutCommand: string;
};

export type ChangedFile = { path: string; status: string; additions: number | null; deletions: number | null };

export type SelectOption = { value: string; name: string; description?: string | null };
export type ConfigOption = {
  id: string;
  name: string;
  category?: string | null;
  type: "select" | "boolean";
  currentValue: string | boolean;
  options?: SelectOption[] | { group: string; name: string; options: SelectOption[] }[];
};

export type PermissionOption = { optionId: string; name: string; kind: string };

// Raw ACP session/update payload; the transcript reducer interprets it.
export type AcpUpdate = { sessionUpdate: string; [key: string]: any };

export type CoreEvent =
  | { type: "sessionUpdate"; sessionId: string; update: AcpUpdate }
  | { type: "userMessage"; sessionId: string; text: string; ts: number }
  | { type: "turnEnd"; sessionId: string; stopReason: string; ts: number }
  | { type: "sessionState"; sessionId: string; state: string; error: string | null }
  | { type: "sessionConfig"; sessionId: string; configOptions: ConfigOption[] }
  | { type: "sessionTitle"; sessionId: string; title: string }
  | { type: "permissionRequest"; sessionId: string; requestId: string; toolCall: any; options: PermissionOption[] }
  | { type: "permissionResolved"; sessionId: string; requestId: string }
  | { type: "workspaceStatus"; workspaceId: string; status: string }
  | { type: "scriptOutput"; workspaceId: string; data: string };

export type PrStatus = {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  title: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[];
};

export const api = {
  subscribe: (onEvents: (events: CoreEvent[]) => void) => {
    const channel = new Channel<CoreEvent[]>();
    channel.onmessage = onEvents;
    return invoke<void>("subscribe", { channel });
  },
  listAgents: () => invoke<AgentDef[]>("list_agents"),
  listRepos: () => invoke<Repo[]>("list_repos"),
  addRepo: (path: string) => invoke<Repo>("add_repo", { path }),
  removeRepo: (repoId: string) => invoke<void>("remove_repo", { repoId }),
  listWorkspaces: () => invoke<Workspace[]>("list_workspaces"),
  createWorkspace: (repoId: string) => invoke<Workspace>("create_workspace", { repoId }),
  archiveWorkspace: (workspaceId: string) => invoke<void>("archive_workspace", { workspaceId }),
  repoConfig: (workspaceId: string) =>
    invoke<{ scripts: { setup?: string; run?: string; archive?: string }; copy: string[] }>("repo_config", { workspaceId }),
  listSessions: (workspaceId: string) => invoke<Session[]>("list_sessions", { workspaceId }),
  createSession: (workspaceId: string, agentId: string) => invoke<Session>("create_session", { workspaceId, agentId }),
  deleteSession: (sessionId: string) => invoke<void>("delete_session", { sessionId }),
  sessionEvents: (sessionId: string) => invoke<CoreEvent[]>("session_events", { sessionId }),
  sendPrompt: (sessionId: string, text: string) => invoke<void>("send_prompt", { sessionId, text }),
  cancelPrompt: (sessionId: string) => invoke<void>("cancel_prompt", { sessionId }),
  respondPermission: (sessionId: string, requestId: string, optionId: string | null) =>
    invoke<void>("respond_permission", { sessionId, requestId, optionId }),
  setConfig: (sessionId: string, configId: string, value: string | boolean) =>
    invoke<void>("set_config", { sessionId, configId, value }),
  changedFiles: (workspaceId: string) => invoke<ChangedFile[]>("changed_files", { workspaceId }),
  fileDiff: (workspaceId: string, path: string) => invoke<string>("file_diff", { workspaceId, path }),
  revertFile: (workspaceId: string, path: string) => invoke<void>("revert_file", { workspaceId, path }),
  commitAll: (workspaceId: string, message: string) => invoke<void>("commit_all", { workspaceId, message }),
  push: (workspaceId: string) => invoke<void>("push", { workspaceId }),
  prStatus: (workspaceId: string) => invoke<PrStatus | null>("pr_status", { workspaceId }),
  createPr: (workspaceId: string, title: string, body: string) => invoke<string>("create_pr", { workspaceId, title, body }),
  mergePr: (workspaceId: string) => invoke<void>("merge_pr", { workspaceId }),
  terminalOpen: (
    workspaceId: string,
    terminalId: string,
    cols: number,
    rows: number,
    command: string | null,
    onData: (data: Uint8Array) => void,
    onExit: () => void,
  ) => {
    const dataChannel = new Channel<ArrayBuffer>();
    dataChannel.onmessage = (buf) => onData(new Uint8Array(buf));
    const exitChannel = new Channel<boolean>();
    exitChannel.onmessage = onExit;
    return invoke<void>("terminal_open", { workspaceId, terminalId, cols, rows, command, onData: dataChannel, onExit: exitChannel });
  },
  terminalWrite: (terminalId: string, data: string) => invoke<void>("terminal_write", { terminalId, data }),
  terminalResize: (terminalId: string, cols: number, rows: number) => invoke<void>("terminal_resize", { terminalId, cols, rows }),
  terminalKill: (terminalId: string) => invoke<void>("terminal_kill", { terminalId }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  detectAgents: () => invoke<AgentStatus[]>("detect_agents"),
  setupTerminalOpen: (terminalId: string, cols: number, rows: number, command: string, onData: (d: Uint8Array) => void, onExit: () => void) => {
    const dataChannel = new Channel<ArrayBuffer>();
    dataChannel.onmessage = (buf) => onData(new Uint8Array(buf));
    const exitChannel = new Channel<boolean>();
    exitChannel.onmessage = onExit;
    return invoke<void>("setup_terminal_open", { terminalId, cols, rows, command, onData: dataChannel, onExit: exitChannel });
  },
  openPath: (path: string, appName?: string) => invoke<void>("open_path", { path, appName: appName ?? null }),
};
