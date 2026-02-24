import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "../tools/common.js";
import { McpConnection } from "./client.js";
import { mcpToolToAgentTool } from "./tool-bridge.js";
import type { McpToolServerConfig } from "./types.js";

/** Active connections keyed by server name. */
const connections = new Map<string, McpConnection>();

function getServerConfigs(cfg: OpenClawConfig): McpToolServerConfig[] {
  return (cfg.tools as { toolServers?: McpToolServerConfig[] } | undefined)?.toolServers ?? [];
}

/**
 * Initialize the MCP registry at gateway startup.
 * Creates a connection for each enabled server and attempts to connect.
 * Per-server failures are logged as warnings — never thrown.
 */
export async function initMcpRegistry(
  cfg: OpenClawConfig,
  log: { warn: (msg: string) => void } = { warn: () => {} },
): Promise<void> {
  const servers = getServerConfigs(cfg);
  for (const server of servers) {
    if (server.enabled === false) {
      continue;
    }
    const conn = new McpConnection(server);
    connections.set(server.name, conn);
    try {
      await conn.connect();
    } catch (err) {
      log.warn(`MCP server "${server.name}" failed to connect: ${String(err)}`);
    }
  }
}

/** Disconnect all MCP servers and clear the registry. */
export async function disposeMcpRegistry(): Promise<void> {
  const entries = Array.from(connections.entries());
  connections.clear();
  await Promise.all(entries.map(([, conn]) => conn.disconnect().catch(() => {})));
}

/** Look up a connection by server name. */
export function getMcpConnection(name: string): McpConnection | undefined {
  return connections.get(name);
}

/** Get all registered connections. */
export function getAllMcpConnections(): ReadonlyMap<string, McpConnection> {
  return connections;
}

/**
 * Resolve all MCP tools from connected servers.
 * Errors per server are warned and skipped.
 *
 * This is synchronous in signature but internally async-capable because
 * tool schemas are cached after the first listTools() call.
 */
export function resolveMcpTools(
  cfg: OpenClawConfig,
  opts?: { existingToolNames?: Set<string>; log?: { warn: (msg: string) => void } },
): AnyAgentTool[] {
  const tools: AnyAgentTool[] = [];
  if (connections.size === 0) {
    return tools;
  }

  const serverConfigs = getServerConfigs(cfg);
  const configByName = new Map(serverConfigs.map((s) => [s.name, s]));

  // Return a lazy-resolving tool array built synchronously using closures.
  // Each tool's execute() triggers a live callTool() RPC — the schemas
  // were already fetched at init time and cached in McpConnection.listTools().
  for (const [name, conn] of connections) {
    const serverCfg = configByName.get(name);
    if (serverCfg?.enabled === false) {
      continue;
    }
    const allowedTools = serverCfg?.tools;

    // We need the tool list synchronously — use the cached list if available.
    // If not yet cached we can't await here, so we yield a sentinel that resolves
    // the list lazily inside execute().
    const cachedList = tryGetCachedTools(conn);
    if (cachedList === null) {
      // No cache yet — skip this server; tools will appear after next registry init.
      opts?.log?.warn(
        `MCP server "${name}" tools not yet cached — skipping until reconnect`,
      );
      continue;
    }

    for (const mcpTool of cachedList) {
      if (allowedTools && !allowedTools.includes(mcpTool.name)) {
        continue;
      }
      const agentTool = mcpToolToAgentTool(name, mcpTool, (toolName, args, signal) =>
        conn.callTool(toolName, args, signal),
      );
      if (
        opts?.existingToolNames &&
        opts.existingToolNames.has(agentTool.name)
      ) {
        continue;
      }
      tools.push(agentTool);
    }
  }
  return tools;
}

/**
 * Try to get the cached tool list from a connection without triggering a network call.
 * Returns null if the list has not been fetched yet.
 */
function tryGetCachedTools(conn: McpConnection) {
  // Access the private cachedTools field via a cast — avoids exposing it publicly.
  // The registry and client are co-located so this is an acceptable internal seam.
  const internal = conn as unknown as { cachedTools: ReturnType<typeof Array.from> | null };
  return internal.cachedTools as import("@modelcontextprotocol/sdk/types.js").Tool[] | null;
}
