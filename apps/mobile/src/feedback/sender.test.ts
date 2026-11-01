import { EMPTY_FEEDBACK, type FeedbackDraft } from '@open-stall/domain';
import { describe, expect, it } from 'vitest';
import type { RpcClientLike } from '../account/api';
import { FeedbackSender, type SenderDeps } from './sender';

// Synthetic adapters that record exactly what is transmitted and under which credential, and that let each wait be held open and released by hand.
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const DIAG = { platform: 'web' as const, appVersion: '1.0.0' };
const DRAFT: FeedbackDraft = { ...EMPTY_FEEDBACK, kind: 'bug', screen: 'map', title: 'AlphaPrivateTitle here', description: 'AlphaPrivateDescription of the bug.' };
const OK = { ok: true as const, id: 'item-1', replayed: false };

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

function rig(owner = A, over: Partial<SenderDeps> = {}) {
  const sent: { token: string; key: string; title: string }[] = [];
  const bound: string[] = [];
  let lookups = 0;
  let session: { userId: string | null; accessToken: string | null } = { userId: owner, accessToken: `token-of-${owner}` };
  let keyN = 0;
  const deps: SenderDeps = {
    owner,
    getSession: async () => { lookups++; return session; },
    bind: (t) => { bound.push(t); return Object.assign({ rpc: () => { throw new Error('unused'); } }, { __t: t }) as RpcClientLike; },
    newKey: async () => `fb-key-${++keyN}`,
    submit: async (c, d, _diag, key) => { sent.push({ token: (c as unknown as { __t: string }).__t, key, title: d.title }); return OK; },
    ...over,
  };
  const sender = new FeedbackSender(deps);
  sender.attach();
  return { sender, sent, bound, lookups: () => lookups, setSession: (s: typeof session) => { session = s; } };
}

describe('FeedbackSender: a send belongs to the account that started it', () => {
  it('sends with the verified owner session token and returns the outcome', async () => {
    const r = rig();
    const out = await r.sender.send(DRAFT, DIAG);
    expect(out).toEqual({ kind: 'done', outcome: OK });
    expect(r.sent).toEqual([{ token: `token-of-${A}`, key: 'fb-key-1', title: DRAFT.title }]);
  });

  it('A starts a send, key generation is HELD, B replaces A: after release nothing is transmitted', async () => {
    const gate = deferred<string>();
    const r = rig(A, { newKey: () => gate.promise });
    const pending = r.sender.send(DRAFT, DIAG);
    r.sender.dispose(); // the account changed: the screen of A is gone
    r.setSession({ userId: B, accessToken: `token-of-${B}` });
    gate.resolve('fb-key-late');
    expect(await pending).toEqual({ kind: 'refused', reason: 'disposed' });
    expect(r.sent).toEqual([]); expect(r.bound).toEqual([]);
    expect(r.lookups()).toBe(0); // the credential is not even looked up for a form that is gone
  });

  it('A passes its form guard, the SESSION LOOKUP is held, B replaces A (screen not yet gone): refused, A content never gets B\'s token', async () => {
    const gate = deferred<{ userId: string | null; accessToken: string | null }>();
    const r = rig(A, { getSession: () => gate.promise });
    const pending = r.sender.send(DRAFT, DIAG);
    await Promise.resolve();
    gate.resolve({ userId: B, accessToken: `token-of-${B}` }); // the lookup now answers with the NEW account
    expect(await pending).toEqual({ kind: 'refused', reason: 'account-changed' });
    expect(r.sent).toEqual([]); expect(r.bound).toEqual([]);
  });

  it('the session lookup is held and the screen goes away before it answers: nothing is transmitted even with A\'s own token', async () => {
    const gate = deferred<{ userId: string | null; accessToken: string | null }>();
    const r = rig(A, { getSession: () => gate.promise });
    const pending = r.sender.send(DRAFT, DIAG);
    await Promise.resolve();
    r.sender.dispose();
    gate.resolve({ userId: A, accessToken: `token-of-${A}` });
    expect(await pending).toEqual({ kind: 'refused', reason: 'disposed' });
    expect(r.sent).toEqual([]);
  });

  it('a signed-out lookup (no user, no token) is refused', async () => {
    const r = rig(A);
    r.setSession({ userId: null, accessToken: null });
    expect(await r.sender.send(DRAFT, DIAG)).toEqual({ kind: 'refused', reason: 'account-changed' });
    expect(r.sent).toEqual([]);
  });

  it('an already DISPATCHED request finishes for A with A\'s token only, and reports nothing to a replaced screen', async () => {
    const gate = deferred<typeof OK>();
    const r = rig(A, { submit: async (c, d, _g, key) => { r.sent.push({ token: (c as unknown as { __t: string }).__t, key, title: d.title }); return gate.promise; } });
    const pending = r.sender.send(DRAFT, DIAG);
    await new Promise((x) => setTimeout(x, 0));
    expect(r.sent).toHaveLength(1);
    r.sender.dispose(); r.setSession({ userId: B, accessToken: `token-of-${B}` });
    gate.resolve(OK);
    expect(await pending).toEqual({ kind: 'discarded' });
    expect(r.sent).toEqual([{ token: `token-of-${A}`, key: 'fb-key-1', title: DRAFT.title }]); // went out as A, once
  });

  it('a double tap while a send is running is refused synchronously (never two items)', async () => {
    const gate = deferred<typeof OK>();
    const r = rig(A, { submit: async () => gate.promise });
    const first = r.sender.send(DRAFT, DIAG);
    expect(await r.sender.send(DRAFT, DIAG)).toEqual({ kind: 'refused', reason: 'busy' });
    gate.resolve(OK); await first;
  });

  it('a lost answer keeps the SAME retry key for an exact retry; any edit starts a new key', async () => {
    let lose = true;
    const r = rig(A, { submit: async (c, d, _g, key) => { r.sent.push({ token: (c as unknown as { __t: string }).__t, key, title: d.title }); return lose ? { ok: false as const, message: 'x', uncertain: true } : OK; } });
    await r.sender.send(DRAFT, DIAG);
    lose = false;
    await r.sender.send(DRAFT, DIAG);
    expect(r.sent.map((s) => s.key)).toEqual(['fb-key-1', 'fb-key-1']);
    r.sender.forgetKey();
    await r.sender.send(DRAFT, DIAG);
    expect(r.sent.at(-1)?.key).toBe('fb-key-2');
  });

  it('a new account\'s sender never inherits A\'s retry key or draft state', async () => {
    const a = rig(A, { newKey: async () => 'key-of-A-account' });
    await a.sender.send(DRAFT, DIAG);
    const b = rig(B, { newKey: async () => 'key-of-B-account' });
    await b.sender.send({ ...DRAFT, title: 'BetaOwnTitle here' }, DIAG);
    expect(b.sent).toEqual([{ token: `token-of-${B}`, key: 'key-of-B-account', title: 'BetaOwnTitle here' }]);
  });

  it('logout then login of the SAME account is a new form: the old sender can neither send nor report', async () => {
    const old = rig(A);
    old.sender.dispose(); // sign-out discards the screen
    expect(await old.sender.send(DRAFT, DIAG)).toEqual({ kind: 'refused', reason: 'disposed' });
    expect(old.sent).toEqual([]);
    const fresh = rig(A, { newKey: async () => 'fresh-key' });
    expect((await fresh.sender.send(DRAFT, DIAG)).kind).toBe('done');
    expect(fresh.sent[0]?.key).toBe('fresh-key');
  });

  it('a same-account token refresh is usable: the refreshed token is the one used', async () => {
    const r = rig(A);
    r.setSession({ userId: A, accessToken: 'refreshed-token-of-A' });
    await r.sender.send(DRAFT, DIAG);
    expect(r.sent[0]?.token).toBe('refreshed-token-of-A');
  });

  it('unmount (dispose) then development re-mount (attach) works again', async () => {
    const r = rig(A);
    r.sender.dispose(); r.sender.attach();
    expect((await r.sender.send(DRAFT, DIAG)).kind).toBe('done');
  });

  it('an unavailable transport refuses without sending', async () => {
    const r = rig(A, { bind: () => null });
    expect(await r.sender.send(DRAFT, DIAG)).toEqual({ kind: 'refused', reason: 'unavailable' });
  });
});
