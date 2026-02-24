import { Type } from "@sinclair/typebox";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AnyAgentTool } from "../tools/common.js";

/**
 * Converts an MCP tool + call function into an AnyAgentTool.
 *
 * Tool name: mcp__<serverName>__<toolName>
 * Tool description: [MCP:<serverName>] <original description>
 */
export function mcpToolToAgentTool(
  serverName: string,
  mcpTool: Tool,
  callFn: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>,
): AnyAgentTool {
  const prefixedName = `mcp__${serverName}__${mcpTool.name}`;
  const description = `[MCP:${serverName}] ${mcpTool.description ?? mcpTool.name}`;

  // Pass through the MCP inputSchema directly; TypeBox Type.Unsafe wraps it as-is
  // so the schema flows to the LLM without re-parsing.
  const inputSchema = mcpTool.inputSchema ?? { type: "object", properties: {} };
  const params = Type.Unsafe<Record<string, unknown>>(inputSchema);

  return {
    name: prefixedName,
    label: description,
    description,
    parameters: params,
    execute: async (
      _toolCallId: string,
      args: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> => {
      let result: CallToolResult;
      try {
        result = await callFn(mcpTool.name, args ?? {}, signal);
      } catch (err) {
        return {
          content: [{ type: "text", text: `MCP tool error: ${String(err)}` }],
          details: { error: String(err) } as unknown,
        };
      }

      // Convert MCP content array → AgentToolResult content
      const content: AgentToolResult<unknown>["content"] = (result.content ?? []).map((item) => {
        if (item.type === "text") {
          return { type: "text" as const, text: item.text };
        }
        if (item.type === "image") {
          return {
            type: "image" as const,
            data: item.data,
            mimeType: item.mimeType,
          };
        }
        // Fallback: stringify unknown content types
        return { type: "text" as const, text: JSON.stringify(item) };
      });

      if (result.isError) {
        // Prefix error content so the agent understands the tool failed
        const errorText = content.map((c) => ("text" in c ? c.text : "")).join("\n");
        return {
          content: [{ type: "text", text: `MCP tool returned an error:\n${errorText}` }],
          details: { isError: true } as unknown,
        };
      }

      return { content, details: null as unknown };
    },
  };
}
