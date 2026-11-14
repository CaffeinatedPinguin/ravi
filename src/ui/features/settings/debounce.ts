/** A tiny trailing debounce; the preview must run once after a burst of tag edits. */
export type Debounced<A extends unknown[]> = ((...args: A) => void) & { cancel: () => void };

export function debounce<A extends unknown[]>(run: (...args: A) => void, waitMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return Object.assign(
    (...args: A): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        run(...args);
      }, waitMs);
    },
    {
      cancel: (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
    },
  );
}
