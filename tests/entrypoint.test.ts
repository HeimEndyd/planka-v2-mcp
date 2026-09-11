import { describe, expect, test } from "@jest/globals";
import { selectTransport } from "../index.js";

describe("transport selection", () => {
  test("keeps STDIO as the default", () => {
    expect(selectTransport([], {})).toBe("stdio");
  });

  test("allows HTTP through an argument or the environment", () => {
    expect(selectTransport(["--transport=http"], {})).toBe("http");
    expect(selectTransport([], { MCP_TRANSPORT: "http" })).toBe("http");
  });

  test("rejects unsupported transports and unknown arguments", () => {
    expect(() => selectTransport(["--transport=sse"], {})).toThrow("Unsupported transport");
    expect(() => selectTransport(["--port=3000"], {})).toThrow("Unknown argument");
  });
});
