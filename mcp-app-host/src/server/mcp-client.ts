/**
 * MCP Client: connects to MCP servers, lists tools, and executes tool calls.
 * Used by the agent server to bridge between Claude's tool_use and MCP servers.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import { getLocalToolByName, getLocalTools } from "./local-tools.js";

const IMPLEMENTATION = { name: "MCP App Host Agent", version: "1.0.0" };

export interface ConnectedServer {
  url: string;
  name: string;
  client: Client;
  tools: Tool[];
}

const servers: ConnectedServer[] = [];

/** Connect to all configured MCP servers. */
export async function connectToServers(serverUrls: string[]): Promise<void> {
  for (const url of serverUrls) {
    try {
      const client = await connectToServer(new URL(url));
      const name = client.getServerVersion()?.name ?? url;
      const { tools } = await client.listTools();
      servers.push({ url, name, client, tools });
      console.log(
        `[MCP] Connected to ${name} — ${tools.length} tools: ${tools.map(t => t.name).join(", ")}`
      );
    } catch (err) {
      console.error(`[MCP] Failed to connect to ${url}:`, err);
    }
  }
}

async function connectToServer(serverUrl: URL): Promise<Client> {
  const client = new Client(IMPLEMENTATION);
  await client.connect(new StreamableHTTPClientTransport(serverUrl));
  return client;
}

/**
 * Get all tools from all connected servers, formatted for Anthropic's `tools` parameter.
 * Returns both the Anthropic tool definitions and a lookup map.
 */
export function getAvailableTools(): {
  anthropicTools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  toolServerMap: Map<string, ConnectedServer>;
} {
  const anthropicTools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> = [];
  const toolServerMap = new Map<string, ConnectedServer>();

  for (const server of servers) {
    for (const tool of server.tools) {
      anthropicTools.push({
        name: tool.name,
        description: tool.description ?? "",
        input_schema: (tool.inputSchema as Record<string, unknown>) ?? {
          type: "object"
        }
      });
      toolServerMap.set(tool.name, server);
    }
  }

  for (const tool of getLocalTools()) {
    anthropicTools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    });
  }

  return { anthropicTools, toolServerMap };
}

/** Execute a tool call on the appropriate MCP server. */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ result: CallToolResult; hasApp: boolean; resourceUri?: string }> {
  const localTool = getLocalToolByName(toolName);
  if (localTool) {
    const result = await localTool.execute(input);
    return { result, hasApp: false };
  }

  const { toolServerMap } = getAvailableTools();
  const server = toolServerMap.get(toolName);

  if (!server) {
    throw new Error(`No server found for tool: ${toolName}`);
  }

  const tool = server.tools.find(t => t.name === toolName);
  const resourceUri = tool ? getToolUiResourceUri(tool) : undefined;
  const hasApp = !!resourceUri;

  const result = (await server.client.callTool({
    name: toolName,
    arguments: input
  })) as CallToolResult;

  return { result, hasApp, resourceUri: resourceUri ?? undefined };
}

/**
 * Get Anthropic-formatted tool schemas for a specific list of tool names.
 * Used by the agent to add a skill's tools to the API call once that skill is loaded.
 * Searches both MCP servers and local tools.
 */
export function getToolsForNames(toolNames: string[]): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  const { anthropicTools } = getAvailableTools();
  return anthropicTools.filter(t => toolNames.includes(t.name));
}

/** Get connected server info for the browser-side MCP bridge. */
export function getConnectedServers(): ConnectedServer[] {
  return servers;
}

/**
 * Lightweight tool summaries (name + description only) for progressive disclosure.
 * Used in the system prompt so the LLM can choose a tool without seeing full schemas.
 */
export function getToolSummaries(): Array<{
  name: string;
  description: string;
}> {
  const mcpSummaries = servers.flatMap(s =>
    s.tools.map(t => ({
      name: t.name,
      description: t.description ?? ""
    }))
  );

  const localSummaries = getLocalTools().map(tool => ({
    name: tool.name,
    description: tool.description
  }));

  return [...mcpSummaries, ...localSummaries];
}

/**
 * Get the full Anthropic-formatted schema for a single tool (on demand).
 * Returns undefined if the tool is not found.
 */
export function getToolSchema(
  toolName: string
):
  | { name: string; description: string; input_schema: Record<string, unknown> }
  | undefined {
  const localTool = getLocalToolByName(toolName);
  if (localTool) {
    return {
      name: localTool.name,
      description: localTool.description,
      input_schema: localTool.inputSchema
    };
  }

  for (const server of servers) {
    const tool = server.tools.find(t => t.name === toolName);
    if (tool) {
      return {
        name: tool.name,
        description: tool.description ?? "",
        input_schema: (tool.inputSchema as Record<string, unknown>) ?? {
          type: "object"
        }
      };
    }
  }
  return undefined;
}
