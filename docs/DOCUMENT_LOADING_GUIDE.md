# Document Loading and Multi-Format Intake Guide

> **Milestone:** 3.19 — Document loading and multi-format intake  
> **System:** AeroRAG Airline Procedure Intelligence  
> **Module:** `backend/src/rag/documentLoader.js` & `backend/src/utils/textExtractor.js`

---

## 1. Overview & Objectives

In airline flight operations and safety engineering, standard operating procedures (SOPs), Quick Reference Handbooks (QRHs), Flight Crew Training Manuals (FCTMs), safety directives, and regulatory compliance bulletins arrive in heterogeneous file formats from various OEM airframers and regulatory authorities (Boeing, Airbus, FAA, EASA, ICAO).

Milestone 3.19 implements an enterprise-grade, modular intake pipeline capable of:
1. Ingesting multiple document formats (**PDF**, **DOCX**, **Plain Text**, and **Markdown**, with additional **HTML** support).
2. Preserving document identity, origin filename, content type, and structural metadata.
3. Enforcing rigorous **security boundaries** by treating all uploaded documents as **untrusted input**.
4. Identifying **scanned image-only PDFs** requiring an Optical Character Recognition (OCR) pipeline rather than silently treating them as complete.
5. Providing resilient directory-level corpus intake (`loadCorpus`) that gracefully survives corrupted, missing, or unsupported documents without halting batch execution.

---

## 2. Architecture & Modular Loaders

The intake system utilizes a modular loader pattern governed by an extensible `BaseLoader` interface and a central format registry.

```
                              ┌─────────────────────────┐
                              │     loadDocument()      │
                              │  (Validation & Security)│
                              └────────────┬────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
           ┌────────▼────────┐    ┌────────▼────────┐    ┌────────▼────────┐
           │    PdfLoader    │    │   DocxLoader    │    │ MarkdownLoader  │
           │ (PDFJS streams) │    │(Mammoth OpenXML)│    │(Headings & Body)│
           └────────┬────────┘    └────────┬────────┘    └────────┬────────┘
                    │                      │                      │
           ┌────────▼────────┐    ┌────────▼────────┐             │
           │   TextLoader    │    │   HtmlLoader    │             │
           │ (UTF-8 w/ BOM)  │    │ (Tag/CSS Strip) │             │
           └────────┬────────┘    └────────┬────────┘             │
                    │                      │                      │
                    └──────────────────────┼──────────────────────┘
                                           │
                              ┌────────────▼────────────┐
                              │ Text & Path Sanitizer   │
                              │ (Redact Paths & Scripts)│
                              └────────────┬────────────┘
                                           │
                              ┌────────────▼────────────┐
                              │ Normalized Document DTO │
                              │ (id, status, metadata)  │
                              └─────────────────────────┘
```

### 2.1 Concrete Loader Implementations

| Loader Class | Format | MIME Type | Underlying Engine | Key Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| `PdfLoader` | `pdf` | `application/pdf` | PDFJS (v1.10.100 build) | Extracts multi-page text streams; computes exact page count; detects scanned/image-only PDFs. |
| `DocxLoader` | `docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | Mammoth OpenXML Parser | Extracts raw body paragraphs and lists; isolates text runs; ignores active macros/scripts. |
| `TextLoader` | `txt` | `text/plain` | Native UTF-8 Reader | Strips UTF-8 Byte Order Marks (`\uFEFF`); normalizes newlines; estimates page equivalents. |
| `MarkdownLoader` | `md`, `markdown` | `text/markdown` | Native Markdown Parser | Parses procedural headings (`#`, `##`, `###`) into structured metadata; preserves checklists. |
| `HtmlLoader` | `html`, `htm` | `text/html` | Regex / Clean Parser | Strips `<script>`, `<style>`, `<noscript>`, and inline markup; extracts plain procedure text. |

---

## 3. Security Model: Untrusted Input Protections

Uploaded flight operations documents may originate from external sources, untrusted third-party vendors, or compromised network shares. AeroRAG implements strict defensive security policies.

### 3.1 Server Filesystem Path Redaction
* **Zero Path Leakage:** Internal host paths (such as `C:\Users\username\...` or `/var/app/storage/...`) are strictly redacted.
* **Virtual Relative Paths:** All document records and error reports present sanitized virtual paths in the format `documents/<sanitized_filename>`.
* **Path Traversal Defense:** Inputs containing traversal tokens (`../`, `..\`, null bytes `\0`, or special control characters) are sanitized to prevent directory traversal attacks.

### 3.2 Executable Content Neutralization
* **DOCX Macro Isolation:** The loader extracts text strictly from OpenXML paragraph and run structures (`w:p`, `w:r`, `w:t`). Embedded VBA macros (`vbaProject.bin`), OLE objects, and external DTD entity resolutions are disabled.
* **PDF Script Neutralization:** The PDF parser accesses text streams exclusively via `getTextContent()`. It never parses or executes PDF action dictionaries such as `/Launch`, `/JavaScript`, `/SubmitForm`, or embedded attachments.
* **HTML/Markdown Sanitization:** Text extracted from HTML and Markdown documents is stripped of `<script>`, `<iframe>`, `<object>`, `<embed>`, inline event handlers (`onload=`, `onerror=`), and `javascript:` pseudoprotocols via `sanitizeExtractedText()`.

---

## 4. Scanned PDF Detection (OCR Handoff)

A critical hazard in aviation document indexing is the silent failure of scanned flight logs, maintenance signatures, or physical manual scans that contain images rather than embedded font glyphs. A naive parser reports successful extraction with zero or near-zero characters, polluting the vector store with empty documents.

### Detection Mechanism
1. The `PdfLoader` parses page streams and computes total extractable character count.
2. If `pageCount >= 1` and `charCount < ocrCharThreshold` (default: 35 characters):
   - The document status is set to `'REQUIRES_OCR'`.
   - `isScanned: true` and `requiresOcr: true` are recorded.
   - `metadata.ocrReason` is populated with diagnostic context:
     `"Document has 1 page(s) with only 0 extractable character(s); scanned image or non-text PDF detected"`.
   - In `loadCorpus()`, such documents are segregated into `ocrRequiredDocs` for handoff to a Vision/OCR pipeline (e.g. Tesseract or Cloud Vision).

---

## 5. File Validation and Size Limits

The ingestion pipeline validates document integrity prior to deep parsing:

1. **Existence & Type Check:** Verifies the target path exists and is a regular file. Directory inputs throw `DocumentLoaderError`. Missing files throw `DocumentNotFoundError`.
2. **Empty File Guard:** Files with `0 bytes` or whitespace-only content throw `EmptyDocumentError` (or return `status: 'FAILED'` with `throwOnError: false`).
3. **Configurable Size Limits:** Default maximum file size is **25 MB** (`DEFAULT_MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024`). Files exceeding the threshold throw `DocumentSizeExceededError` detailing the actual vs. allowable size.
4. **Unsupported Format Guard:** Files with unsupported extensions or MIME types throw `UnsupportedFormatError`, reporting the attempted format alongside the list of allowed formats (`pdf, docx, txt, md, html`).
5. **Corrupted File Recovery:** Damaged PDF headers or invalid DOCX zip central directories throw `CorruptedDocumentError` without crashing host processes.

---

## 6. Document Data Transfer Object (DTO) Schema

A successful `loadDocument()` call produces a normalized schema:

```typescript
interface LoadedDocument {
  id: string;               // Deterministic hash ID: e.g. "doc_a1b2c3d4e5f67890"
  filename: string;         // Cleaned basename: "sop_sterile_cockpit.pdf"
  contentType: string;      // MIME type: "application/pdf"
  format: string;           // Normalized format: "pdf" | "docx" | "txt" | "md" | "html"
  text: string;             // Sanitized clean plain text
  charCount: number;        // Total characters (0 if scanned)
  wordCount: number;        // Total words (0 if scanned)
  pageCount: number;        // Actual or estimated page count
  isScanned: boolean;       // True if scanned image requiring OCR
  requiresOcr: boolean;     // Flag for downstream OCR routing
  status: 'SUCCESS' | 'REQUIRES_OCR' | 'FAILED';
  metadata: {
    sanitizedPath: string;        // Safe virtual path: "documents/sop_sterile_cockpit.pdf"
    fileSizeBytes: number;        // File size in bytes
    extractionTimestamp: string;  // ISO 8601 UTC timestamp
    extractedWith: string;        // Loader class name: "PdfLoader"
    ocrReason?: string | null;    // Explanation if requiresOcr is true
    headings?: Array<{ level: number; title: string }>; // For Markdown
    warnings?: string[];          // For DOCX non-fatal warnings
  };
}
```

---

## 7. Extraction Limitations & Mitigations

| Limitation | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Scanned / Raster-Only Pages** | No embedded font characters; text cannot be extracted by standard PDF stream readers. | Detected automatically (`isScanned: true`, `status: 'REQUIRES_OCR'`). Routed to external OCR subsystem. |
| **Complex Multi-Column Tables** | Sequential text streams in PDFs may merge adjacent table columns horizontally. | Downstream chunking applies contextual window overlap; Markdown/DOCX preferred for structured tabular SOPs. |
| **Embedded Charts & Diagrams** | Flight profile graphs (e.g. descent profiles, approach plates) contain graphical vector or bitmap data without textual representation. | Documented as non-textual elements; future milestones introduce multimodal vision encoders for aeronautical charts. |
| **Password-Protected / Encrypted Files** | Decryption fails without master credentials. | Throws `CorruptedDocumentError` indicating protected container; must be decrypted prior to intake. |
| **VBA Macros & Embedded Executables** | Active automation scripts are stripped and ignored by design. | Security-hardened parser eliminates Remote Code Execution (RCE) attack surface. |

---

## 8. Usage Examples

### 8.1 Loading a Single Document
```javascript
import { loadDocument } from './src/rag/documentLoader.js';

// Standard load
const doc = await loadDocument('data/sample_corpus/sop_sterile_cockpit.pdf');
console.log(`Document ID: ${doc.id}`);
console.log(`Format: ${doc.format} (${doc.contentType})`);
console.log(`Characters: ${doc.charCount}, Pages: ${doc.pageCount}`);

if (doc.requiresOcr) {
  console.warn(`Routing to OCR: ${doc.metadata.ocrReason}`);
}
```

### 8.2 Safe Intake (No Throw)
```javascript
const result = await loadDocument('data/sample_corpus/unknown_file.bin', {
  throwOnError: false
});

if (result.status === 'FAILED') {
  console.error(`Skipped ${result.filename}: ${result.error}`);
}
```

### 8.3 Ingesting an Entire Directory
```javascript
import { loadCorpus } from './src/rag/documentLoader.js';

const corpus = await loadCorpus('data/sample_corpus');
console.log(`Successfully loaded: ${corpus.loadedDocs.length} documents`);
console.log(`Scanned/OCR required: ${corpus.ocrRequiredDocs.length} documents`);
console.log(`Skipped/Corrupted: ${corpus.skippedDocs.length} documents`);
```
