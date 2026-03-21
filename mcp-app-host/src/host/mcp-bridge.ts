/**
 * MCP Bridge: core logic for connecting to MCP servers and managing MCP Apps.
 * Adapted from: https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-host/src/implementation.ts
 *
 * Stripped of React dependencies and theme system.
 * Framework-agnostic — communicates via callbacks.
 */

import {
  RESOURCE_MIME_TYPE,
  getToolUiResourceUri,
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiSandboxProxyReadyNotification,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
  type McpUiUpdateModelContextRequest,
  type McpUiMessageRequest
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CallToolResult,
  Resource,
  Tool
} from "@modelcontextprotocol/sdk/types.js";

const SANDBOX_PROXY_BASE_URL = "http://localhost:8081/sandbox.html";
const IMPLEMENTATION = { name: "MCP App Host", version: "1.0.0" };

export const log = {
  info: console.log.bind(console, "[HOST]"),
  warn: console.warn.bind(console, "[HOST]"),
  error: console.error.bind(console, "[HOST]")
};

// --- Server connection ---

export interface ServerInfo {
  url: URL;
  name: string;
  client: Client;
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
  appHtmlCache: Map<string, string>;
}

export async function connectToServer(serverUrl: URL): Promise<ServerInfo> {
  log.info("Connecting to server:", serverUrl.href);

  const client = new Client(IMPLEMENTATION);
  await client.connect(new StreamableHTTPClientTransport(serverUrl));
  log.info("Connected via Streamable HTTP transport");

  const name = client.getServerVersion()?.name ?? serverUrl.href;

  const toolsList = await client.listTools();
  const tools = new Map(toolsList.tools.map(tool => [tool.name, tool]));
  log.info("Server tools:", Array.from(tools.keys()));

  const resourcesList = await client.listResources();
  const resources = new Map(resourcesList.resources.map(r => [r.uri, r]));
  log.info("Server resources:", Array.from(resources.keys()));

  return {
    url: new URL(serverUrl.href),
    name,
    client,
    tools,
    resources,
    appHtmlCache: new Map()
  };
}

function isServerNotInitializedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /server not initialized/i.test(message);
}

async function reconnectServer(serverInfo: ServerInfo): Promise<void> {
  log.warn(`Reconnecting MCP server client: ${serverInfo.url.href}`);

  const client = new Client(IMPLEMENTATION);
  await client.connect(new StreamableHTTPClientTransport(serverInfo.url));

  const name = client.getServerVersion()?.name ?? serverInfo.url.href;
  const toolsList = await client.listTools();
  const resourcesList = await client.listResources();

  serverInfo.client = client;
  serverInfo.name = name;
  serverInfo.tools = new Map(toolsList.tools.map(tool => [tool.name, tool]));
  serverInfo.resources = new Map(
    resourcesList.resources.map(resource => [resource.uri, resource])
  );
}

export async function readUiResource(
  serverInfo: ServerInfo,
  uri: string
): Promise<UiResourceData> {
  try {
    return await getUiResource(serverInfo, uri);
  } catch (error) {
    if (!isServerNotInitializedError(error)) {
      throw error;
    }

    log.warn(
      `UI resource read failed due to uninitialized server session. Retrying once: ${uri}`
    );
    await reconnectServer(serverInfo);
    return getUiResource(serverInfo, uri);
  }
}

// --- Tool calling ---

interface UiResourceData {
  html: string;
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
}

export interface ToolCallInfo {
  serverInfo: ServerInfo;
  tool: Tool;
  input: Record<string, unknown>;
  resultPromise: Promise<CallToolResult>;
  appResourcePromise?: Promise<UiResourceData>;
}

export function hasAppHtml(
  toolCallInfo: ToolCallInfo
): toolCallInfo is Required<ToolCallInfo> {
  return !!toolCallInfo.appResourcePromise;
}

export { getToolUiResourceUri };

export function callTool(
  serverInfo: ServerInfo,
  name: string,
  input: Record<string, unknown>
): ToolCallInfo {
  log.info("Calling tool", name, "with input", input);
  const resultPromise = serverInfo.client.callTool({
    name,
    arguments: input
  }) as Promise<CallToolResult>;

  const tool = serverInfo.tools.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const toolCallInfo: ToolCallInfo = { serverInfo, tool, input, resultPromise };

  const uiResourceUri = getToolUiResourceUri(tool);
  if (uiResourceUri) {
    toolCallInfo.appResourcePromise = readUiResource(serverInfo, uiResourceUri);
  }

  return toolCallInfo;
}

async function getUiResource(
  serverInfo: ServerInfo,
  uri: string
): Promise<UiResourceData> {
  log.info("Reading UI resource:", uri);
  const resource = await serverInfo.client.readResource({ uri });

  if (!resource) {
    throw new Error(`Resource not found: ${uri}`);
  }
  if (resource.contents.length !== 1) {
    throw new Error(`Unexpected contents count: ${resource.contents.length}`);
  }

  const content = resource.contents[0];

  if (content.mimeType !== RESOURCE_MIME_TYPE) {
    throw new Error(`Unsupported MIME type: ${content.mimeType}`);
  }

  const html = "blob" in content ? atob(content.blob) : content.text;

  // Extract CSP and permissions metadata, preferring content-level (resources/read)
  // and falling back to listing-level (resources/list) per the spec
  const contentMeta =
    (content as Record<string, unknown>)._meta ||
    (content as Record<string, unknown>).meta;

  const listingResource = serverInfo.resources.get(uri);
  const listingMeta = (listingResource as Record<string, unknown> | undefined)
    ?._meta;

  const uiMeta =
    (contentMeta as Record<string, unknown>)?.ui ??
    (listingMeta as Record<string, unknown>)?.ui;
  const csp = (uiMeta as Record<string, unknown>)?.csp as
    | McpUiResourceCsp
    | undefined;
  const permissions = (uiMeta as Record<string, unknown>)?.permissions as
    | McpUiResourcePermissions
    | undefined;

  return { html: html ?? "", csp, permissions };
}

// --- Sandbox & AppBridge ---

export function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  csp?: McpUiResourceCsp,
  permissions?: McpUiResourcePermissions
): Promise<boolean> {
  // Prevent reload
  if (iframe.src) return Promise.resolve(false);

  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");

  const allowAttribute = buildAllowAttribute(permissions);
  if (allowAttribute) {
    iframe.setAttribute("allow", allowAttribute);
  }

  const readyNotification: McpUiSandboxProxyReadyNotification["method"] =
    "ui/notifications/sandbox-proxy-ready";

  const readyPromise = new Promise<boolean>(resolve => {
    const listener = ({ source, data }: MessageEvent) => {
      if (
        source === iframe.contentWindow &&
        data?.method === readyNotification
      ) {
        log.info("Sandbox proxy loaded");
        window.removeEventListener("message", listener);
        resolve(true);
      }
    };
    window.addEventListener("message", listener);
  });

  // Build sandbox URL with CSP query param
  const sandboxUrl = new URL(SANDBOX_PROXY_BASE_URL);
  if (csp) {
    sandboxUrl.searchParams.set("csp", JSON.stringify(csp));
  }

  log.info(
    "Loading sandbox proxy...",
    csp ? `(CSP: ${JSON.stringify(csp)})` : ""
  );
  iframe.src = sandboxUrl.href;

  return readyPromise;
}

export async function initializeApp(
  iframe: HTMLIFrameElement,
  appBridge: AppBridge,
  { input, resultPromise, appResourcePromise }: Required<ToolCallInfo>
): Promise<void> {
  const appInitializedPromise = hookInitializedCallback(appBridge);

  // Connect app bridge (triggers MCP initialization handshake)
  // IMPORTANT: Pass `iframe.contentWindow` as BOTH target and source
  await appBridge.connect(
    new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!)
  );

  // Load inner iframe HTML with CSP and permissions metadata
  const { html, csp, permissions } = await appResourcePromise;
  log.info("Sending UI resource HTML to MCP App");
  await appBridge.sendSandboxResourceReady({ html, csp, permissions });

  // Wait for inner iframe to be ready
  log.info("Waiting for MCP App to initialize...");
  await appInitializedPromise;
  log.info("MCP App initialized");

  // Send tool call input to iframe
  log.info("Sending tool call input to MCP App:", input);
  appBridge.sendToolInput({ arguments: input });

  // Schedule tool call result (or cancellation) to be sent to MCP App
  resultPromise.then(
    result => {
      log.info("Sending tool call result to MCP App:", result);
      appBridge.sendToolResult(result);
    },
    error => {
      log.error("Tool call failed, sending cancellation to MCP App:", error);
      appBridge.sendToolCancelled({
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  );
}

function hookInitializedCallback(appBridge: AppBridge): Promise<void> {
  const oninitialized = appBridge.oninitialized;
  return new Promise<void>(resolve => {
    appBridge.oninitialized = (...args) => {
      resolve();
      appBridge.oninitialized = oninitialized;
      appBridge.oninitialized?.(...args);
    };
  });
}

// --- AppBridge factory ---

export type ModelContext = McpUiUpdateModelContextRequest["params"];
export type AppMessage = McpUiMessageRequest["params"];

export interface AppBridgeCallbacks {
  onContextUpdate?: (context: ModelContext | null) => void;
  onMessage?: (message: AppMessage) => void;
  onDisplayModeChange?: (mode: "inline" | "fullscreen") => void;
}

export interface AppBridgeOptions {
  containerDimensions?:
    | { maxHeight?: number; width?: number }
    | { height: number; width?: number };
  displayMode?: "inline" | "fullscreen";
}

/**
 * Host style variables for MCP Apps.
 * Apps receive these as CSS custom properties.
 * All required keys from McpUiStyles must be provided.
 */
const HOST_STYLE_VARIABLES = {
  "--color-background-primary": "light-dark(#ffffff, #1a1a1a)",
  "--color-background-secondary": "light-dark(#f5f5f5, #2d2d2d)",
  "--color-background-tertiary": "light-dark(#e5e5e5, #404040)",
  "--color-background-inverse": "light-dark(#1a1a1a, #ffffff)",
  "--color-background-ghost":
    "light-dark(rgba(255,255,255,0), rgba(26,26,26,0))",
  "--color-background-info": "light-dark(#eff6ff, #1e3a5f)",
  "--color-background-danger": "light-dark(#fef2f2, #7f1d1d)",
  "--color-background-success": "light-dark(#f0fdf4, #14532d)",
  "--color-background-warning": "light-dark(#fefce8, #713f12)",
  "--color-background-disabled":
    "light-dark(rgba(255,255,255,0.5), rgba(26,26,26,0.5))",
  "--color-text-primary": "light-dark(#1f2937, #f3f4f6)",
  "--color-text-secondary": "light-dark(#6b7280, #9ca3af)",
  "--color-text-tertiary": "light-dark(#9ca3af, #6b7280)",
  "--color-text-inverse": "light-dark(#f3f4f6, #1f2937)",
  "--color-text-ghost":
    "light-dark(rgba(107,114,128,0.5), rgba(156,163,175,0.5))",
  "--color-text-info": "light-dark(#1d4ed8, #60a5fa)",
  "--color-text-danger": "light-dark(#b91c1c, #f87171)",
  "--color-text-success": "light-dark(#15803d, #4ade80)",
  "--color-text-warning": "light-dark(#a16207, #fbbf24)",
  "--color-text-disabled":
    "light-dark(rgba(31,41,55,0.5), rgba(243,244,246,0.5))",
  "--color-border-primary": "light-dark(#e5e7eb, #404040)",
  "--color-border-secondary": "light-dark(#d1d5db, #525252)",
  "--color-border-tertiary": "light-dark(#f3f4f6, #374151)",
  "--color-border-inverse":
    "light-dark(rgba(255,255,255,0.3), rgba(0,0,0,0.3))",
  "--color-border-ghost": "light-dark(rgba(229,231,235,0), rgba(64,64,64,0))",
  "--color-border-info": "light-dark(#93c5fd, #1e40af)",
  "--color-border-danger": "light-dark(#fca5a5, #991b1b)",
  "--color-border-success": "light-dark(#86efac, #166534)",
  "--color-border-warning": "light-dark(#fde047, #854d0e)",
  "--color-border-disabled":
    "light-dark(rgba(229,231,235,0.5), rgba(64,64,64,0.5))",
  "--color-ring-primary": "light-dark(#3b82f6, #60a5fa)",
  "--color-ring-secondary": "light-dark(#6b7280, #9ca3af)",
  "--color-ring-inverse": "light-dark(#ffffff, #1f2937)",
  "--color-ring-info": "light-dark(#2563eb, #3b82f6)",
  "--color-ring-danger": "light-dark(#dc2626, #ef4444)",
  "--color-ring-success": "light-dark(#16a34a, #22c55e)",
  "--color-ring-warning": "light-dark(#ca8a04, #eab308)",
  "--font-sans":
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  "--font-mono": "ui-monospace, 'SF Mono', Monaco, 'Cascadia Code', monospace",
  "--font-weight-normal": "400",
  "--font-weight-medium": "500",
  "--font-weight-semibold": "600",
  "--font-weight-bold": "700",
  "--font-text-xs-size": "0.75rem",
  "--font-text-sm-size": "0.875rem",
  "--font-text-md-size": "1rem",
  "--font-text-lg-size": "1.125rem",
  "--font-heading-xs-size": "0.75rem",
  "--font-heading-sm-size": "0.875rem",
  "--font-heading-md-size": "1rem",
  "--font-heading-lg-size": "1.25rem",
  "--font-heading-xl-size": "1.5rem",
  "--font-heading-2xl-size": "1.875rem",
  "--font-heading-3xl-size": "2.25rem",
  "--font-text-xs-line-height": "1.4",
  "--font-text-sm-line-height": "1.4",
  "--font-text-md-line-height": "1.5",
  "--font-text-lg-line-height": "1.5",
  "--font-heading-xs-line-height": "1.4",
  "--font-heading-sm-line-height": "1.4",
  "--font-heading-md-line-height": "1.4",
  "--font-heading-lg-line-height": "1.3",
  "--font-heading-xl-line-height": "1.25",
  "--font-heading-2xl-line-height": "1.2",
  "--font-heading-3xl-line-height": "1.1",
  "--border-radius-xs": "2px",
  "--border-radius-sm": "4px",
  "--border-radius-md": "6px",
  "--border-radius-lg": "8px",
  "--border-radius-xl": "12px",
  "--border-radius-full": "9999px",
  "--border-width-regular": "1px",
  "--shadow-hairline": "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  "--shadow-sm":
    "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)",
  "--shadow-md":
    "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
  "--shadow-lg":
    "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)"
} satisfies Record<string, string>;

function getTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function newAppBridge(
  serverInfo: ServerInfo,
  iframe: HTMLIFrameElement,
  callbacks?: AppBridgeCallbacks,
  options?: AppBridgeOptions
): AppBridge {
  const serverCapabilities = serverInfo.client.getServerCapabilities();
  const appBridge = new AppBridge(
    serverInfo.client,
    IMPLEMENTATION,
    {
      openLinks: {},
      serverTools: serverCapabilities?.tools,
      serverResources: serverCapabilities?.resources,
      updateModelContext: { text: {} }
    },
    {
      hostContext: {
        theme: getTheme(),
        platform: "web",
        styles: {
          variables: HOST_STYLE_VARIABLES
        },
        containerDimensions: options?.containerDimensions ?? {
          maxHeight: 6000
        },
        displayMode: options?.displayMode ?? "inline",
        availableDisplayModes: ["inline", "fullscreen"]
      }
    }
  );

  // Listen for system theme changes
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", e => {
      const newTheme = e.matches ? "dark" : "light";
      log.info("Theme changed:", newTheme);
      appBridge.sendHostContextChange({ theme: newTheme });
    });

  // Register handlers before calling connect()
  appBridge.onmessage = async params => {
    log.info("Message from MCP App:", params);
    callbacks?.onMessage?.(params);
    return {};
  };

  appBridge.onopenlink = async params => {
    log.info("Open link request:", params);
    window.open(params.url, "_blank", "noopener,noreferrer");
    return {};
  };

  appBridge.onloggingmessage = params => {
    log.info("Log message from MCP App:", params);
  };

  appBridge.onupdatemodelcontext = async params => {
    log.info("Model context update from MCP App:", params);
    const hasContent = params.content && params.content.length > 0;
    const hasStructured =
      params.structuredContent &&
      Object.keys(params.structuredContent).length > 0;
    callbacks?.onContextUpdate?.(hasContent || hasStructured ? params : null);
    return {};
  };

  appBridge.onsizechange = async ({ width, height }) => {
    const style = getComputedStyle(iframe);
    const isBorderBox = style.boxSizing === "border-box";

    if (width !== undefined) {
      if (isBorderBox) {
        width +=
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.borderRightWidth);
      }
      iframe.style.minWidth = `min(${width}px, 100%)`;
    }
    if (height !== undefined) {
      if (isBorderBox) {
        height +=
          parseFloat(style.borderTopWidth) +
          parseFloat(style.borderBottomWidth);
      }
      iframe.style.height = `${height}px`;
    }
  };

  appBridge.onrequestdisplaymode = async params => {
    log.info("Display mode request from MCP App:", params);
    const newMode = params.mode === "fullscreen" ? "fullscreen" : "inline";
    appBridge.sendHostContextChange({ displayMode: newMode });
    callbacks?.onDisplayModeChange?.(newMode);
    return { mode: newMode };
  };

  return appBridge;
}
