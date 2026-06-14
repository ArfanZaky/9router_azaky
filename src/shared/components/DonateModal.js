"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import {
  PAYMENKU_DONATE_TIERS,
  PAYMENKU_LINK_BASE,
  PAYMENKU_DONATE_INFO,
} from "@/shared/constants/config";

function buildPaymenkuUrl(code) {
  return `${PAYMENKU_LINK_BASE}/${encodeURIComponent(code)}`;
}

export default function DonateModal({ isOpen, onClose }) {
  const modalRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) onClose();
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEsc = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={modalRef}
        className="relative w-full bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-md flex flex-col"
      >
        <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
          <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-pink-500">volunteer_activism</span>
            {PAYMENKU_DONATE_INFO.title}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          <p className="text-text-muted text-sm text-center">
            {PAYMENKU_DONATE_INFO.message}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PAYMENKU_DONATE_TIERS.map((tier) => (
              <a
                key={tier.code}
                href={buildPaymenkuUrl(tier.code)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-pink-500/30 bg-pink-500/5 hover:bg-pink-500/15 hover:border-pink-500/50 transition-colors text-text-main font-medium"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-pink-500 text-[20px]">
                    favorite
                  </span>
                  {tier.label}
                </span>
                <span className="text-text-muted flex items-center gap-1 text-xs">
                  Bayar
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                </span>
              </a>
            ))}
          </div>

          <div className="text-[11px] text-text-muted text-center pt-2 border-t border-black/5 dark:border-white/5">
            Dibawa ke halaman pembayaran Paymenku di tab baru.
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

DonateModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
