#!/usr/bin/env node
/** probe402-check-mcp: the MCP server over stdio. Configure it in your agent's MCP settings. */
import { serveStdio } from "../mcp-server.ts";

serveStdio().catch((error: unknown) => {
  process.stderr.write(`probe402-check-mcp failed to start: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
