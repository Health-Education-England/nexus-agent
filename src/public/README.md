# Nexus Agent Web UI (quick-and-dirty)

This folder contains the lightweight browser UI served by `src/server.ts`.

## Files

- `index.html` — app shell and DOM structure.
- `scripts/app.js` — chat interaction logic, SSE stream handling, sidebar conversations list, load/delete/undo flows.
- `styles/main.css` — styling for layout, chat bubbles, tool badges, modal, and toast notifications.

## Runtime contract with the server

The UI expects these endpoints from `src/server.ts`:

- `POST /chat` (SSE stream of agent events, then `done`).
- `GET /conversations` (conversation summaries for sidebar).
- `GET /conversations/:id` (full message history).
- `DELETE /conversations/:id` (hard delete conversation file).

## Development

From repo root:

```bash
npm run dev:web
```

Then open `http://localhost:3000`.
