# AeroRAG

AeroRAG is an academic document-search and retrieval-augmented generation prototype for airline procedure material. It provides authenticated search, source passages, document metadata, explicit supersession fields, and admin-only uploads.

> **Safety notice:** This project is not an approved aviation operational system, does not certify regulatory compliance, and must not replace authorized manuals or operational decisions. Verify every procedure with the responsible document owner.

## Current MVP

- React/Vite responsive client with login/registration, authenticated search, source passage cards, document library, personal search history, and admin document upload.
- Express API with JWT authentication, standard-user registration, admin-gated upload/update/delete, file-size/type checks, and user-scoped history.
- PDF and TXT ingestion with chunk metadata, local persistent vectors for demo mode, and a Chroma adapter for live-provider mode.
- Google Generative AI when configured; without credentials, deterministic demo mode uses lexical filtering and extractive responses rather than inventing instructions.
- Citation metadata is built from retrieved chunks, not from model-provided source claims.

## Requirements

- Node.js 20+
- Docker Desktop (or a local MongoDB server)
- A Google Generative AI API key only for live provider mode

## Local setup

1. Configure backend environment:

   ```powershell
   Copy-Item .env.example .env
   ```

   Keep `DEMO_MODE=true` to run without a model key. Set a private random `JWT_SECRET`.

2. Start local MongoDB:

   ```powershell
   docker compose up -d mongodb chroma
   ```

   MongoDB and ChromaDB are bound to loopback for local development only. Demo mode intentionally uses the checked-in local vector fixture; when live-provider mode is enabled, the API uses ChromaDB if available and falls back to local persistence.

3. Install and start the API:

   ```powershell
   npm --prefix backend ci --legacy-peer-deps
   npm --prefix backend start
   ```

   For development with automatic restarts, use `npm --prefix backend run dev`.

   API: `http://localhost:5000`; health: `http://localhost:5000/api/health`.

4. Configure and start the frontend in a second terminal:

   ```powershell
   Copy-Item frontend/.env.example frontend/.env.local
   npm --prefix frontend ci
   npm --prefix frontend run dev
   ```

   Client: `http://localhost:5173`. Vite only exposes `VITE_*` values to the browser; never put secrets in frontend env files.

5. Register an account. Public registration creates only `ground_staff` accounts. To create or promote an administrator, use `npm --prefix backend run admin:bootstrap` with `ADMIN_BOOTSTRAP_CONFIRM=I_UNDERSTAND`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` set temporarily in the process environment. Never expose this operation through the public API or commit the credentials.

For live generation, set `GOOGLE_API_KEY`, `DEMO_MODE=false`, and the desired `LLM_MODEL` / `EMBEDDING_MODEL` in the backend `.env`. Never commit credentials.

## Tests and evaluation

```powershell
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run build
```

The backend tests use Node's built-in test runner and synthetic/local fixture data. The evaluation runner is maintained in the separate RAG evaluation pull request; its scores use deterministic demo mode and are not measurements of live-model performance.

GitHub Actions runs the backend tests, frontend tests, and frontend production build on pull requests and pushes to `main`.

## API overview

| Method | Route | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | Public | Dependency and demo status |
| `GET` | `/api/health/live` | Public | Liveness probe |
| `GET` | `/api/health/ready` | Public | MongoDB readiness |
| `POST` | `/api/auth/register` | Public | Create standard user account |
| `POST` | `/api/auth/login` | Public | Authenticate |
| `GET` | `/api/auth/me` | User | Current user |
| `GET` | `/api/documents` | User | List available documents |
| `GET` | `/api/documents/:id` | User | Document metadata |
| `POST` | `/api/documents/upload` | Admin | Upload and index PDF/TXT |
| `PUT/DELETE` | `/api/documents/:id` | Admin | Edit metadata / remove document |
| `POST` | `/api/rag/query` | User | Ask a question with retrieved citations |
| `GET` | `/api/rag/history` | User | Read own latest 50 searches |

## Architecture and limitations

See [MVP architecture and data flow](docs/ARCHITECTURE.md).

- MongoDB stores users, document metadata, and search history. `docker-compose.yml` is for local development and does not configure production authentication.
- Demo mode uses the checked-in JSON-backed vector fixture. Live-provider mode uses Chroma when reachable and falls back to local persistence with a warning.
- Demo retrieval uses lexical overlap, not semantic ranking; demo responses quote retrieved evidence and do not synthesize answers.
- Live model provider errors are surfaced. Citation cards always originate from retrieved chunk metadata and passages.
- Scanned PDF OCR, API rate limiting, production-grade secret/session management, and deployment-grade multi-instance storage are not implemented.
- Upload and local vector data are local to the API host; this is not a multi-instance deployment design.

## Existing technical artifacts

Earlier focused work includes [grounded settings](docs/GROUNDED_SETTINGS.md), [structured output guide](docs/STRUCTURED_OUTPUT_GUIDE.md), [vector database guide](docs/VECTOR_DATABASE_GUIDE.md), and the parameter, structured-output, and vector-store experiment result files in `docs/`.
