# Nexus Agent Web UI (quick-and-dirty)

This folder contains the lightweight browser UI served by `src/server.ts`.

## Files

- `index.html` — app shell and DOM structure.
- `scripts/app.js` — app bootstrap, DOM wiring, and form submission entry point.
- `scripts/assistant-renderer.js` — streaming assistant bubble rendering and tool badge UI.
- `scripts/chat-stream.js` — SSE frame parsing and event dispatch for assistant text, tool usage, widgets, and completion.
- `scripts/chat-view.js` — chat history rendering, welcome state, and LTFT form submission summaries.
- `scripts/conversation-controller.js` — conversation sidebar loading plus delete/undo modal and toast flows.
- `scripts/ltft-widget.js` — inline LTFT calculator form card rendering and submission handling.
- `scripts/widget-registry.js` — maps widget event types to browser renderers.
- `styles/main.css` — styling for layout, chat bubbles, tool badges, tables, modal, toast notifications, and widget cards.

## Runtime contract with the server

The UI expects these endpoints from `src/server.ts`:

- `POST /chat` (SSE stream of agent events, then `done`).
- `GET /conversations` (conversation summaries for sidebar).
- `GET /conversations/:id` (full message history).
- `DELETE /conversations/:id` (hard delete conversation file).

The `POST /chat` SSE stream currently emits these event types:

- `text` — assistant text delta.
- `tool_use` — a tool has started.
- `tool_result` — a tool has finished.
- `widget` — render an inline widget card, currently `ltft_form`.
- `error` — surface an agent or tool error inline.
- `done` — final history payload and conversation ID.

For LTFT calculations, the expected browser flow is:

1. Receive `widget` for `ltft_form`.
2. Render the form card inline in the chat.
3. Submit the collected values as the user's next message.
4. Stream the calculator response back into the conversation.

## Development

From repo root:

```bash
npm run dev:web
```

Then open `http://localhost:3000`.

During development, `src/server.ts` serves static files from the first available directory in this order:

1. `__dirname/public` from the running server build output.
2. `src/public` from the repository root.
3. `public` from the repository root.

It also disables browser caching for `.js` and `.css` assets to make frontend iteration less confusing.
