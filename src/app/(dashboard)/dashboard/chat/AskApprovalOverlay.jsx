"use client";

import { memo, useState } from "react";
import { Button } from "@/shared/components";

function AskWizard({ ask, onAnswer }) {
  const questions = Array.isArray(ask.questions) ? ask.questions.filter((q) => q && q.question) : [];
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [custom, setCustom] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (questions.length === 0) return null;

  const q = questions[idx];
  const isLast = idx === questions.length - 1;
  const multi = !!q.multiSelect;
  const selected = answers[idx] || [];

  const commitCustom = (base) => {
    const v = custom.trim();
    if (!v) return base;
    const cur = base[idx] || [];
    return multi ? { ...base, [idx]: [...cur.filter((x) => x !== v), v] } : { ...base, [idx]: [v] };
  };

  const submit = (final) => {
    const all = final || answers;
    const lines = questions.map((qq, i) => {
      const a = all[i]?.length ? all[i].join(", ") : "(no answer)";
      return `${qq.header || qq.question}: ${a}`;
    });
    setSubmitted(true);
    onAnswer(questions.length === 1 ? (all[0]?.join(", ") || "") : lines.join("\n"));
  };

  const toggleOption = (o) => {
    if (multi) {
      setAnswers((a) => ({ ...a, [idx]: selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o] }));
    } else {
      const next = { ...answers, [idx]: [o] };
      setAnswers(next);
      if (questions.length === 1) submit(next);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
        <p className="text-[11px] text-text-muted">Answered ✓</p>
      </div>
    );
  }

  const hasOptions = (q.options || []).length > 0;

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="material-symbols-outlined text-[20px] text-primary">help</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {q.header ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">{q.header}</span>
            ) : null}
            {questions.length > 1 ? (
              <span className="text-[11px] text-text-muted">{idx + 1}/{questions.length}</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm font-medium">{q.question}</p>

          {hasOptions ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {q.options.map((o) => (
                <Button
                  key={o}
                  size="sm"
                  variant={selected.includes(o) ? "secondary" : "outline"}
                  onClick={() => toggleOption(o)}
                >
                  {o}
                </Button>
              ))}
            </div>
          ) : null}

          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={hasOptions ? "Or type your own…" : "Type your answer…"}
            className="mt-2.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (isLast) submit(commitCustom(answers));
                else {
                  setAnswers(commitCustom(answers));
                  setCustom("");
                  setIdx((i) => Math.min(questions.length - 1, i + 1));
                }
              }
            }}
          />

          <div className="mt-3 flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
              Prev
            </Button>
            {isLast ? (
              <Button size="sm" onClick={() => submit(commitCustom(answers))}>Submit</Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setAnswers(commitCustom(answers));
                  setCustom("");
                  setIdx((i) => Math.min(questions.length - 1, i + 1));
                }}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AskApprovalOverlay({
  approvals,
  asks,
  onResolveGate,
}) {
  if (approvals.length === 0 && asks.length === 0) return null;

  return (
    <div className="space-y-2">
      {approvals.map((approval) => (
        <div key={approval.id} className="mx-auto mb-2 max-w-3xl rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[20px] text-amber-500">shield</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Allow {approval.tool} to run?</p>
              <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-background/60 p-2.5 font-mono text-[11px] leading-5">
                {approval.arguments || "{}"}
              </pre>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => onResolveGate(approval, "allow")}>
                  Allow
                </Button>
                <Button size="sm" variant="outline" onClick={() => onResolveGate(approval, "allow", true)}>
                  Always allow
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onResolveGate(approval, "deny")}>
                  Deny
                </Button>
                <span className="text-[10px] text-text-muted">Auto-deny after 120s</span>
              </div>
            </div>
          </div>
        </div>
      ))}

      {asks.map((ask) => (
        <AskWizard
          key={ask.id}
          ask={ask}
          onAnswer={(answer) => onResolveGate(ask, answer)}
        />
      ))}
    </div>
  );
}

export default memo(AskApprovalOverlay);
export { AskWizard };
