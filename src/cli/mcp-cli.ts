import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import {
  getAllMcpConnections,
  getMcpConnection,
  initMcpRegistry,
} from "../agents/mcp/registry.js";
import type { McpToolServerConfig } from "../agents/mcp/types.js";
import { defaultRuntime } from "../runtime.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { runCommandWithRuntime } from "./cli-utils.js";

function run(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

function getToolServers(): McpToolServerConfig[] {
  const cfg = loadConfig();
  return (cfg.tools as { toolServers?: McpToolServerConfig[] } | undefined)?.toolServers ?? [];
}

export function registerMcpCli(program: Command) {
  const mcp = program
    .command("mcp")
    .description("Manage MCP tool server connections");

  // ── mcp list ────────────────────────────────────────────────────────────────
  mcp
    .command("list")
    .description("List configured MCP tool servers and their connection status")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) =>
      run(async () => {
        const cfg = loadConfig();
        // Ensure registry is populated (no-op if already running via gateway).
        await initMcpRegistry(cfg).catch(() => {});
        const servers = getToolServers();
        if (servers.length === 0) {
          defaultRuntime.error(
            "No MCP tool servers configured. Add entries to tools.toolServers in config.",
          );
          return;
        }
        const connections = getAllMcpConnections();
        if (opts.json) {
          const out = servers.map((s) => ({
            name: s.name,
            type: s.type,
            endpoint: s.type === "stdio" ? s.command : s.url,
            enabled: s.enabled !== false,
            status: connections.get(s.name)?.getStatus() ?? "disconnected",
          }));
          defaultRuntime.log(JSON.stringify(out, null, 2));
          return;
        }
        const rows = servers.map((s) => {
          const conn = connections.get(s.name);
          const status = conn?.getStatus() ?? "not started";
          const statusLabel =
            status === "connected"
              ? theme.success("connected")
              : status === "connecting"
                ? theme.muted("connecting")
                : theme.error(status);
          return {
            name: s.name,
            type: s.type,
            endpoint: s.type === "stdio" ? `${s.command} ${(s.args ?? []).join(" ")}`.trim() : s.url,
            enabled: s.enabled !== false ? "yes" : "no",
            status: statusLabel,
          };
        });
        defaultRuntime.log(
          renderTable({
            columns: [
              { key: "name", header: "Name", flex: true },
              { key: "type", header: "Type", minWidth: 6 },
              { key: "endpoint", header: "Endpoint / Command", flex: true, maxWidth: 50 },
              { key: "enabled", header: "Enabled", minWidth: 8 },
              { key: "status", header: "Status", minWidth: 12 },
            ],
            rows,
          }),
        );
      }),
    );

  // ── mcp tools ───────────────────────────────────────────────────────────────
  mcp
    .command("tools [server]")
    .description("List tools exposed by MCP servers")
    .option("--json", "Output as JSON")
    .action((serverArg: string | undefined, opts: { json?: boolean }) =>
      run(async () => {
        const cfg = loadConfig();
        await initMcpRegistry(cfg).catch(() => {});
        const servers = getToolServers().filter((s) => s.enabled !== false);
        const filtered = serverArg
          ? servers.filter((s) => s.name === serverArg)
          : servers;
        if (filtered.length === 0) {
          defaultRuntime.error(
            serverArg
              ? `MCP server "${serverArg}" not found or not enabled.`
              : "No enabled MCP tool servers configured.",
          );
          return;
        }

        type ToolRow = { server: string; tool: string; description: string };
        const rows: ToolRow[] = [];
        for (const server of filtered) {
          const conn = getMcpConnection(server.name);
          if (!conn) {
            rows.push({ server: server.name, tool: "(not connected)", description: "" });
            continue;
          }
          let tools: import("@modelcontextprotocol/sdk/types.js").Tool[];
          try {
            tools = await conn.listTools();
          } catch (err) {
            rows.push({ server: server.name, tool: "(error)", description: String(err) });
            continue;
          }
          for (const t of tools) {
            rows.push({
              server: server.name,
              tool: t.name,
              description: t.description ?? "",
            });
          }
        }

        if (opts.json) {
          defaultRuntime.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (rows.length === 0) {
          defaultRuntime.log("No tools found.");
          return;
        }
        defaultRuntime.log(
          renderTable({
            columns: [
              { key: "server", header: "Server", minWidth: 10 },
              { key: "tool", header: "Tool", flex: true },
              { key: "description", header: "Description", flex: true, maxWidth: 60 },
            ],
            rows,
          }),
        );
      }),
    );

  // ── mcp reconnect ────────────────────────────────────────────────────────────
  mcp
    .command("reconnect [server]")
    .description("Reconnect one or all MCP servers")
    .action((serverArg: string | undefined) =>
      run(async () => {
        const cfg = loadConfig();
        await initMcpRegistry(cfg).catch(() => {});
        const servers = getToolServers().filter((s) => s.enabled !== false);
        const targets = serverArg ? servers.filter((s) => s.name === serverArg) : servers;
        if (targets.length === 0) {
          defaultRuntime.error(
            serverArg
              ? `MCP server "${serverArg}" not found or not enabled.`
              : "No enabled MCP servers configured.",
          );
          return;
        }
        for (const server of targets) {
          const conn = getMcpConnection(server.name);
          if (!conn) {
            defaultRuntime.log(`${theme.muted(server.name)}: not in registry — skipping`);
            continue;
          }
          try {
            await conn.disconnect();
            await conn.connect();
            defaultRuntime.log(`${theme.success("✓")} ${server.name}: reconnected`);
          } catch (err) {
            defaultRuntime.error(`${server.name}: reconnect failed — ${String(err)}`);
          }
        }
      }),
    );
}
