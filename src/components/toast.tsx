"use client";

import { useState, useCallback, useEffect } from "react";

type ToastType = "success" | "error";

interface Toast {
  id: number;
  message: string;
  type: ToastType | null;
}

let nextId = 0;
let globalShow: ((message: string, type?: ToastType) => void) | null = null;

export function showToast(message: string, type?: ToastType) {
  globalShow?.(message, type);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type?: ToastType) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type: type ?? null }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    globalShow = show;
    return () => { globalShow = null; };
  }, [show]);

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.type ? ` ${t.type}` : ""}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
