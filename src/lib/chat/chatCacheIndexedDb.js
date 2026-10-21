// Native IndexedDB storage for instant session switching & draft recovery without network lag.
// ponytail: using standard IndexedDB without external idb library. Upgrade to idb if complex queries/migrations needed.

const DB_NAME = "9router_chat_cache";
const DB_VERSION = 1;
const STORE_TRANSCRIPTS = "transcripts";
const STORE_DRAFTS = "drafts";

let dbPromise = null;

function getDb() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_TRANSCRIPTS)) {
          db.createObjectStore(STORE_TRANSCRIPTS, { keyPath: "sessionId" });
        }
        if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
          db.createObjectStore(STORE_DRAFTS, { keyPath: "sessionId" });
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

export async function getCachedTranscript(sessionId) {
  if (!sessionId) return null;
  const db = await getDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_TRANSCRIPTS, "readonly");
      const store = tx.objectStore(STORE_TRANSCRIPTS);
      const req = store.get(sessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedTranscript(sessionId, data) {
  if (!sessionId || !data) return;
  const db = await getDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_TRANSCRIPTS, "readwrite");
      const store = tx.objectStore(STORE_TRANSCRIPTS);
      store.put({
        sessionId,
        messages: Array.isArray(data.messages) ? data.messages : [],
        tasks: Array.isArray(data.tasks) ? data.tasks : [],
        teamState: data.teamState || null,
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function deleteCachedTranscript(sessionId) {
  if (!sessionId) return;
  const db = await getDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_TRANSCRIPTS, "readwrite");
      const store = tx.objectStore(STORE_TRANSCRIPTS);
      store.delete(sessionId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getCachedDraft(sessionId) {
  if (!sessionId) return null;
  const db = await getDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_DRAFTS, "readonly");
      const store = tx.objectStore(STORE_DRAFTS);
      const req = store.get(sessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedDraft(sessionId, draftText, attachments = []) {
  if (!sessionId) return;
  const db = await getDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_DRAFTS, "readwrite");
      const store = tx.objectStore(STORE_DRAFTS);
      if (!draftText && (!attachments || attachments.length === 0)) {
        store.delete(sessionId);
      } else {
        store.put({
          sessionId,
          draft: String(draftText || ""),
          attachments: Array.isArray(attachments) ? attachments : [],
          updatedAt: Date.now(),
        });
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function clearCachedDraft(sessionId) {
  if (!sessionId) return;
  const db = await getDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_DRAFTS, "readwrite");
      const store = tx.objectStore(STORE_DRAFTS);
      store.delete(sessionId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
