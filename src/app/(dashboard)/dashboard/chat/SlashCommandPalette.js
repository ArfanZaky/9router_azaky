"use client";

export const CHAT_COMMANDS = [
  { name: "help", summary: "List chat commands" },
  { name: "new", summary: "Start a new chat" },
  { name: "clear", summary: "Clear this transcript" },
  { name: "undo", summary: "Remove the latest exchange" },
  { name: "fork", args: "[title]", summary: "Fork this conversation" },
  { name: "rename", args: "<title>", summary: "Rename this conversation" },
  { name: "model", summary: "Open the model picker" },
  { name: "agent", args: "orchestrator|coder|researcher|reviewer|planner", summary: "Switch agent role" },
  { name: "retry", summary: "Regenerate the latest answer" },
  { name: "stop", summary: "Stop the active run" },
  { name: "export", args: "md|json", summary: "Export this conversation" },
  { name: "project", args: "<absolute path>", summary: "Bind a project workspace" },
  { name: "codebase", summary: "Edit this session's name and project URL/path" },
  { name: "mcp", summary: "Manage MCP servers for this chat" },
  { name: "steer", args: "<instruction>", summary: "Redirect the active agent" },
  { name: "approve", summary: "Allow the pending tool approval (Alt+A)" },
  { name: "deny", summary: "Deny the pending tool approval (Alt+D)" },
  { name: "goal", args: "<text|status|pause|resume|clear>", summary: "Set or manage a standing goal" },
  { name: "verify", summary: "Toggle answer verification by a second model" },
  { name: "compact", summary: "Compress transcript: summarize old messages, keep recent ones verbatim" },
];

export function commandMatches(value) {
  if (!value.startsWith("/") || value.includes(" ") || value.includes("\n")) return [];
  const query = value.slice(1).toLowerCase();
  return CHAT_COMMANDS.filter((command) => command.name.startsWith(query));
}

export default function SlashCommandPalette({ matches, selected, onPick }) {
  if (!matches.length) return null;
  return <div role="listbox" className="absolute bottom-full left-0 right-0 z-40 mb-3 max-h-64 overflow-auto rounded-xl border border-primary/35 bg-surface p-1.5 shadow-[0_20px_55px_rgba(0,0,0,0.65)] ring-1 ring-black/30">{matches.map((command, index) => <button key={command.name} type="button" role="option" aria-selected={selected === index} onMouseDown={(event) => { event.preventDefault(); onPick(command); }} className={`flex w-full items-baseline gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${selected === index ? "border-primary/35 bg-surface-2" : "border-transparent hover:bg-surface-2"}`}><span className="font-mono text-xs font-semibold text-primary">/{command.name}{command.args ? ` ${command.args}` : ""}</span><span className="truncate text-[11px] text-text-muted">{command.summary}</span></button>)}</div>;
}
