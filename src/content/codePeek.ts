import { storageService } from '../services/storage';

/**
 * Reads the public Codeforces status page, which can sort server-side by judge
 * time, so the fastest accepted solutions can be listed without an index.
 * Source pages are same-origin only, hence the fetch lives in the content script.
 */

export class CodePeekError extends Error {
  constructor(message: string, public readonly code: 'blocked' | 'unavailable' | 'empty') {
    super(message);
    this.name = 'CodePeekError';
  }
}

export interface PeerRow {
  submissionId: number;
  handle: string;
  language: string;
  ms: number;
  partyMembers: number;
}

export interface Peer extends PeerRow {
  lines: number;
  source: string;
}

export interface PeekResult {
  peers: Peer[];
  scanned: number;
  family: string | null;
}

export const MAX_PEERS = 3;
export const MAX_STATUS_PAGES = 2;
export const REQUEST_GAP_MS = 1000;
export const BLOCK_BACKOFF_MS = 60_000;
const CACHE_KEY = 'cfchart:codepeek:v1';
const CACHE_LIMIT = 50;

/** Collapse Codeforces' per-compiler language names into the families learners share techniques across. */
export function languageFamily(language: string): string {
  const value = language.toLowerCase();
  if (/c\+\+|^ms c|clang/.test(value)) return 'cpp';
  if (/pypy|python/.test(value)) return 'python';
  if (/^c#|mono|\.net|^f#/.test(value)) return 'dotnet';
  if (/rust/.test(value)) return 'rust';
  if (/^go\b/.test(value)) return 'go';
  if (/java/.test(value)) return 'java';
  if (/kotlin/.test(value)) return 'kotlin';
  if (/javascript|node\.js/.test(value)) return 'javascript';
  if (/pascal|delphi|fpc/.test(value)) return 'pascal';
  return value.split(/[\s(]/)[0] ?? value;
}

export function parseStatusRows(html: string): PeerRow[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows: PeerRow[] = [];
  for (const row of Array.from(doc.querySelectorAll('tr[data-submission-id]'))) {
    if (!row.querySelector('.verdict-accepted')) continue;
    const handle = row.querySelector('.status-party-cell a[href^="/profile/"]')?.textContent?.trim();
    const language = row.children[4]?.textContent?.trim();
    const submissionId = Number(row.getAttribute('data-submission-id'));
    if (!handle || !language || !Number.isFinite(submissionId)) continue;
    rows.push({
      submissionId,
      handle,
      language,
      ms: Number(row.querySelector('.time-consumed-cell')?.textContent?.replace(/\D/g, '') ?? 0),
      partyMembers: (row.getAttribute('partyMemberIds') ?? '').split(';').filter(Boolean).length,
    });
  }
  return rows;
}

export function parseSource(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.getElementById('program-source-text')?.textContent ?? '').replace(/\r\n/g, '\n').trimEnd();
}

/** Non-blank lines, so trailing blank lines and editor padding do not inflate the count. */
export function countLines(source: string): number {
  return source.split('\n').filter(line => line.trim()).length;
}

export function pickPeers(rows: PeerRow[], options: { family: string | null; handle: string }): PeerRow[] {
  const ownHandle = options.handle.toLowerCase();
  const seen = new Set<string>();
  const picked: PeerRow[] = [];
  for (const row of rows) {
    const key = row.handle.toLowerCase();
    if (key === ownHandle || seen.has(key)) continue;
    if (row.partyMembers > 1 || key.startsWith('vjudge.')) continue;
    if (options.family && languageFamily(row.language) !== options.family) continue;
    seen.add(key);
    picked.push(row);
    if (picked.length === MAX_PEERS) break;
  }
  return picked;
}

export function statusUrl(contestId: number, index: string, page: number): string {
  return `https://codeforces.com/problemset/status/${contestId}/problem/${index}/page/${page}?order=BY_CONSUMED_TIME_ASC`;
}

export function sourceUrl(contestId: number, submissionId: number): string {
  return `https://codeforces.com/problemset/submission/${contestId}/${submissionId}`;
}

let lastRequestAt = 0;
let blockedUntil = 0;

// shortcut: the block deadline is per page load, so a reload clears it. Upgrade to
// storage-backed backoff if Codeforces starts answering repeated loads with 403.
async function fetchPage(url: string): Promise<string> {
  if (Date.now() < blockedUntil) {
    throw new CodePeekError('Codeforces is limiting CFChart requests. Try again in a minute.', 'blocked');
  }
  const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const response = await fetch(url, { credentials: 'same-origin' });
  if (response.status === 403 || response.status === 429) {
    blockedUntil = Date.now() + BLOCK_BACKOFF_MS;
    throw new CodePeekError('Codeforces blocked this request. Try again in a minute.', 'blocked');
  }
  if (!response.ok) throw new CodePeekError(`Codeforces returned HTTP ${response.status}.`, 'unavailable');
  return response.text();
}

interface CacheEntry {
  peers: Peer[];
  scanned: number;
  updatedAt: number;
}

async function readCache(): Promise<Record<string, CacheEntry>> {
  try {
    return (await storageService.getValue<Record<string, CacheEntry>>(CACHE_KEY)) ?? {};
  } catch {
    return {};
  }
}

async function writeCache(key: string, entry: CacheEntry): Promise<void> {
  const all = await readCache();
  all[key] = entry;
  const keys = Object.keys(all);
  if (keys.length > CACHE_LIMIT) {
    keys
      .sort((a, b) => all[a].updatedAt - all[b].updatedAt)
      .slice(0, keys.length - CACHE_LIMIT)
      .forEach(stale => delete all[stale]);
  }
  try {
    await storageService.setValue(CACHE_KEY, all);
  } catch {
    /* Caching is an optimisation; a blocked store must not lose the result. */
  }
}

export interface PeekOptions {
  /** The viewer's own language, used to keep peers comparable. Unknown skips the filter. */
  language?: string;
  onPeer?: (peer: Peer) => void;
}

export async function loadPeers(contestId: number, index: string, handle: string, options: PeekOptions = {}): Promise<PeekResult> {
  const cacheKey = `${contestId}-${index}`;
  const family = options.language ? languageFamily(options.language) : null;
  const cached = (await readCache())[cacheKey];
  if (cached) {
    const peers = family ? cached.peers.filter(peer => languageFamily(peer.language) === family) : cached.peers;
    if (peers.length > 0) return { peers, scanned: cached.scanned, family };
  }

  const rows: PeerRow[] = [];
  let pages = 0;
  let picked = pickPeers(rows, { family, handle });
  while (picked.length < MAX_PEERS && pages < MAX_STATUS_PAGES) {
    pages++;
    rows.push(...parseStatusRows(await fetchPage(statusUrl(contestId, index, pages))));
    picked = pickPeers(rows, { family, handle });
  }
  if (picked.length === 0) {
    throw new CodePeekError('No other accepted solution in this language was found.', 'empty');
  }

  const peers: Peer[] = [];
  for (const row of picked) {
    try {
      const source = parseSource(await fetchPage(sourceUrl(contestId, row.submissionId)));
      if (!source) continue;
      const peer = { ...row, source, lines: countLines(source) };
      peers.push(peer);
      options.onPeer?.(peer);
    } catch (error) {
      if (peers.length > 0) break;
      throw error;
    }
  }
  if (peers.length === 0) throw new CodePeekError('Codeforces did not return the source of these solutions.', 'unavailable');

  await writeCache(cacheKey, { peers, scanned: rows.length, updatedAt: Date.now() });
  return { peers, scanned: rows.length, family };
}
