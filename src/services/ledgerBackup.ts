import type { EnrichedProblem, PracticeEvent, PracticeLedger, PracticeOutcome } from '../recommender/types';
import type { RecSlot, RecommendedProblem } from '../types/codeforces';
import { getProblemUrl } from './codeforcesApi';

export interface SyncStorageAdapter {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

const VALID_OUTCOMES = new Set<PracticeOutcome>([
  'independent',
  'assisted',
  'timeout',
  'skipped',
  'interrupted',
  'already-solved',
  'accepted',
]);

const VALID_SLOTS = new Set<RecSlot>([
  'core',
  'stretch',
  'warmup',
  'revisit',
  'upsolve',
  'timed',
  'guided',
  'transfer',
]);

const SLOT_LABELS: Record<RecSlot, string> = {
  timed: 'Timed practice',
  guided: 'Guided study',
  transfer: 'Transfer probe',
  revisit: 'Independent review',
  upsolve: 'Upsolve',
  core: 'Core practice',
  stretch: 'Stretch',
  warmup: 'Warmup',
};

const MAX_SYNC_CHUNKS = 8;
const MAX_CHUNK_BYTES = 6400;
const MAX_SYNC_REMOVED = 30;

interface CompactSyncEvent {
  id: string;
  k: string;
  o: PracticeOutcome;
  t: number;
  r?: number;
  m?: number;
  s?: RecSlot;
  g?: string[];
}

interface SyncBackupMeta {
  v: 1;
  updatedAt: number;
  chunks: number;
  removedSolves?: { day: string; problemKey: string }[];
}

export type CatalogLookup = (problemKey: string) => EnrichedProblem | undefined;

const metaKey = (handle: string) => `cfchart:sync:v1:${handle.toLowerCase()}:meta`;
const chunkKey = (handle: string, idx: number) => `cfchart:sync:v1:${handle.toLowerCase()}:c${idx}`;

function parseProblemKey(key: string): { contestId: number; index: string } | null {
  const match = /^(\d+)-([A-Za-z0-9_]+)$/.exec(key);
  if (!match) return null;
  return { contestId: Number(match[1]), index: match[2].toUpperCase() };
}

function hydrateProblem(
  key: string,
  partial: Partial<RecommendedProblem> | undefined,
  lookup?: CatalogLookup
): RecommendedProblem | null {
  const parsed = parseProblemKey(key);
  if (!parsed) return null;
  const cat = lookup?.(key);
  const slot: RecSlot = partial?.slot && VALID_SLOTS.has(partial.slot) ? partial.slot : 'core';
  const rating =
    typeof partial?.rating === 'number' && Number.isFinite(partial.rating)
      ? partial.rating
      : cat && Number.isFinite(cat.rating)
        ? cat.rating!
        : 1400;
  const tags =
    Array.isArray(partial?.tags) && partial.tags.length
      ? partial.tags.filter((t): t is string => typeof t === 'string')
      : cat?.tags ?? [];
  return {
    contestId: parsed.contestId,
    index: parsed.index,
    name: typeof partial?.name === 'string' && partial.name ? partial.name : cat?.name ?? `Problem ${parsed.contestId}${parsed.index}`,
    rating,
    tags,
    slot,
    slotLabel: SLOT_LABELS[slot],
    pSolve: null,
    plannedMinutes:
      typeof partial?.plannedMinutes === 'number' && Number.isFinite(partial.plannedMinutes)
        ? partial.plannedMinutes
        : slot === 'revisit'
          ? 20
          : slot === 'stretch'
            ? 40
            : 30,
    reasons: Array.isArray(partial?.reasons) ? partial.reasons.filter((r): r is string => typeof r === 'string') : [],
    qualityScore: cat ? cat.qualityScore : typeof partial?.qualityScore === 'number' ? partial.qualityScore : 1,
    url: getProblemUrl(parsed.contestId, parsed.index),
  };
}

function toCompactEvent(event: PracticeEvent): CompactSyncEvent {
  const compact: CompactSyncEvent = {
    id: event.id,
    k: event.problemKey,
    o: event.outcome,
    t: Math.round(event.timestamp),
  };
  if (Number.isFinite(event.problem?.rating)) compact.r = event.problem.rating;
  if (typeof event.minutes === 'number' && Number.isFinite(event.minutes) && event.minutes >= 0) {
    compact.m = Math.round(event.minutes * 10) / 10;
  }
  if (event.problem?.slot && VALID_SLOTS.has(event.problem.slot)) compact.s = event.problem.slot;
  if (event.problem?.tags?.length) compact.g = event.problem.tags.slice(0, 6);
  return compact;
}

function fromCompactEvent(raw: unknown, lookup?: CatalogLookup): PracticeEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<CompactSyncEvent>;
  if (
    typeof item.id !== 'string' ||
    !item.id ||
    typeof item.k !== 'string' ||
    !parseProblemKey(item.k) ||
    typeof item.o !== 'string' ||
    !VALID_OUTCOMES.has(item.o as PracticeOutcome) ||
    typeof item.t !== 'number' ||
    !Number.isFinite(item.t)
  ) {
    return null;
  }
  const problem = hydrateProblem(
    item.k,
    {
      rating: item.r,
      slot: item.s,
      tags: item.g,
    },
    lookup
  );
  if (!problem) return null;
  return {
    version: 1,
    id: item.id,
    problemKey: item.k,
    outcome: item.o as PracticeOutcome,
    ...(typeof item.m === 'number' && Number.isFinite(item.m) ? { minutes: item.m } : {}),
    timestamp: item.t,
    problem,
    provenance: 'self-report',
  };
}

export async function writeSyncBackup(
  sync: SyncStorageAdapter | undefined,
  handle: string,
  ledger: PracticeLedger,
  nowMs: number
): Promise<void> {
  if (!sync) return;
  try {
    const selfReports = ledger.events
      .filter(e => e.provenance === 'self-report')
      .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));

    // Pack newest-first into size-bounded chunks so recent history is always retained if quota is tight
    const newestFirst = [...selfReports].reverse().map(toCompactEvent);
    const chunks: CompactSyncEvent[][] = [];
    let current: CompactSyncEvent[] = [];
    let currentBytes = 2; // "[]"

    for (const item of newestFirst) {
      const itemBytes = JSON.stringify(item).length + 1;
      if (current.length > 0 && currentBytes + itemBytes > MAX_CHUNK_BYTES) {
        chunks.push(current);
        if (chunks.length >= MAX_SYNC_CHUNKS) {
          current = [];
          break;
        }
        current = [item];
        currentBytes = 2 + itemBytes;
      } else {
        current.push(item);
        currentBytes += itemBytes;
      }
    }
    if (current.length > 0 && chunks.length < MAX_SYNC_CHUNKS) {
      chunks.push(current);
    }

    const prevMeta = (await sync.get(metaKey(handle)))[metaKey(handle)] as SyncBackupMeta | undefined;
    const prevChunks = typeof prevMeta?.chunks === 'number' ? prevMeta.chunks : 0;

    const payload: Record<string, unknown> = {
      [metaKey(handle)]: {
        v: 1,
        updatedAt: nowMs,
        chunks: chunks.length,
        ...(ledger.removedSolves?.length ? { removedSolves: ledger.removedSolves.slice(-MAX_SYNC_REMOVED) } : {}),
      } satisfies SyncBackupMeta,
    };
    for (let i = 0; i < chunks.length; i++) {
      payload[chunkKey(handle, i)] = chunks[i];
    }
    await sync.set(payload);

    if (prevChunks > chunks.length) {
      const staleKeys: string[] = [];
      for (let i = chunks.length; i < Math.min(prevChunks, MAX_SYNC_CHUNKS); i++) {
        staleKeys.push(chunkKey(handle, i));
      }
      if (staleKeys.length) await sync.remove(staleKeys);
    }
  } catch {
    // Best-effort sync mirror: never break local practice storage on sync quota or offline errors.
  }
}

export async function readSyncBackup(
  sync: SyncStorageAdapter | undefined,
  handle: string,
  lookup?: CatalogLookup
): Promise<{ events: PracticeEvent[]; removedSolves: { day: string; problemKey: string }[] } | null> {
  if (!sync) return null;
  try {
    const mKey = metaKey(handle);
    const meta = (await sync.get(mKey))[mKey] as SyncBackupMeta | undefined;
    if (!meta || meta.v !== 1 || typeof meta.chunks !== 'number') return null;
    const count = Math.max(0, Math.min(MAX_SYNC_CHUNKS, Math.floor(meta.chunks)));
    const events: PracticeEvent[] = [];
    if (count > 0) {
      const keys = Array.from({ length: count }, (_, i) => chunkKey(handle, i));
      const data = await sync.get(keys);
      for (const k of keys) {
        const list = data[k];
        if (!Array.isArray(list)) continue;
        for (const raw of list) {
          const parsed = fromCompactEvent(raw, lookup);
          if (parsed) events.push(parsed);
        }
      }
    }
    events.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    const removedSolves = Array.isArray(meta.removedSolves)
      ? meta.removedSolves.filter(
          (r): r is { day: string; problemKey: string } =>
            Boolean(r) &&
            typeof r.day === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(r.day) &&
            typeof r.problemKey === 'string' &&
            Boolean(parseProblemKey(r.problemKey))
        )
      : [];
    if (!events.length && !removedSolves.length) return null;
    return { events, removedSolves };
  } catch {
    return null;
  }
}

export async function clearSyncBackup(sync: SyncStorageAdapter | undefined, handle: string): Promise<void> {
  if (!sync) return;
  try {
    const keys = [metaKey(handle), ...Array.from({ length: MAX_SYNC_CHUNKS }, (_, i) => chunkKey(handle, i))];
    await sync.remove(keys);
  } catch {
    // Ignore sync clear errors
  }
}

export function parsePracticeBackupPayload(
  payload: unknown,
  lookup?: CatalogLookup
): { events: PracticeEvent[]; removedSolves: { day: string; problemKey: string }[] } {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid backup file: expected a JSON object.');
  }
  const obj = payload as Record<string, unknown>;
  const ledgerRaw = obj.ledger && typeof obj.ledger === 'object' ? (obj.ledger as Record<string, unknown>) : obj;
  if (!Array.isArray(ledgerRaw.events)) {
    throw new Error('Invalid backup file: missing practice events.');
  }

  const events: PracticeEvent[] = [];
  for (const raw of ledgerRaw.events) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null;
    const key = typeof item.problemKey === 'string' ? item.problemKey.trim() : null;
    const outcome = typeof item.outcome === 'string' && VALID_OUTCOMES.has(item.outcome as PracticeOutcome)
      ? (item.outcome as PracticeOutcome)
      : null;
    const timestamp = typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? item.timestamp : null;
    if (!id || !key || !outcome || timestamp === null) continue;
    const problem = hydrateProblem(
      key,
      item.problem && typeof item.problem === 'object' ? (item.problem as Partial<RecommendedProblem>) : undefined,
      lookup
    );
    if (!problem) continue;
    const provenance = item.provenance === 'codeforces-api' ? 'codeforces-api' : 'self-report';
    const minutes =
      typeof item.minutes === 'number' && Number.isFinite(item.minutes) && item.minutes >= 0 && item.minutes <= 600
        ? item.minutes
        : undefined;
    events.push({
      version: 1,
      id,
      problemKey: key,
      outcome,
      ...(minutes !== undefined ? { minutes } : {}),
      timestamp,
      problem,
      provenance,
    });
  }

  const removedSolves = Array.isArray(ledgerRaw.removedSolves)
    ? ledgerRaw.removedSolves.filter(
        (r): r is { day: string; problemKey: string } =>
          Boolean(r) &&
          typeof (r as { day?: unknown }).day === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test((r as { day: string }).day) &&
          typeof (r as { problemKey?: unknown }).problemKey === 'string' &&
          Boolean(parseProblemKey((r as { problemKey: string }).problemKey))
      )
    : [];

  return { events, removedSolves };
}

export function mergeRestoredLedger(
  base: PracticeLedger,
  restored: { events: PracticeEvent[]; removedSolves: { day: string; problemKey: string }[] }
): { ledger: PracticeLedger; addedEvents: number } {
  const byId = new Map(base.events.map(e => [e.id, e]));
  let addedEvents = 0;
  for (const ev of restored.events) {
    if (!byId.has(ev.id)) {
      byId.set(ev.id, ev);
      addedEvents++;
    }
  }
  const mergedEvents = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));

  const removedSet = new Set((base.removedSolves ?? []).map(r => `${r.day}:${r.problemKey}`));
  const mergedRemoved = [...(base.removedSolves ?? [])];
  for (const r of restored.removedSolves) {
    const rk = `${r.day}:${r.problemKey}`;
    if (!removedSet.has(rk)) {
      removedSet.add(rk);
      mergedRemoved.push(r);
    }
  }

  return {
    ledger: {
      ...base,
      events: mergedEvents,
      ...(mergedRemoved.length ? { removedSolves: mergedRemoved } : {}),
    },
    addedEvents,
  };
}
