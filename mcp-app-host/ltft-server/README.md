# LTFT MCP Server

An MCP server that provides an interactive **LTFT CCT calculator** via the `calculate_ltft_cct` tool and an embedded MCP App UI.

**Port:** `3001`  
**Transport:** Streamable HTTP at `/mcp`  
**Tool:** `calculate_ltft_cct` (App-backed, form-first workflow)  
**App Resource:** `ui://ltft/calculator.html`

---

## What this server does

- Exposes `calculate_ltft_cct` as an MCP tool.
- Registers an interactive App resource so the host can render a form UI in an iframe.
- Uses a **form-first policy**:
  - initial tool calls open/pre-fill the form,
  - only form submissions (`_submitted_from_form: true`) run the calculation.
- Performs pure calculation logic in `src/server/calculator.ts` with unit tests.

---

## Running

From `mcp-app-host/ltft-server`:

```bash
# Install dependencies
npm install

# Build app bundle + type-check server code
npm run build

# Start MCP server
npm run serve
```

For local host E2E from `mcp-app-host/`:

```bash
npm run dev:e2e
```

This starts LTFT (`:3001`) + Gold Guide (`:3002`) + host/sandbox (`:8080`/`:8081`).

---

## Scripts

```bash
npm run build:app   # Build single-file calculator App (Vite)
npm run build       # Build app + tsc --noEmit
npm run serve       # Run MCP server (tsx)
npm run dev         # Build app then run server
npm run test        # Run calculator unit tests
```

---

## Tool contract

### `calculate_ltft_cct`

Intended use:

- Open calculator UI for CCT-date impact scenarios,
- Compare LTFT working-pattern effects,
- Calculate updated CCT date once user submits the form.

Input highlights:

- Dates are `YYYY-MM-DD`.
- Work percentages are decimals in `(0, 1]` (e.g. `0.8` = 80%).
- `_submitted_from_form` is an internal flag for explicit form submission.

Calculation outputs include:

- `new_cct_date`
- `extension_days`
- `extension_formatted`
- `warnings` (e.g., short-notice and non-standard WTE)
- `summary_table_markdown`

---

## Architecture notes

- `registerAppTool(...)` + `_meta.ui.resourceUri` binds tool ↔ UI.
- `registerAppResource(...)` serves app HTML (`RESOURCE_MIME_TYPE`).
- Browser-side host fetches the UI resource and renders it in a sandboxed iframe.
- The App (`src/app/calculator.ts`) uses `@modelcontextprotocol/ext-apps` to:
  - receive tool input/result,
  - prefill the form,
  - call the server tool directly on submit.

---

## Project structure

```text
ltft-server/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── README.md
└── src/
    ├── app/
    │   ├── calculator.html
    │   └── calculator.ts
    └── server/
        ├── index.ts
        ├── calculator.ts
        └── calculator.test.ts
```
