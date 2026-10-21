// A continuation can provide new durable facts, even if its user text is short.
const ROUTINE_REPLY = /^(hi|hello|hey|halo|test|ok|oke|sip|thanks|terima kasih)[\s.!]*$/i;

export function reflectionSkipReason({ mode, workspace, apiKey, userText, content }) {
  if (mode !== "agent") return "agent mode is off";
  if (!workspace || !apiKey) return "workspace or API key unavailable";
  if (!String(content || "").trim()) return "assistant response is empty";
  if (!String(userText || "").trim() || ROUTINE_REPLY.test(String(userText).trim())) return "routine message";
  return null;
}
