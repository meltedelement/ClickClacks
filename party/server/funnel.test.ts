import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFunnelStatus } from './funnel.ts';

test('a funnel on 443 to a local port is found, without the :443', () => {
  const status = {
    TCP: { 443: { HTTPS: true } },
    Web: { 'box.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } } } },
    AllowFunnel: { 'box.tail1.ts.net:443': true },
  };
  assert.deepEqual(parseFunnelStatus(JSON.stringify(status)), [{ url: 'https://box.tail1.ts.net/', port: 8080 }]);
});

test('other public ports and mount paths are kept in the URL', () => {
  const status = {
    Web: { 'box.tail1.ts.net:8443': { Handlers: { '/quiz': { Proxy: 'http://localhost:3001' } } } },
    AllowFunnel: { 'box.tail1.ts.net:8443': true },
  };
  assert.deepEqual(parseFunnelStatus(JSON.stringify(status)), [{ url: 'https://box.tail1.ts.net:8443/quiz/', port: 3001 }]);
});

test('tailnet-only serves, other machines and junk give nothing', () => {
  const serveOnly = { Web: { 'box.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8080' } } } } };
  assert.deepEqual(parseFunnelStatus(JSON.stringify(serveOnly)), []);
  const elsewhere = {
    Web: { 'box.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://192.168.1.9:8080' } } } },
    AllowFunnel: { 'box.tail1.ts.net:443': true },
  };
  assert.deepEqual(parseFunnelStatus(JSON.stringify(elsewhere)), []);
  assert.deepEqual(parseFunnelStatus('{}'), []);
  assert.deepEqual(parseFunnelStatus('not json'), []);
});
