import { readFileSync } from "node:fs";

export function readEnvironmentSecret(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
  preserveWhitespace = false,
): string | undefined {
  const rawDirectValue = environment[name];
  const directValue = preserveWhitespace ? rawDirectValue : rawDirectValue?.trim();
  const fileVariable = `${name}_FILE`;
  const filePath = environment[fileVariable]?.trim();

  if (directValue && filePath) {
    throw new Error(`${name} and ${fileVariable} cannot both be configured`);
  }

  if (directValue) {
    return directValue;
  }

  if (!filePath) {
    return undefined;
  }

  let fileValue: string;
  try {
    const rawFileValue = readFileSync(filePath, "utf8");
    fileValue = preserveWhitespace ? rawFileValue.replace(/\r?\n$/, "") : rawFileValue.trim();
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${fileVariable}: ${reason}`);
  }

  if (!fileValue) {
    throw new Error(`${fileVariable} points to an empty secret file`);
  }

  return fileValue;
}
