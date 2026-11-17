/**
 * Auth-session storage for native: SecureStore (Keychain/Keystore) limits values to ~2 KB, but a
 * session JSON can exceed that, so values are split into chunks. Backend is injectable for tests.
 */
export interface KeyValueBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const CHUNK = 1000;
// SecureStore keys may contain only [A-Za-z0-9._-]
const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

export function createChunkedStorage(backend: KeyValueBackend, chunkSize = CHUNK): AuthStorage {
  const countKey = (k: string) => `${safeKey(k)}.n`;
  const partKey = (k: string, i: number) => `${safeKey(k)}.${i}`;

  async function removeItem(key: string) {
    const n = Number(await backend.getItemAsync(countKey(key)));
    if (Number.isInteger(n) && n > 0) {
      for (let i = 0; i < n; i++) await backend.deleteItemAsync(partKey(key, i));
    }
    await backend.deleteItemAsync(countKey(key));
  }

  return {
    async getItem(key) {
      const n = Number(await backend.getItemAsync(countKey(key)));
      if (!Number.isInteger(n) || n <= 0 || n > 64) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await backend.getItemAsync(partKey(key, i));
        if (part === null) return null; // incomplete write: treat as signed out
        parts.push(part);
      }
      return parts.join('');
    },
    async setItem(key, value) {
      await removeItem(key);
      const parts = value.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) ?? [''];
      for (const [i, part] of parts.entries()) await backend.setItemAsync(partKey(key, i), part);
      await backend.setItemAsync(countKey(key), String(parts.length)); // written last: marks completeness
    },
    removeItem,
  };
}
