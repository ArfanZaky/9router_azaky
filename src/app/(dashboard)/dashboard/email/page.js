"use client";

import { useEffect, useMemo, useState } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS } from "@/shared/constants/providers";

function parseAccounts(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const displayEmail = line.split(":", 1)[0].trim();
      return { line, displayEmail, email: displayEmail.toLowerCase() };
    })
    .filter((account) => account.email.includes("@"));
}

function EmailBox({ title, items, empty, credential = false }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/70">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">{title}</p>
        <span className="rounded-full bg-sidebar px-2 py-0.5 text-xs text-text-muted">{items.length}</span>
      </div>
      <div className="max-h-64 overflow-y-auto p-3">
        {items.length ? (
          <div className="space-y-1.5">
            {items.map((item, index) => (
              <div key={`${credential ? item.line : item}-${index}`} className="break-all rounded-lg bg-sidebar px-3 py-2 font-mono text-xs">
                {credential ? item.line : item}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-1 py-4 text-center text-xs text-text-muted">{empty}</p>
        )}
      </div>
    </div>
  );
}

export default function EmailPage() {
  const [input, setInput] = useState("");
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/providers", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load connections");
        setConnections(data.connections || []);
      })
      .catch((fetchError) => setError(fetchError.message))
      .finally(() => setLoading(false));
  }, []);

  const accounts = useMemo(() => parseAccounts(input), [input]);
  const providers = useMemo(() => Object.values(AI_PROVIDERS)
    .filter((provider) => !provider.hidden)
    .sort((left, right) => left.name.localeCompare(right.name)), []);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-3">
          <h1 className="text-xl font-semibold">Email Provider Check</h1>
          <p className="mt-1 text-sm text-text-muted">
            Paste one <code>email:password</code> per line. Passwords stay in this browser page.
          </p>
        </div>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={"user1@example.com:password\nuser2@example.com:password"}
          spellCheck={false}
          className="min-h-44 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <p className="mt-2 text-xs text-text-muted">{accounts.length} valid email{accounts.length === 1 ? "" : "s"}</p>
      </section>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
      {loading && <div className="rounded-xl border border-border p-8 text-center text-sm text-text-muted">Loading provider connections...</div>}

      {!loading && !error && (
        <div className="space-y-4">
          {providers.map((provider) => {
            const savedSet = new Set(connections
              .filter((connection) => connection.provider === provider.id && connection.email)
              .map((connection) => connection.email.trim().toLowerCase()));
            const saved = accounts.filter((account) => savedSet.has(account.email)).map((account) => account.displayEmail);
            const missing = accounts.filter((account) => !savedSet.has(account.email));

            return (
              <section key={provider.id} className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-center gap-3">
                  <ProviderIcon
                    src={`/providers/${provider.id}.png`}
                    alt={provider.name}
                    size={38}
                    className="rounded-xl"
                    fallbackText={provider.textIcon || provider.name.slice(0, 2).toUpperCase()}
                    fallbackColor={provider.color}
                  />
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{provider.name}</h2>
                    <p className="text-xs text-text-muted">{provider.id}</p>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <EmailBox title="Sudah tersimpan" items={saved} empty="Belum ada email input yang tersimpan" />
                  <EmailBox title="Belum tersimpan" items={missing} empty="Semua email input sudah tersimpan" credential />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
