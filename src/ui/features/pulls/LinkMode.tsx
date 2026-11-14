/** Where the "link mode" choice reaches every file header and comment. */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { CommentSide } from '../../../shared/review.ts';
import { showToast } from '../../components/Toast.tsx';
import styles from './LinkMode.module.css';
import { linkFor } from './links.ts';
import type { LinkContext } from './links.ts';

const LinkContextValue = createContext<LinkContext | null>(null);

export function LinkModeProvider({ context, children }: { context: LinkContext; children: ReactNode }) {
  return <LinkContextValue.Provider value={context}>{children}</LinkContextValue.Provider>;
}

export function useLinkContext(): LinkContext | null {
  return useContext(LinkContextValue);
}

type LineLinkProps = {
  path: string;
  side: CommentSide;
  /** Null for a whole-file link: text without `:line`, URL anchored at the first line. */
  line: number | null;
  className?: string;
};

/** Copyable `path:line` in path mode; an external forge URL in URL mode. */
export function LineLink({ path, side, line, className }: LineLinkProps) {
  const context = useContext(LinkContextValue);
  if (context === null) {
    return null;
  }
  const target = linkFor(context, path, side, line);
  const classes = [styles.link, className].filter(Boolean).join(' ');
  if (target.href !== null) {
    return (
      <a className={classes} href={target.href} target="_blank" rel="noopener noreferrer" title={`Open ${target.text} on the forge`}>
        {target.text}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      title={`Copy ${target.text}`}
      onClick={(event) => {
        event.stopPropagation();
        void copyLink(target.text);
      }}
    >
      {target.text}
    </button>
  );
}

async function copyLink(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast({ message: `Copied ${text}` });
  } catch {
    showToast({ message: 'Could not copy the link' });
  }
}
