"use client";

import { useMemo, useState } from "react";
import { Lexer } from "marked";

function Inline({ tokens = [] }) {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "strong") return <strong key={key}><Inline tokens={token.tokens} /></strong>;
    if (token.type === "em") return <em key={key}><Inline tokens={token.tokens} /></em>;
    if (token.type === "codespan") return <code key={key} className="rounded bg-sidebar px-1.5 py-0.5 font-mono text-[0.9em]">{token.text}</code>;
    if (token.type === "br") return <br key={key} />;
    if (token.type === "del") return <del key={key}><Inline tokens={token.tokens} /></del>;
    if (token.type === "link") {
      const safe = /^(https?:|mailto:)/i.test(token.href || "") ? token.href : "#";
      return <a key={key} href={safe} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2"><Inline tokens={token.tokens} /></a>;
    }
    if (token.type === "image") {
      const safe = /^(https?:|data:image\/)/i.test(token.href || "") ? token.href : "";
      return safe ? <img key={key} src={safe} alt={token.text || "Image"} loading="lazy" className="my-2 max-h-80 rounded-xl border border-border object-contain" /> : null;
    }
    if (token.tokens) return <Inline key={key} tokens={token.tokens} />;
    return <span key={key}>{token.text || token.raw || ""}</span>;
  });
}

function CodeBlock({ token }) {
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
}

function Blocks({ tokens = [] }) {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "space") return null;
    if (token.type === "code") return <CodeBlock key={key} token={token} />;
    if (token.type === "heading") {
      const size = token.depth <= 2 ? "text-lg" : "text-base";
      return <div key={key} className={`${size} font-semibold tracking-tight`}><Inline tokens={token.tokens} /></div>;
    }
    if (token.type === "paragraph" || token.type === "text") return <p key={key} className="whitespace-pre-wrap break-words"><Inline tokens={token.tokens || [{ type: "text", text: token.text }]} /></p>;
    if (token.type === "blockquote") return <blockquote key={key} className="border-l-2 border-primary/50 pl-3 text-text-muted"><Blocks tokens={token.tokens} /></blockquote>;
    if (token.type === "hr") return <hr key={key} className="border-border" />;
    if (token.type === "list") {
      const Tag = token.ordered ? "ol" : "ul";
      return <Tag key={key} className={`${token.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>{token.items.map((item, i) => <li key={i}><Blocks tokens={item.tokens} /></li>)}</Tag>;
    }
    if (token.type === "table") return (
      <div key={key} className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs"><thead className="bg-sidebar"><tr>{token.header.map((cell, i) => <th key={i} className="px-3 py-2 text-left"><Inline tokens={cell.tokens} /></th>)}</tr></thead><tbody>{token.rows.map((row, r) => <tr key={r} className="border-t border-border">{row.map((cell, c) => <td key={c} className="px-3 py-2 align-top"><Inline tokens={cell.tokens} /></td>)}</tr>)}</tbody></table>
      </div>
    );
    return null;
  });
}

export default function ChatMarkdown({ content = "" }) {
  const tokens = useMemo(() => Lexer.lex(String(content || ""), { gfm: true, breaks: true }), [content]);
  return <div className="space-y-3 text-[14px] leading-6"><Blocks tokens={tokens} /></div>;
}
