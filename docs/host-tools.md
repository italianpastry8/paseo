# Host Tools

Host tools surface four opencode-adjacent utilities inside the app — quota panel, role model switcher, skill manager, and MCP manager — backed by daemon services that share their state files with the equivalent VS Code extensions (or, for MCP, with opencode itself). Both sides read and write the same files on disk, so a change made in VS Code appears in the app (and vice versa) via file watching.

## Entry point

Workspace screen header, icon-only Puzzle button (next to 运行 / 文件修改 / ⋮) → dropdown → one item per available tool. The button hides when the daemon reports no host-tools capabilities; each menu item hides when its own capability is absent.

Routes: `/h/[serverId]/host-tools/quota|roles|skills|mcp` (registered in `packages/app/src/app/h/[serverId]/_layout.tsx`).

## Capability gating

`server_info.features.hostTools.{quota,roles,skills,mcp}` — booleans, computed daemon-side from whether the relevant state file's directory exists. The app reads them through a single hook, `useHostToolsFeatures(serverId)` (`packages/app/src/host-tools/use-host-tools-features.ts`); nothing else reads `serverInfo` for host tools. Marked with `COMPAT(hostTools)` for cleanup once the client floor passes the introducing version.

## RPC surface

Dotted namespaces, `.request`/`.response` pairs plus `.changed` push events (see [rpc-namespacing.md](rpc-namespacing.md)):

- `host.quota.get` / `host.quota.subscribe` / `host.quota.refresh` + `host.quota.changed`
- `host.roles.get` / `host.roles.subscribe` / `host.roles.list_models` / `host.roles.set_model` + `host.roles.changed`
- `host.skills.list` / `host.skills.subscribe` / `host.skills.toggle` / `host.skills.groups.update` + `host.skills.changed`
- `host.mcp.list` / `host.mcp.subscribe` / `host.mcp.toggle` + `host.mcp.changed`

Client methods live on `DaemonClient` (`hostQuotaGet`, `hostRolesSetModel`, `hostSkillsToggle`, `hostMcpToggle`, `onHostQuotaChanged`, …). Server dispatch is `dispatchHostToolsMessage` in `session.ts`; services are daemon-lifetime singletons held by `HostToolsRegistry` (`packages/server/src/server/host-tools/`) — sessions subscribe/unsubscribe listeners, disconnect never kills the watchers.

## Shared files (the discipline that makes interop work)

| Tool   | Files                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| quota  | `~/.cache/opencode/quota-export.json` (data), `~/.config/opencode/opencode-quota/quota-toast.json` (enabledProviders)      |
| roles  | `~/.config/opencode/oh-my-opencode-slim.json` (active preset role roster)                                                  |
| skills | six global skill roots + their `skills-disabled/` siblings, `~/.agents/skill-manager.json` (groups, zhDict, lastInstances) |
| mcp    | `~/.config/opencode/opencode.jsonc` (top-level `mcp.<name>.enabled` flags)                                                 |

Rules:

- **Never overwrite a corrupt state file.** Report a structured error (`file_corrupt`) and leave the bytes untouched. Missing files are fine — defaults apply (all providers enabled, prefix auto-grouping, empty MCP server list).
- **Atomic writes only**: tmp file + rename, and `.bak` backup before the roles/mcp writer modifies the file. Preserve unknown fields and the file's existing indentation.
- **Enable/disable is a pure directory rename** between `skills/` and `skills-disabled/`, with rollback if any instance move fails midway.
- **MCP toggle is a single-field flip** of `mcp.<name>.enabled` in `opencode.jsonc`. The writer strips JSONC comments before parsing and writes back `JSON.stringify` output (2-space indent) — original comments are not preserved. A `.bak` is left before each write.
- All four services debounce-watch their files and push `.changed` only when the normalized snapshot actually differs.

## MCP manager specifics

- **JSONC parsing**: `opencode.jsonc` allows `//` and `/* */` comments. The daemon strips them with `stripJsoncComments` (`packages/server/src/server/host-tools/strip-jsonc.ts`) before `JSON.parse`. The strip is string-state aware so `//` inside string literals is preserved.
- **No hot reload**: opencode spawns MCP servers once at session start and does not re-read `opencode.jsonc` mid-session. A toggle writes the file; the running session keeps the old state until the user starts a new session. The app surfaces this with a "新会话生效 / takes effect in new sessions" hint.
- **Per-server granularity only**: the `enabled` flag is per-server in opencode. Per-tool disabling (e.g. disabling just one tool inside a server) is not supported by opencode and is out of scope here.
- **No add/edit/delete**: v1 only toggles `enabled` for existing servers. Adding, editing, or removing MCP server entries still requires hand-editing `opencode.jsonc`; the daemon watch picks up the change.
- **Per-role `mcps:[]` binding is v2**: `oh-my-opencode-slim.json` carries which MCP servers each role binds to — that's a separate concern (role→server binding, not global on/off) and is not touched here.

## Error contract

Failures travel as `{ code, message }` (`HostToolsError`) on the response/snapshot — never thrown across the wire. Codes in use: `file_missing`, `file_corrupt`, `read_failed`, `cli_missing`, `cli_failed`, `partial_failure`, `cooldown`, `in_progress`, `no_active_preset`, `invalid_model`, `skill_not_found`, `toggle_failed`, `write_failed`, `not_found` (MCP toggle on unknown server), `unavailable`. The app maps codes to localized copy in `packages/app/src/host-tools/types.ts` (`classifyHostToolsError`).

## Deliberate v1 exclusions

- The zh-summary LLM refresh pipeline (background task) — v2.
- MRU/shared migration of skill state — v2.
- opencode-service-manager — out of scope; its semantics differ enough to warrant its own change.
- Auto-refresh timers for quota — manual refresh only.
- MCP per-tool granularity and per-role `mcps:[]` binding management — v2.
- MCP server add/edit/delete — hand-edit `opencode.jsonc` for now; daemon watch syncs the list.
