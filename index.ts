#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlankaMcpServer } from "./server.js";
import { startHttpServer } from "./transports/http.js";

export type TransportName = "stdio" | "http";

export function selectTransport(
  args: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): TransportName {
  const argument = args.find((value) => value.startsWith("--transport="));
  const value = argument?.slice("--transport=".length) ?? environment.MCP_TRANSPORT ?? "stdio";

  if (value !== "stdio" && value !== "http") {
    throw new Error(`Unsupported transport "${value}"; expected "stdio" or "http"`);
  }

  const unknownArguments = args.filter((value) => !value.startsWith("--transport="));
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument "${unknownArguments[0]}"`);
  }

  return value;
}

async function runStdioServer(): Promise<void> {
  const server = createPlankaMcpServer();
  await server.connect(new StdioServerTransport());
}

export async function main(): Promise<void> {
  if (selectTransport() === "http") {
    await startHttpServer();
    return;
  }

  await runStdioServer();
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error running server: ${message}`);
    process.exit(1);
  });
}
