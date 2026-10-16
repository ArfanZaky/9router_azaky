export function buildUserContent(message) {
  if (!message) return "";
  const text =
    typeof message === "string"
      ? message.trim()
      : typeof message.content === "string"
      ? message.content.trim()
      : message.content || "";

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length === 0) return text;

  const content = [];
  if (text) content.push({ type: "text", text });
  for (const attachment of attachments) {
    if (attachment?.dataUrl) {
      content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
    }
  }
  return content.length > 0 ? content : text;
}
