export class ChromaVectorCollection {
  constructor(collection, dimension) {
    this.collection = collection;
    this.dimension = dimension;
  }

  async upsert(records) {
    const list = Array.isArray(records) ? records : [records];
    for (const record of list) {
      if (!Array.isArray(record.vector) || record.vector.length !== this.dimension) {
        throw new Error(`Chroma vector dimension mismatch: expected ${this.dimension}`);
      }
      if (typeof record.text !== 'string' || !record.text.trim()) {
        throw new Error('Chroma records require non-empty source text');
      }
      if (!record.metadata?.source || typeof record.metadata.chunk_index !== 'number') {
        throw new Error('Chroma records require source and numeric chunk_index metadata');
      }
    }

    await this.collection.upsert({
      ids: list.map(record => record.id),
      embeddings: list.map(record => record.vector),
      documents: list.map(record => record.text),
      metadatas: list.map(record => record.metadata)
    });
    return { upsertedCount: list.length };
  }

  async get(id) {
    const result = await this.collection.get({
      ids: [id],
      include: ['embeddings', 'documents', 'metadatas']
    });
    if (!result.ids.length) return null;
    return {
      id: result.ids[0],
      vector: result.embeddings?.[0] ?? [],
      text: result.documents?.[0] ?? '',
      metadata: result.metadatas?.[0] ?? {}
    };
  }

  async deleteDocumentChunks(documentId) {
    const result = await this.collection.get({ where: { source: documentId } });
    const ids = result.ids ?? [];
    if (ids.length > 0) await this.collection.delete({ ids });
    return ids.length;
  }

  async query(queryVector, topK = 5) {
    if (queryVector.length !== this.dimension) {
      throw new Error(`Chroma query vector dimension mismatch: expected ${this.dimension}, got ${queryVector.length}`);
    }
    const result = await this.collection.query({
      queryEmbeddings: [queryVector],
      nResults: topK,
      include: ['distances', 'documents', 'metadatas']
    });
    const ids = result.ids?.[0] ?? [];
    return ids.map((id, index) => {
      const distance = result.distances?.[0]?.[index] ?? 1;
      return {
        id,
        score: 1 - distance,
        distance,
        text: result.documents?.[0]?.[index] ?? '',
        metadata: result.metadatas?.[0]?.[index] ?? {}
      };
    });
  }
}
