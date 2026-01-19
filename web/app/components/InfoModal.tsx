"use client";

import { ReactNode, useEffect } from "react";

type InfoModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export function InfoModal({ open, title, children, onClose }: InfoModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 12,
          padding: 16,
          width: "100%",
          maxWidth: 480,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 12px 30px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 20,
              cursor: "pointer",
              color: "#666",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 14, color: "#444", lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
}

type InfoIconButtonProps = {
  onClick: () => void;
};

export function InfoIconButton({ onClick }: InfoIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Info"
      title="Info"
      style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        border: "1px solid #ccc",
        color: "#555",
        background: "#fff",
        fontSize: 12,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#f5f5f5";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#fff";
      }}
    >
      i
    </button>
  );
}
