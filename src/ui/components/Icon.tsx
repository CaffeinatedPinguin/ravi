/** Inline SVG icons drawn for this project: 16×16, stroked with the current text colour. */
const PATHS = {
  chevronRight: 'M6 3.5 10.5 8 6 12.5',
  chevronDown: 'M3.5 6 8 10.5 12.5 6',
  folder: 'M1.5 4.5v8h13v-7h-6l-1.5-2h-5.5z',
  file: 'M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3',
  plus: 'M8 3v10M3 8h10',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.7 10.7 14 14',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3',
  copy: 'M5.5 5.5h8v8h-8zM2.5 10.5v-8h8',
  upload: 'M8 11V2M4.5 5.5 8 2l3.5 3.5M2.5 11v3h11v-3',
  download: 'M8 2v9M4.5 7.5 8 11l3.5-3.5M2.5 11v3h11v-3',
  external: 'M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4',
  split: 'M1.5 2.5h13v11h-13zM8 2.5v11',
  unified: 'M1.5 2.5h13v11h-13zM1.5 8h13',
  expand: 'M8 1.5v4M5.5 3.5 8 1.5l2.5 2M8 14.5v-4M5.5 12.5 8 14.5l2.5-2M2.5 8h11',
  arrowUp: 'M8 13V3M3.5 7.5 8 3l4.5 4.5',
  arrowDown: 'M8 3v10M3.5 8.5 8 13l4.5-4.5',
  branch: 'M4.5 5.5v5M4.5 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4.5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM11.5 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM11.5 6.5c0 2.5-7 1.5-7 4',
  trash: 'M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.7 9h6.6l.7-9',
  sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  moon: 'M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z',
  collapse: 'M3 6l5-4 5 4M3 10l5 4 5-4',
  comment: 'M2.5 3.5h11v7h-6l-3 3v-3h-2z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
