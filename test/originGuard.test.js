const test = require('node:test');
const assert = require('node:assert/strict');

const { makeOriginGuard } = require('../src/lib/originGuard');

const allowed = makeOriginGuard(3000);
const req = (origin) => ({ headers: origin === false ? {} : { origin } });

test('origin guard', async (t) => {
  await t.test('allows the app talking to itself', () => {
    assert.equal(allowed(req('http://127.0.0.1:3000')), true);
    assert.equal(allowed(req('http://localhost:3000')), true);
    assert.equal(allowed(req('http://[::1]:3000')), true);
  });

  await t.test('allows requests with no Origin at all', () => {
    // curl, the Electron main process, a top-level navigation. Not a browser
    // cross-origin request, so there is nothing to defend against.
    assert.equal(allowed(req(false)), true);
  });

  await t.test('refuses another site', () => {
    assert.equal(allowed(req('https://evil.example')), false);
    assert.equal(allowed(req('http://evil.example')), false);
  });

  await t.test('refuses a null origin', () => {
    // What a sandboxed iframe or a data: URL sends. Attacker-reachable, so it
    // must not be treated the same as a missing header.
    assert.equal(allowed(req('null')), false);
  });

  await t.test('refuses loopback on a different port', () => {
    // Another local dev server is not this one, and localhost is not a trust
    // boundary between applications.
    assert.equal(allowed(req('http://127.0.0.1:3001')), false);
    assert.equal(allowed(req('http://localhost:8080')), false);
  });

  await t.test('refuses https on the right port', () => {
    // The server only ever speaks http. An https origin on the same port is
    // some other thing entirely.
    assert.equal(allowed(req('https://127.0.0.1:3000')), false);
  });

  await t.test('refuses lookalike hosts', () => {
    assert.equal(allowed(req('http://127.0.0.1.evil.example:3000')), false);
    assert.equal(allowed(req('http://localhost.evil.example:3000')), false);
    assert.equal(allowed(req('http://notlocalhost:3000')), false);
  });

  await t.test('is bound to the port it was built for', () => {
    const onOtherPort = makeOriginGuard(3200);
    assert.equal(onOtherPort(req('http://127.0.0.1:3200')), true);
    assert.equal(onOtherPort(req('http://127.0.0.1:3000')), false);
  });
});
