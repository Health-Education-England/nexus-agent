# Plan: Agent Skills for mcp-app-host

## Decisions (confirmed by user)

- True lazy loading (one extra round-trip accepted)
- Subtle "Loading skill..." indicator in chat UI
- MCP servers (gold-guide-server, ltft-server) remain as separate MCP servers
- Skills directory: `mcp-app-host/skills/`

## Architecture Overview

Current: monolithic system prompt with all routing rules hardcoded.
New: Core persona + skills catalog in system prompt. Detailed instructions live in SKILL.md files. Claude calls `read_skill` to load them on demand. Tool schemas are progressively added to the Anthropic tools list as skills are loaded.

**3 Skills:**

- `date-tools` → tools: get_current_datetime, calculate_date_offset (local tools)
- `gold-guide` → tool: ask_gold_guide (MCP, port 3002)
- `ltft-calculator` → tool: calculate_ltft_cct (MCP, port 3001)

**Progressive disclosure, two layers:**

1. System prompt: skill name + description only
2. read_skill(name) → full SKILL.md content (adds tool schema to subsequent API calls)

---

## Phase 1: Skill Files (new directory + content)

1. Create `mcp-app-host/skills/date-tools/SKILL.md`
   - Frontmatter: name, description
   - Body: when to use get_current_datetime vs calculate_date_offset, never-assume-date rule, timezone default
2. Create `mcp-app-host/skills/gold-guide/SKILL.md`
   - Frontmatter: name, description
   - Body: ask_gold_guide usage, \*\*\* citation rules (MANDATORY – preserve inline IDs, References section, URL), LTFT cross-awareness offer
3. Create `mcp-app-host/skills/ltft-calculator/SKILL.md`
   - Frontmatter: name, description
   - Body: when to use vs not use (policy ≠ calculation), disambiguation question, pre-fill guidance, ONE sentence after form opens

## Phase 2: Server-Side Infrastructure

4. Create `mcp-app-host/src/server/skills-registry.ts` (NEW FILE)
   - Scans `skills/` dir at startup, parses YAML frontmatter
   - `getSkillSummaries(): {name, description}[]` — for system prompt
   - `getSkillContent(name): string` — full SKILL.md for read_skill
   - `SKILL_TOOL_MAP: Record<string, string[]>` — maps skill name → tool names (e.g. 'gold-guide' → ['ask_gold_guide'])
5. Add `read_skill` to `mcp-app-host/src/server/local-tools.ts`
   - Input: `{ skill_name: string }`
   - Returns full SKILL.md content from skills-registry
   - Add `isMeta: true` field to LocalTool type so agent handles it differently
6. Refactor `mcp-app-host/src/server/agent.ts`
   - New `buildBaseSystemPrompt()`: 8-12 lines of core persona only
   - New `buildSystemPrompt()`: core + skills catalog from `getSkillSummaries()` + instruction to read skill before first use
   - Add `loadedSkills: Set<string>` per session (alongside conversationHistory)
   - Refactor `getToolsForRequest()`: always include [read_skill, date tools]; for each loadedSkill, add its tool schemas from getToolsForSkill()
   - Mark `read_skill` as meta in tool dispatch: send `skill_load`/`skill_ready` events instead of `tool_call`/`tool_result`; mark skill as loaded in Set
   - Remove PRE_TOOL_SENTENCE for `read_skill`
   - Reset `loadedSkills` on conversation reset (same place conversationHistory is reset)
7. Update `mcp-app-host/src/server/mcp-client.ts`
   - Add `getToolsForSkill(toolNames: string[]): AnthropicTool[]` — returns tool schemas for the named tools (used by agent to add to tools list when skill is loaded)
   - `getToolSummaries()` is no longer used by agent (can be deprecated or kept for /api/health)

## Phase 3: Shared Events + Frontend UI

8. `mcp-app-host/src/shared/chat-events.ts`
   - Add `SkillLoadEvent: { type: 'skill_load'; skillName: string }`
   - Add `SkillReadyEvent: { type: 'skill_ready'; skillName: string }`
   - Add to `ChatEvent` union type
9. `mcp-app-host/src/host/main.ts`
   - Handle `skill_load` → call `showSkillLoadingIndicator(skillName)`
   - Handle `skill_ready` → call `hideSkillLoadingIndicator()`
10. `mcp-app-host/src/host/chat-renderer.ts`

- Add `showSkillLoadingIndicator(skillName)` — renders small non-intrusive "Loading skill…" chip
- Add `hideSkillLoadingIndicator()` — fades/removes it

---

## Relevant Files

- `mcp-app-host/skills/` (new)
- `mcp-app-host/src/server/skills-registry.ts` (new)
- `mcp-app-host/src/server/local-tools.ts`
- `mcp-app-host/src/server/agent.ts`
- `mcp-app-host/src/server/mcp-client.ts`
- `mcp-app-host/src/shared/chat-events.ts`
- `mcp-app-host/src/host/main.ts`
- `mcp-app-host/src/host/chat-renderer.ts`

## Verification

1. Cold start — Gold Guide query: read_skill('gold-guide') fires, then ask_gold_guide; citations present
2. Cold start — Date query: read_skill('date-tools') fires, then get_current_datetime
3. Follow-up Gold Guide query (same session): no redundant read_skill; gold-guide skill already loaded
4. LTFT ambiguous message ("ltft"): read_skill('ltft-calculator') fires; disambiguation question asked
5. LTFT calculation: calculator form opens; agent sends one-sentence response only
6. UI check: skill_load events show subtle indicator, not a tool-call card

## Scope Exclusions

- MCP server implementations unchanged (gold-guide-server, ltft-server src untouched)
- No new MCP tools or tool implementations
- Sandbox CSP logic untouched
- No multi-user session scoping (same single-session limitation as now)

## Further Considerations

1. Date-tools latency tradeoff — Since date context is needed in nearly every medical query
   (CCT dates, ARCP timelines, etc.), you'll likely see a read_skill round-trip on almost every
   cold conversation. If this feels sluggish in practice, date-tools could be promoted back to
   always-on (schemas + basic rules in system prompt), with only gold-guide and ltft-calculator
   as true lazy skills. Easy to toggle post-implementation.
2. Skill re-reading — Once read_skill has been called within a session,
   its content is in the conversation history, so Claude won't call it again unless conversation
   history is cleared. The loadedSkills Set ensures the tool schemas also persist in subsequent
   API calls for that session.
3. Future skill growth — The architecture is designed so adding a new skill is just: drop
   a SKILL.md into skills/, add an entry to SKILL_TOOL_MAP in skills-registry,
   and optionally connect a new MCP server. No agent.ts changes needed.
4. Interactive app UX cleanup — The model may still emit a short pre-tool assistant message such
   as "I'll open the calculator for you" before an app-backed tool call. The host currently renders
   that text bubble above the tool-call row, which can feel redundant once the tool status pills and
   interactive form appear. Consider a follow-up change to suppress or collapse that immediately
   preceding assistant bubble when the tool result has `hasApp: true`.
