import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "@jest/globals";
import { readEnvironmentSecret } from "../common/secrets.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("readEnvironmentSecret", () => {
  test("reads and trims a mounted secret file", () => {
    const directory = mkdtempSync(join(tmpdir(), "planka-mcp-secret-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "token");
    writeFileSync(path, "file-backed-value\n", { mode: 0o600 });

    expect(readEnvironmentSecret("EXAMPLE_TOKEN", { EXAMPLE_TOKEN_FILE: path })).toBe(
      "file-backed-value",
    );
  });

  test("rejects conflicting direct and file sources without exposing either value", () => {
    const directory = mkdtempSync(join(tmpdir(), "planka-mcp-secret-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "token");
    writeFileSync(path, "file-secret", { mode: 0o600 });

    expect(() =>
      readEnvironmentSecret("EXAMPLE_TOKEN", {
        EXAMPLE_TOKEN: "direct-secret",
        EXAMPLE_TOKEN_FILE: path,
      }),
    ).toThrow("EXAMPLE_TOKEN and EXAMPLE_TOKEN_FILE cannot both be configured");
  });

  test("rejects an empty mounted secret", () => {
    const directory = mkdtempSync(join(tmpdir(), "planka-mcp-secret-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "token");
    writeFileSync(path, "\n", { mode: 0o600 });

    expect(() => readEnvironmentSecret("EXAMPLE_TOKEN", { EXAMPLE_TOKEN_FILE: path })).toThrow(
      "points to an empty secret file",
    );
  });

  test("can preserve password whitespace while removing the file newline", () => {
    const directory = mkdtempSync(join(tmpdir(), "planka-mcp-secret-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "password");
    writeFileSync(path, " leading and trailing \n", { mode: 0o600 });

    expect(readEnvironmentSecret("PASSWORD", { PASSWORD_FILE: path }, true)).toBe(
      " leading and trailing ",
    );
    expect(readEnvironmentSecret("PASSWORD", { PASSWORD: " direct " }, true)).toBe(" direct ");
  });
});
