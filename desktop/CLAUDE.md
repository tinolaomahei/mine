# mine desktop

- "mine" is always lowercase.
- Every feature is a command. Anything the person can click in mine must also be registered in `appCommands` (`src/renderer/src/App.tsx`, via `useAppCommands`) with a description, 3-4 example phrasings, and fixed-choice params. That way the decisions model can trigger it from speech and agents can run it with `run_command`. The exception is approving agent-made code: it stays a click and is never a command.
- Agent-made commands and widgets never run unapproved. Don't add any path, whether IPC, the pipe or MCP, that approves on anyone's behalf except through the window's Approve button.
- Widgets stay offline (the CSP in `src/main/widgets.ts`) and only get the data collections they declare.
- Approvals, API keys and the approvals signing key stay in the main process. Never send them to the renderer or an agent.
- See README.md for the architecture.
