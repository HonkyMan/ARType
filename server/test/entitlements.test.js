import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProductAccess } from '../src/entitlements.js';

const now = new Date('2026-10-20T12:00:00Z');
const owner = { role: 'owner', status: 'active', product_enabled: false };
const describe = (member, paid = false, tenantStatus = 'active') =>
  describeProductAccess(member, tenantStatus, null, paid, '2026-10-01', now);

test('management-only state applies only to an enabled owner account', () => {
  assert.equal(describe(owner).app_status, 'management_only');
  assert.equal(describe({ ...owner, status: 'disabled' }).app_status, 'disabled');
  assert.equal(describe({ ...owner, status: 'invited', expires_at: '2026-10-01' }).app_status, 'disabled');
});

test('payment grants product access only while membership and organization remain enabled', () => {
  const member = { role: 'member', status: 'active', product_enabled: true };
  assert.equal(describe(member).app_status, 'awaiting_payment');
  assert.equal(describe(member, true).can_translate, true);
  assert.equal(describe(member, true).paid_until, '2026-11-01T00:00:00.000Z');
  assert.equal(describe({ ...member, product_enabled: false }, true).can_translate, false);
  assert.equal(describe({ ...member, status: 'disabled' }, true).can_translate, false);
  assert.equal(describe(member, true, 'suspended').app_status, 'suspended');
});
