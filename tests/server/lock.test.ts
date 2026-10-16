import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

describe('the optional password', () => {
  it('is off by default and everything is open', async () => {
    const { call } = testApp();
    expect((await call('GET', '/api/lock')).body).toEqual({ on: false });
    expect((await call('GET', '/api/config')).status).toBe(200);
  });

  it('refuses to set an empty password', async () => {
    const { call } = testApp();
    expect((await call('PUT', '/api/lock', { password: '  ' })).status).toBe(400);
    expect((await call('GET', '/api/lock')).body).toEqual({ on: false });
  });

  it('locks every data route once set, and the password unlocks a tab', async () => {
    const { call, app } = testApp();
    const set = (await call('PUT', '/api/lock', { password: 'open sesame' })).body;
    expect(set.on).toBe(true);
    expect(typeof set.token).toBe('string'); // the tab that set it stays open
    expect((await call('GET', '/api/lock')).body).toEqual({ on: true });
    const locked = await call('GET', '/api/config');
    expect(locked.status).toBe(401);
    expect(locked.body.locked).toBe(true);
    expect((await call('GET', '/api/portfolio')).status).toBe(401);
    expect((await call('GET', '/api/export.csv')).status).toBe(401);
    expect((await call('GET', '/api/health')).status).toBe(200);

    expect((await call('POST', '/api/unlock', { password: 'nope' })).status).toBe(401);
    const { token } = (await call('POST', '/api/unlock', { password: 'open sesame' })).body;
    expect(typeof token).toBe('string');
    const withHeader = await app.request('/api/config', { headers: { 'x-unlock': token } });
    expect(withHeader.status).toBe(200);
    const withQuery = await app.request(`/api/export.csv?unlock=${token}`);
    expect(withQuery.status).toBe(200);

    // Lock now: the token stops working.
    await app.request('/api/unlock', { method: 'DELETE', headers: { 'x-unlock': token } });
    expect((await app.request('/api/config', { headers: { 'x-unlock': token } })).status).toBe(401);
  });

  it('needs the unlock to change or remove the password, then opens everything again', async () => {
    const { call, app } = testApp();
    await call('PUT', '/api/lock', { password: 'first' });
    expect((await call('PUT', '/api/lock', { password: 'second' })).status).toBe(401);
    expect((await call('DELETE', '/api/lock')).status).toBe(401);
    const { token } = (await call('POST', '/api/unlock', { password: 'first' })).body;
    const off = await app.request('/api/lock', { method: 'DELETE', headers: { 'x-unlock': token } });
    expect(await off.json()).toEqual({ on: false });
    expect((await call('GET', '/api/config')).status).toBe(200);
    expect(typeof (await call('PUT', '/api/lock', { password: 'third' })).body.token).toBe('string');
  });
});
