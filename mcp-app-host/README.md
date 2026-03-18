# MCP App Host

A custom MCP (Model Context Protocol) client and host that renders **MCP Apps** — interactive HTML UIs served by MCP servers — inside sandboxed iframes within a vanilla TypeScript chat interface.

The host connects to one or more MCP servers, exposes their tools to a Claude-powered agent (this was the simplest option for me as I have a Claude API for testing stuff), and — when a tool has an associated interactive App UI — automatically renders that App inside a secure sandboxed iframe after the tool call completes. Users can then interact directly with the App form to adjust values and re-run computations without further chat turns.

Current local setup includes two MCP servers by default:

- LTFT calculator MCP server on port `3001`
- Gold Guide policy MCP server (CAG pipeline) on port `3002`

Built without React or any UI framework, using the [`basic-host`](https://github.com/nicobailon/mcp-apps/tree/main/examples/basic-host) example from `@modelcontextprotocol/ext-apps` as a reference implementation.

## How It Works

### Chat & Agent Loop

The user types a message into the chat UI. The browser `POST`s to `/api/chat`, which runs an Anthropic Claude agent loop on the Express server. The agent receives the full tool definitions from all connected MCP servers plus local server-side tools. Text deltas stream back to the browser in real time via SSE as the agent generates its response. If the agent calls a tool, the server executes it against the appropriate MCP server (or locally) and feeds the result back, looping until the agent stops requesting tools (up to 10 turns atm). Conversation history is maintained in memory across turns.

The system prompt includes concise tool summaries alongside the full schemas, enabling better tool routing. The architecture also supports a two-pass progressive disclosure mode — where only summaries are sent initially and full schemas are loaded on demand — deactivated atm but can be used when the tool count grows - so as to avoid context window 'bloat'.

### Conversation Flow Updates

- Assistant messages now render Markdown (`marked`) instead of plain text.
- Tool call/result indicators render as compact status pills in a dedicated row.
- Post-tool assistant output is rendered in a new message bubble beneath the tool status row for cleaner turn structure.
- Text-only tool results are shown compactly (`✅ tool_name`) and the assistant delivers the explanation in natural language.

### MCP App Integration

Some tools declare an associated interactive App UI via `_meta.ui.resourceUri` (a `@modelcontextprotocol/ext-apps` convention). When such a tool is called:

1. The server-side agent detects the `resourceUri` from the tool definition and includes `hasApp: true` plus the resource URI in the SSE `tool_result` event.
2. On startup the browser connects its own MCP `Client` instances directly to each configured server — these are used exclusively for reading App HTML resources (independent of the server-side connections used for tool execution).
3. When a `tool_result` with `hasApp: true` arrives, the browser fetches the App HTML from the MCP server via its browser-side client.
4. The App HTML is passed to the sandbox iframe and rendered inside a double-iframe security proxy.
5. `AppBridge` wires up bidirectional `postMessage` communication so the App can display the model's inputs, show the tool result, and call back to the MCP server's tool directly — without going through the chat agent again.

### Double-Iframe Security Model

MCP Apps run untrusted HTML/JS from potentially external MCP servers. Isolation is enforced through a layered sandbox:

1. The **host** (port 8080) embeds an `<iframe>` pointing to the **sandbox** (port 8081) — a separate origin.
2. The **sandbox outer iframe** (`sandbox.html`) validates `postMessage` origins before relaying any messages.
3. The **sandbox inner iframe** runs the actual App HTML via `srcdoc` under a restrictive `sandbox` attribute.
4. All communication flows through `AppBridge` via `postMessage` — the App code has no direct DOM access to the host page.
5. CSP headers on both servers lock down script sources and permitted frame ancestors.

### Streaming SSE Protocol

The `/api/chat` response is a `text/event-stream`. A shared event type (`src/shared/chat-events.ts`) defines the typed event shapes used by both the server and client:

| Event         | When emitted                              |
| ------------- | ----------------------------------------- |
| `text`        | Each text delta from agent                |
| `tool_call`   | When agent requests a tool (name + input) |
| `tool_result` | When the MCP tool execution completes     |
| `done`        | Stream finished cleanly                   |
| `error`       | Unrecoverable error during processing     |

The client parses the SSE stream progressively, updating the assistant message bubble in real time, rendering tool call and result indicators, and triggering App iframe rendering on `tool_result` events with `hasApp: true`.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Browser (port 8080)                             │
│  ┌────────────────────────────────────────────┐  │
│  │  Chat UI (index.html)                      │  │
│  │  - vanilla TS                              │  │
│  │  - sends messages to /api/chat             │  │
│  │  - renders assistant responses             │  │
│  │  - browser-side MCP Client connections     │  │
│  │    (for App resource fetching & AppBridge) │  │
│  │                                            │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │  Sandbox iframe (port 8081)          │  │  │
│  │  │  - separate origin for isolation     │  │  │
│  │  │  - outer iframe validates messages   │  │  │
│  │  │  - inner iframe (srcdoc) runs app    │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
         │                              │
         │  POST /api/chat              │  Streamable HTTP
         │  (SSE streaming)             │  (readResource, callTool
         ▼                              │   from App iframe)
┌──────────────────────────┐            │
│  Express Server          │            │
│  (serve.ts, port 8080)   │            │
│  - /api/chat → agent.ts  │            │
│  - /api/servers → URLs   │            │
│                          │            │
│  Server-side MCP Client  │            │
│  - tool execution        │            │
│  - Anthropic agent loop  │            │
└────────────┬─────────────┘            │
             │  Streamable HTTP         │
             ▼                          ▼
┌──────────────────────────────────────────────────┐
│  MCP Server(s)                                    │
│  - LTFT Server (port 3001, interactive app tool) │
│  - Gold Guide Server (port 3002, text tool)      │
│  - Factory pattern: new McpServer per session    │
└──────────────────────────────────────────────────┘
```

## Project Structure

```
mcp-app-host/
├── index.html                  # Chat UI shell (Vite entry point)
├── sandbox.html                # Sandbox iframe (Vite entry point)
├── package.json
├── tsconfig.json
├── vite.config.ts              # Builds index.html + sandbox.html as single files
├── .env.example
├── .gitignore
├── src/
│   ├── host/                   # Browser-side code (bundled by Vite)
│   │   ├── main.ts             # Chat form, SSE consumer, browser MCP client, App iframe wiring
│   │   ├── chat-renderer.ts    # DOM manipulation for messages + app iframes
│   │   └── mcp-bridge.ts       # AppBridge setup, MCP App lifecycle, style vars
│   ├── sandbox/
│   │   └── sandbox.ts          # Double-iframe security proxy (origin validation)
│   ├── shared/
│   │   └── chat-events.ts      # SSE event types shared between server and client
│   └── server/                 # Node.js server-side code (run with tsx)
│       ├── serve.ts            # Dual Express server (host + sandbox ports)
│       ├── mcp-client.ts       # MCP client connections, tool execution & summaries
│       └── agent.ts            # Anthropic Claude agent loop with streaming + tool use
└── ltft-server/                # Example MCP server with interactive App
    ├── package.json
    ├── README.md
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── app/
        │   ├── calculator.html # Interactive calculator form (Vite entry, bundled as single file)
        │   └── calculator.ts   # MCP App class — ontoolinput, ontoolresult, callServerTool
        └── server/
            ├── calculator.ts   # Pure LTFT CCT calculation logic
            └── index.ts        # MCP server, registerAppTool/AppResource, Express transport
└── gold-guide-server/          # Gold Guide MCP server (CAG policy Q&A)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── data/
    │   └── raw/
    │       └── gold_guide_canonical.jsonl
    └── src/
        ├── core/
        │   ├── cag-pipeline.ts
        │   ├── query-gold-guide.ts
        │   └── types.ts
        └── server/
            └── index.ts
```

## Key Technologies

| Dependency                       | Purpose                                                     |
| -------------------------------- | ----------------------------------------------------------- |
| `@modelcontextprotocol/ext-apps` | AppBridge for rendering MCP Apps in iframes                 |
| `@modelcontextprotocol/sdk`      | MCP Client, Streamable HTTP transport                       |
| `@anthropic-ai/sdk`              | Claude Messages API (for the agent loop)                    |
| Express 5                        | Dual-port HTTP server                                       |
| Vite + vite-plugin-singlefile    | Bundles each HTML entry into a self-contained file          |
| TypeScript + tsx                 | Type-safe code, tsx for running server without a build step |

## Setup

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY (and optional ANTHROPIC_MODEL override)
```

## Scripts

```bash
npm run build    # Type-check + Vite build (index.html & sandbox.html → dist/)
npm run serve    # Start the Express server (serves dist/)
npm run start    # Build then serve
npm run dev      # Watch mode + serve (for development)
npm run dev:e2e  # Start LTFT + Gold Guide MCP servers + host together (for local E2E)
```

The host UI will be available at `http://localhost:8080`.

## Running E2E (with LTFT Server)

### One-command option (recommended)

From the repository root:

```bash
npm run dev:mcp-app-host
```

Or from `mcp-app-host/` directly:

```bash
npm run dev:e2e
```

This starts all required services:

- LTFT MCP server on `http://localhost:3001/mcp`
- Gold Guide MCP server on `http://localhost:3002/mcp`
- Host + sandbox on `http://localhost:8080` and `http://localhost:8081`

### Manual two-terminal option

```bash
# 1. Build and start the LTFT MCP server
cd ltft-server
npm install
npm run build
npx tsx src/server/index.ts          # Starts on http://localhost:3001/mcp

# 2. In a separate terminal, configure and start the host
cd ..                                # Back to mcp-app-host/
cp .env.example .env                 # Add your ANTHROPIC_API_KEY
# The default SERVERS value includes both:
# ["http://localhost:3001/mcp","http://localhost:3002/mcp"]
# For LTFT-only manual demos you can set SERVERS explicitly in .env if needed.
npm run build
npm run serve                        # Host on :8080, sandbox on :8081

# 3. Open http://localhost:8080 and try:
#    "Calculate my new CCT date — currently full time, CCT August 2027,
#     switching to 60% from August 2026"
```

**Flow (interactive tool)**: User message → Claude agent calls `calculate_ltft_cct` → server executes tool → SSE streams result + `hasApp: true` → browser fetches App HTML resource → sandbox iframe renders interactive calculator form → user can edit values and recalculate directly.

For Gold Guide policy questions, the flow is text-only (`ask_gold_guide`) with no App iframe.

## Example: LTFT CCT Calculator

The bundled `ltft-server/` demonstrates the full MCP App pattern end-to-end.

**The MCP server** (`ltft-server/src/server/`) exposes a `calculate_ltft_cct` tool registered via `registerAppTool` with `_meta.ui.resourceUri` linking it to the interactive App HTML. It uses the Streamable HTTP transport on port 3001 with a factory pattern — each HTTP session gets a fresh `McpServer` instance, since `McpServer.connect()` can only bind once per object. The calculation logic (a very rough implementation of existing CCT calc logic from other projects) itself is pure and separately tested: it validates dates and WTE percentages, computes the adjusted CCT date, and generates a markdown summary with 16-week notice warnings where applicable.

**The App UI** (`ltft-server/src/app/`) is a Vite-bundled single-file HTML page using the `@modelcontextprotocol/ext-apps` `App` class. It receives Claude agent's tool inputs via `ontoolinput` to pre-populate the form, displays the tool result via `ontoolresult`, and calls `callServerTool` directly on form submit — letting the user adjust values and recalculate without re-entering the chat.

**Try it** — after starting with `npm run dev:e2e`, open `http://localhost:8080` and ask:

> _"Calculate my new CCT date — currently full time, CCT August 2027, switching to 60% from August 2026"_

The agent calls the tool immediately, the calculator form opens and attempts to pre-fill as much of the form as it can (with some artistic license lol!).

Note: Even if it thinks it has all the values it needs to perform the calculation, the logic enforces "human-in-the-loop" confirmation via the 'Calculate...' button so the user can adjust any incorrect pre-filling etc. and recalculate directly.
