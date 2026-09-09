import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importGardenSnapshots } from './import-garden-snapshots.mjs';
const source = { snap_A: { id: 'snap_A', createdAt: 1000, updatedAt: 2000, expiresAt: 3000, ownerUserId: 'garden:snapshot-publisher', data: { title: 'Original', turns: [{ text: 'Array<T>', images: [{ src: 'data:image/png;base64,eA==' }] }] } } };
test('preserves source data, timestamps, expiry and existing target records', () => {
  const original = { id: 'existing', snapshot: { turns: [] }, extra: true };
  const { store, report } = importGardenSnapshots(source, { entries: [original] });
  assert.deepEqual(store.entries[0], original);
  assert.deepEqual(store.entries[1].snapshot, source.snap_A.data);
  assert.equal(Date.parse(store.entries[1].expiresAt), 3000);
  assert.equal(store.entries[1].redacted, false);
  assert.deepEqual(report, { imported: 1, identical: 0, prior: 1, total: 2 });
  assert.equal(importGardenSnapshots(source, store).report.identical, 1);
});
test('rejects collisions and malformed input instead of overwriting', () => {
  assert.throws(() => importGardenSnapshots(source, { entries: [{ id: 'snap_A', snapshot: {} }] }), /Conflicting/);
  assert.throws(() => importGardenSnapshots(source, {}), /Invalid/);
  assert.throws(() => importGardenSnapshots({ x: { id: 'x', createdAt: 1, data: {} } }, []), /Invalid/);
});
