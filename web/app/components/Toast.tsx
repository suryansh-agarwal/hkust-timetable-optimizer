"use client";

import { useEffect } from "react";

type ToastProps = {
  open: boolean;
  message: string;
  variant?: "error" | "info";
  onClose: () => void;
};

export function Toast({ open, message, variant = "info", onClose }: ToastProps) {
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      onClose();
    }, 7000);
    return () => clearTimeout(handle);
  }, [open, onClose]);

  if (!open) return null;

  const isError = variant === "error";
  const background = isError ? "#7f1d1d" : "#1f2937";
  // The toast keeps its own dark palette in both themes; a border gives it
  // separation from the page when that page is already dark.
  const borderColor = isError ? "#b91c1c" : "#374151";

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        background,
        border: `1px solid ${borderColor}`,
        color: "white",
        borderRadius: 10,
        padding: "12px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        minWidth: 260,
        maxWidth: 380,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 14, lineHeight: 1.4, flex: 1 }}>{message}</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          border: "none",
          background: "transparent",
          color: "white",
          fontSize: 18,
          cursor: "pointer",
          padding: 0,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
