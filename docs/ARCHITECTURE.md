# AeroRAG MVP architecture

## Current request flow

1. The React/Vite client sends a bearer token to the Express API.
2. Express authenticates protected requests against a JWT and MongoDB user record. Public registration creates only the standard `ground_staff` role.
3. Admin document uploads are stored under the backend upload directory. PDF and text extraction produce chunks, which are embedded and upserted into the configured vector collection.
4. Search embeds the question and retrieves chunks. In demo mode, a lexical-overlap check removes chunks that do not share question terms with the indexed evidence; the demo answer quotes evidence instead of synthesizing operating instructions.
5. The response includes citations assembled from retrieved chunk metadata and passages. Structured model output cannot introduce citation objects that were not retrieved.
6. Authenticated search history is stored against the requesting user and is only returned for that user.

## Storage and providers

- MongoDB stores users, document metadata, and query history.
- Demo mode persists records in `data/vector_db/aerorag_chunks.json` to keep the checked-in fixture deterministic.
- In live-provider mode, the API uses the configured Chroma collection when the Chroma service is reachable. If it is unavailable, the API warns and falls back to the local JSON-backed collection.
- Google Generative AI is used when a key is configured and `DEMO_MODE` is not true. `LLM_MODEL` and `EMBEDDING_MODEL` select the provider models. With no key, demo mode is enabled.
- Files are stored locally under `uploads/`. Deleting a document removes its indexed chunks and local file.

## Important limitations

- This is an academic prototype, not an approved aviation operational system.
- Demo output is extractive-only and is not an LLM answer. Lexical retrieval is a smoke-test fallback, not production semantic ranking.
- Scanned PDFs are not OCR-processed.
- Frontend tests cover auth routing, API errors, and the citation-rendering search workflow. API rate limiting, multi-instance file/vector storage, and production-grade secrets/session management remain future work. Docker-based database/Chroma integration could not be exercised because the Docker daemon is unavailable in this environment.
- User registration is open and grants only the standard role. Provision administrator users through a controlled administrative process; never expose role assignment through public registration.
- The project targets Node.js 20 or later, in part to use React Router 7 and Node's built-in file watch mode without an extra watcher dependency.
