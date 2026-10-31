import { describe, expect, it } from 'vitest';
import { stateFromPermission } from './locationAccess';

describe('stateFromPermission', () => {
  it('granted starts locating', () => {
    expect(stateFromPermission('granted', true)).toEqual({ kind: 'locating' });
  });
  it('undetermined needs a prompt', () => {
    expect(stateFromPermission('undetermined', true)).toEqual({ kind: 'needs-prompt' });
  });
  it('denied keeps canAskAgain so the UI can offer retry or settings', () => {
    expect(stateFromPermission('denied', true)).toEqual({ kind: 'denied', canAskAgain: true });
    expect(stateFromPermission('denied', false)).toEqual({ kind: 'denied', canAskAgain: false });
  });
});
