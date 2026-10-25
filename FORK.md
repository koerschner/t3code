# This fork (koerschner/t3code)

Nathan's fork of [T3 Code](https://github.com/pingdotgg/t3code), run as the UI of his agent system, Ag. It is
deployed from `main` to the T3 server on Ag's session host and used daily. Read this before changing anything;
where it disagrees with `AGENTS.md`, this file wins. In `AGENTS.md`, "we/maintainers" means Theo and Julius
upstream. Here, the person you work for is Nathan.

## Shipping a feature in one shot

1. Work in a worktree off `origin/main`: `git -C ~/t3code worktree add ~/t3code-<topic> -b <topic> origin/main`,
   then `corepack pnpm install`.
2. Build the feature. Follow `AGENTS.md` (hit every surface, effect patterns, tests), but scope it to **web +
   server**: only those reach Nathan right away (see "Surfaces"). Add or adjust tests next to what you changed.
3. Commit, then run **`ag/ship`** from the worktree. It builds that commit cleanly, typechecks, runs the tests
   affected since the deployed build, boots the candidate against a backup of the live database, deploys it,
   health-checks it (rolling back on failure), and pushes it to `origin/main`. If `origin/main` moved, merge it
   and ship again.
4. Check the result on the live server (`https://ag.<tailnet>.ts.net`, headless browser or the `preview_*`
   tools) and report what shipped, with the version `ag/ship` printed.

This repo is **slop-cannon**, like the ag repo: commit, ship and push to `main` without asking, no PRs. Never
push to `upstream`, and never open PRs against pingdotgg/t3code unless Nathan asks.

Deploys never interrupt turns: if one is running, `ag/ship` stages the build and restarts the server once all turns finish (`ag/ship --status` shows it as pending).

Other commands: `ag/ship --status`, `ag/ship --rollback`, `ag/sync-upstream`, `ag/build-mac [<rev>]`,
`ag/build-mac --status`. What's left to build from Ag: `ag/TODO.md` (check items off as they ship).

## The Mac app

`ag/build-mac` builds upstream's Electron app (`apps/desktop`) from a fork commit on ag-mac and installs it on the
client Mac as `/Applications/T3 Code (Ag).app` (and on ag-mac itself, paired to the same server, so agents
test the app on ag-mac's screen, never the client's), without patching any upstream file: in its clean build worktree it
stamps the product name and a non-nightly version (`<core>-ag.<date>.g<sha>`), so upstream's build script gives
it no update feed and it never replaces itself with upstream's build. It shares upstream's profile (`t3code-v2`),
so it's used _instead of_ T3 Code (Nightly), which is retired to `/Applications/Retired/`. For fast UI iteration,
run the web UI against a dev server (`AGENTS.md`); the app itself picks the change up on the next `ag/ship`.

**Quick entry** (fork, the Mac app only): both Command keys, from any app, open a floating box that starts a new
thread in the default project without leaving the app you're in; with Shift too, that app's window is captured
and attached. Enter sends, ⌘Enter sends and pins, ⌥Enter sends and opens the thread, Tab cycles the model chips
(the new-thread default, then favorites), Esc closes (the draft is kept), ⌘V pastes images. The native side is
`apps/desktop/src/ag/QuickEntry.ts` (`kill -USR2 <pid>` opens it without the chord); the box is
`apps/web/src/ag/quickEntry/`, a popup drawn by the main window's React tree. The screenshot needs Screen Recording
for T3 Code (Ag).

**Deep search** (fork): ⌥⌘K opens a search by meaning over every open thread and every open Ag tab, next to
the palette's word search (⌘K). It's DigUp's recipe (EmbeddingGemma 2 on llama.cpp) running in Ag's
`ag-deepsearch` service on the session host; the server route `/api/ag/deep-search` forwards to it. Threads open
in place, Ag tabs open in ag-dash.

**Lanes** (fork, server): before T3 takes a message, Ag's `lane` rules (ag-rules) pick the Pi lane it runs in:
`piPrivate` (Pi sessions outside Nessie) or `pi` (synced to Nessie). Both lanes run the same TrueFoundry models, so a
thread keeps its model when it changes lanes. The rules run for every message Nathan sends and for the first message of
every thread, whichever way it starts (the composer and quick entry launch threads, `ag-t3 new` creates them, agents
launch them over MCP); when rules disagree, private wins. His `freetime-sync` rule starts every thread private and lets
Jev move FreeTime work to `pi`; `off-the-record` moves a thread private when he says "off the record". The message
starts in its lane through T3's own lane switch (queued behind a running turn, never steered into it).
`apps/server/src/ag/lane.ts` loads ag-rules' engine from `~/ag`; a failure or a rule slower than 15 s leaves the
selection unchanged.

## Surfaces

| Surface                                                     | Gets fork changes                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Server                                                      | Yes: `ag/ship`                                                                                        |
| Web UI (served by the server; browser on the Mac and phone) | Yes: `ag/ship`                                                                                        |
| Mac app **T3 Code (Ag)** (Nathan's main client)             | Yes: `ag/ship` runs `ag/build-mac` after pushing a change to web, desktop or packages (a few minutes) |
| iOS app                                                     | No (upstream's native app on TestFlight, pointed at this server; gets server features only)           |

Server-side features (MCP tools, commands, providers, settings) reach every client. UI features show up in the web
UI only.

## Keep upstream merges cheap

Upstream lands dozens of commits a day, and `ag/sync-upstream` merges them nightly (routine
`t3-upstream-sync`). Every line you change in an upstream file is a future conflict, so:

- Put fork code in its own files under an `ag/` directory in the package it belongs to: `apps/web/src/ag/`,
  `apps/server/src/ag/`, `packages/contracts/src/ag/`.
- Hook it into upstream code with the smallest possible edit (one import plus one call, or one entry in an
  existing list), and add the hook to **Patch surface** below in the same commit.
- Prefer extension points upstream already has: MCP toolkits, provider drivers, settings schemas, routes,
  sidebar sections.
- Don't reformat, rename or reorganize upstream code.
- When resolving a sync conflict, keep upstream's change and re-apply our hook on top. If upstream now does what
  our patch did, delete ours.

## Patch surface (every upstream file the fork touches)

| File                                                      | Why                                                                                                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                               | Pointer to this file (top lines)                                                                                                                                                                            |
| `apps/web/src/components/sidebar/SidebarThreadRow.tsx`    | `SidebarThreadRow`: `useRevealActiveSidebarRow` wraps the row ref (`apps/web/src/ag/revealActiveSidebarRow.ts`) + its import                                                                                |
| `apps/web/src/main.tsx`                                   | `installNormalMode()` + its import (`apps/web/src/ag/normalMode.ts`: vim normal mode, j/k/i/e/u and / to search sessions); `installSingleWorkspace()` + import (`ag/singleWorkspace.ts`)                    |
| `apps/web/src/components/sidebar/SidebarThreadRow.tsx`    | Single workspace hooks: `data-ag-row` (row body/head/title/meta), `data-ag-noise` (provider/env icons; hover-card project/env/model lines), `data-ag-quiet` (project label), class `ag-noise` (row favicon) |
| `apps/web/src/components/settings/SettingsPanels.tsx`     | `<SingleWorkspaceSetting />` at the top of Behavior + import                                                                                                                                                |
| `apps/web/src/routes/__root.tsx`                          | `<AgQuickEntryHost />` beside `<SnapShotCoordinator />` + its import (`apps/web/src/ag/quickEntry`: the quick entry box)                                                                                    |
| `apps/web/src/routes/__root.tsx`                          | `<AgDeepSearchHost />` after `<AgQuickEntryHost />` + its import (`apps/web/src/ag/deepSearch`: ⌥⌘K deep search)                                                                                            |
| `apps/server/src/server.ts`                               | `layerAgDeepSearchRoute` in `layerMakeRoutes` + its import (`apps/server/src/ag/deepSearchRoute.ts`: proxies Ag's ag-deepsearch)                                                                            |
| `apps/server/src/orchestration-v2/ThreadMessageIntake.ts` | `dispatchCommand` (`routed = AgLane.routeLane(incoming)` before upstream's guest attachments) and `launchThread` (`AgLane.routeLaunch(incoming)`) + import (`apps/server/src/ag/lane.ts`: lanes) |
| `apps/desktop/src/app/DesktopApp.ts`                      | `AgQuickEntry.start(environment.platform)` after `snapShot.initialize` + import (`apps/desktop/src/ag/QuickEntry.ts`: both-⌘ chord, screenshot, panel window)                                               |
| `apps/desktop/src/window/DesktopWindow.ts`                | main window's `setWindowOpenHandler`: `quickEntryWindowOpenResponse(details)` first (`apps/desktop/src/ag/quickEntryWindow.ts`) + import                                                                    |
| `apps/desktop/src/preload.ts`                             | `import "./ag/preload.ts"` (exposes `window.agDesktop.quickEntry`, quick entry's renderer → main IPC)                                                                                                       |

## Rules carried over from Ag

- Never write to the live install: `~/.t3/userdata` is Nathan's real database. Use a dev server with
  `--base-dir` on a copy (`AGENTS.md` explains). Only `ag/ship` touches the live server.
- Don't enable upstream's GitHub workflows (Actions are off in this fork), release or publish anything, or sign
  in to T3 Connect.
- Commit messages start with the AI attribution line (Nathan's global instructions).
