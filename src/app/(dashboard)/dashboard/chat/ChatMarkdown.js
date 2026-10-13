"use client";

import { memo, useMemo, useState } from "react";
import { Lexer } from "marked";

function resolveMediaUrl(href = "") {
  const raw = String(href || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|https?:\/\/|\/api\/)/i.test(raw)) return raw;
  if (/^\/?public\//i.test(raw)) return raw.replace(/^\/?public\//i, "/");
  const cleaned = raw.replace(/^\.\//, "").replace(/^[\\\/]+/, "");
  return `/api/chat/files?path=${encodeURIComponent(cleaned)}`;
}

function collectRenderedImages(tokens) {
  const set = new Set();
  function walk(list) {
    for (const t of list || []) {
      if ((t.type === "image" || t.type === "link") && t.href) {
        set.add(t.href);
        set.add(t.href.replace(/^[\\\/]+/, ""));
        const base = t.href.split("/").pop()?.split("\\").pop();
        if (base) set.add(base);
      }
      if (t.tokens) walk(t.tokens);
      if (t.items) {
        for (const item of t.items) {
          if (item.tokens) walk(item.tokens);
        }
      }
    }
  }
  walk(tokens);
  return set;
}

function extractMediaArtifacts(text, renderedHrefs = new Set()) {
  const raw = String(text || "");
  const dirMatch = raw.match(/\b(output\/[a-zA-Z0-9_\-\/]+)/i);
  const baseDir = dirMatch ? dirMatch[1].replace(/\/+$/, "") : "";
  const fileRegex = /\b([a-zA-Z0-9_\-\.\/\\:]+\.(?:png|jpe?g|gif|webp|svg))\b/gi;
  const matches = raw.matchAll(fileRegex);
  const found = new Map();
  for (const m of matches) {
    const rawFile = m[1].replace(/^[\\\/]+/, "");
    let fullPath = rawFile;
    if (!rawFile.includes("/") && !rawFile.includes("\\") && baseDir) {
      fullPath = `${baseDir}/${rawFile}`;
    }
    const filename = rawFile.split("/").pop().split("\\").pop();
    if (renderedHrefs.has(fullPath) || renderedHrefs.has(rawFile) || renderedHrefs.has(filename)) {
      continue;
    }
    if (!found.has(fullPath)) {
      found.set(fullPath, {
        name: filename,
        path: fullPath,
        src: resolveMediaUrl(fullPath),
      });
    }
  }
  return Array.from(found.values());
}

const Inline = memo(function Inline({ tokens = [], onImageClick }) {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "strong") return <strong key={key}><Inline tokens={token.tokens} onImageClick={onImageClick} /></strong>;
    if (token.type === "em") return <em key={key}><Inline tokens={token.tokens} onImageClick={onImageClick} /></em>;
    if (token.type === "codespan") return <code key={key} className="rounded bg-sidebar px-1.5 py-0.5 font-mono text-[0.9em]">{token.text}</code>;
    if (token.type === "br") return <br key={key} />;
    if (token.type === "del") return <del key={key}><Inline tokens={token.tokens} onImageClick={onImageClick} /></del>;
    if (token.type === "link") {
      const isMedia = /\.(png|jpe?g|gif|webp|svg)($|\?)/i.test(token.href || "");
      if (isMedia) {
        const src = resolveMediaUrl(token.href);
        const name = token.text || token.href.split("/").pop();
        return (
          <span key={key} className="my-1 mr-2 inline-block align-middle">
            <img
              src={src}
              alt={name}
              loading="lazy"
              onClick={() => onImageClick && onImageClick(src, name)}
              className="max-h-48 max-w-xs cursor-pointer rounded-xl border border-border object-contain shadow-md transition hover:opacity-90 active:scale-[0.99] [image-rendering:pixelated]"
            />
          </span>
        );
      }
      const safe = /^(https?:|mailto:|\/)/i.test(token.href || "") ? token.href : "#";
      return <a key={key} href={safe} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2"><Inline tokens={token.tokens} onImageClick={onImageClick} /></a>;
    }
    if (token.type === "image") {
      const src = resolveMediaUrl(token.href);
      const name = token.text || token.href.split("/").pop() || "Image";
      return src ? (
        <img
          key={key}
          src={src}
          alt={name}
          loading="lazy"
          onClick={() => onImageClick && onImageClick(src, name)}
          className="my-2 max-h-96 rounded-xl border border-border object-contain shadow-md cursor-pointer transition hover:opacity-90 active:scale-[0.99] [image-rendering:pixelated]"
        />
      ) : null;
    }
    if (token.tokens) return <Inline key={key} tokens={token.tokens} onImageClick={onImageClick} />;
    return <span key={key}>{token.text || token.raw || ""}</span>;
  });
});

const CodeBlock = memo(function CodeBlock({ token }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(token.text || "").catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-sidebar/50 px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted">
        <span>{token.lang || "text"}</span>
        <button type="button" onClick={copy} className="hover:text-primary">{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-5"><code>{token.text}</code></pre>
    </div>
  );
});

const Blocks = memo(function Blocks({ tokens = [], onImageClick }) {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "space") return null;
    if (token.type === "code") return <CodeBlock key={key} token={token} />;
    if (token.type === "heading") {
      const size = token.depth <= 2 ? "text-lg" : "text-base";
      return <div key={key} className={`${size} font-semibold tracking-tight`}><Inline tokens={token.tokens} onImageClick={onImageClick} /></div>;
    }
    if (token.type === "paragraph" || token.type === "text") return <p key={key} className="whitespace-pre-wrap break-words"><Inline tokens={token.tokens || [{ type: "text", text: token.text }]} onImageClick={onImageClick} /></p>;
    if (token.type === "blockquote") return <blockquote key={key} className="border-l-2 border-primary/50 pl-3 text-text-muted"><Blocks tokens={token.tokens} onImageClick={onImageClick} /></blockquote>;
    if (token.type === "hr") return <hr key={key} className="border-border" />;
    if (token.type === "list") {
      const Tag = token.ordered ? "ol" : "ul";
      return <Tag key={key} className={`${token.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>{token.items.map((item, i) => <li key={i}><Blocks tokens={item.tokens} onImageClick={onImageClick} /></li>)}</Tag>;
    }
    if (token.type === "table") return (
      <div key={key} className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs"><thead className="bg-sidebar"><tr>{token.header.map((cell, i) => <th key={i} className="px-3 py-2 text-left"><Inline tokens={cell.tokens} onImageClick={onImageClick} /></th>)}</tr></thead><tbody>{token.rows.map((row, r) => <tr key={r} className="border-t border-border">{row.map((cell, c) => <td key={c} className="px-3 py-2 align-top"><Inline tokens={cell.tokens} onImageClick={onImageClick} /></td>)}</tr>)}</tbody></table>
      </div>
    );
    return null;
  });
});

function ChatMarkdownComponent({ content = "", onImageClick }) {
  const tokens = useMemo(() => Lexer.lex(String(content || ""), { gfm: true, breaks: true }), [content]);
  const renderedImages = useMemo(() => collectRenderedImages(tokens), [tokens]);
  const detectedMedia = useMemo(() => extractMediaArtifacts(content, renderedImages), [content, renderedImages]);

  return (
    <div className="space-y-3 text-[14px] leading-6">
      <Blocks tokens={tokens} onImageClick={onImageClick} />
      {detectedMedia.length > 0 && (
        <div className="mt-3 border-t border-border/70 pt-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-text-muted">
            <span className="material-symbols-outlined text-[15px] text-primary">imagesmode</span>
            Generated Media
          </div>
          <div className="flex flex-wrap gap-2.5">
            {detectedMedia.map((media, i) => (
              <div
                key={i}
                className="group relative flex flex-col items-center rounded-xl border border-border bg-sidebar/70 p-2 transition hover:border-primary/50"
              >
                <img
                  src={media.src}
                  alt={media.name}
                  loading="lazy"
                  onError={(e) => {
                    const card = e.currentTarget.closest(".group");
                    if (card) card.style.display = "none";
                  }}
                  onClick={() => onImageClick && onImageClick(media.src, media.name)}
                  className="h-28 max-w-[12rem] cursor-pointer rounded-lg bg-background/50 object-contain transition hover:opacity-95 active:scale-[0.99] [image-rendering:pixelated]"
                />
                <span className="mt-1.5 max-w-[11rem] truncate font-mono text-[10px] text-text-muted group-hover:text-text-main" title={media.name}>
                  {media.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ChatMarkdownComponent);
