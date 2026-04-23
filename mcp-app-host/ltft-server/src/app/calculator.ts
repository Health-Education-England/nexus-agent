/**
 * LTFT Calculator MCP App — runs inside the host's sandboxed iframe.
 *
 * Uses the App class from @modelcontextprotocol/ext-apps to:
 *  - Receive tool input/result notifications from the host
 *  - Call the server's calculate_ltft_cct tool directly from the form
 */

import {
  App,
  PostMessageTransport,
  applyHostStyleVariables,
  applyDocumentTheme,
  type McpUiStyles
} from "@modelcontextprotocol/ext-apps";

// ── DOM references ──────────────────────────────────────────────────

const form = document.getElementById("calc-form") as HTMLFormElement;
const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement;
const errorEl = document.getElementById("form-error") as HTMLParagraphElement;
const resultEl = document.getElementById("result") as HTMLDivElement;
const SUBMIT_IDLE_TEXT = "Calculate new CCT date →";
const SUBMIT_BUSY_TEXT = "Calculating…";

// ── MCP App setup ───────────────────────────────────────────────────

const app = new App({ name: "LTFTCalculator", version: "1.0.0" });

// When the host sends tool input (model called the tool with arguments),
// populate the form and auto-calculate.
app.ontoolinput = params => {
  const args = params.arguments;
  if (!args) return;

  setFormValue("programme_name", args.programme_name);
  setFormValue("current_cct_date", args.current_cct_date);
  setFormValue("proposed_work_percentage", args.proposed_work_percentage);
  setFormValue("proposed_start_date", args.proposed_start_date);
};

// When the host sends the tool result, display it.
app.ontoolresult = params => {
  if (params.isError) {
    showError(
      extractTextContent(params.content as ToolTextBlock[]) ||
        "Calculation failed."
    );
    return;
  }

  const parsed = parseToolResult(params.content as ToolTextBlock[]);
  if (parsed) {
    showResult(parsed);
  }
};

// Apply host theme if available
app.onhostcontextchanged = ctx => {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.hostStyles) {
    applyHostStyleVariables(ctx.hostStyles as McpUiStyles);
  }
};

// Connect via PostMessageTransport (talks to the host's AppBridge)
await app.connect(new PostMessageTransport(window.parent, window.parent));

// Apply initial theme
const ctx = app.getHostContext();
if (ctx?.theme) applyDocumentTheme(ctx.theme);
if (ctx?.hostStyles) applyHostStyleVariables(ctx.hostStyles as McpUiStyles);

// ── Form handling ───────────────────────────────────────────────────

form.addEventListener("submit", async e => {
  e.preventDefault();
  clearError();

  const data = new FormData(form);
  const proposedWte = data.get("proposed_work_percentage") as string;

  if (!proposedWte) {
    showError("Please select a proposed working percentage.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = SUBMIT_BUSY_TEXT;

  try {
    const persistedInput: Record<string, unknown> = {
      current_cct_date: data.get("current_cct_date") as string,
      proposed_work_percentage: Number.parseFloat(proposedWte),
      proposed_start_date: data.get("proposed_start_date") as string
    };

    const args: Record<string, unknown> = {
      ...persistedInput,
      _submitted_from_form: true
    };

    const programme = (data.get("programme_name") as string).trim();
    if (programme) {
      persistedInput.programme_name = programme;
      args.programme_name = programme;
    }

    // Call the server-side tool via the App bridge
    const result = await app.callServerTool({
      name: "calculate_ltft_cct",
      arguments: args
    });

    if (result.isError) {
      const msg = extractTextContent(result.content as ToolTextBlock[]);
      await app.updateModelContext({
        structuredContent: {
          persistenceKind: "form-state",
          persistedInput,
          persistedToolResultText: msg || "Calculation failed.",
          persistedToolResultIsError: true
        }
      });
      showError(msg || "Calculation failed.");
      return;
    }

    const parsed = parseToolResult(result.content as ToolTextBlock[]);
    await app.updateModelContext({
      structuredContent: {
        persistenceKind: "form-state",
        persistedInput,
        persistedToolResultText: extractTextContent(
          result.content as ToolTextBlock[]
        ),
        persistedToolResultIsError: false
      }
    });

    if (parsed) {
      showResult(parsed);
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = SUBMIT_IDLE_TEXT;
  }
});

// ── UI helpers ──────────────────────────────────────────────────────

function setFormValue(name: string, value: unknown): void {
  if (value == null) return;
  const el = form.elements.namedItem(name) as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  if (!el) return;

  const rawValue = typeof value === "number" ? value.toString() : String(value);

  if (el instanceof HTMLSelectElement) {
    const exactMatch = Array.from(el.options).find(
      option => option.value === rawValue
    );
    if (exactMatch) {
      el.value = exactMatch.value;
      return;
    }

    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue)) {
      const numericMatch = Array.from(el.options).find(option => {
        const optionValue = Number(option.value);
        return Number.isFinite(optionValue) && optionValue === numericValue;
      });

      if (numericMatch) {
        el.value = numericMatch.value;
        return;
      }
    }
  }

  el.value = rawValue;
}

function showError(msg: string): void {
  errorEl.textContent = msg;
  resultEl.style.display = "none";
  postHeightSoon();
}

function clearError(): void {
  errorEl.textContent = "";
}

type ToolTextBlock = { type: string; text?: string };

function extractTextContent(content: ToolTextBlock[] | undefined): string {
  if (!content) return "";
  return content
    .map(block => (block.type === "text" ? (block.text ?? "") : ""))
    .join("");
}

function parseToolResult(
  content: ToolTextBlock[] | undefined
): CalcResult | null {
  const text = extractTextContent(content).trim();
  if (!text) return null;

  try {
    return JSON.parse(text) as CalcResult;
  } catch {
    return null;
  }
}

interface CalcResult {
  programme: string;
  current_cct_date: string;
  proposed_start_date: string;
  proposed_wte: string;
  extension_days: number;
  new_cct_date: string;
  extension_formatted: string;
  warnings?: string[];
}

function formatDisplay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

function showResult(r: CalcResult): void {
  clearError();

  const rows: [string, string, boolean?][] = [
    ["Programme", escapeHtml(r.programme)],
    ["Current CCT date", escapeHtml(formatDisplay(r.current_cct_date))],
    ["Proposed working percentage", escapeHtml(r.proposed_wte)],
    ["Proposed start date", escapeHtml(formatDisplay(r.proposed_start_date))],
    [
      "<strong>New CCT date</strong>",
      `<strong>${escapeHtml(formatDisplay(r.new_cct_date))}</strong>`,
      true
    ],
    ["Training extension", escapeHtml(r.extension_formatted)]
  ];

  let html = `<h2>Result</h2><table>`;
  for (const [label, value] of rows) {
    html += `<tr><th>${label}</th><td>${value}</td></tr>`;
  }
  html += `</table>`;

  if (r.warnings && r.warnings.length > 0) {
    html += `<div class="warnings"><strong>Warnings:</strong><ul>`;
    for (const w of r.warnings) {
      html += `<li>${escapeHtml(w)}</li>`;
    }
    html += `</ul></div>`;
  }

  resultEl.innerHTML = html;
  resultEl.style.display = "block";
  postHeightSoon();
}

function escapeHtml(str: string): string {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

// ── Auto-resize: report content height to the host via postMessage ──
// Target origin is "*" because this app runs inside a document.write() iframe
// (about:blank URL, so location.origin is "null"). Security is enforced by the
// sandbox proxy which validates event.origin before relaying to the host.

function postHeight(): void {
  const body = document.body;
  const style = getComputedStyle(body);
  const paddingBottom = Number.parseFloat(style.paddingBottom || "0") || 0;

  let furthestContentBottom = 0;
  for (const child of Array.from(body.children)) {
    const element = child as HTMLElement;
    const bottom = element.offsetTop + element.offsetHeight;
    if (bottom > furthestContentBottom) furthestContentBottom = bottom;
  }

  const measuredHeight = furthestContentBottom + paddingBottom;
  const height = Math.ceil(measuredHeight + 8);

  const targetOrigin = getParentOrigin();
  window.parent.postMessage({ type: "app-resize", height }, targetOrigin);
}

function getParentOrigin(): string {
  if (!document.referrer) return "*";

  try {
    return new URL(document.referrer).origin;
  } catch {
    return "*";
  }
}

function postHeightSoon(): void {
  postHeight();
  requestAnimationFrame(() => {
    postHeight();
    requestAnimationFrame(postHeight);
  });
}

// Observe body size changes (result table appearing, etc.)
const resizeObserver = new ResizeObserver(() => postHeightSoon());
resizeObserver.observe(document.body);
// Also fire once on load
postHeightSoon();
