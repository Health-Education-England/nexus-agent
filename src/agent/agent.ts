import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ContentBlock,
  Message,
  ModelProvider,
  ToolDefinition,
  ToolResultBlock,
  ToolUseBlock
} from "../../providers/types.js";
import { SYSTEM_PROMPT, MAX_TOOL_TURNS } from "./constants.js";
import { COLOURS } from "../utils/colours.js";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string }
  | { type: "tool_result"; name: string; success: boolean }
  | { type: "error"; message: string };

type InferenceOpts = {
  silent?: boolean;
  emit?: (event: AgentEvent) => void;
};

export class Agent {
  private readonly provider: ModelProvider;
  private readonly getUserMessage: () => Promise<string | null>;
  private readonly tools: ToolDefinition[];
  private readonly systemPrompt: string;

  constructor(
    provider: ModelProvider,
    getUserMessage: () => Promise<string | null>,
    tools: ToolDefinition[] = [],
    systemPrompt: string = SYSTEM_PROMPT
  ) {
    this.provider = provider;
    this.getUserMessage = getUserMessage;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
  }

  /**
   * Interactive CLI loop – reads user messages, runs inference + tools,
   * prints assistant responses. Type 'exit' or 'quit' to stop.
   */
  async run(): Promise<void> {
    let conversation: Message[] = [];

    let isShuttingDown = false;
    const handleSignal = async () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      if (conversation.length > 0) {
        console.log(
          `\n${COLOURS.yellow}Saving conversation...${COLOURS.reset}`
        );
        await this.saveConversation(conversation);
      }
      process.exit(0);
    };

    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

    try {
      console.log("Chat with Agent (type 'exit' or 'quit' to stop)");

      while (true) {
        process.stdout.write(`${COLOURS.blue}You${COLOURS.reset}: `);
        const userInput = await this.getUserMessage();

        if (userInput === null) break;

        const trimmedInput = userInput.trim();
        if (trimmedInput === "") continue;
        if (
          trimmedInput.toLowerCase() === "exit" ||
          trimmedInput.toLowerCase() === "quit"
        ) {
          break;
        }

        const userMessage: Message = { role: "user", content: userInput };
        conversation.push(userMessage);

        // Keep last 50 messages, ensuring we don't slice mid tool-use pair
        if (conversation.length > 50) {
          let sliceIndex = conversation.length - 50;
          while (sliceIndex < conversation.length) {
            const msg = conversation[sliceIndex];
            if (msg.role === "user" && typeof msg.content === "string") break;
            sliceIndex++;
          }
          conversation = conversation.slice(sliceIndex);
        }

        process.stdout.write(`${COLOURS.yellow}Agent${COLOURS.reset}: `);
        const assistantMessage = await this.runInference(conversation);
        console.log("");

        conversation.push({ role: "assistant", content: assistantMessage });
      }

      console.log("\nShutdown initiated...");
      await this.saveConversation(conversation);
      console.log("Goodbye!");
    } finally {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    }
  }

  /**
   * Streaming single-turn for the web UI: runs inference and emits
   * AgentEvents (text, tool_use, tool_result) via the provided callback.
   * Returns the updated conversation history.
   */
  async stream(
    conversation: Message[],
    userMessage: string,
    emit: (event: AgentEvent) => void
  ): Promise<Message[]> {
    const updated = [
      ...conversation,
      { role: "user" as const, content: userMessage }
    ];
    const content = await this.runInference(updated, { emit });
    updated.push({ role: "assistant" as const, content });
    return updated;
  }

  /**
   * Programmatic single-turn: send one user message and get the final
   * assistant content blocks back. No interactive I/O.
   * Used by the evaluation runner and by sub-agents.
   */
  async chat(
    conversation: Message[],
    userMessage: string
  ): Promise<{ content: ContentBlock[]; conversation: Message[] }> {
    const updated = [
      ...conversation,
      { role: "user" as const, content: userMessage }
    ];

    const content = await this.runInference(updated, { silent: true });
    updated.push({ role: "assistant" as const, content });

    return { content, conversation: updated };
  }

  // ── Private ────────────────────────────────────────────────

  private async saveConversation(conversation: Message[]) {
    if (conversation.length === 0) return;
    try {
      const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
      const filename = `conversation-${timestamp}.json`;
      const dirPath = path.join(process.cwd(), "conversations");

      await fs.mkdir(dirPath, { recursive: true });
      const filePath = path.join(dirPath, filename);

      await fs.writeFile(filePath, JSON.stringify(conversation, null, 2));
      console.log(
        `${COLOURS.green}Conversation saved to ${filePath}${COLOURS.reset}`
      );
    } catch (error) {
      console.error(
        `${COLOURS.red}Failed to save conversation: ${error}${COLOURS.reset}`
      );
    }
  }

  private async runInference(
    conversation: Message[],
    opts: InferenceOpts = {}
  ): Promise<ContentBlock[]> {
    let continueLoop = true;
    let currentContent: ContentBlock[] = [];
    let toolTurns = 0;

    while (continueLoop) {
      const response = await this.provider.generateResponse(
        conversation,
        this.tools,
        this.systemPrompt,
        opts.emit
          ? { onTextDelta: delta => opts.emit!({ type: "text", text: delta }) }
          : undefined
      );
      currentContent = response.content;

      const toolUseBlocks = currentContent.filter(
        (block): block is ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length > 0 && response.stop_reason === "tool_use") {
        toolTurns++;
        if (toolTurns > MAX_TOOL_TURNS) {
          if (opts.emit) {
            opts.emit({
              type: "error",
              message: `Stopped: exceeded ${MAX_TOOL_TURNS} tool turns`
            });
          } else if (!opts.silent) {
            console.log(
              `\n${COLOURS.red}[Stopping: exceeded ${MAX_TOOL_TURNS} tool turns]${COLOURS.reset}`
            );
          }
          break;
        }

        const toolResults = await this.executeTools(toolUseBlocks, opts);
        conversation.push(
          { role: "assistant", content: currentContent },
          { role: "user", content: toolResults }
        );
      } else {
        // When opts.emit is set, text tokens were already streamed via
        // onTextDelta. Only write to stdout for the plain CLI path.
        if (!opts.emit && !opts.silent) {
          for (const block of currentContent) {
            if (block.type === "text") {
              process.stdout.write(block.text);
            }
          }
        }
        continueLoop = false;
      }
    }

    return currentContent;
  }

  private async executeTools(
    toolUseBlocks: ToolUseBlock[],
    opts: InferenceOpts = {}
  ): Promise<ToolResultBlock[]> {
    const results = await Promise.all(
      toolUseBlocks.map(async (toolUse): Promise<ToolResultBlock> => {
        if (opts.emit) {
          opts.emit({ type: "tool_use", name: toolUse.name });
        } else if (!opts.silent) {
          console.log(
            `\n${COLOURS.cyan}[Tool Use: ${toolUse.name}]${COLOURS.reset}`
          );
          if (
            toolUse.input &&
            typeof toolUse.input === "object" &&
            !Array.isArray(toolUse.input) &&
            Object.keys(toolUse.input).length > 0
          ) {
            console.log(`Input: ${JSON.stringify(toolUse.input, null, 2)}`);
          }
        }

        const toolDef = this.tools.find(t => t.name === toolUse.name);

        if (!toolDef) {
          if (opts.emit) {
            opts.emit({
              type: "tool_result",
              name: toolUse.name,
              success: false
            });
          } else if (!opts.silent) {
            console.log(
              `${COLOURS.red}[Error: Tool ${toolUse.name} not found]${COLOURS.reset}`
            );
          }
          return {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Error: Tool ${toolUse.name} not found`,
            is_error: true
          };
        }

        try {
          this.validateInput(toolUse.input, toolDef.input_schema);

          const executionPromise = toolDef.execute(toolUse.input);
          const timeoutPromise = new Promise<string>((_, reject) => {
            setTimeout(
              () => reject(new Error("Tool execution timed out after 30s")),
              30000
            );
          });
          const result = await Promise.race([executionPromise, timeoutPromise]);

          if (opts.emit) {
            opts.emit({
              type: "tool_result",
              name: toolUse.name,
              success: true
            });
          } else if (!opts.silent) {
            const logResult =
              result.length > 100
                ? result.slice(0, 100) + "... (truncated)"
                : result;
            console.log(
              `${COLOURS.green}[Tool use result: ${logResult}]${COLOURS.reset}`
            );
          }

          return {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (opts.emit) {
            opts.emit({
              type: "tool_result",
              name: toolUse.name,
              success: false
            });
          } else if (!opts.silent) {
            console.log(
              `${COLOURS.red}[Error: ${errorMessage}]${COLOURS.reset}`
            );
          }
          return {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: errorMessage,
            is_error: true
          };
        }
      })
    );

    if (!opts.emit && !opts.silent) console.log("");
    return results;
  }

  private validateInput(input: unknown, schema: { required?: string[] }): void {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error("Input must be a valid object");
    }
    if (schema.required && Array.isArray(schema.required)) {
      const inputObj = input as Record<string, unknown>;
      const missing = schema.required.filter(field => !(field in inputObj));
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(", ")}`);
      }
    }
  }
}
