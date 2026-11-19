# DSH 官方原地改名接口提案（草稿，未提交）

> 状态：草稿。依据 design.md 决定 2「上游接口草案」整理。向 DeepSeek Harness 官方仓库提交 issue 或 PR 须用户另行批准；本文件不代表已提交。基线：`dsh-v0.2.2-rc.5`（`9c2670d3`），涉及 `packages/subagent/subagent`、`packages/subagent/tool-subagent-control`、`packages/session/session-projection`。

以下为拟提交的英文正文。

---

## Proposal: rename a subagent in place (`subagent/rename`)

### Problem

A child's name is fixed at creation (`SiblingNameReservations.reserve`, `subagent/catalog` v3). Hosts and plugins that let users name collaborators (for example a CLI-worker plugin whose cards are named `codex-1`) cannot rename a child without retiring it and creating a new one, which adds a catalog row, breaks addresses held by other agents and discards provider-side caches. Plugins are not allowed to append records to the parent log (`packages/core/session/README.zh.md`), so there is no supported way to keep the catalog, `list_agents`, `send_message`, identity prompts and UI headers consistent after a rename.

### Proposed change

1. **Event.** A new parent-log event `subagent/rename { childId, name }`, appended by the parent's owner. `subagent/catalog` keeps its current version.
2. **Projection.** `subagentCatalog` bumps `stateVersion`, replays creation and rename events, and records each replaced name in `formerNames: string[]` on the entry. Old checkpoints rebuild from the log.
3. **Manager.** `manager.rename(parent: Agent, childId: SessionId, name: string, signal?)`:
   - validates direct parent–child lineage and `isAgentName(name)`;
   - reserves `name` synchronously against all current names, all `formerNames` and in-flight creations of the same parent (extend `SiblingNameReservations`); rejects with `DUPLICATE_AGENT_NAME` / `INVALID_AGENT_NAME`; releases the reservation on failure;
   - after the event is durable, updates the cached member path (`activation.ts`) of the child and every resident descendant, so `namesOf`, sender names and activation receipts use the new name; cold resume reads the new catalog name;
   - renaming to the current name is an idempotent success (safe reconciliation after a crash).
4. **Resolution.** `resolveName` accepts any former name of a path segment, permanently (former names are never released), so addresses held by other agents keep working.
5. **Service and Remote.** `ctx.subagents.rename({ parentSessionId, childSessionId, name, signal })` and `@Remote({ name: 'rename', resources: { session: r => r.childSessionId } })`, authorized on the target session like `prompt` / `interruptByUser`.
6. **Lifecycle.** Emit `subagent/renamed { parentSessionId, childSessionId, name, formerName }` so UIs (`ui-subagent` header lineage, team board, workspace tree) refresh without polling.
7. **Tools.** `list_agents` reports the new path; the identity context (`subagent:identity`) changes on the next step without rewriting earlier context.

### Compatibility

- Readers that ignore `formerNames` keep working; entries without renames are unchanged.
- Plugins can feature-detect `typeof ctx.subagents.rename === 'function'` and migrate their own display overlays one entry at a time, verifying the catalog by `childId` before deleting an overlay entry.

### Tests we would add

Duplicate against current/former/in-flight names; invalid names; non-child rejection; concurrent rename vs. create; rename of a running child (current turn continues, next step sees the new identity); replay from log and from an old checkpoint; `resolveName` by former names at any depth; idempotent re-rename; Remote authorization.
