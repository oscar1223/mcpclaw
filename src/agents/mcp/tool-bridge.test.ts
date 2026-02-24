import { describe, expect, it, vi } from "vitest";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { mcpToolToAgentTool } from "./tool-bridge.js";

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: "my_tool",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
    },
    ...overrides,
  };
}

function makeCallResult(overrides: Partial<CallToolResult> = {}): CallToolResult {
  return {
    content: [{ type: "text", text: "hello" }],
    ...overrides,
  };
}

describe("mcpToolToAgentTool", () => {
  it("formats tool name with double-underscore prefix", () => {
    const tool = mcpToolToAgentTool("myserver", makeTool(), vi.fn());
    expect(tool.name).toBe("mcp__myserver__my_tool");
  });

  it("includes server name in description", () => {
    const tool = mcpToolToAgentTool("myserver", makeTool({ description: "Does a thing" }), vi.fn());
    expect(tool.description).toBe("[MCP:myserver] Does a thing");
  });

  it("falls back to tool name in description when no description provided", () => {
    const tool = mcpToolToAgentTool("myserver", makeTool({ description: undefined }), vi.fn());
    expect(tool.description).toBe("[MCP:myserver] my_tool");
  });

  it("passes through inputSchema to parameters", () => {
    const inputSchema = {
      type: "object" as const,
      properties: { x: { type: "string" } },
    };
    const tool = mcpToolToAgentTool("myserver", makeTool({ inputSchema }), vi.fn());
    // TypeBox Type.Unsafe wraps the schema as-is
    expect(tool.parameters).toMatchObject(inputSchema);
  });

  it("uses empty object schema when inputSchema is missing", () => {
    const mcp = makeTool();
    // @ts-expect-error — force undefined to test fallback
    mcp.inputSchema = undefined;
    const tool = mcpToolToAgentTool("myserver", mcp, vi.fn());
    expect(tool.parameters).toMatchObject({ type: "object", properties: {} });
  });

  it("converts text content from call result", async () => {
    const callFn = vi.fn<() => Promise<CallToolResult>>().mockResolvedValue(
      makeCallResult({ content: [{ type: "text", text: "result text" }] }),
    );
    const tool = mcpToolToAgentTool("myserver", makeTool(), callFn);
    const result = await tool.execute!("id1", { query: "hello" }, undefined, undefined);
    expect(result.content).toEqual([{ type: "text", text: "result text" }]);
  });

  it("converts image content from call result", async () => {
    const callFn = vi.fn<() => Promise<CallToolResult>>().mockResolvedValue(
      makeCallResult({
        content: [{ type: "image", data: "base64data", mimeType: "image/png" }],
      }),
    );
    const tool = mcpToolToAgentTool("myserver", makeTool(), callFn);
    const result = await tool.execute!("id2", {}, undefined, undefined);
    expect(result.content).toEqual([
      { type: "image", data: "base64data", mimeType: "image/png" },
    ]);
  });

  it("wraps error result when isError is true", async () => {
    const callFn = vi.fn<() => Promise<CallToolResult>>().mockResolvedValue(
      makeCallResult({
        isError: true,
        content: [{ type: "text", text: "something went wrong" }],
      }),
    );
    const tool = mcpToolToAgentTool("myserver", makeTool(), callFn);
    const result = await tool.execute!("id3", {}, undefined, undefined);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "MCP tool returned an error",
    );
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "something went wrong",
    );
  });

  it("returns error content when callFn throws", async () => {
    const callFn = vi.fn<() => Promise<CallToolResult>>().mockRejectedValue(
      new Error("network failure"),
    );
    const tool = mcpToolToAgentTool("myserver", makeTool(), callFn);
    const result = await tool.execute!("id4", {}, undefined, undefined);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("network failure");
  });

  it("passes tool name (not prefixed) to callFn", async () => {
    const callFn = vi.fn<() => Promise<CallToolResult>>().mockResolvedValue(makeCallResult());
    const tool = mcpToolToAgentTool("myserver", makeTool({ name: "do_thing" }), callFn);
    await tool.execute!("id5", { x: 1 }, undefined, undefined);
    expect(callFn).toHaveBeenCalledWith("do_thing", { x: 1 }, undefined);
  });
});
