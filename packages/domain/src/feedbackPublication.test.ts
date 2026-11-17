import { describe, expect, it } from 'vitest';
import {
  ConnectorError, MAX_LIST_PAGES, PUBLICATION_REPO, checkPacket, evidenceFrom, normalizeText, parseConnectorIssue, parsePacket, parseSnapshot, publish, readbackHash, reconcile, verifyIssue,
  type Connector, type ConnectorIssue, type Fence, type ReportArgs, type Snapshot, type TransferPacket,
} from './feedbackPublication';

/** A small pure SHA-256 (UTF-8 input, hex output), so the domain package needs no Node typings; checked below against the standard test vectors. */
function sha256Hex(text: string): string {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const bytes = Array.from(new TextEncoder().encode(text));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    const w = new Array<number>(64).fill(0);
    for (let i = 0; i < 16; i++) w[i] = ((bytes[off + i * 4]! << 24) | (bytes[off + i * 4 + 1]! << 16) | (bytes[off + i * 4 + 2]! << 8) | bytes[off + i * 4 + 3]!) >>> 0;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i]! + v) >>> 0; });
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('');
}
const sha = sha256Hex;
describe('the test-local sha256 is the real one', () => {
  it('matches the standard vectors', () => {
    expect(sha('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});
const MARKER = 'OSFB-0123456789abcdef0123';
const TITLE = 'Pin jumps when zooming';
const BODY = `Category: bug\nProblem: The pin jumps when zooming on the map screen\nSteps to reproduce: Not provided\nExpected and actual: Not provided\nBuild: web 1.2\nAcceptance hint: None\n\nFeedback reference: ${MARKER}`;
const HASH = readbackHash(TITLE, BODY, sha);
const packet = (over: Partial<TransferPacket> = {}): TransferPacket => ({ repo: PUBLICATION_REPO, operation: 'create', issue_number: null, marker: MARKER, version: 1, attempt: 1, phase: 'preview', title: TITLE, body: BODY, expected_hash: HASH, ...over });

/** A synthetic PRIVATE SERVER: it mirrors the rules the SQL layer enforces (one-time dispatch, attempt fence, verified-absence evidence) so the protocol is exercised against them. */
class FakeServer implements Fence {
  status = 'prepared';
  attempt = 1;
  operation: 'create' | 'update' = 'create';
  issueNumber: number | null = null;
  title = TITLE; body = BODY;
  dispatchedAt: string | null = null;
  dispatches: number[] = [];
  reports: ReportArgs[] = [];
  tamper?: (p: TransferPacket) => TransferPacket;          // a tampered local copy of what the server issued
  hashOverride?: string;                                    // what the SNAPSHOT claims as the trusted hash
  private expected = () => readbackHash(this.title, this.body, sha);
  private packet(phase: 'preview' | 'transfer' | 'readback'): TransferPacket {
    const p = packet({ phase, operation: this.operation, issue_number: this.issueNumber, attempt: this.attempt, title: this.title, body: this.body, expected_hash: this.expected() });
    return this.tamper ? this.tamper(p) : p;
  }
  async snapshot(): Promise<unknown> {
    const showPacket = this.status === 'prepared' ? this.packet('preview') : ['dispatched', 'uncertain', 'failed', 'conflict'].includes(this.status) ? this.packet('readback') : null;
    return { status: this.status, attempt: this.attempt, version: 1, marker: MARKER, expected_hash: this.hashOverride ?? this.expected(), operation: this.operation, issue_number: this.issueNumber,
      since: this.dispatchedAt ? new Date(Date.parse(this.dispatchedAt) - 10 * 60_000).toISOString() : null, packet: showPacket };
  }
  async dispatch(attempt: number): Promise<unknown> {
    if (attempt !== this.attempt || this.status !== 'prepared') throw new Error('refused');
    this.status = 'dispatched'; this.dispatchedAt = '2026-11-01T05:00:00.000Z'; this.dispatches.push(attempt);
    return this.packet('transfer');
  }
  prepare(): void { this.attempt += 1; this.status = 'prepared'; this.dispatchedAt = null; }
  /** the server's side of a report (only what the protocol tests need: it applies the rules the SQL layer enforces) */
  apply(r: ReportArgs): void {
    this.reports.push(r);
    if (r.p_attempt !== this.attempt) throw new Error('stale attempt');
    if (r.p_outcome === 'uncertain') this.status = 'uncertain';
    else if (r.p_outcome === 'multiple') this.status = 'conflict';
    else if (r.p_outcome === 'failed') this.status = 'failed';
    else if (r.p_outcome === 'none_found') {
      const since = r.p_since ? Date.parse(r.p_since) : NaN;
      if (r.p_complete !== true || !r.p_pages || r.p_scanned == null || !(since <= Date.parse(this.dispatchedAt as string) - 10 * 60_000)) throw new Error('absence is not verified');
      this.status = 'ready'; this.dispatchedAt = null;
    } else if (r.p_readback_hash === this.expected() && r.p_marker === MARKER && r.p_repo === PUBLICATION_REPO) { this.status = 'published'; this.issueNumber = r.p_number ?? null; }
    else this.status = 'conflict';
  }
}

/** A synthetic connector: an in-memory repository with scripted faults. It records every call so tests can prove what was (not) attempted. */
class Fake implements Connector {
  issues: ConnectorIssue[] = [];
  calls: string[] = [];
  next = 41;
  pageSize = 2;
  faults: Partial<Record<'create' | 'update' | 'search' | 'list' | 'read', 'timeout' | 'timeoutAfterSuccess' | 'rejected' | 'malformed'>> = {};
  searchEmpty = false;            // the search index has not caught up yet
  listBeyondCap = false;          // the listing never ends (more pages than we will read)
  rewrite?: (i: ConnectorIssue) => ConnectorIssue;
  private add(title: string, body: string): ConnectorIssue {
    const i = { repo: PUBLICATION_REPO, number: this.next++, url: `https://github.com/${PUBLICATION_REPO}/issues/${this.next - 1}`, title, body };
    this.issues.push(i); return i;
  }
  seed(title = TITLE, body = BODY): ConnectorIssue { return this.add(title, body); }
  async create(a: { repo: string; title: string; body: string }) {
    this.calls.push('create');
    if (this.faults.create === 'timeout') throw new ConnectorError('unknown', 'timeout');
    if (this.faults.create === 'rejected') throw new ConnectorError('rejected', '422');
    const made = this.add(a.title, a.body);
    if (this.faults.create === 'timeoutAfterSuccess') throw new ConnectorError('unknown', 'timeout after the remote create');
    if (this.faults.create === 'malformed') return { ok: true };
    return made;
  }
  async update(a: { repo: string; number: number; title: string; body: string }) {
    this.calls.push('update');
    if (this.faults.update === 'timeout') throw new ConnectorError('unknown', 'timeout');
    const i = this.issues.find((x) => x.number === a.number);
    if (!i) throw new ConnectorError('rejected', '404');
    i.title = a.title; i.body = a.body;
    return i;
  }
  async search(a: { repo: string; marker: string }) {
    this.calls.push('search');
    if (this.faults.search === 'timeout') throw new ConnectorError('unknown', 'timeout');
    if (this.faults.search === 'malformed') return 'oops';
    if (this.searchEmpty) return [];
    return this.issues.filter((i) => i.body.includes(a.marker));
  }
  async listSince(a: { repo: string; since: string; page: number }) {
    this.calls.push(`list${a.page}`);
    if (this.faults.list === 'timeout') throw new ConnectorError('unknown', 'timeout');
    if (this.faults.list === 'malformed') return { issues: 'x' };
    if (this.listBeyondCap) return { issues: [], hasMore: true };
    const from = (a.page - 1) * this.pageSize;
    return { issues: this.issues.slice(from, from + this.pageSize), hasMore: from + this.pageSize < this.issues.length };
  }
  async read(a: { repo: string; number: number }) {
    this.calls.push('read');
    if (this.faults.read === 'timeout') throw new ConnectorError('unknown', 'timeout');
    if (this.faults.read === 'malformed') return { nope: 1 };
    const i = this.issues.find((x) => x.number === a.number);
    if (!i) throw new ConnectorError('rejected', '404');
    return this.rewrite ? this.rewrite(i) : i;
  }
}
const creates = (c: Fake) => c.calls.filter((x) => x === 'create' || x === 'update').length;

describe('packet validation (what the private system issues)', () => {
  it('accepts exactly the allowlisted fields', () => { expect(parsePacket(packet())).toEqual(packet()); });
  it.each([
    ['another repository', { repo: 'someone/else' }], ['an unknown operation', { operation: 'delete' as 'create' }], ['a create with an issue number', { issue_number: 3 }],
    ['an update without a number', { operation: 'update' as const }], ['a malformed marker', { marker: 'OSFB-xyz' }], ['a bad hash', { expected_hash: 'abc' }], ['version 0', { version: 0 }],
    ['attempt 0', { attempt: 0 }], ['an unknown phase', { phase: 'later' as 'preview' }], ['a fractional attempt', { attempt: 1.5 }],
  ])('refuses %s', (_n, over) => { expect(parsePacket(packet(over as Partial<TransferPacket>))).toBeNull(); });
  it('refuses an extra field (never a serialization of private data)', () => { expect(parsePacket({ ...packet(), issue_id: 'x' })).toBeNull(); });
  it('refuses non-objects', () => { expect(parsePacket(null)).toBeNull(); expect(parsePacket('x')).toBeNull(); expect(parsePacket([])).toBeNull(); });
  it('parses the snapshot defensively', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ status: 'prepared', attempt: 1, version: 1, marker: 'x', expected_hash: HASH, operation: 'create', issue_number: null })).toBeNull();
  });
});

describe('read-back hashing', () => {
  it('tolerates only line endings and trailing whitespace', () => {
    expect(readbackHash(TITLE, BODY.replace(/\n/g, '\r\n') + '\r\n', sha)).toBe(HASH);
    expect(readbackHash(TITLE, BODY.replace('jumps', 'moves'), sha)).not.toBe(HASH);
    expect(readbackHash(TITLE + '!', BODY, sha)).not.toBe(HASH);
    expect(normalizeText('a\r\nb  \n')).toBe('a\nb');
  });
});

describe('integrity BEFORE any external write (zero connector calls, zero server release)', () => {
  const snap = (): Snapshot => ({ status: 'prepared', attempt: 1, version: 1, marker: MARKER, expected_hash: HASH, operation: 'create', issue_number: null, since: null, packet: null });
  it('the genuine packet passes', () => { expect(checkPacket(packet(), snap(), sha)).toEqual({ ok: true }); });
  const SENSITIVE = ['Contact me at', ' person', '@', 'example.org'].join('');
  it.each([
    ['a changed title', (p: TransferPacket) => ({ ...p, title: p.title + ' now' })],
    ['a changed body', (p: TransferPacket) => ({ ...p, body: p.body.replace('jumps', 'moves') })],
    ['raw sensitive text inserted into an allowed field, with the ORIGINAL hash', (p: TransferPacket) => ({ ...p, body: p.body.replace('Problem: ', `Problem: ${SENSITIVE} `) })],
    ['a changed marker (and body line)', (p: TransferPacket) => ({ ...p, marker: 'OSFB-ffffffffffffffffffff', body: p.body.replace(MARKER, 'OSFB-ffffffffffffffffffff') })],
    ['a packet whose OWN hash was rewritten to match changed text (rehashed payload)', (p: TransferPacket) => { const body = p.body.replace('jumps', 'moves'); return { ...p, body, expected_hash: readbackHash(p.title, body, sha) }; }],
    ['a forged expected hash', (p: TransferPacket) => ({ ...p, expected_hash: 'b'.repeat(64) })],
    ['an oversized body', (p: TransferPacket) => { const body = p.body.replace('Problem: ', `Problem: ${'x'.repeat(4000)} `); return { ...p, body, expected_hash: readbackHash(p.title, body, sha) }; }],
    ['an oversized title', (p: TransferPacket) => ({ ...p, title: 'T'.repeat(500) })],
    ['a control character', (p: TransferPacket) => ({ ...p, body: p.body.replace('Problem: ', 'Problem: \u0007') })],
    ['a non-ASCII character', (p: TransferPacket) => ({ ...p, title: 'Pin jumps é' })],
    ['a body outside the fixed template', (p: TransferPacket) => ({ ...p, body: p.body.replace('Category: ', 'Hello: ') })],
    ['the marker twice', (p: TransferPacket) => ({ ...p, body: p.body.replace('Problem: ', `Problem: ${MARKER} `) })],
    ['another attempt', (p: TransferPacket) => ({ ...p, attempt: 2 })],
    ['another version', (p: TransferPacket) => ({ ...p, version: 2 })],
    ['another operation', (p: TransferPacket) => ({ ...p, operation: 'update' as const, issue_number: 5 })],
  ])('%s', async (_n, mutate) => {
    const server = new FakeServer(); server.tamper = mutate as (p: TransferPacket) => TransferPacket;
    const c = new Fake();
    const r = await publish(server, c, sha);
    expect(r.refused === 'integrity' || r.refused === 'invalid-packet').toBe(true);
    expect(c.calls).toEqual([]);                 // zero create/update (and nothing else)
    expect(server.dispatches).toEqual([]);       // and the attempt was never released
    expect(server.status).toBe('prepared');
    expect(c.issues).toHaveLength(0);
  });
  it('a snapshot that disagrees with the packet hash refuses (a rehash cannot satisfy two independent reads)', async () => {
    const server = new FakeServer(); server.hashOverride = 'c'.repeat(64);
    const c = new Fake();
    expect((await publish(server, c, sha)).refused).toBe('integrity');
    expect(c.calls).toEqual([]); expect(server.dispatches).toEqual([]);
  });
});

describe('transfer protocol with a synthetic server and connector', () => {
  it('success + read-back: reports verified evidence, releases the attempt exactly once', async () => {
    const server = new FakeServer(); const c = new Fake();
    const r = await publish(server, c, sha);
    expect(c.calls).toEqual(['create', 'read']);
    expect(server.dispatches).toEqual([1]);
    expect(r.report).toMatchObject({ p_attempt: 1, p_outcome: 'created', p_repo: PUBLICATION_REPO, p_number: 41, p_marker: MARKER, p_readback_hash: HASH });
    server.apply(r.report as ReportArgs);
    expect(server.status).toBe('published');
  });

  it('the SAME attempt cannot be executed twice: the second run is refused and never creates', async () => {
    const server = new FakeServer(); const c = new Fake();
    await publish(server, c, sha);
    const again = await publish(server, c, sha);
    expect(again).toMatchObject({ refused: 'not-prepared', calls: 0 });
    expect(creates(c)).toBe(1); expect(c.issues).toHaveLength(1);
  });

  it('response lost after remote success, then a RELOAD / new protocol instance with no flags: still no second create', async () => {
    const server = new FakeServer(); const c = new Fake(); c.faults.create = 'timeoutAfterSuccess';
    const first = await publish(server, c, sha);
    expect(first.report).toEqual({ p_attempt: 1, p_outcome: 'uncertain' });
    expect(c.issues).toHaveLength(1);                         // it WAS created: a timeout proves nothing
    server.apply(first.report as ReportArgs);
    c.faults = {};
    for (let i = 0; i < 3; i++) expect((await publish(server, c, sha)).refused).toBe('not-prepared');   // a new caller, a reload, a reused instance
    expect(creates(c)).toBe(1); expect(c.issues).toHaveLength(1);
  });

  it('another operator releases the attempt between our snapshot and our release: the release is refused and NOTHING is sent', async () => {
    const server = new FakeServer(); const c = new Fake();
    const snapshot = server.snapshot.bind(server);
    server.snapshot = async () => { const v = await snapshot(); await server.dispatch(1); return v; };   // the other operator wins the race right after we read the state
    const r = await publish(server, c, sha);
    expect(r).toMatchObject({ refused: 'dispatch-refused', calls: 0, report: null });
    expect(c.calls).toEqual([]);
    expect(server.dispatches).toEqual([1]);      // exactly one release, the other operator's
  });

  it('a stale or reused attempt is refused at the release (an old attempt cannot dispatch)', async () => {
    const server = new FakeServer(); const c = new Fake();
    await expect(server.dispatch(7)).rejects.toThrow();
    await publish(server, c, sha);
    await expect(server.dispatch(1)).rejects.toThrow();
  });

  it('timeout before the create -> uncertain; only a COMPLETE listing showing nothing reopens a create', async () => {
    const server = new FakeServer(); const c = new Fake(); c.faults.create = 'timeout';
    const first = await publish(server, c, sha);
    expect(first.report).toEqual({ p_attempt: 1, p_outcome: 'uncertain' });
    server.apply(first.report as ReportArgs); c.faults = {};
    const rec = await reconcile(server, c, sha);
    expect(rec.report).toMatchObject({ p_attempt: 1, p_outcome: 'none_found', p_complete: true, p_pages: 1, p_scanned: 0 });
    server.apply(rec.report as ReportArgs);
    expect(server.status).toBe('ready');
    server.prepare();                                        // a NEW attempt generation, authorized by the server
    const r = await publish(server, c, sha);
    expect(r.report?.p_outcome).toBe('created'); expect(c.issues).toHaveLength(1);
  });

  it('a create response is never trusted: a forged answer whose read-back differs is reported as evidence, not success', async () => {
    const server = new FakeServer(); const c = new Fake();
    c.rewrite = (i) => ({ ...i, body: i.body.replace('jumps', 'moves') });
    const r = await publish(server, c, sha);
    expect(r.report?.p_outcome).toBe('created');
    expect(r.report?.p_readback_hash).not.toBe(HASH);
    server.apply(r.report as ReportArgs);
    expect(server.status).toBe('conflict');                  // the server fails closed
  });

  it('a malformed or unreadable connector answer is uncertain, never success', async () => {
    for (const f of ['create', 'read'] as const) {
      const server = new FakeServer(); const c = new Fake(); c.faults[f] = 'malformed';
      expect((await publish(server, c, sha)).report).toEqual({ p_attempt: 1, p_outcome: 'uncertain' });
    }
    const server = new FakeServer(); const c = new Fake(); c.faults.read = 'timeout';
    expect((await publish(server, c, sha)).report).toEqual({ p_attempt: 1, p_outcome: 'uncertain' });
    expect(c.issues).toHaveLength(1);                         // created remotely but unverified: reconcile
  });

  it('a definitive rejection is failed (nothing was created) but still needs verified absence before any retry', async () => {
    const server = new FakeServer(); const c = new Fake(); c.faults.create = 'rejected';
    const r = await publish(server, c, sha);
    expect(r.report).toEqual({ p_attempt: 1, p_outcome: 'failed' });
    server.apply(r.report as ReportArgs);
    expect((await publish(server, c, sha)).refused).toBe('not-prepared');
  });

  it('a state that is not prepared never starts a transfer (ready, published, unknown)', async () => {
    for (const status of ['ready', 'published', 'dispatched', 'uncertain', 'conflict', 'failed']) {
      const server = new FakeServer(); server.status = status; const c = new Fake();
      expect((await publish(server, c, sha)).refused).toBe('not-prepared');
      expect(c.calls).toEqual([]);
    }
    const broken: Fence = { snapshot: async () => { throw new Error('down'); }, dispatch: async () => ({}) };
    expect((await publish(broken, new Fake(), sha)).refused).toBe('snapshot-unavailable');
    const junk: Fence = { snapshot: async () => ({ nope: 1 }), dispatch: async () => ({}) };
    expect((await publish(junk, new Fake(), sha)).refused).toBe('snapshot-unavailable');
  });

  it('a server that releases something different from the preview: nothing is sent, reported as nothing created', async () => {
    const server = new FakeServer(); const c = new Fake();
    const real = server.dispatch.bind(server);
    server.dispatch = async (a: number) => { const p = (await real(a)) as TransferPacket; return { ...p, body: p.body.replace('jumps', 'moves') }; };
    const r = await publish(server, c, sha);
    expect(r).toMatchObject({ refused: 'integrity-after-release', calls: 0, report: { p_attempt: 1, p_outcome: 'failed' } });
    expect(c.calls).toEqual([]);
  });

  it('an update edits the SAME issue (never a second create) and verifies the number', async () => {
    const c = new Fake(); const made = c.seed();
    const body2 = `Category: bug\nProblem: The pin still jumps when zooming\nSteps to reproduce: Not provided\nExpected and actual: Not provided\nBuild: web 1.2\nAcceptance hint: None\n\nFeedback reference: ${MARKER}`;
    const server = new FakeServer(); server.operation = 'update'; server.issueNumber = made.number; server.body = body2; server.attempt = 2;
    const r = await publish(server, c, sha);
    expect(creates(c)).toBe(1); expect(c.calls).toContain('update'); expect(c.issues).toHaveLength(1);
    expect(r.report).toMatchObject({ p_attempt: 2, p_outcome: 'updated', p_number: made.number, p_readback_hash: readbackHash(TITLE, body2, sha) });
    const trusted = parseSnapshot({ status: 'dispatched', attempt: 2, version: 2, marker: MARKER, expected_hash: readbackHash(TITLE, body2, sha), operation: 'update', issue_number: made.number, since: null, packet: null }) as Snapshot;
    expect(verifyIssue(trusted, c.issues[0]!, sha)).toEqual({ ok: true });
    expect(verifyIssue(trusted, { ...c.issues[0]!, number: made.number + 1, url: `https://github.com/${PUBLICATION_REPO}/issues/${made.number + 1}` }, sha)).toEqual({ ok: false, reason: 'issue number does not match the recorded mapping' });
  });
});

describe('reconciliation: an empty search is NOT absence', () => {
  async function released(opts: { lost?: boolean } = {}) {
    const server = new FakeServer(); const c = new Fake();
    if (opts.lost) c.faults.create = 'timeoutAfterSuccess';
    const r = await publish(server, c, sha);
    server.apply(r.report as ReportArgs); c.faults = {};
    return { server, c };
  }
  it('remote create succeeded but the response was lost; the search index is empty; the authoritative listing finds it -> FOUND, never none_found, no second create', async () => {
    const { server, c } = await released({ lost: true });
    c.searchEmpty = true;
    const rec = await reconcile(server, c, sha);
    expect(rec.report).toMatchObject({ p_outcome: 'found', p_number: 41, p_marker: MARKER, p_readback_hash: HASH });
    expect(creates(c)).toBe(1); expect(c.issues).toHaveLength(1);
  });
  it('search empty AND the listing never completes within the page bound -> UNCERTAIN (no create is authorized)', async () => {
    const { server, c } = await released({ lost: true });
    c.searchEmpty = true; c.listBeyondCap = true;
    const rec = await reconcile(server, c, sha);
    expect(rec.report).toEqual({ p_attempt: 1, p_outcome: 'uncertain' });
    expect(c.calls.filter((x) => x.startsWith('list'))).toHaveLength(MAX_LIST_PAGES);
    expect(creates(c)).toBe(1);
  });
  it('a later reconciliation, once the index caught up, finds the issue', async () => {
    const { server, c } = await released({ lost: true });
    c.searchEmpty = true; c.listBeyondCap = true;
    expect((await reconcile(server, c, sha)).report?.p_outcome).toBe('uncertain');
    c.searchEmpty = false; c.listBeyondCap = false;
    expect((await reconcile(server, c, sha)).report).toMatchObject({ p_outcome: 'found', p_number: 41 });
  });
  it('a search or listing timeout or malformed answer is uncertain', async () => {
    for (const f of ['search', 'list'] as const) for (const k of ['timeout', 'malformed'] as const) {
      const { server, c } = await released({ lost: true });
      c.faults[f] = k;
      expect((await reconcile(server, c, sha)).report).toEqual({ p_attempt: 1, p_outcome: 'uncertain' });
    }
  });
  it('multiple marker hits fail closed', async () => {
    const { server, c } = await released({ lost: true }); c.seed('again', BODY);
    expect((await reconcile(server, c, sha)).report).toEqual({ p_attempt: 1, p_outcome: 'multiple' });
  });
  it('a hit from another repository is never silently ignored as "nothing"', async () => {
    const { server, c } = await released({ lost: true });
    c.search = async () => [{ repo: 'someone/else', number: 5, url: 'https://github.com/someone/else/issues/5', title: 'x', body: BODY }];
    expect((await reconcile(server, c, sha)).report).toEqual({ p_attempt: 1, p_outcome: 'uncertain' });
  });
  it('a read-back that differs is reported as evidence (the server then fails closed)', async () => {
    const { server, c } = await released({ lost: true });
    c.rewrite = (i) => ({ ...i, title: 'Changed title' });
    const rec = await reconcile(server, c, sha);
    expect(rec.report?.p_outcome).toBe('found'); expect(rec.report?.p_readback_hash).not.toBe(HASH);
  });
  it('a COMPLETE listing with no hit across several pages is absence, with the evidence of what was checked', async () => {
    const { server, c } = await released();
    server.status = 'uncertain'; server.issueNumber = null;   // (the answer was lost) while the remote never had the issue
    c.issues = [];                                            // the remote never had it (a rejection / true timeout before the create)
    for (let i = 0; i < 5; i++) c.seed(`Other ${i}`, `Category: bug\nProblem: unrelated ${i}\n\nFeedback reference: OSFB-aaaaaaaaaaaaaaaaaaa${i}`);
    const rec = await reconcile(server, c, sha);
    expect(rec.report).toMatchObject({ p_attempt: 1, p_outcome: 'none_found', p_complete: true, p_pages: 3, p_scanned: 5 });
    expect(typeof rec.report?.p_since).toBe('string');
  });
  it('nothing to reconcile unless an attempt was released; an unreadable reference is uncertain', async () => {
    for (const status of ['ready', 'prepared', 'published']) {
      const server = new FakeServer(); server.status = status;
      expect(await reconcile(server, new Fake(), sha)).toMatchObject({ refused: 'nothing-to-reconcile', calls: 0 });
    }
    const server = new FakeServer(); server.status = 'dispatched'; server.dispatchedAt = '2026-11-01T05:00:00.000Z'; server.tamper = (p) => ({ ...p, body: p.body.replace('jumps', 'moves') });
    const c = new Fake();
    expect((await reconcile(server, c, sha)).report).toEqual({ p_attempt: 1, p_outcome: 'uncertain' });
    expect(c.calls).toEqual([]);
  });
  it('late results of an OLDER attempt are refused by the server fence', async () => {
    const { server, c } = await released({ lost: true });
    const rec = await reconcile(server, c, sha); server.apply(rec.report as ReportArgs);   // found -> published... then a NEW attempt is prepared
    server.status = 'uncertain'; server.dispatchedAt = '2026-11-01T05:00:00.000Z';
    server.apply({ p_attempt: 1, p_outcome: 'none_found', p_since: '2026-11-01T04:40:00.000Z', p_pages: 1, p_scanned: 0, p_complete: true });
    server.prepare();
    expect(() => server.apply({ p_attempt: 1, p_outcome: 'failed' })).toThrow('stale attempt');
    expect(() => server.apply({ p_attempt: 1, p_outcome: 'uncertain' })).toThrow('stale attempt');
    expect(server.status).toBe('prepared');
  });
});

describe('evidence and verification helpers', () => {
  it.each([
    ['wrong repository', { repo: 'someone/else' }, 'wrong repository'],
    ['url that does not match', { url: 'https://github.com/vindexholdings/open-stall/issues/99' }, 'url does not match the issue number'],
    ['another marker', { body: BODY.replace(MARKER, 'OSFB-ffffffffffffffffffff') }, 'marker does not match'],
    ['edited text', { title: 'Changed title' }, 'text does not match the approved snapshot'],
  ])('verifyIssue refuses %s', (_n, over, reason) => {
    const trusted = { status: 'dispatched', attempt: 1, version: 1, marker: MARKER, expected_hash: HASH, operation: 'create' as const, issue_number: null, since: null, packet: null };
    const base: ConnectorIssue = { repo: PUBLICATION_REPO, number: 41, url: `https://github.com/${PUBLICATION_REPO}/issues/41`, title: TITLE, body: BODY };
    expect(verifyIssue(trusted, { ...base, ...over }, sha)).toEqual({ ok: false, reason });
  });
  it('evidence takes the marker from the READ-BACK body, and is null when absent', () => {
    const issue: ConnectorIssue = { repo: PUBLICATION_REPO, number: 3, url: `https://github.com/${PUBLICATION_REPO}/issues/3`, title: TITLE, body: 'no reference here' };
    expect(evidenceFrom(1, 'found', issue, sha).p_marker).toBeNull();
    expect(evidenceFrom(1, 'found', { ...issue, body: BODY }, sha).p_marker).toBe(MARKER);
    expect(evidenceFrom(4, 'found', { ...issue, body: BODY }, sha).p_attempt).toBe(4);
  });
  it('parseConnectorIssue refuses malformed shapes', () => {
    expect(parseConnectorIssue({ repo: 'a/b', number: 0, url: 'x', title: 't', body: 'b' })).toBeNull();
    expect(parseConnectorIssue('x')).toBeNull();
  });
  it('the protocol takes NO caller-supplied retry flags', () => { expect(publish.length).toBe(3); expect(reconcile.length).toBe(3); });
});
