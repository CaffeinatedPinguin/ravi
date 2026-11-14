/**
 * One small toast region for the whole app.
 *
 * A module-level store keeps callers (comment deletion) free of prop drilling; the host renders a
 * single `role="status"` region and replaces any older toast, so the screen never fills with them.
 */
import { useEffect, useSyncExternalStore } from 'react';
import styles from './Toast.module.css';

type ToastAction = { label: string; onClick: () => void };
type ToastState = { id: number; message: string; action: ToastAction | null; duration: number };

let current: ToastState | null = null;
let nextId = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): ToastState | null {
  return current;
}

export function showToast(spec: { message: string; action?: ToastAction }, duration = 4000): void {
  current = { id: ++nextId, message: spec.message, action: spec.action ?? null, duration };
  emit();
}

export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, snapshot);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const id = toast.id;
    const timer = setTimeout(() => {
      if (current?.id === id) {
        current = null;
        emit();
      }
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) {
    return null;
  }

  const runAction = () => {
    const action = toast.action;
    current = null;
    emit();
    action?.onClick();
  };

  return (
    <div className={styles.toast} role="status">
      <span>{toast.message}</span>
      {toast.action !== null && (
        <button type="button" className={styles.action} onClick={runAction}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
