# Gold Guide MCP Server

An MCP server that exposes the Gold Guide 10th Edition as a queryable tool via the `ask_gold_guide` tool. Uses a CAG (Cache-Augmented Generation) pipeline — the full document is injected into context on each request, with Anthropic prompt caching keeping repeat calls cheap.

**Port:** `3002`  
**Transport:** Streamable HTTP at `/mcp`  
**Model:** `claude-haiku-4-5-20251001` (direct Anthropic SDK, no provider abstraction)  
**Pipeline:** CAG only — full document injection (~80K tokens), prompt cache active after first turn

---

## Implementation Progress

### Phase 1 — Scaffold

- [x] `package.json` — deps: `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `express`, `cors`, `zod` (no Vite)
- [x] `tsconfig.json` — mirrors `ltft-server` config, includes `src/server` + `src/core`
- [x] `data/raw/gold_guide_canonical.jsonl` — 498 chunks copied from root project
- [x] `README.md` — this file

### Phase 2 — Core Logic

- [x] `src/core/types.ts` — `RetrievedChunk`, `Citation`, `GoldGuideResult` (slimmed from root)
- [x] `src/core/cag-pipeline.ts` — loads + caches all 498 chunks; path resolved via `import.meta.url`
- [x] `src/core/query-gold-guide.ts` — CAG hardcoded, Anthropic SDK direct, prompt caching preserved

### Phase 3 — MCP Server

- [x] `src/server/index.ts` — `ask_gold_guide` tool, plain `server.registerTool()`, text-only (no App UI), ANSWER + CITATIONS formatter

### Phase 4 — Host Integration

- [x] `mcp-app-host/.env.example` — `http://localhost:3002/mcp` added to SERVERS
- [x] `mcp-app-host/src/server/serve.ts` — default SERVERS updated to include port 3002
- [x] Root `package.json` `dev:mcp-app-host` — starts gold-guide-server alongside ltft-server
- [x] `mcp-app-host/package.json` `dev:e2e` — waits for both servers on 3001 + 3002
- [x] Host conversation flow updates — text-only Gold Guide tool results shown as compact tool status while assistant renders the final answer in chat

### Phase 5 — Verify

- [x] Type-check passes (`tsc --noEmit`)
- [ ] E2E: ask a Gold Guide question in the chat UI, confirm answer + citations returned

---

## Future Phases

- Provider abstraction layer (Anthropic / Bedrock / Ollama) — matching root project
- RAG / hybrid pipeline support (after evaluation iteration in root project)
- Conversation history / multi-turn context management
- App UI for gold guide results (read-only citations display)

---

## Running

```bash
# Install dependencies
npm install

# Ensure ANTHROPIC_API_KEY is set in ../.env (mcp-app-host/.env)

# Start (tsx, no build step needed)
npm run dev

# Type-check only
npm run build
```

The server will be available at `http://localhost:3002/mcp`.

### E2E with the full mcp-app-host stack

From `mcp-app-host/`:

```bash
npm run dev:e2e
```

This starts:

- LTFT MCP server on `http://localhost:3001/mcp`
- Gold Guide MCP server on `http://localhost:3002/mcp`
- Host + sandbox on `http://localhost:8080` and `http://localhost:8081`

---

## Project Structure

```
gold-guide-server/
├── package.json
├── tsconfig.json
├── README.md
├── data/
│   └── raw/
│       └── gold_guide_canonical.jsonl   # 498 chunks, copied from root project
└── src/
    ├── core/
    │   ├── types.ts               # RetrievedChunk, Citation, GoldGuideResult
    │   ├── cag-pipeline.ts        # Loads + caches full doc from JSONL
    │   └── query-gold-guide.ts    # CAG query: retrieve → build context → LLM → citations
    └── server/
        └── index.ts               # MCP server, Express transport, ask_gold_guide tool
```
