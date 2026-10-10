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

Other commands: `ag/ship --status`, `ag/ship --rollback`, `ag/sync-upstream`, `ag/build-mac [<rev>]`,
`ag/build-mac --status`. What's left to build from Ag: `ag/TODO.md` (check items off as they ship).

## The Mac app

`ag/build-mac` builds upstream's Electron app (`apps/desktop`) from a fork commit on ag-mac and installs it on the
client Mac as `/Applications/T3 Code (Ag).app`, without patching any upstream file: in its clean build worktree it
stamps the product name and a non-nightly version (`<core>-ag.<date>.g<sha>`), so upstream's build script gives
it no update feed and it never replaces itself with upstream's build. It shares upstream's profile (`t3code-v2`),
so it's used _instead of_ T3 Code (Nightly), which is retired to `/Applications/Retired/`. For fast UI iteration,
run the web UI against a dev server (`AGENTS.md`); the app itself picks the change up on the next `ag/ship`.

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

| File                                                  | Why                                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                           | Pointer to this file (top lines)                                                                                                                                                                            |
| `apps/web/src/components/Sidebar.tsx`                 | `SidebarThreadRow`: `useRevealActiveSidebarRow` wraps the row ref (`apps/web/src/ag/revealActiveSidebarRow.ts`) + its import                                                                                |
| `apps/web/src/main.tsx`                               | `installNormalMode()` + its import (`apps/web/src/ag/normalMode.ts`: vim normal mode, j/k/i/e); `installSingleWorkspace()` + import (`ag/singleWorkspace.ts`)                                               |
| `apps/web/src/components/Sidebar.tsx`                 | Single workspace hooks: `data-ag-row` (row body/head/title/meta), `data-ag-noise` (provider/env icons; hover-card project/env/model lines), `data-ag-quiet` (project label), class `ag-noise` (row favicon) |
| `apps/web/src/components/settings/SettingsPanels.tsx` | `<SingleWorkspaceSetting />` at the top of Behavior + import                                                                                                                                                |

## Rules carried over from Ag

- Never write to the live install: `~/.t3/userdata` is Nathan's real database. Use a dev server with
  `--base-dir` on a copy (`AGENTS.md` explains). Only `ag/ship` touches the live server.
- Don't enable upstream's GitHub workflows (Actions are off in this fork), release or publish anything, or sign
  in to T3 Connect.
- Commit messages start with the AI attribution line (Nathan's global instructions).
