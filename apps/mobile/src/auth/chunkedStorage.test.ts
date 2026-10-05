import { describe, expect, it } from 'vitest';
import { createChunkedStorage, type KeyValueBackend } from './chunkedStorage';

const memory = (): KeyValueBackend & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (k) => data.get(k) ?? null,
    setItemAsync: async (k, v) => void data.set(k, v),
    deleteItemAsync: async (k) => void data.delete(k),
  };
};

describe('chunked auth storage', () => {
  it('round-trips values larger than one chunk, keeping every stored value small', async () => {
    const b = memory();
    const s = createChunkedStorage(b, 100);
    const big = JSON.stringify({ access_token: 'x'.repeat(1234), user: { email: 'a@b.co', note: 'é✓' } });
    await s.setItem('sb-ref-auth-token', big);
    expect(await s.getItem('sb-ref-auth-token')).toBe(big);
    expect(Math.max(...[...b.data.values()].map((v) => v.length))).toBeLessThanOrEqual(100);
  });

  it('overwrites cleanly (no stale chunks) and removes everything', async () => {
    const b = memory();
    const s = createChunkedStorage(b, 10);
    await s.setItem('k', 'a'.repeat(95));
    await s.setItem('k', 'short');
    expect(await s.getItem('k')).toBe('short');
    expect([...b.data.keys()].filter((k) => k.startsWith('k.')).length).toBe(2); // one chunk + count
    await s.removeItem('k');
    expect(b.data.size).toBe(0);
    expect(await s.getItem('k')).toBeNull();
  });

  it('treats a missing chunk or garbage count as signed out, and sanitizes key names', async () => {
    const b = memory();
    const s = createChunkedStorage(b, 10);
    await s.setItem('sb:weird key!', 'x'.repeat(35));
    expect([...b.data.keys()].every((k) => /^[A-Za-z0-9._-]+$/.test(k))).toBe(true);
    b.data.delete('sb_weird_key_.2');
    expect(await s.getItem('sb:weird key!')).toBeNull();
    b.data.set('bad.n', 'NaN');
    expect(await s.getItem('bad')).toBeNull();
    b.data.set('huge.n', '9999');
    expect(await s.getItem('huge')).toBeNull();
  });
});
