# mine desktop

- "mine" is always lowercase.
- Every feature is a command. Anything the person can click in mine must also be registered in `appCommands` (`src/renderer/src/App.tsx`, via `useAppCommands`) with a description, 3-4 example phrasings, and fixed-choice params. That way the decisions model can trigger it from speech and agents can run it with `run_command`. The exception is approving agent-made code: it stays a click and is never a command.
- Agent-made commands and widgets never run unapproved. Don't add any path, whether IPC, the pipe or MCP, that approves on anyone's behalf except through the window's Approve button.
- Widgets stay offline (the CSP in `src/main/widgets.ts`) and only get the data collections they declare.
- Every widget ships `mock.json` sample data. Marketplace previews run on it in memory (`src/renderer/src/lib/mockStore.ts`) and must never reach the real data store, run commands or ask the agent.
- mine's own widgets live in `resources/widgets/` and need no approval; the person's always do.
- An agent's permission requests (Claude Code's `--permission-prompt-tool`, answered in `src/main/permissions.ts`) are answered only by the person clicking in the window. The MCP tool and the pipe only ask; never add a path that answers for them.
- Approvals, API keys and the approvals signing key stay in the main process. Never send them to the renderer or an agent.
- Connections (`src/main/connections/`): tokens and secret fields stay in the main process, encrypted, and are only ever sent to a connection's own hosts. The window and agents get state without them. A source an agent defines runs only after the person clicks Approve. An agent's call that might change something in the person's account asks them first, and "allow all" never covers it. Typing a token in is the person's job, never a command or an agent's. Local command sources run programs with an argument list, never a shell string, and only after the person approves that exact command.
- Never put an OAuth client secret in `resources/oauth-clients.json`; the repo is public.
- See README.md for the architecture.
