import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Offline only: stop both writers and back up both files before installing output.
export function importGardenSnapshots(garden, target) {
  if (!garden || typeof garden !== 'object' || Array.isArray(garden)) throw Error('Invalid Garden store');
  const entries = Array.isArray(target) ? target : target?.entries;
  if (!Array.isArray(entries)) throw Error('Invalid Agent Snapshots store');
  const result = structuredClone(entries);
  const ids = new Map(result.map(r => [r.id, r]));
  if (ids.size !== result.length) throw Error('Duplicate target IDs');
  let imported = 0, identical = 0;
  const iso = value => {
    if (!Number.isFinite(value)) throw Error('Invalid Garden timestamp');
    return new Date(value).toISOString();
  };
  for (const [id, record] of Object.entries(garden)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) || record.id !== id) throw Error('Invalid source ID');
    const snapshot = record.data?.snapshot ?? record.data;
    if (!snapshot || !Array.isArray(snapshot.turns)) throw Error(`Invalid snapshot: ${id}`);
    const converted = {
      id, title: snapshot.title || record.title || 'Session Snapshot',
      engine: snapshot.engine || 'codex', engineLabel: snapshot.engineLabel || 'Codex',
      createdAt: iso(record.createdAt), updatedAt: iso(record.updatedAt ?? record.createdAt),
      redacted: snapshot.redacted === true, turnCount: snapshot.turns.length,
      snapshot: structuredClone(snapshot),
      ...(record.expiresAt != null ? { expiresAt: iso(record.expiresAt) } : {}),
      ...(snapshot.ref ? { sourceRef: snapshot.ref } : {}),
      ...(record.ownerUserId === 'garden:snapshot-publisher' || record.ownerUserId === 'github:157952394'
        ? { owner: { id: '157952394', login: 'ffffhx' } } : {}),
    };
    const prior = ids.get(id);
    if (prior) {
      if (!isDeepStrictEqual(prior.snapshot, converted.snapshot) || Date.parse(prior.createdAt) !== Date.parse(converted.createdAt) || Date.parse(prior.updatedAt) !== Date.parse(converted.updatedAt) || (prior.expiresAt || null) !== (converted.expiresAt || null)) throw Error(`Conflicting target ID: ${id}`);
      identical++;
      continue;
    }
    result.push(converted); ids.set(id, converted); imported++;
  }
  return { store: { ...(Array.isArray(target) ? {} : target), schemaVersion: 1, updatedAt: new Date().toISOString(), entries: result }, report: { imported, identical, prior: entries.length, total: result.length } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, target, output] = process.argv.slice(2);
  if (!output) throw Error('Usage: node scripts/import-garden-snapshots.mjs garden.json shares.json output.json');
  const { store, report } = importGardenSnapshots(JSON.parse(fs.readFileSync(source, 'utf8')), JSON.parse(fs.readFileSync(target, 'utf8')));
  fs.writeFileSync(output, JSON.stringify(store, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
}
