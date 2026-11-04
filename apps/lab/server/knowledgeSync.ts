import type { Connect, Plugin } from "vite";
import { isKind, itemChangedAt, itemDocument, wikiDeps, wikiState, type WikiKind, type WikiOptions } from "./wiki.ts";
import type { KnowledgeEntry } from "../src/domain/knowledge.ts";

/**
 * Adds a saved report to the knowledge graph. The graph reads it through the same ingest the papers use, as its own entry labelled as app-made, filed under the
 * collection "App knowledge". Saving the same item again replaces its earlier entry once the new one is stored, so the graph holds one current version.
 */
export interface SyncOptions extends WikiOptions { knowledge: (req: Request) => Promise<Response>; /** What the automatic updater is set to, so a screen can say an update will happen by itself. */ auto?: () => Promise<{ wiki: boolean; graph: boolean; quietMinutes: number }> }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export const MODELS = ["muse-wonder-1.0", "muse-spark-1.3"];
export class SyncError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export interface GraphResult { entry: KnowledgeEntry; duplicate: boolean; replaced: number }
export interface ItemStatus { changedAt: string; wiki: { saved: boolean; writtenAt?: string; stale: boolean }; graph: { saved: boolean; addedAt?: string; stale: boolean } }

// One read at a time: the knowledge base reads one document at once, and both the button and the automatic updater use it.
let turn: Promise<unknown> = Promise.resolve();
export const withGraphLock = <T>(work: () => Promise<T>): Promise<T> => { const next = turn.catch(() => undefined).then(work); turn = next; return next; };

export function createGraphSyncer(options: SyncOptions) {
  const deps = wikiDeps(options);
  const call = (path: string, method: string, body?: unknown) => options.knowledge(new Request(`http://knowledge-sync.local${path}`, { method, headers: { origin: "http://knowledge-sync.local", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const entries = async () => ((await (await call("/api/knowledge", "GET")).json()) as { entries?: KnowledgeEntry[] }).entries ?? [];
  // The knowledge base deletes an entry only when asked with confirmed: true, as it does for a paper.
  const remove = (entryId: string) => call(`/api/knowledge/${entryId}`, "DELETE", { confirmed: true });
  // A failed read leaves a failed entry behind. Clear the ones for this item so a retry starts clean and the Papers tab is not left with debris.
  const clearFailed = async (kind: string, id: string) => { for (const e of (await entries()).filter(x => x.status === "failed" && x.origin?.kind === kind && x.origin?.id === id)) await remove(e.id); };
  return {
    deps, entries,
    /** Where an item stands: is it in the wiki and the graph, and has it changed since each copy was made? */
    async status(kind: WikiKind, id: string, known?: KnowledgeEntry[]): Promise<ItemStatus> {
      const changedAt = await itemChangedAt(deps, kind, id), wiki = await wikiState(deps, kind, id);
      const graphAt = (known ?? await entries()).filter(e => e.origin?.kind === kind && e.origin?.id === id && e.status === "stored").map(e => e.addedAt).sort().at(-1);
      return { changedAt, wiki: { saved: wiki.saved, ...(wiki.writtenAt ? { writtenAt: wiki.writtenAt } : {}), stale: !!wiki.writtenAt && changedAt > wiki.writtenAt }, graph: { saved: !!graphAt, ...(graphAt ? { addedAt: graphAt } : {}), stale: !!graphAt && changedAt > graphAt } };
    },
    /** Reads the item into the graph. The item's earlier entry goes only after the new one is stored. */
    sync(kind: WikiKind, id: string, model = MODELS[0]!): Promise<GraphResult> {
      return withGraphLock(async () => {
        const doc = await itemDocument(deps, kind, id); await clearFailed(kind, id);
        const response = await call("/api/knowledge/ingest", "POST", { confirmed: true, model, title: doc.title, text: doc.text, origin: { kind, id, paperId: doc.paperId } });
        const data = await response.json() as { entry?: KnowledgeEntry; duplicate?: boolean; error?: string };
        if (!response.ok || !data.entry) { await clearFailed(kind, id).catch(() => undefined); throw new SyncError(data.error ?? "The knowledge graph could not read this.", response.status >= 400 ? response.status : 400); }
        let replaced = 0;
        if (data.entry.status === "stored") for (const old of (await entries()).filter(e => e.origin?.kind === kind && e.origin?.id === id && e.id !== data.entry!.id && e.status === "stored")) if ((await remove(old.id)).ok) replaced++;
        return { entry: data.entry, duplicate: data.duplicate === true, replaced };
      });
    },
  };
}

export function createSyncHandler(options: SyncOptions) {
  const syncer = createGraphSyncer(options);
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/api/graph-sync/status") {
      try {
        const kind = url.searchParams.get("kind"), id = url.searchParams.get("id"); if (!isKind(kind) || !id) return json({ error: "Choose an item." }, 400);
        const auto = options.auto ? await options.auto().catch(() => null) : null;
        return json({ ...(await syncer.status(kind, id)), ...(auto ? { auto } : {}) });
      } catch (error) { return json({ error: error instanceof Error ? error.message.slice(0, 300) : "Could not read the item." }, 400); }
    }
    if (req.method !== "POST" || url.pathname !== "/api/graph-sync/graph") return json({ error: "Unknown knowledge sync operation." }, 404);
    if (req.headers.get("origin") !== url.origin || (req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin")) return json({ error: "Use knowledge sync from this app." }, 403);
    try {
      const body = JSON.parse(await req.text()) as Record<string, unknown>;
      if (!isKind(body.kind) || typeof body.id !== "string" || body.confirmed !== true) return json({ error: "Confirm adding this to the knowledge graph first." }, 400);
      const model = body.model === undefined ? MODELS[0]! : body.model; if (typeof model !== "string" || !MODELS.includes(model)) return json({ error: "Select a supported Muse model." }, 400);
      return json(await syncer.sync(body.kind, body.id, model));
    } catch (error) { return json({ error: error instanceof Error ? error.message.slice(0, 400) : "Knowledge sync failed." }, error instanceof SyncError ? error.status : 400); }
  };
}

export function knowledgeSyncPlugin(options: SyncOptions): Plugin {
  const handle = createSyncHandler(options);
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/graph-sync")) return next();
    try {
      const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 20_000) { res.statusCode = 413; res.end(JSON.stringify({ error: "Request too large." })); return; } chunks.push(chunk as Buffer); }
      const headers = new Headers(); for (const name of ["origin", "sec-fetch-site", "content-type"]) { const value = req.headers[name]; if (typeof value === "string") headers.set(name, value); }
      const response = await handle(new Request(new URL(req.url, `http://${req.headers.host ?? "localhost"}`), { method: req.method, headers, ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }));
      res.statusCode = response.status; response.headers.forEach((v, k) => res.setHeader(k, v)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.statusCode = 500; res.end(JSON.stringify({ error: "Knowledge sync failed." })); }
  };
  return { name: "local-knowledge-sync", configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
