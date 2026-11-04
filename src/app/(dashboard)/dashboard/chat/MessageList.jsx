"use client";

import { memo, useState } from "react";
import { Spinner } from "@/shared/components";
import ChatMarkdown from "./ChatMarkdown";
import ChatToolCard from "./ChatToolCard";
import { groupMessageSegments } from "@/lib/chat/segmentGrouping";

export { groupMessageSegments };

function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function updateOrAppendSegment(segments, type, content, extra = {}) {
  const next = [...(segments || [])];
  if (type === "text" || type === "reasoning") {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].type === "tool") break;
      if (next[i].type === type) {
        next[i] = { ...next[i], content, ...extra };
        return next;
      }
    }
  }
  next.push({ type, content, ...extra });
  return next;
}

function ChatActivityGroup({ items, isStreamingMessage, messageCreatedAt }) {
  const hasRunningTool = items.some((it) => it.type === "tool" && it.status === "running");
  const lastItem = items[items.length - 1];
  const isStreamingReasoning = isStreamingMessage && lastItem?.type === "reasoning";
  const isActive = hasRunningTool || isStreamingReasoning;

  const toolItems = items.filter((it) => it.type === "tool");
  const reasoningItems = items.filter((it) => it.type === "reasoning");
  const toolNames = [...new Set(toolItems.map((t) => t.name || "tool"))];

  const labelParts = [];
  if (reasoningItems.length > 0) {
    labelParts.push(isStreamingReasoning ? "Thinking…" : "Reasoning");
  }
  if (toolItems.length > 0) {
    labelParts.push(`${toolItems.length} tool${toolItems.length > 1 ? "s" : ""}`);
  }
  const summaryTitle = labelParts.join(" · ") || "Activity";
  const runningTool = toolItems.find((t) => t.status === "running");

  return (
    <details
      key={isActive ? "activity-open" : "activity-closed"}
      className="group/activity rounded-xl border border-border bg-background/40 overflow-hidden"
      open={isActive || undefined}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-text-muted hover:bg-sidebar/50 transition flex items-center justify-between gap-2 list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={`material-symbols-outlined text-[15px] shrink-0 ${
              isActive ? "animate-spin text-primary" : "text-primary/80"
            }`}
          >
            {isActive ? "progress_activity" : reasoningItems.length > 0 && toolItems.length === 0 ? "psychology" : "account_tree"}
          </span>
          <span className="font-semibold text-text-main shrink-0">{summaryTitle}</span>
          {runningTool ? (
            <span className="truncate font-mono text-[10px] text-primary">
              running {runningTool.name}…
            </span>
          ) : toolNames.length > 0 ? (
            <span className="truncate font-mono text-[10px] text-text-muted opacity-80">
              ({toolNames.slice(0, 4).join(", ")}{toolNames.length > 4 ? ` +${toolNames.length - 4}` : ""})
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {lastItem?.timestamp ? (
            <span className="font-mono text-[10px] opacity-70">{formatMessageTime(lastItem.timestamp)}</span>
          ) : null}
          <span className="material-symbols-outlined text-[15px] text-text-muted transition-transform duration-150 group-open/activity:rotate-180">
            expand_more
          </span>
        </div>
      </summary>

      <div className="border-t border-border/70 bg-background/25 px-2.5 py-2 space-y-2">
        {items.map((item, idx) => {
          const isLastInGroup = idx === items.length - 1;
          if (item.type === "reasoning") {
            const streamingHere = isStreamingMessage && isLastInGroup;
            return (
              <details
                key={`reasoning-${item.originalIndex ?? idx}`}
                className="rounded-lg border border-border/70 bg-background/50 px-3 py-1.5"
                open={streamingHere || items.length === 1 || undefined}
              >
                <summary className="cursor-pointer text-[11px] font-medium text-text-muted flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className={`material-symbols-outlined text-[13px] ${streamingHere ? "animate-spin text-primary" : ""}`}>
                      psychology
                    </span>
                    <span>{streamingHere ? "Thinking…" : "Thought process"}</span>
                  </span>
                  {item.timestamp ? (
                    <span className="font-mono text-[10px] opacity-70">{formatMessageTime(item.timestamp)}</span>
                  ) : null}
                </summary>
                <div className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-text-muted max-h-60 overflow-y-auto custom-scrollbar">
                  {item.content}
                  {streamingHere ? <span className="inline-block animate-pulse ml-0.5 text-primary">▋</span> : null}
                </div>
              </details>
            );
          }

          if (item.type === "tool") {
            return (
              <ChatToolCard
                key={item.callId || `tool-${item.originalIndex ?? idx}`}
                segment={item}
                messageCreatedAt={messageCreatedAt}
              />
            );
          }
          return null;
        })}
      </div>
    </details>
  );
}

// ── Memoized Message Row Component (Zero Re-render on Typing) ─────────────────
export const ChatMessageRow = memo(function ChatMessageRow({
  message,
  globalIndex,
  activeSessionModel,
  isSending,
  viewMode,
  showReasoning,
  onCopy,
  onEdit,
  onRegenerate,
  onImageClick,
}) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";
  const content = textValue(message.content);
  const msgTime = formatMessageTime(message.createdAt);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(content);

  if (isSystem) {
    const isCompactSummary = message.name === "compact_summary";
    return (
      <div data-chat-message-index={globalIndex} className="flex justify-start">
        <div
          className={`max-w-[min(92%,42rem)] w-full rounded-xl border px-3.5 py-2.5 ${
            isCompactSummary
              ? "border-primary/30 bg-primary/5"
              : "border-border bg-background/40"
          }`}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className={`material-symbols-outlined text-[14px] ${isCompactSummary ? "text-primary" : ""}`}>
                {isCompactSummary ? "compress" : "terminal"}
              </span>
              <span className={isCompactSummary ? "text-primary" : ""}>
                {isCompactSummary ? "Compacted Context Summary" : "Command"}
              </span>
              {isCompactSummary && message.tokenUsage?.prompt_tokens ? (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-medium text-primary">
                  ~{message.tokenUsage.prompt_tokens} tokens
                </span>
              ) : null}
            </span>
            <div className="flex items-center gap-1.5">
              {msgTime ? <span className="font-mono text-[10px] font-normal opacity-70">{msgTime}</span> : null}
              <button
                type="button"
                className="material-symbols-outlined text-[14px] opacity-60 hover:opacity-100 transition cursor-pointer"
                onClick={() => onCopy(content)}
                title="Copy"
              >
                content_copy
              </button>
            </div>
          </div>
          {isCompactSummary ? (
            <div className="max-h-72 overflow-auto custom-scrollbar text-xs leading-5 text-text-main">
              <ChatMarkdown content={content} onImageClick={onImageClick} />
            </div>
          ) : (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-muted">{content}</pre>
          )}
        </div>
      </div>
    );
  }

  if (isTool) {
    const preview = content.length > 1200 ? `${content.slice(0, 1200)}\n…` : content;
    return (
      <div data-chat-message-index={globalIndex} className="flex justify-start">
        <div className="max-w-[min(92%,42rem)] w-full rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            <span className="material-symbols-outlined text-[14px]">
              {message.status === "running" ? "progress_activity" : "build"}
            </span>
            <span>tool · {message.name || "unknown"}</span>
            <span className="opacity-60 font-normal">
              {message.status === "running" ? "running…" : "done"}
            </span>
            {msgTime ? <span className="font-mono text-[10px] font-normal opacity-70">{msgTime}</span> : null}
            <button
              type="button"
              className="ml-auto material-symbols-outlined text-[14px] opacity-60 hover:opacity-100 transition cursor-pointer"
              onClick={() => onCopy(content)}
              title="Copy output"
            >
              content_copy
            </button>
          </div>
          <pre className="mt-1.5 max-h-48 overflow-auto custom-scrollbar whitespace-pre-wrap break-words text-[11px] leading-5 text-text-muted font-mono">
            {preview}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div data-chat-message-index={globalIndex} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(92%,42rem)] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-primary text-white"
            : message.status === "error"
              ? "bg-red-500/10 border border-red-500/20"
              : "bg-sidebar border border-border"
        }`}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold opacity-80 flex items-center gap-2">
            <span>{isUser ? "You" : activeSessionModel || "Assistant"}</span>
            {msgTime ? <span className="font-mono text-[10px] font-normal opacity-70">{msgTime}</span> : null}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="material-symbols-outlined text-[14px] opacity-60 hover:opacity-100 transition cursor-pointer"
              onClick={() => onCopy(content)}
              title="Copy"
            >
              content_copy
            </button>
            {isUser ? (
              <button
                type="button"
                className="material-symbols-outlined text-[14px] opacity-60 hover:opacity-100 transition cursor-pointer"
                onClick={() => {
                  setEditValue(content);
                  setIsEditing(true);
                }}
                title="Edit and resend"
                disabled={isSending}
              >
                edit
              </button>
            ) : null}
            {!isUser ? (
              <button
                type="button"
                className="material-symbols-outlined text-[14px] opacity-60 hover:opacity-100 transition cursor-pointer"
                onClick={onRegenerate}
                title="Regenerate"
                disabled={isSending}
              >
                refresh
              </button>
            ) : null}
          </div>
        </div>
        {message.attachments?.length ? (
          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {message.attachments.map((a) => (
              <button
                key={a.id || a.name}
                type="button"
                onClick={() => a.dataUrl && onImageClick(a.dataUrl, a.name || "Image")}
                className="overflow-hidden rounded-lg border border-white/10 text-left hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                title="View image"
              >
                <img src={a.dataUrl} alt={a.name} className="h-24 w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        {viewMode === "raw" && message.tool_calls?.length && !message.segments?.some((s) => s.type === "tool") ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.tool_calls.map((tc) => (
              <span
                key={tc.id}
                className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-text-muted"
              >
                {tc.function?.name || "tool"}
              </span>
            ))}
          </div>
        ) : null}
        <div>
          {!isUser && message.segments?.length ? (
            <div className="space-y-3">
              {groupMessageSegments(message.segments, { showReasoning, viewMode }).map((group, gIdx) => {
                if (group.kind === "activity") {
                  return (
                    <ChatActivityGroup
                      key={`activity-${gIdx}`}
                      items={group.items}
                      isStreamingMessage={message.status === "streaming" || message.status === "tool_calls"}
                      messageCreatedAt={message.createdAt}
                    />
                  );
                }
                const isLastSegment = group.originalIndex === message.segments.length - 1;
                const isStreamingHere = message.status === "streaming" && isLastSegment;
                return (
                  <div key={`text-${group.originalIndex ?? gIdx}`} className="relative">
                    <ChatMarkdown content={group.segment.content} onImageClick={onImageClick} />
                    {isStreamingHere ? <span className="inline-block animate-pulse ml-0.5 text-primary">▋</span> : null}
                  </div>
                );
              })}
              {!message.segments.some((s) => s.type === "text" && s.content) && content ? (
                <div className="relative">
                  <ChatMarkdown content={content} onImageClick={onImageClick} />
                  {(message.status === "streaming" || message.status === "tool_calls") ? (
                    <span className="inline-block animate-pulse ml-0.5 text-primary">▋</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : isUser ? (
            isEditing ? (
              <div className="space-y-2 min-w-[min(72vw,28rem)]">
                <textarea
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setIsEditing(false);
                    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      if (editValue.trim() && editValue.trim() !== content.trim()) {
                        onEdit(message, editValue.trim());
                      }
                      setIsEditing(false);
                    }
                  }}
                  rows={Math.min(8, Math.max(2, editValue.split("\n").length))}
                  className="w-full rounded-xl border border-white/25 bg-black/20 px-3 py-2 text-sm text-white placeholder-white/60 outline-none focus:border-white/60 resize-y"
                />
                <div className="flex items-center justify-end gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="rounded-lg border border-white/20 px-2.5 py-1 text-white/80 hover:bg-white/10 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (editValue.trim() && editValue.trim() !== content.trim()) {
                        onEdit(message, editValue.trim());
                      }
                      setIsEditing(false);
                    }}
                    disabled={!editValue.trim() || editValue.trim() === content.trim()}
                    className="rounded-lg bg-white px-2.5 py-1 font-semibold text-primary hover:bg-white/90 transition disabled:opacity-50 cursor-pointer"
                  >
                    Save & Resend
                  </button>
                </div>
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words text-[14px] leading-6">{content}</div>
            )
          ) : (
            <div>
              <ChatMarkdown content={content} onImageClick={onImageClick} />
              {(message.status === "streaming" || message.status === "tool_calls") ? (
                <span className="inline-block animate-pulse ml-0.5 text-primary">▋</span>
              ) : null}
            </div>
          )}
        </div>
        {message.tokenUsage ? (
          <p className="mt-2 text-[10px] opacity-60">
            tokens: {message.tokenUsage.total_tokens ||
              (message.tokenUsage.prompt_tokens || 0) +
                (message.tokenUsage.completion_tokens || 0)}
          </p>
        ) : null}
      </div>
    </div>
  );
});

function MessageList({
  messages,
  visibleMessages,
  activeSessionModel,
  isSending,
  viewMode,
  showReasoning,
  transcriptScrollRef,
  onTranscriptScroll,
  bottomRef,
  showScrollBottomBtn,
  onJumpToBottom,
  onSetDraft,
  onCopy,
  onEditMessage,
  onRegenerate,
  onImageClick,
  isLoading = false,
}) {
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={transcriptScrollRef}
        onScroll={onTranscriptScroll}
        className="flex-1 overflow-y-auto custom-scrollbar px-3 py-4 lg:px-6"
      >
        {isLoading ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center text-center gap-3">
            <Spinner size="lg" />
            <span className="text-xs text-text-muted font-medium">Loading chat…</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center text-center gap-4">
            <div className="size-14 rounded-2xl border border-border bg-sidebar flex items-center justify-center">
              <span className="material-symbols-outlined text-[28px] text-primary">chat</span>
            </div>
            <div>
              <h2 className="text-xl font-semibold">Start a conversation</h2>
              <p className="mt-1 text-sm text-text-muted max-w-md">
                Multi-session chat over your connected providers. History is stored in SQLite and cached locally in IndexedDB.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {[
                "Explain this error and propose a fix",
                "Write a unit test for this function",
                "Review this design for hidden risks",
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => onSetDraft(chip)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-sidebar transition cursor-pointer"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
            {visibleMessages.map((message, idx) => (
              <ChatMessageRow
                key={message.id}
                message={message}
                globalIndex={idx}
                activeSessionModel={activeSessionModel}
                isSending={isSending}
                viewMode={viewMode}
                showReasoning={showReasoning}
                onCopy={onCopy}
                onEdit={onEditMessage}
                onRegenerate={onRegenerate}
                onImageClick={onImageClick}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {showScrollBottomBtn && !isLoading && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
          <button
            type="button"
            onClick={onJumpToBottom}
            className="flex items-center gap-1.5 rounded-full border border-primary/35 bg-surface/95 backdrop-blur-md px-3.5 py-1.5 text-xs font-medium text-text-main shadow-lg hover:bg-surface-2 hover:border-primary/60 transition-all cursor-pointer"
            title="Scroll to bottom"
          >
            <span className="material-symbols-outlined text-[16px] text-primary">arrow_downward</span>
            <span>Latest messages</span>
            {isSending && (
              <span className="relative flex size-2 ml-0.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(MessageList);
