import { describe, expect, it } from 'vitest';
import {
  ConnectorError, PUBLICATION_REPO, evidenceFrom, normalizeText, parseConnectorIssue, parsePacket, publish, readbackHash, reconcile, verifyIssue,
  type Connector, type ConnectorIssue, type TransferPacket,
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
const BODY = `Category: bug\nProblem: The pin jumps when zooming on the map screen\n\nFeedback reference: ${MARKER}`;
const packet = (over: Partial<TransferPacket> = {}): TransferPacket => ({ repo: PUBLICATION_REPO, operation: 'create', issue_number: null, marker: MARKER, version: 1, title: TITLE, body: BODY, expected_hash: readbackHash(TITLE, BODY, sha), ...over });

/** A synthetic connector: an in-memory repository with scripted faults. It records every call so tests can prove what was (not) attempted. */
class Fake implements Connector {
  issues: ConnectorIssue[] = [];
  calls: string[] = [];
  next = 41;
  faults: Partial<Record<'create' | 'update' | 'search' | 'read', 'timeout' | 'timeoutAfterSuccess' | 'rejected' | 'malformed'>> = {};
  rewrite?: (i: ConnectorIssue) => ConnectorIssue;
  private add(title: string, body: string): ConnectorIssue {
    const i = { repo: PUBLICATION_REPO, number: this.next++, url: `https://github.com/${PUBLICATION_REPO}/issues/${this.next - 1}`, title, body };
    this.issues.push(i); return i;
  }
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
    return this.issues.filter((i) => i.body.includes(a.marker));
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

describe('packet validation (what the private system issues)', () => {
  it('accepts exactly the allowlisted fields', () => { expect(parsePacket(packet())).toEqual(packet()); });
  it.each([
    ['another repository', { repo: 'someone/else' }], ['an unknown operation', { operation: 'delete' as 'create' }], ['a create with an issue number', { issue_number: 3 }],
    ['an update without a number', { operation: 'update' as const }], ['a malformed marker', { marker: 'OSFB-xyz' }], ['a body without the reference line', { body: 'Problem: x' }],
    ['a body with another marker', { body: `Problem: x\n\nFeedback reference: OSFB-ffffffffffffffffffff` }], ['a bad hash', { expected_hash: 'abc' }], ['version 0', { version: 0 }],
  ])('refuses %s', (_n, over) => { expect(parsePacket(packet(over as Partial<TransferPacket>))).toBeNull(); });
  it('refuses an extra field (never a serialization of private data)', () => { expect(parsePacket({ ...packet(), issue_id: 'x' })).toBeNull(); });
  it('refuses non-objects', () => { expect(parsePacket(null)).toBeNull(); expect(parsePacket('x')).toBeNull(); expect(parsePacket([])).toBeNull(); });
});

describe('read-back hashing', () => {
  it('tolerates only line endings and trailing whitespace', () => {
    expect(readbackHash(TITLE, BODY.replace(/\n/g, '\r\n') + '\r\n', sha)).toBe(packet().expected_hash);
    expect(readbackHash(TITLE, BODY.replace('jumps', 'moves'), sha)).not.toBe(packet().expected_hash);
    expect(readbackHash(TITLE + '!', BODY, sha)).not.toBe(packet().expected_hash);
    expect(normalizeText('a\r\nb  \n')).toBe('a\nb');
  });
});

describe('transfer protocol with a synthetic connector', () => {
  it('success + read-back: reports verified evidence', async () => {
    const c = new Fake();
    const r = await publish(packet(), c, sha);
    expect(c.calls).toEqual(['create', 'read']);
    expect(r.report).toMatchObject({ p_outcome: 'created', p_repo: PUBLICATION_REPO, p_number: 41, p_url: `https://github.com/${PUBLICATION_REPO}/issues/41`, p_marker: MARKER, p_readback_hash: packet().expected_hash });
    const issue = parseConnectorIssue(c.issues[0])!;
    expect(verifyIssue(packet(), issue, sha)).toEqual({ ok: true });
  });

  it('a create response is never trusted: a forged answer whose read-back differs is reported as evidence, not success', async () => {
    const c = new Fake();
    c.rewrite = (i) => ({ ...i, body: i.body.replace('jumps', 'moves') });
    const r = await publish(packet(), c, sha);
    expect(r.report.p_outcome).toBe('created');
    expect(r.report.p_readback_hash).not.toBe(packet().expected_hash);   // the server compares and fails closed
    expect(verifyIssue(packet(), parseConnectorIssue(c.rewrite!(c.issues[0]!))!, sha)).toEqual({ ok: false, reason: 'text does not match the approved snapshot' });
  });

  it('timeout AFTER remote success -> uncertain; reconcile finds exactly one verified issue (never a second create)', async () => {
    const c = new Fake(); c.faults.create = 'timeoutAfterSuccess';
    const first = await publish(packet(), c, sha);
    expect(first.report).toEqual({ p_outcome: 'uncertain' });
    expect(c.issues).toHaveLength(1);                        // it WAS created: a timeout proves nothing
    c.faults = {};
    const again = await publish(packet(), c, sha, { afterUncertain: true });   // refused: reconcile first
    expect(again).toMatchObject({ refused: 'reconcile-first', calls: 0 });
    expect(c.calls.filter((x) => x === 'create')).toHaveLength(1);
    const rec = await reconcile(packet(), c, sha);
    expect(rec).toMatchObject({ p_outcome: 'found', p_number: 41, p_marker: MARKER, p_readback_hash: packet().expected_hash });
    expect(c.issues).toHaveLength(1);
  });

  it('timeout BEFORE the create -> uncertain; reconcile finds nothing; only then a create may be retried', async () => {
    const c = new Fake(); c.faults.create = 'timeout';
    expect((await publish(packet(), c, sha)).report).toEqual({ p_outcome: 'uncertain' });
    expect(c.issues).toHaveLength(0);
    c.faults = {};
    expect((await publish(packet(), c, sha, { afterUncertain: true })).refused).toBe('reconcile-first');
    expect(await reconcile(packet(), c, sha)).toEqual({ p_outcome: 'none_found' });
    const r = await publish(packet(), c, sha, { afterUncertain: true, reconciledNone: true });
    expect(r.report.p_outcome).toBe('created');
    expect(c.issues).toHaveLength(1);
  });

  it('an issue with the marker already exists -> reconcile reports it found (no duplicate create)', async () => {
    const c = new Fake(); await c.create({ repo: PUBLICATION_REPO, title: TITLE, body: BODY });
    const rec = await reconcile(packet(), c, sha);
    expect(rec).toMatchObject({ p_outcome: 'found', p_number: 41 });
    expect(c.calls.filter((x) => x === 'create')).toHaveLength(1);
  });

  it('several issues carry the marker -> multiple (fail closed)', async () => {
    const c = new Fake(); await c.create({ repo: PUBLICATION_REPO, title: TITLE, body: BODY }); await c.create({ repo: PUBLICATION_REPO, title: 'again', body: BODY });
    expect(await reconcile(packet(), c, sha)).toEqual({ p_outcome: 'multiple' });
  });

  it('a malformed or unreadable connector answer is uncertain, never success', async () => {
    for (const f of ['create', 'read'] as const) {
      const c = new Fake(); c.faults[f] = f === 'create' ? 'malformed' : 'malformed';
      expect((await publish(packet(), c, sha)).report).toEqual({ p_outcome: 'uncertain' });
    }
    const c = new Fake(); c.faults.read = 'timeout';
    expect((await publish(packet(), c, sha)).report).toEqual({ p_outcome: 'uncertain' });   // created remotely but unverified: reconcile
    expect(c.issues).toHaveLength(1);
    const d = new Fake(); d.faults.search = 'malformed';
    expect(await reconcile(packet(), d, sha)).toEqual({ p_outcome: 'uncertain' });
    const e = new Fake(); e.faults.search = 'timeout';
    expect(await reconcile(packet(), e, sha)).toEqual({ p_outcome: 'uncertain' });
  });

  it('a search that returns a hit from another repository is not "nothing found"', async () => {
    const c = new Fake();
    c.search = async () => [{ repo: 'someone/else', number: 5, url: 'https://github.com/someone/else/issues/5', title: 'x', body: BODY }];
    expect(await reconcile(packet(), c, sha)).toEqual({ p_outcome: 'uncertain' });
  });

  it('a definitive rejection is failed (nothing was created)', async () => {
    const c = new Fake(); c.faults.create = 'rejected';
    expect((await publish(packet(), c, sha)).report).toEqual({ p_outcome: 'failed' });
  });

  it('wrong repository, version or shape in the packet: nothing is sent to the connector at all', async () => {
    const c = new Fake();
    for (const bad of [{ ...packet(), repo: 'someone/else' }, { ...packet(), marker: 'x' }, { ...packet(), issue_id: 'x' }, null]) {
      const r = await publish(bad, c, sha);
      expect(r).toMatchObject({ refused: 'invalid-packet', calls: 0 });
    }
    expect(await reconcile({ ...packet(), repo: 'someone/else' }, c, sha)).toEqual({ p_outcome: 'uncertain' });
    expect(c.calls).toEqual([]);
  });

  it('an update edits the SAME issue (never a second create) and verifies the number', async () => {
    const c = new Fake(); const made = await c.create({ repo: PUBLICATION_REPO, title: TITLE, body: BODY }) as ConnectorIssue;
    const body2 = `Category: bug\nProblem: The pin still jumps when zooming\n\nFeedback reference: ${MARKER}`;
    const p2 = packet({ operation: 'update', issue_number: made.number, version: 2, body: body2, expected_hash: readbackHash(TITLE, body2, sha) });
    const r = await publish(p2, c, sha);
    expect(c.calls.filter((x) => x === 'create')).toHaveLength(1);
    expect(c.calls).toContain('update');
    expect(r.report).toMatchObject({ p_outcome: 'updated', p_number: made.number, p_readback_hash: p2.expected_hash });
    expect(c.issues).toHaveLength(1);
    expect(verifyIssue(p2, c.issues[0]!, sha)).toEqual({ ok: true });
    expect(verifyIssue(p2, { ...c.issues[0]!, number: made.number + 1, url: `https://github.com/${PUBLICATION_REPO}/issues/${made.number + 1}` }, sha)).toEqual({ ok: false, reason: 'issue number does not match the recorded mapping' });
  });

  it.each([
    ['wrong repository', { repo: 'someone/else' }, 'wrong repository'],
    ['url that does not match', { url: 'https://github.com/vindexholdings/open-stall/issues/99' }, 'url does not match the issue number'],
    ['another marker', { body: BODY.replace(MARKER, 'OSFB-ffffffffffffffffffff') }, 'marker does not match'],
    ['edited text', { title: 'Changed title' }, 'text does not match the approved snapshot'],
  ])('verifyIssue refuses %s', (_n, over, reason) => {
    const base: ConnectorIssue = { repo: PUBLICATION_REPO, number: 41, url: `https://github.com/${PUBLICATION_REPO}/issues/41`, title: TITLE, body: BODY };
    expect(verifyIssue(packet(), { ...base, ...over }, sha)).toEqual({ ok: false, reason });
  });

  it('evidence takes the marker from the READ-BACK body, and is null when absent', () => {
    const issue: ConnectorIssue = { repo: PUBLICATION_REPO, number: 3, url: `https://github.com/${PUBLICATION_REPO}/issues/3`, title: TITLE, body: 'no reference here' };
    expect(evidenceFrom('found', issue, sha).p_marker).toBeNull();
    expect(evidenceFrom('found', { ...issue, body: BODY }, sha).p_marker).toBe(MARKER);
  });

  it('secret- or PII-bearing text never needs to be handled here: the packet has no raw fields and a forged extra field is refused', () => {
    expect(parsePacket({ ...packet(), submitter: 'x', raw: 'RAWSECRET' })).toBeNull();
  });
});
