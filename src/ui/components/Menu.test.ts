import { describe, expect, it } from 'vitest';
import { menuKeyAction } from './Menu.tsx';

describe('menuKeyAction', () => {
  it('wraps ArrowDown from the last item to the first', () => {
    expect(menuKeyAction('ArrowDown', 2, 3)).toEqual({ type: 'move', index: 0 });
  });

  it('wraps ArrowUp from the first item to the last', () => {
    expect(menuKeyAction('ArrowUp', 0, 3)).toEqual({ type: 'move', index: 2 });
  });

  it('moves between rows without wrapping in the middle of the list', () => {
    expect(menuKeyAction('ArrowDown', 0, 3)).toEqual({ type: 'move', index: 1 });
    expect(menuKeyAction('ArrowUp', 2, 3)).toEqual({ type: 'move', index: 1 });
  });

  it('activates the highlighted row on Enter and ignores Enter without a highlight', () => {
    expect(menuKeyAction('Enter', 1, 3)).toEqual({ type: 'activate', index: 1 });
    expect(menuKeyAction('Enter', -1, 3)).toBeNull();
    expect(menuKeyAction('Enter', 3, 3)).toBeNull();
  });

  it('closes on Escape', () => {
    expect(menuKeyAction('Escape', 1, 3)).toEqual({ type: 'close' });
  });
});
