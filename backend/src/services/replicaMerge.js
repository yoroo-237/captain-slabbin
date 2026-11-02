// Re-importing a replica ("update from the bot") must not wipe what the user changed
// by hand in the editor. We keep a compact fingerprint of what the last import produced
// (look._imported); on the next import we 3-way merge: for each page and field, if the
// current value still matches that fingerprint it was not touched, so we take the fresh
// capture; if it differs the user edited it, so we keep their version. New captured
// pages are added; pages dropped upstream are removed only when the user had not edited
// them. The fingerprint is small (one short hash per page) so it fits the style size cap.

import crypto from 'node:crypto';

const sha = v => crypto.createHash('sha1').update(typeof v === 'string' ? v : JSON.stringify(v ?? null)).digest('hex').slice(0, 12);

// What the import produced, hashed, to compare against next time
export function fingerprint(look = {}) {
  return {
    pages: Object.fromEntries((look.pages || []).map(p => [p.key, sha(p)])),
    profile: sha(look.profile ?? null),
    invoice: sha(look.invoice ?? null),
    catalog: look.catalog ?? null,
    home: look.home ?? null,
  };
}

export function mergeReplicaLook(existing = {}, incoming = {}) {
  const base = existing._imported;
  // First import (or no fingerprint yet): take the capture as is, record its fingerprint
  if (!base) return { ...incoming, _imported: fingerprint(incoming) };

  const basePages = base.pages || {};
  const existingByKey = new Map((existing.pages || []).map(p => [p.key, p]));
  const incomingKeys = new Set((incoming.pages || []).map(p => p.key));
  const pages = [];
  // Fresh capture order, each page: the user's edit wins, else the new version
  for (const p of incoming.pages || []) {
    const cur = existingByKey.get(p.key);
    pages.push(cur && sha(cur) !== basePages[p.key] ? cur : p);
  }
  // Pages gone from the capture: kept only if the user added or edited them
  for (const p of existing.pages || []) {
    if (incomingKeys.has(p.key)) continue;
    const wasImported = p.key in basePages;
    if (!wasImported || sha(p) !== basePages[p.key]) pages.push(p);
  }

  // A captured field: nothing new → keep current; user edited → keep theirs; else refresh
  const field = key => {
    if (incoming[key] == null) return existing[key];
    return sha(existing[key] ?? null) !== base[key] ? existing[key] : incoming[key];
  };
  // A scalar the fingerprint stores by value (catalog, home)
  const scalar = key => ((existing[key] ?? null) !== (base[key] ?? null) ? existing[key] : incoming[key]);

  const merged = {
    ...incoming,
    pages,
    profile: field('profile'),
    invoice: field('invoice'),
    review: incoming.review, // always the fresh list from this capture
    ...(scalar('catalog') != null ? { catalog: scalar('catalog') } : {}),
    ...(scalar('home') != null ? { home: scalar('home') } : {}),
  };
  // Keep any extra top-level keys the user added that the capture doesn't produce
  for (const k of Object.keys(existing)) if (!(k in merged) && k !== '_imported') merged[k] = existing[k];
  merged._imported = fingerprint(incoming);
  return merged;
}
