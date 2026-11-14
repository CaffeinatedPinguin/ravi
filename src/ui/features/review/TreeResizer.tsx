/**
 * The draggable divider between the file tree and the diff.
 * Width changes are reported live for a smooth drag, but persisted only when the gesture ends.
 */
import { useRef } from 'react';
import type { PointerEvent } from 'react';
import styles from './ReviewPage.module.css';

export const TREE_MIN_WIDTH = 160;
export const TREE_MAX_WIDTH = 800;
/** Matches the arrow-key step expected from a resizable separator. */
const KEY_STEP = 16;

export function clampTreeWidth(width: number): number {
  return Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, Math.round(width)));
}

type TreeResizerProps = {
  width: number;
  /** Called on every pointer move so the layout follows the pointer. */
  onChange: (width: number) => void;
  /** Called on drag end and on arrow keys: the only moments worth saving to settings. */
  onCommit: (width: number) => void;
};

type Drag = { pointerId: number; startX: number; startWidth: number };

export function TreeResizer({ width, onChange, onCommit }: TreeResizerProps) {
  const drag = useRef<Drag | null>(null);

  const widthAt = (clientX: number, start: Drag): number => clampTreeWidth(start.startWidth + clientX - start.startX);

  const finish = (event: PointerEvent<HTMLDivElement>, start: Drag): void => {
    const finalWidth = widthAt(event.clientX, start);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onChange(finalWidth);
    onCommit(finalWidth);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file tree"
      aria-valuemin={TREE_MIN_WIDTH}
      aria-valuemax={TREE_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className={styles.resizer}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start !== null && start.pointerId === event.pointerId) {
          onChange(widthAt(event.clientX, start));
        }
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (start !== null && start.pointerId === event.pointerId) {
          finish(event, start);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
          return;
        }
        event.preventDefault();
        const next = clampTreeWidth(width + (event.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP));
        onChange(next);
        onCommit(next);
      }}
    />
  );
}
