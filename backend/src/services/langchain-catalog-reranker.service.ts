type Candidate = { canonical: string; confidence: number };

/**
 * Optional LangChain-backed reranker.
 * If LangChain is not installed, AppGenCatalogService falls back to lexical ranking.
 */
export class LangChainCatalogRerankerService {
  async rerank(_query: string, candidates: Candidate[]): Promise<Candidate[]> {
    // Retrieval/prompt assembly can be upgraded to full LangChain components when package is installed.
    // For now, keep deterministic order from lexical rank.
    return candidates;
  }
}

