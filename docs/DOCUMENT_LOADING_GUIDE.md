# Document Loading & Multi-Format Intake Guide

This document details the architecture, extraction mechanics, resilience strategies, and domain mapping for **AeroRAG's** multi-format document intake pipeline (Sprint 2 · Concept 10 · 3.19).

---

## 1. Why Documents Must Be Converted to a Common Text Form

In any Retrieval-Augmented Generation (RAG) system, downstream components (chunkers, embedding models, vector databases, and Large Language Models) understand exactly one primitive: **plain text strings**.

- **Vector Embeddings Require Text Semantics:** Embedding models compute vector coordinates based on natural language word embeddings. Binary formatting, HTML tags (`<div>`, `<style>`), or PDF vector drawing instructions pollute the token space and degrade retrieval relevance.
- **Uniform Chunking:** Chunking algorithms rely on character or token counts with clean boundary splitting (e.g. paragraph and sentence breaks).
- **LLM Context Windows:** Feeding unparsed markup or raw file streams into prompt context windows consumes precious tokens without contributing factual substance.

---

## 2. Challenges of Extracting Text: PDFs vs. Plain Text & HTML

| Format | Structure & Ingestion Complexity | Key Extraction Challenges |
|---|---|---|
| **Plain Text (`.txt`)** | Linear UTF-8 character stream | Low. Line breaks and whitespace represent true text boundaries. |
| **Markdown (`.md`)** | Lightweight structured text with headers/lists | Low. Semantic headers (`#`, `##`) and bullet points can be preserved to guide recursive chunking. |
| **HTML (`.html`)** | Tree of nested DOM elements, metadata, and scripts | Medium. Presentation boilerplate (`<style>`, `<script>`, `<nav>`, `<head>`) must be stripped to isolate primary content. |
| **PDF (`.pdf`)** | PostScript-derived visual rendering description language | **High / Most Challenging:** See detailed breakdown below. |

### The Core Challenges of PDF Extraction:
1. **Lack of Inherent Semantic Flow:** PDFs store instructions on *where to place glyphs on a canvas* (coordinates $x, y$), rather than semantic paragraphs or sentences. Words can be drawn out of reading order.
2. **Multi-Column Layouts:** Standard line-by-line readers may read across columns, interleaving sentences from column A with column B and rendering sentences unintelligible.
3. **Scanned Documents (Images):** Many aviation regulatory advisories or legacy checklists are rasterized page scans containing zero extractable character streams, requiring Optical Character Recognition (OCR).
4. **Font Encodings & Ligatures:** Custom font encodings, mathematical symbols, or typographic ligatures ("fi", "fl") can extract as unmapped private-use unicode characters or gibberish.
5. **Corrupted or Truncated Streams:** Missing EOF markers, damaged cross-reference (`xref`) tables, or interrupted network downloads will crash naive loaders if not guarded with exception handling.

---

## 3. How Source Identity is Preserved

To enable grounded citations and regulatory compliance in AeroRAG:
1. **Immediate Metadata Tagging:** As soon as `load_text(path)` executes, the loader constructs a document object pairing the raw text with its originating filename:
   \`\`\`python
   docs.append({
       "source": path.name,
       "format": path.suffix.lower().replace(".", ""),
       "length": len(text),
       "sample": text[:80]
   })
   \`\`\`
2. **Downstream Traceability:** The `source` identifier travels through chunking into ChromaDB metadata (`chunk.metadata.source`), and is ultimately cited in the RAG response (`{"source": {"documentId": "SOP-OPS-737-04", ...}}`).

---

## 4. Handling Missing or Unreadable Files Gracefully

In a real-world repository containing 4,000+ files, batch ingestion must not halt because a single document is missing, corrupt, or unsupported:

- **Isolated Try-Catch per File:** The loader processes each file in an independent `try ... except` block.
- **Explicit Diagnostics:**
  - `OK {filename}: {length} chars | '{sample}'` — Logs intake confirmation.
  - `SKIP {filename}: {reason}` — Captures exact failure (e.g. `Corrupt or unreadable PDF: Stream ended unexpectedly`, `unsupported format: .bin`, `File not found`).
- **Resilient Batch Continuation:** Unreadable files are recorded in a `skipped_files` diagnostic manifest while valid files proceed to vectorization without interruption.

---

## 5. Follow-Up Answer: How Does This Map to AeroRAG's Documents?

When asked: *"How does this map to the documents in your problem statement?"*, use this answer:

> "In **AeroRAG**, our problem statement centers on airline procedure verification and flight safety compliance. In an airline flight operations department, documents arrive in fundamentally different formats from multiple sources:
> 1. **PDF Manuals:** Boeing 737 Flight Crew Operating Manuals (FCOM), Flight Crew Training Manuals (FCTM), and FAA/EASA Airworthiness Directives arrive as large, formal multi-page PDFs with tables and diagrams.
> 2. **Markdown Checklists:** Emergency Quick Reference Handbooks (QRH) and abnormal checklists are stored as lightweight Markdown files for rapid rendering on Electronic Flight Bags (EFBs).
> 3. **HTML Safety Portals:** Company safety bulletins, urgent operational notices, and winter weather advisories are exported directly from the internal airline crew intranet portal.
> 4. **Plain Text Dispatches:** Domestic and international dispatch fuel reserve rules and NOTAM summaries arrive in plain text teletype format.
> 
> Our multi-format loader unifies all these sources into a common text representation while preserving the exact source document ID. This ensures pilots receive reliable, grounded answers with citations back to the current approved manual."

---

## 6. Video Walkthrough Script (3–5 Minutes)

| Time | Topic | What to Show & Discuss on Screen |
|---|---|---|
| **0:00 - 0:45** | **Introduction & Why Common Text Form** | Introduce yourself and AeroRAG. Explain why chunkers, embeddings, and LLMs require unified plain text rather than binary formats or HTML markup. |
| **0:45 - 1:45** | **PDF Extraction vs. Text/HTML** | Open `backend/scripts/run_document_loader.py`. Explain why PDFs are challenging (coordinate-based drawing, multi-column reading order, scanned images, missing EOFs) compared to clean UTF-8 text and stripped HTML. |
| **1:45 - 2:30** | **Source Identity & Graceful Failure Handling** | Walk through the `try ... except` block and `docs.append({"source": path.name, ...})`. Show how missing files, corrupt PDFs (`corrupt_document.pdf`), and unsupported binary files (`.bin`) are skipped cleanly. |
| **2:30 - 3:30** | **Terminal Demonstration (Intake Confirmation)** | Run `python backend/scripts/run_document_loader.py` in the terminal. Point out the `OK` logs with character counts and samples for PDF, MD, HTML, and TXT, and the `SKIP` logs for the corrupt, unsupported, and missing files. |
| **3:30 - 4:15** | **Follow-up Question & Conclusion** | Answer the follow-up question: *"How does this map to the documents in your problem statement?"* (Boeing FCOMs in PDF, QRH in Markdown, intranet bulletins in HTML, dispatch policies in TXT). |
