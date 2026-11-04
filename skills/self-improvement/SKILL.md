---
name: self-improvement
description: Hermes-style dual-tier memory and procedural skill self-evolution. Learn project gotchas, save user preferences, and create or patch skills deliberately.
---

# Self-Improving AI (Hermes Architecture)

Persistent memory and reusable procedural skills are separate from REA. Loading the REA skill or discovering its MCP tools does **not** automatically produce a memory update. The agent should load the matching skill with `read_skill` and use REA tools when the task requires reverse engineering; it should only store verified, reusable conclusions.

## Dual-Tier Memory

- **`MEMORY.md`**: Durable project knowledge at `<workspace>/.9router/MEMORY.md`, limited to ~2,400 characters. Save architecture, verified commands and reusable gotchas, not transient state or unverified REA hypotheses.
- **`USER.md`**: Explicit user preferences at `<workspace>/.9router/USER.md` (or the global fallback), limited to ~1,400 characters. Do not infer preferences from a single routine message.
- Memory is injected into subsequent agent prompts. Old entries are bounded and deduplicated.

## Tools

- `manage_memory`: `view`, `append`, `replace`; target `project` or `user`. Read before overwriting. Example: `manage_memory({action:"append",target:"project",content:"- Verified build command: npm run build."})`.
- `manage_skill`: `list`, `view`, `create`, `patch`; use for repeatable workflows, not for per-chat facts. Read an existing skill before patching it.

## Post-turn review

A best-effort reviewer runs after a successful agent turn, before the `done` event so the dashboard can display its result. It returns a visible notice:

- `Self-improvement updated`: New durable knowledge was saved.
- `Self-improvement skipped: no new durable knowledge`: Review ran and correctly found nothing worth persisting. This is normal, **not** an MCP failure.
- `Self-improvement skipped: ...`: The turn was ineligible, for example plain chat mode or a routine acknowledgement.
- `Self-improvement failed: ...`: The review or persistence failed; check the notice and chat run events. The primary chat answer remains available.

The reviewer cannot substitute for calling REA: if `MCP rea unavailable: ...` appears, verify the enabled `rea` server in `/dashboard/chat` MCP settings and probe `npx -y rea-agents@6.4.0 mcp`. Do not claim reverse engineering was performed when its tools were unavailable. REA-specific workflow and evidence rules are in `rea-reverse-engineer`.
