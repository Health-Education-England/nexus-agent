import "dotenv/config";
import { createGetUserMessage } from "./input-handler.js";
import { Agent } from "./agent/agent.js";
import {
  createProviderFromEnv,
  createAnthropicProvider
} from "./providers/provider-factory.js";
import { MAX_TOKENS } from "./agent/constants.js";
import {
  DateTimeTool,
  LtftCalculatorTool,
  createGoldGuideExpertTool
} from "./tools/index.js";
import { PRODUCTION_CONFIG } from "../gold-guide-expert/sub-agent/index.js";

const getUserMessage = createGetUserMessage();

try {
  const { provider, providerName, model } = createProviderFromEnv(MAX_TOKENS);
  console.log(`Using provider: ${providerName} (orchestrator model: ${model})`);

  // Create a dedicated provider for the Gold Guide sub-agent.
  // The sub-agent model is owned by its production-config, not the root .env.
  const subAgentModel = PRODUCTION_CONFIG.models.answer;
  const subAgentProvider = createAnthropicProvider(subAgentModel, MAX_TOKENS);
  console.log(`Gold Guide sub-agent model: ${subAgentModel}`);

  const tools = [
    DateTimeTool,
    LtftCalculatorTool,
    createGoldGuideExpertTool({ provider: subAgentProvider })
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
