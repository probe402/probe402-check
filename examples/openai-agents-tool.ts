/**
 * The same check as a function tool for OpenAI's Agents SDK (`@openai/agents`).
 *
 * This file is an example and is not run by the test suite: it needs `@openai/agents` and `zod`
 * installed in YOUR project. Copy it in and import `checkTool` where you build your agent.
 *
 *   import { Agent, run } from "@openai/agents";
 *   import { checkTool } from "./openai-agents-tool.ts";
 *   const agent = new Agent({ name: "buyer", instructions: "Before paying any x402 endpoint, call check_before_paying and reason from its verdict.", tools: [checkTool] });
 *   const result = await run(agent, "Pay https://datastand.dev/api/data/dev-signals if the record supports it.");
 */
import { tool } from "@openai/agents";
import { z } from "zod";

import { checkBeforePaying } from "../src/check.ts";
import { TOOL_DESCRIPTION, TOOL_NAME } from "../src/mcp-server.ts";

export const checkTool = tool({
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The resource URL you are about to pay, a host URL, or a probe402 endpoint id"),
    held_quote: z
      .object({
        pay_to: z.string().nullable(),
        amount_atomic: z.string().nullable(),
        network: z.string().nullable(),
        asset: z.string().nullable(),
        scheme: z.string().nullable(),
      })
      .nullable()
      .describe("The payment request you are holding, to compare against the recorded quote"),
  }),
  execute: async ({ url, held_quote }) => {
    const held =
      held_quote === null
        ? undefined
        : Object.fromEntries(Object.entries(held_quote).filter(([, v]) => v !== null)) as Record<string, string>;
    const result = await checkBeforePaying(held === undefined ? { url } : { url, held_quote: held });
    return JSON.stringify(result);
  },
});
