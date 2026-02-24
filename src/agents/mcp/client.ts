import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpToolServerConfig } from "./types.js";

const CLIENT_NAME = "openclaw-mcp";
const CLIENT_VERSION = "1.0.0";
const DEFAULT_TIMEOUT_MS = 30_000;

export type McpConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export class McpConnection {
  readonly config: McpToolServerConfig;

  private client: Client | null = null;
  private status: McpConnectionStatus = "disconnected";
  private cachedTools: Tool[] | null = null;

  constructor(config: McpToolServerConfig) {
    this.config = config;
  }

  getStatus(): McpConnectionStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    if (this.status === "connecting" || this.status === "connected") {
      return;
    }
    this.status = "connecting";
    this.cachedTools = null;
    try {
      const transport = this.createTransport();
      const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
      await client.connect(transport);
      this.client = client;
      this.status = "connected";
    } catch (err) {
      this.status = "error";
      this.client = null;
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.status = "disconnected";
    this.cachedTools = null;
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore close errors */
      }
    }
  }

  async listTools(): Promise<Tool[]> {
    // Use cached tools if already fetched for this connection
    if (this.cachedTools !== null) {
      return this.cachedTools;
    }
    if (this.status !== "connected" || !this.client) {
      await this.connect();
    }
    const client = this.client;
    if (!client) {
      throw new Error(`MCP server "${this.config.name}" not connected`);
    }
    const result = await client.listTools();
    this.cachedTools = result.tools;
    return this.cachedTools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    if (this.status !== "connected" || !this.client) {
      await this.connect();
    }
    const client = this.client;
    if (!client) {
      throw new Error(`MCP server "${this.config.name}" not connected`);
    }
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Wrap with per-call timeout
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined =
      signal && !signal.aborted
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

    const raw = await client.callTool({ name, arguments: args }, undefined, {
      signal: combined,
    });
    // The SDK's callTool return type has an open index signature that doesn't exactly
    // match CallToolResult — cast to the canonical result type.
    return raw as CallToolResult;
  }

  private createTransport(): StdioClientTransport | SSEClientTransport {
    const cfg = this.config;
    if (cfg.type === "stdio") {
      return new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: cfg.env,
        cwd: cfg.cwd,
      });
    }
    // type === "sse"
    const url = new URL(cfg.url);
    const headers = cfg.headers;
    return new SSEClientTransport(url, headers ? { requestInit: { headers } } : undefined);
  }
}
