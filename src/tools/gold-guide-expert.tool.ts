/**
 * Re-exports the Gold Guide Expert tool definition from the
 * gold-guide-expert/sub-agent module.
 *
 * The actual implementation lives in:
 *   gold-guide-expert/sub-agent/tool-definition.ts  — tool definition
 *   gold-guide-expert/sub-agent/gold-guide-sub-agent.ts  — conversation wrapper
 *   gold-guide-expert/core/query-gold-guide.ts  — shared stateless query function
 */
export { createGoldGuideExpertTool } from "../../gold-guide-expert/sub-agent/index.js";
export type { GoldGuideToolOptions } from "../../gold-guide-expert/sub-agent/tool-definition.js";
