/**
 * Which files a visible row range needs patches for.
 *
 * Pure and free of virtualizer measurements on purpose: the first render of a huge diff happens
 * before the virtualizer has measured the scroll element, so its visible items are empty then.
 * The top of the list is what the user sees at that moment, and asking for those files right away
 * is what removes the multi-second delay before the first `diff/patches` request.
 */
type RowMap = {
  readonly files: readonly unknown[];
  fileIndexAtRow(index: number): number;
};

export function filesToRequest(session: RowMap, visible: ReadonlyArray<{ index: number }>, preload: number): number[] {
  if (session.files.length === 0) {
    return [];
  }
  // No measurements yet (first render, or a transient empty range after a layout change):
  // row 0 is the best available answer and requesting it is cheap and idempotent.
  const firstRow = visible[0]?.index ?? 0;
  const lastRow = visible.at(-1)?.index ?? firstRow;
  const from = session.fileIndexAtRow(firstRow);
  const to = Math.min(session.fileIndexAtRow(lastRow) + preload, session.files.length - 1);
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}
