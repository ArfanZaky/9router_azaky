/**
 * Server credentials for CLI OAuth flows
 * Used by services like Antigravity, Claude, Codex, etc.
 */
export function getServerCredentials() {
  return {
    server: process.env.API_SERVER_URL || "http://localhost:2026",
    token: process.env.API_SERVER_TOKEN || "",
    userId: process.env.API_USER_ID || "1",
  };
}

