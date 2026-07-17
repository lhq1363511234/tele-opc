# Tele-OPC Codex Agent Guidance

## Codex Subagents

When the user explicitly asks for Codex subagents, parallel agents, fanout, or "one agent per task", use Codex subagent workflows.

Current local Codex behavior exposes CSV-based fanout through `spawn_agents_on_csv`. Do not assume a direct named-agent launcher is available in every surface.

Use this workflow:

1. Create a small CSV worklist under `runtime/` with one row per independent task.
2. Include all context each worker needs in the row prompt. CSV workers may not have normal repo-reading tools, so the parent agent should read key files first and paste the relevant excerpts into the row prompt.
3. Use `id_column` with a stable row id such as `agent` or `task_id`.
4. Set `max_workers` and `max_concurrency` conservatively. Default to 2-4 workers unless the user asks for more.
5. Set `output_csv_path` outside the repo or under `runtime/`.
6. After fanout completes, read the output CSV.
7. Treat `{}` or empty `result_json` as failed output. Retry with more explicit row context or do the final synthesis in the parent.

For Tele-OPC Web Console work, preferred worker rows are:

- `backend-api`: Fastify routes, repository methods, auth, JSON API contracts.
- `web-console`: React/Vite UI, layouts, state, dashboard ergonomics.
- `motion-polish`: WebGL/motion/micro-interactions and reduced-motion fallback.
- `qa-verifier`: typecheck, tests, smoke checks, release risk.
- `docs-planner`: README, deployment notes, roadmap updates.

Keep write-heavy work coordinated by the parent agent. Use subagents first for read-heavy exploration, test triage, UI critique, and plan review. If multiple workers need to edit files, assign non-overlapping files and merge deliberately.
