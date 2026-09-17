/**
 * THE MCP SERVER (stdio). One tool, `check_before_paying`, over the same function the CLI runs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { checkBeforePaying, type CheckOptions, type HeldQuote } from "./check.ts";
import { VERSION } from "./version.ts";

export const TOOL_NAME = "check_before_paying";

export const TOOL_DESCRIPTION =
  "Ask probe402's public record about an x402 or MPP endpoint before paying it. Give the resource URL you are " +
  "about to pay (or a probe402 endpoint id). Returns what the route was doing at probe402's newest reading and " +
  "when: whether it was quoting, the recorded quote (scheme, network, amount, asset, payment address), how many " +
  "times the quote changed in the window, whether probe402 itself has paid the route and how that was graded, " +
  "the age of the reading against the route's own cadence, the grade address to cite, and a one-line reading in " +
  "plain words. Pass held_quote to have the payment request you are holding compared against the recorded one. " +
  "A host URL answers the host's routes. Every answer is a dated reading from probe402's vantage, not a statement " +
  "about what the endpoint is; the decision is yours.";

export function buildServer(options: CheckOptions = {}): McpServer {
  const server = new McpServer({ name: "probe402-check", version: VERSION });
  server.registerTool(
    TOOL_NAME,
    {
      title: "Check an endpoint on probe402 before paying it",
      description: TOOL_DESCRIPTION,
      inputSchema: {
        url: z.string().describe("The resource URL you are about to pay, a host URL, or a probe402 endpoint id (ep_...)"),
        held_quote: z
          .object({
            pay_to: z.string().optional().describe("The payment address in the 402 you hold"),
            amount_atomic: z.string().optional().describe("The amount in atomic units in the 402 you hold"),
            network: z.string().optional().describe("The network (CAIP-2, e.g. eip155:8453) in the 402 you hold"),
            asset: z.string().optional().describe("The asset address in the 402 you hold"),
            scheme: z.string().optional().describe("The scheme (e.g. exact) in the 402 you hold"),
          })
          .optional()
          .describe("The payment request you are holding, to compare against the recorded quote"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ url, held_quote }) => {
      try {
        const held =
          held_quote === undefined
            ? undefined
            : (Object.fromEntries(Object.entries(held_quote).filter(([, v]) => v !== undefined)) as HeldQuote);
        const result = await checkBeforePaying(held === undefined ? { url } : { url, held_quote: held }, options);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `probe402-check could not answer: ${(error as Error).message}` }] };
      }
    },
  );
  return server;
}

export async function serveStdio(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}
