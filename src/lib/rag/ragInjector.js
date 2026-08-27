/**
 * RAG Context Injector for Chat API Requests.
 * Checks request body for `knowledge_base_ids` or `kb_ids` and injects retrieved context into system prompt.
 */
import { retrieveContext } from "@/lib/knowledge/ragRetriever.js";

export async function injectKnowledgeContext(body, baseUrl) {
  if (!body) return body;

  const kbIds = body.knowledge_base_ids || body.kb_ids || body.knowledge_bases;
  if (!Array.isArray(kbIds) || kbIds.length === 0) return body;

  // Extract user query from last user message
  const messages = body.messages || [];
  let userQuery = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      userQuery = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map(p => p.text || "").join(" ") : "";
      break;
    }
  }

  if (!userQuery.trim()) return body;

  try {
    const { context } = await retrieveContext(userQuery, kbIds, { baseUrl });
    if (!context) return body;

    // Inject into system prompt or first system message
    const updatedMessages = [...messages];
    const systemIdx = updatedMessages.findIndex((m) => m.role === "system");

    if (systemIdx >= 0) {
      const existing = updatedMessages[systemIdx].content;
      updatedMessages[systemIdx] = {
        ...updatedMessages[systemIdx],
        content: `${existing}\n\n${context}`,
      };
    } else {
      updatedMessages.unshift({
        role: "system",
        content: `You have access to the following relevant knowledge base excerpts to help answer the user:\n\n${context}`,
      });
    }

    return {
      ...body,
      messages: updatedMessages,
    };
  } catch (err) {
    console.error("[RAG] Failed to inject knowledge context:", err.message);
    return body;
  }
}
