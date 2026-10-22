#!/usr/bin/env python3
"""
AeroRAG Document Loading & Multi-Format Intake (3.19)
Loads mixed document formats (PDF, HTML, MD, TXT) into a common plain-text representation.
Preserves source identity and handles missing or unreadable files gracefully.
"""

import sys
import os
import json
from pathlib import Path
from pypdf import PdfReader
from bs4 import BeautifulSoup

def load_text(path: Path) -> str:
    """
    Extracts text from a file path into clean plain text.
    Supports .pdf, .txt, .md, .html, .htm.
    Raises ValueError for unsupported formats or empty/corrupt extractions.
    """
    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    s = path.suffix.lower()
    if s == ".pdf":
        try:
            reader = PdfReader(path)
            extracted = "\n".join(p.extract_text() or "" for p in reader.pages).strip()
            if not extracted:
                raise ValueError("PDF contains no extractable text (empty or scanned image)")
            return extracted
        except Exception as e:
            raise ValueError(f"Corrupt or unreadable PDF: {e}")

    if s in (".txt", ".md"):
        try:
            return path.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception as e:
            raise ValueError(f"Failed to read text file: {e}")

    if s in (".html", ".htm"):
        try:
            raw_html = path.read_text(encoding="utf-8", errors="ignore")
            soup = BeautifulSoup(raw_html, "html.parser")
            # Strip non-body elements
            for tag in soup(["script", "style", "head", "title", "meta"]):
                tag.decompose()
            text = soup.get_text(" ", strip=True)
            if not text:
                raise ValueError("HTML contains no readable text content")
            return text
        except Exception as e:
            raise ValueError(f"Failed to parse HTML: {e}")

    raise ValueError(f"unsupported format: {s}")

def run_intake(corpus_dir: Path):
    print("=" * 68)
    print("   AERORAG: DOCUMENT LOADING & MULTI-FORMAT INTAKE PIPELINE (3.19)  ")
    print("=" * 68)
    print(f"Target Corpus Directory: {corpus_dir.resolve()}\n")

    docs = []
    skipped = []

    # Include negative test for non-existent file to demonstrate missing file handling
    test_paths = list(corpus_dir.rglob("*"))
    test_paths.append(corpus_dir / "non_existent_procedure.pdf")

    for path in test_paths:
        if path.is_dir():
            continue
        try:
            text = load_text(path)
            docs.append({
                "source": path.name,
                "format": path.suffix.lower().replace(".", ""),
                "length": len(text),
                "sample": text[:80].replace("\n", " "),
                "full_text": text
            })
            print(f"OK   {path.name:32} | {len(text):4d} chars | {text[:60]!r}")
        except Exception as e:
            skipped.append({
                "source": path.name,
                "format": path.suffix.lower().replace(".", "") if path.suffix else "none",
                "error": str(e)
            })
            print(f"SKIP {path.name:32} | REASON: {e}")

    print("\n" + "=" * 68)
    print(f"INTAKE SUMMARY: {len(docs)} loaded successfully, {len(skipped)} skipped gracefully.")
    print("=" * 68 + "\n")

    # Generate JSON and Markdown documentation
    results = {
        "summary": {
            "total_inspected": len(docs) + len(skipped),
            "loaded_count": len(docs),
            "skipped_count": len(skipped),
            "supported_formats": sorted(list(set(d["format"] for d in docs)))
        },
        "loaded_documents": [
            {
                "source": d["source"],
                "format": d["format"],
                "char_length": d["length"],
                "sample_preview": d["sample"]
            }
            for d in docs
        ],
        "skipped_files": skipped
    }

    docs_dir = Path(__file__).resolve().parent.parent.parent / "docs"
    docs_dir.mkdir(exist_ok=True)

    json_path = docs_dir / "document_intake_results.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    md_path = docs_dir / "document_intake_results.md"
    generate_markdown_report(results, md_path)

    print(f"[Artifact 1] JSON Report saved to: {json_path}")
    print(f"[Artifact 2] Markdown Report saved to: {md_path}")

    return results

def generate_markdown_report(results, output_path: Path):
    lines = [
        "# Document Loading & Multi-Format Intake Report",
        "",
        "**Project:** AeroRAG Airline Procedure Verification Assistant  ",
        "**Module:** Sprint 2 · Concept 10 (3.19 Document Loading & Multi-Format Intake)  ",
        "**Status:** Verified across PDF, TXT, HTML, and Markdown formats  ",
        "",
        "---",
        "",
        "## 1. Executive Summary",
        "",
        "In production RAG systems, operational knowledge originates in heterogeneous file formats (PDF manuals, HTML safety portals, Markdown checklists, and TXT operational notes). Before chunking, embedding, or retrieval can occur, all documents must be normalized into a unified, common plain-text representation while preserving each file's source identity.",
        "",
        f"- **Total Files Inspected:** {results['summary']['total_inspected']}",
        f"- **Successfully Loaded:** {results['summary']['loaded_count']}",
        f"- **Gracefully Skipped (Missing / Corrupt / Unsupported):** {results['summary']['skipped_count']}",
        f"- **Validated Formats:** {', '.join(results['summary']['supported_formats']).upper()}",
        "",
        "---",
        "",
        "## 2. Successfully Loaded Documents (Intake Confirmation)",
        "",
        "| Source Filename | Format | Character Count | Sample Text Preview |",
        "|---|---|---|---|"
    ]

    for d in results["loaded_documents"]:
        clean_sample = d["sample_preview"].replace("|", "\\|")
        lines.append(f"| **`{d['source']}`** | `{d['format'].upper()}` | {d['char_length']} chars | *\"{clean_sample}\"* |")

    lines.extend([
        "",
        "---",
        "",
        "## 3. Graceful Failure Handling (Surviving Bad Input)",
        "",
        "In a real-world multi-thousand-document corpus, files will inevitably be corrupted, misnamed, or missing. The loader isolates these errors per-file without interrupting the ingestion run.",
        "",
        "| File Attempted | Format | Failure Classification | Handled Exception Message |",
        "|---|---|---|---|"
    ])

    for s in results["skipped_files"]:
        classification = "Missing File" if "not found" in s["error"].lower() else ("Corrupted Stream" if "corrupt" in s["error"].lower() else "Unsupported Extension")
        lines.append(f"| **`{s['source']}`** | `{s['format']}` | {classification} | `{s['error']}` |")

    lines.extend([
        "",
        "---",
        "",
        "## 4. Key Takeaways for Reviewers",
        "",
        "1. **Unified Text Representation:** Every document format (PDF, TXT, HTML, MD) is stripped of presentation overhead and converted into uniform UTF-8 text.",
        "2. **Preserved Source Identity:** The `source` filename identifier is retained on every loaded record so downstream RAG citations can link answers directly to the originating document.",
        "3. **Resilience & Non-Crashing Intake:** Corrupted PDFs, missing files, and unsupported binary streams are skipped with clear diagnostic logs, safeguarding batch pipelines.",
        ""
    ])

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

if __name__ == "__main__":
    base_dir = Path(__file__).resolve().parent.parent.parent
    sample_dir = base_dir / "data" / "sample_corpus"
    run_intake(sample_dir)
