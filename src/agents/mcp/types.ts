export type McpStdioServerConfig = {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpSseServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type McpToolServerConfig = (McpStdioServerConfig | McpSseServerConfig) & {
  /** Unique server name — used as the tool name prefix: mcp__<name>__<tool>. */
  name: string;
  description?: string;
  /** Default: true. */
  enabled?: boolean;
  /** Allowlist of tool names to expose (default: all). */
  tools?: string[];
  /** Per-call timeout in milliseconds (default: 30000). */
  timeoutMs?: number;
};
