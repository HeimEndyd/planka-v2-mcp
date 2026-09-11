import {
  getActivePlankaClient,
  type PlankaAuthTarget,
  type PlankaRequestOptions,
} from "./planka-client.js";

export type { PlankaAuthTarget, PlankaRequestOptions } from "./planka-client.js";

export function buildUrl(
  baseUrl: string,
  params: Record<string, string | number | undefined>,
): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.append(key, value.toString());
    }
  });
  return url.toString();
}

/**
 * Builds authentication headers without exposing credentials to MCP callers.
 * API keys work for both API and file routes. JWT download routes use the
 * accessToken cookie because Planka does not consume Authorization there.
 */
export async function getPlankaAuthHeaders(
  target: PlankaAuthTarget = "api",
): Promise<Record<string, string>> {
  return getActivePlankaClient().getAuthHeaders(target);
}

export async function plankaRequest(
  path: string,
  options: PlankaRequestOptions = {},
): Promise<unknown> {
  return getActivePlankaClient().request(path, options);
}

export function validateProjectName(name: string): string {
  const sanitized = name.trim();
  if (!sanitized) {
    throw new Error("Project name cannot be empty");
  }
  return sanitized;
}

export function validateBoardName(name: string): string {
  const sanitized = name.trim();
  if (!sanitized) {
    throw new Error("Board name cannot be empty");
  }
  return sanitized;
}

export function validateListName(name: string): string {
  const sanitized = name.trim();
  if (!sanitized) {
    throw new Error("List name cannot be empty");
  }
  return sanitized;
}

export function validateCardName(name: string): string {
  const sanitized = name.trim();
  if (!sanitized) {
    throw new Error("Card name cannot be empty");
  }
  return sanitized;
}

/**
 * Looks up a user ID by email
 *
 * @param {string} email - The email of the user to look up
 * @returns {Promise<string | null>} The user ID if found, null otherwise
 */
export async function getUserIdByEmail(email: string): Promise<string | null> {
  try {
    // Get all users
    const response = await plankaRequest("/api/users");
    const { items } = response as {
      items: Array<{ id: string; email: string }>;
    };

    // Find the user with the matching email
    const user = items.find((user) => user.email === email);
    return user ? user.id : null;
  } catch (error) {
    console.error(
      `Failed to get user ID by email: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Looks up a user ID by username
 *
 * @param {string} username - The username of the user to look up
 * @returns {Promise<string | null>} The user ID if found, null otherwise
 */
export async function getUserIdByUsername(username: string): Promise<string | null> {
  try {
    // Get all users
    const response = await plankaRequest("/api/users");
    const { items } = response as {
      items: Array<{ id: string; username: string }>;
    };

    // Find the user with the matching username
    const user = items.find((user) => user.username === username);
    return user ? user.id : null;
  } catch (error) {
    console.error(
      `Failed to get user ID by username: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
