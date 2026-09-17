/**
 * vector-store.js
 * Client-side IndexedDB vector storage and semantic similarity engine.
 * Enables zero-leak semantic search over conversation history and
 * intelligent dynamic suggestion chips using on-device Needle embeddings.
 */

/* exported VectorStore */

class VectorStore {
  constructor(dbName = 'agentcy_vectors', storeName = 'embeddings') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async saveMessageVector(id, sessionId, role, text, vector) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const record = {
        id: String(id),
        sessionId,
        role,
        text,
        vector,
        timestamp: Date.now()
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async search(queryVector, topK = 3, minScore = 0.55) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.getAll();

      req.onsuccess = () => {
        const records = req.result || [];
        const scored = [];

        for (const rec of records) {
          if (!rec.vector) continue;
          const score = this.cosineSimilarity(queryVector, rec.vector);
          if (score >= minScore) {
            scored.push({
              id: rec.id,
              text: rec.text,
              role: rec.role,
              score,
              timestamp: rec.timestamp
            });
          }
        }

        scored.sort((a, b) => b.score - a.score);
        resolve(scored.slice(0, topK));
      };

      req.onerror = () => reject(req.error);
    });
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// Global instance
const vectorStore = new VectorStore();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VectorStore, vectorStore };
}
