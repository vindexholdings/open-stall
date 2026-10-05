import { describe, expect, it, vi } from 'vitest';
import {
  addFavorite, checkIn, deleteAccount, fetchMyReview, fetchPreferences, listFavorites, savePreferences, submitEdit,
  submitNewLocation, submitReport, submitReview, type RpcClientLike,
} from './api';

const ok = (data: unknown) => ({ rpc: vi.fn(async () => ({ data, error: null })) }) satisfies RpcClientLike;
const err = (e: object) => ({ rpc: vi.fn(async () => ({ data: null, error: e })) }) satisfies RpcClientLike;
const ID = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d5e';
const row = { id: ID, name: 'Park', address_line: null, city: null, region: null, postal_code: null, latitude: 1, longitude: 2, verification: 'verified',
  last_verified_at: null, opening_hours: null, fee_required: null, key_required: null, purchase_required: null, wheelchair_accessible: null,
  gender_neutral: null, baby_changing: null, has_hot_water: null, has_cold_water: null, access_location: null, average_rating: null, rating_count: 0,
  attribution: null, distance_m: null };

describe('account api', () => {
  it('reads preferences defensively', async () => {
    const r = await fetchPreferences(ok([{ display_name: 'Sam', preferred_mode: 'risque', default_transport: 'bike' }]));
    expect(r).toEqual({ ok: true, preferences: { mode: 'risque', transport: 'bike', displayName: 'Sam' } });
    const bad = await fetchPreferences(ok([{ display_name: '<x>', preferred_mode: 'zzz', default_transport: 'fly' }]));
    expect(bad).toMatchObject({ ok: true, preferences: { mode: 'plain', transport: 'walk', displayName: null } });
  });

  it('sends exactly the expected rpc arguments', async () => {
    const c = ok(null);
    await savePreferences(c, { mode: 'plain', transport: 'walk', displayName: null });
    expect(c.rpc).toHaveBeenCalledWith('update_my_profile', { p_display_name: null, p_mode: 'plain', p_transport: 'walk' });
    const f = ok({ count: 2, limit: 5 });
    expect(await addFavorite(f, ID)).toEqual({ ok: true, count: 2, limit: 5 });
    await checkIn(c, ID, { latitude: 1, longitude: 2 });
    expect(c.rpc).toHaveBeenCalledWith('check_in', { p_location: ID, p_lat: 1, p_lng: 2 });
    await submitNewLocation(c, { name: 'x' }, { latitude: 44.5, longitude: -109, accuracyM: 12 }, null);
    expect(c.rpc).toHaveBeenCalledWith('submit_location', { p_proposed: { name: 'x' }, p_lat: 44.5, p_lng: -109, p_accuracy_m: 12, p_attested: true, p_note: null });
    expect(await submitNewLocation(ok({ coalesced: true }), { name: 'x' }, { latitude: 1, longitude: 2, accuracyM: 5 }, null)).toEqual({ ok: true, coalesced: true });
    expect(await submitNewLocation(ok({ coalesced: false, submission_id: 'abc' }), { name: 'x' }, { latitude: 1, longitude: 2, accuracyM: 5 }, null)).toEqual({ ok: true, coalesced: false });
    expect(await submitNewLocation(err({ code: '22023', message: 'restroom already listed nearby' }), { name: 'x' }, { latitude: 1, longitude: 2, accuracyM: 5 }, null))
      .toMatchObject({ ok: false, message: expect.stringMatching(/already on the map/) });
    await submitEdit(c, ID, { fee_required: true }, 'n');
    expect(c.rpc).toHaveBeenCalledWith('submit_location_edit', { p_location: ID, p_proposed: { fee_required: true }, p_attested: true, p_note: 'n' });
    await submitReport(c, ID, 'closed', '  ');
    expect(c.rpc).toHaveBeenCalledWith('submit_report', { p_location: ID, p_issue: 'closed', p_comment: null });
    await submitReview(c, ID, 4, 'plain', ['clean']);
    expect(c.rpc).toHaveBeenCalledWith('submit_review', { p_location: ID, p_rating: 4, p_mode: 'plain', p_observations: ['clean'] });
    await deleteAccount(c);
    expect(c.rpc).toHaveBeenCalledWith('delete_my_account', { p_confirm: 'DELETE' });
  });

  it('drops malformed favorite rows', async () => {
    const r = await listFavorites(ok([row, { ...row, verification: 'pending' }, { nonsense: true }]), null);
    expect(r.ok && r.locations.map((l) => l.id)).toEqual([ID]);
  });

  it('parses my review and tolerates junk', async () => {
    expect(await fetchMyReview(ok(null), ID)).toEqual({ ok: true, review: null });
    expect(await fetchMyReview(ok({ rating: 4, mode: 'risque', observations: ['clean', 7] }), ID)).toMatchObject({ review: { rating: 4, mode: 'risque', observations: ['clean', 7].filter((x) => typeof x === 'string') } });
    expect(await fetchMyReview(ok({ rating: 99 }), ID)).toEqual({ ok: true, review: null });
  });

  it('turns backend errors and thrown network errors into friendly messages', async () => {
    expect(await addFavorite(err({ code: '53400', message: 'favorites limit reached' }), ID)).toMatchObject({ ok: false, message: expect.stringMatching(/up to 5/) });
    const boom: RpcClientLike = { rpc: () => Promise.reject(new Error('Network request failed')) };
    expect(await checkIn(boom, ID, { latitude: 0, longitude: 0 })).toMatchObject({ ok: false, message: expect.stringMatching(/reach the server/) });
    const leak = await submitReport(err({ code: 'XX000', message: 'relation "public.reports" internal detail' }), ID, 'other', '');
    expect(leak).toEqual({ ok: false, message: 'Something went wrong. Please try again.' });
  });
});
