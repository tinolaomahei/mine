# mine desktop

Electron + React + TypeScript (electron-vite), shadcn/ui on Tailwind v4, themed with the Bloom palette from `../landing`.

```
npm install
npm run dev        # app with hot reload
npm run build      # production bundle in out/
npm run typecheck
```

## How it fits together

```
src/
  main/                 Node side (Electron main process)
    index.ts            window, permissions (mic only), IPC wiring
    settings.ts         settings.json in %APPDATA%/mine
    conversations.ts    saved conversations, one file each
    harness/            bring-your-own-harness: detect, spawn headless, parse each stream format
    speech/             Parakeet TDT 0.6B v3 in a utility process
    decisions/          the fast layer: one provider-agnostic call to a System One model
    commands/           the command registry: worker (runs command files), starters, local pipe
    widgets.ts          widget folders, served sandboxed over mine-widget://
    data-store.ts       local collections of JSON documents
    approvals.ts        what the person has OKed, signed with a keychain key
    mcp/                the MCP server agents use: theme, folder, commands, widgets, data
  preload/index.ts      the only bridge: window.mine (typed by src/shared/ipc.ts)
  shared/               IPC contract, theme, decisions, commands and widgets types
  renderer/             React UI
    src/App.tsx         onboarding, routing, and mine's own features as commands
    src/lib/abilities.ts  how a feature registers its command
    src/components/     Conversation, CommandView (files, table, list, markdown, html, widget), Approval, …
```

## Abilities: commands, widgets, data

mine is built to be extended at runtime, by the person or by their agent, with no rebuild. There are three building blocks:

- **Commands** are instant actions. A fast System One model (the decisions provider) picks the command from what was said, along with any choice parameters. mine then runs it directly, with no agent involved. A command can show a view in the conversation.
  - **mine's own features** are registered in `App.tsx` through `useAppCommands`.
  - **The person's commands** are `.js` files in `%APPDATA%/mine/commands`. They run in a utility process with a `mine` API (see `COMMAND_GUIDE` in `src/shared/commands.ts`).
- **Widgets** are HTML/CSS/JS cards. They live in `%APPDATA%/mine/widgets/<name>/` and run in a sandboxed iframe with no network. They reach mine only through `window.mine`, and only the data collections they declare (see `WIDGET_GUIDE` in `src/shared/widgets.ts`).
- **Data** is `%APPDATA%/mine/data/<collection>.json`. Commands, widgets and agents share it, and widgets update live when it changes.

How a request is handled: the person speaks or types. The decisions model picks a command or widget, or answers "agent". Choices that depend on the moment, like subfolders, take one more quick call. Anything that isn't clearly a command goes to the agent, the System Two model.

Approval: nothing an agent writes runs until the person approves it in mine. Approvals are content hashes, signed with a key kept in the OS keychain, so any edit needs approving again.

**Rule for new features:** anything the person can do in mine must also be a command. Add it to `appCommands` in `App.tsx`, next to the feature, with a plain description, 3-4 example phrasings, and fixed-choice params. That makes it sayable and runnable by agents (`run_command`). Approving things is the one exception: it must stay a click.

Speech runs on this computer. Prompts go to whichever harness you picked, running in the folder shown in the title bar.
