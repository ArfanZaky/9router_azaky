"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

const DISCORD_URL = "https://dsc.gg/wyxhub";
const STORAGE_KEY = "discord-popup-dismissed";

export default function DiscordPopup() {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    if (dismissed === "forever") return;
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted || !visible) return null;

  const handleJoin = () => {
    window.open(DISCORD_URL, "_blank", "noopener,noreferrer");
    setVisible(false);
  };

  const handleClose = () => {
    setVisible(false);
  };

  const handleDontRemind = () => {
    window.localStorage.setItem(STORAGE_KEY, "forever");
    setVisible(false);
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
      onClick={handleClose}
    >
      <div
        style={{ position: "relative", width: "100%", maxWidth: 384, margin: "0 16px" }}
        className="overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-4 px-6 pt-8 pb-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#5865F2]/10">
            <Image
              src="/icons/discord.svg"
              alt="Discord"
              width={36}
              height={36}
              className="opacity-90"
            />
          </div>

          <div className="text-center">
            <h3 className="text-lg font-bold text-text-main">Join our Discord!</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              Get help, share configs, request features, and hang out with the WYx0 community.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={handleJoin}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4752C4]"
            >
              <Image src="/icons/discord.svg" alt="" width={18} height={18} className="brightness-0 invert" />
              Join Discord
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text-main transition-colors hover:bg-sidebar"
            >
              Close
            </button>
          </div>

          <button
            type="button"
            onClick={handleDontRemind}
            className="text-xs text-text-muted transition-colors hover:text-text-main"
          >
            Don&apos;t remind me
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
