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
    widgets.ts          widget folders (mine's own in resources/widgets, and yours), served sandboxed over mine-widget://
    screens.ts          screens: pages of widgets on a grid, in screens.json
    themes.ts           the theme marketplace's shelves: list, apply, keep the current look, remove
    permissions.ts      an agent asking before it acts; only the person's click answers
    connections/        the person's tools: catalogue, checklists, OAuth sign-in, a remote MCP client, web API reads, sources
    data-store.ts       local collections of JSON documents
    approvals.ts        what the person has OKed, signed with a keychain key
    mcp/                the MCP server agents use: theme, folder, commands, widgets, data
  preload/index.ts      the only bridge: window.mine (typed by src/shared/ipc.ts)
  shared/               IPC contract, theme, decisions, commands and widgets types
  renderer/             React UI
    src/App.tsx         onboarding, routing, and mine's own features as commands
    src/lib/abilities.ts  how a feature registers its command
    src/components/     Conversation, CommandView (files, table, list, markdown, html, widget), Approval, …
                        WidgetFrame, ScreenGrid, Marketplace, ChatDock (the conversation over a screen), ScreenSwitcher,
                        Connections (the checklists, the empty screen that asks about your day, the tools shelf)
```

## Abilities: commands, widgets, data

mine is built to be extended at runtime, by the person or by their agent, with no rebuild. There are three building blocks:

- **Commands** are instant actions. A fast System One model (the decisions provider) picks the command from what was said, along with any choice parameters. mine then runs it directly, with no agent involved. A command can show a view in the conversation.
  - **mine's own features** are registered in `App.tsx` through `useAppCommands`.
  - **The person's commands** are `.js` files in `%APPDATA%/mine/commands`. They run in a utility process with a `mine` API (see `COMMAND_GUIDE` in `src/shared/commands.ts`).
- **Widgets** are HTML/CSS/JS cards. mine ships its own in `resources/widgets/` (clock, to-dos, note, focus timer, habits, countdowns), and the person's live in `%APPDATA%/mine/widgets/<name>/`. Each runs in a sandboxed iframe with no network. It reaches mine only through `window.mine`, and only the data collections it declares (see `WIDGET_GUIDE` in `src/shared/widgets.ts`). Every widget carries `mock.json`, sample data the marketplace runs it on, in memory, so trying one never touches real data.
- **Screens** are blank pages on a 12-column grid. The person puts widgets on them and drags, resizes and arranges them. When a screen shows, the conversation steps aside into a small window or a button in the corner (Ctrl+J toggles it), and the change morphs with the View Transitions API.
- **The marketplace** has two shelves. Widgets: every widget, mine's own and the person's, live on its sample data, with a way to add each to a screen. Themes: mine's own in `resources/themes/` (Bloom, Harbour, Kōwhai, Graphite, Moss, Dusk) and the person's in `%APPDATA%/mine/themes/`, each previewed as a small mock of mine in light and dark. Applying one goes through the theme history, so it can be undone. The look on screen can be kept as a theme, and agents can add one with `save_theme`.
- **Data** is `%APPDATA%/mine/data/<collection>.json`. Commands, widgets and agents share it, and widgets update live when it changes.
- **Connections** join the tools the person uses every day (Jira, Linear, GitHub, their calendar, Slack) to mine. See below.

## Connections

An empty screen asks the person what they do day to day and which tools their team uses. That goes to their agent, which puts each tool on a checklist (`suggest_connection`), offers widgets, and, once a tool is connected, sets up a source that keeps its data flowing into a collection.

- **The catalogue** is `resources/services/*.json`: 19 services, each with the ways it can connect, best first, plus exact steps and ready-made sources. An agent can design a connection for anything else, as long as it names the hosts the person's details may go to and the steps to take.
- **Ways to connect**, in the order mine prefers them:
  - **Sign in (OAuth) to the service's remote MCP server.** mine discovers the server's authorisation server (RFC 9728 and 8414) and gets a client id with no one registering mine by hand: a pre-registered client if there is one, else mine's client ID metadata document (`https://mine.computer/oauth/client.json`, published from `landing/public/oauth/client.json`; used only once it's live and matches), else dynamic client registration. Then PKCE, a loopback redirect on `127.0.0.1:47823`, the `resource` parameter, the `iss` check, and refresh. Atlassian, Linear, Notion, Sentry, Figma, Canva, Stripe, Intercom, monday.com, ClickUp and Zapier work like this today.
  - **Sign in to a service that only lets registered apps in** (GitHub, Slack, Asana, HubSpot, Google, Microsoft). Those need mine registered with each, and the client id in `oauth-clients.json` (a file of that name in the user data folder adds to it and can hold a secret). Until then the checklist offers the next way.
  - **A token or secret address the person pastes**, sent only to the hosts the connection names, e.g. a Jira API token or a calendar's secret ICS address.
- **Secrets** (tokens, secret fields) are encrypted with the OS keychain (`secrets.ts`), stay in the main process, and never reach the window or an agent.
- **Sources** pull from a connection on a schedule into a collection (`data.sync` replaces just that source's documents, keeping fields changed locally, like a message marked read). mine's own Work, Agenda and Messages widgets show the standard collections `work`, `agenda` and `messages`, so a source that fills one needs nothing more. A source an agent makes waits for the person's Approve click, like a command or widget.
- **Agents** read through mine (`connection_tools`, `connection_call`). A tool that might change something in the person's account asks them first, and "allow all in this folder" never covers it.
- **Widgets** can open links with `mine.open(url)`, but only to the person's own services.

How a request is handled: the person speaks or types. The decisions model picks a command or widget, or answers "agent". Choices that depend on the moment, like subfolders, take one more quick call. Anything that isn't clearly a command goes to the agent, the System Two model.

Approval: nothing an agent writes runs until the person approves it in mine. Approvals are content hashes, signed with a key kept in the OS keychain, so any edit needs approving again.

**Rule for new features:** anything the person can do in mine must also be a command. Add it to `appCommands` in `App.tsx`, next to the feature, with a plain description, 3-4 example phrasings, and fixed-choice params. That makes it sayable and runnable by agents (`run_command`). Approving things is the one exception: it must stay a click.

Speech runs on this computer. Prompts go to whichever harness you picked, running in the folder shown in the title bar.
