/**
 * Claude/Antigravity reject tool_result whose tool_use_id has no matching
 * tool_use in the immediately preceding assistant message.
 * Drop orphan tools + incomplete tool_call turns before sending upstream.
 */
export function sanitizeToolHistory(messages = []) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m?.role) continue;

    if (m.role === "tool") {
      const callId = m.tool_call_id || m.id;
      let prev = null;
      for (let j = out.length - 1; j >= 0; j--) {
        if (out[j].role !== "tool") {
          prev = out[j];
          break;
        }
      }
      const ids = new Set(
        (prev?.role === "assistant" && Array.isArray(prev.tool_calls)
          ? prev.tool_calls.map((tc) => tc.id)
          : []
        ).filter(Boolean)
      );
      if (!callId || !ids.has(callId)) continue;
      out.push({
        role: "tool",
        tool_call_id: callId,
        content:
          typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
      });
      continue;
    }

    if (m.role === "assistant") {
      const msg = {
        role: "assistant",
        content: m.content ?? "",
      };
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const followingIds = new Set();
        for (let k = i + 1; k < messages.length; k++) {
          const n = messages[k];
          if (n?.role === "tool") {
            const id = n.tool_call_id || n.id;
            if (id) followingIds.add(id);
            continue;
          }
          break;
        }
        const kept = m.tool_calls
          .filter((tc) => tc?.id && followingIds.has(tc.id))
          .map((tc) => ({
            id: tc.id,
            type: tc.type || "function",
            function: {
              name: tc.function?.name || tc.name || "tool",
              arguments:
                typeof tc.function?.arguments === "string"
                  ? tc.function.arguments
                  : JSON.stringify(tc.function?.arguments ?? tc.arguments ?? {}),
            },
          }));
        if (kept.length) msg.tool_calls = kept;
        if (!kept.length && !String(msg.content || "").trim()) continue;
      }
      out.push(msg);
      continue;
    }

    if (m.role === "user") {
      out.push({ role: "user", content: m.content ?? "" });
      continue;
    }

    if (m.role === "system") {
      out.push({ role: "system", content: m.content ?? "" });
    }
  }

  const final = [];
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const needed = new Set(m.tool_calls.map((tc) => tc.id));
      const tools = [];
      let j = i + 1;
      while (j < out.length && out[j].role === "tool") {
        tools.push(out[j]);
        needed.delete(out[j].tool_call_id);
        j++;
      }
      if (needed.size > 0) {
        const textOnly = { role: "assistant", content: m.content || "" };
        if (String(textOnly.content).trim()) final.push(textOnly);
        i = j - 1;
        continue;
      }
      final.push(m);
      for (const t of tools) final.push(t);
      i = j - 1;
      continue;
    }
    if (m.role === "tool") continue;
    final.push(m);
  }
  return final;
}
