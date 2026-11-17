import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors.ts';

describe('errorMessage', () => {
  it('shows the message of an Error', () => {
    expect(errorMessage(new Error('Could not reach the server'), 'Something went wrong')).toBe(
      'Could not reach the server',
    );
  });

  it('falls back for anything that is not an Error', () => {
    expect(errorMessage('a thrown string', 'Could not save the review')).toBe('Could not save the review');
    expect(errorMessage(undefined, 'Could not save the review')).toBe('Could not save the review');
  });
});
