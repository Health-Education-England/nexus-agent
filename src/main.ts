import "dotenv/config";
import { createGetUserMessage } from "./input-handler.js";
import { Agent } from "./agent/agent.js";
import { createProviderFromEnv } from "./providers/provider-factory.js";
import { MAX_TOKENS } from "./agent/constants.js";
import {
  DateTimeTool,
  LtftCalculatorTool,
  createGoldGuideExpertTool
} from "./tools/index.js";

const getUserMessage = createGetUserMessage();

try {
  const { provider, providerName, model } = createProviderFromEnv(MAX_TOKENS);
  console.log(`Using provider: ${providerName} (model: ${model})`);

  // Configure the Gold Guide Expert sub-agent
  const tools = [
    DateTimeTool,
    LtftCalculatorTool,
    createGoldGuideExpertTool(provider)
  ];

  const agent = new Agent(provider, getUserMessage, tools);
  await agent.run();
} catch (error) {
  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error("Error:", error);
  }
}
