import zipfile
import os

os.makedirs('data/sample_corpus', exist_ok=True)

# 1. Valid DOCX
content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

doc_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>AERO-SOP-742: Standard Operating Procedure for Missed Approach and Go-Around.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Simultaneously advance thrust levers to GA detent, press TO/GA switch, and call GO AROUND FLAPS.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Verify positive rate of climb on altimeter and vertical speed indicator before calling GEAR UP.</w:t></w:r></w:p>
  </w:body>
</w:document>"""

with zipfile.ZipFile('data/sample_corpus/flight_crew_training_manual.docx', 'w') as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', rels)
    z.writestr('word/document.xml', doc_xml)

# 2. Corrupt DOCX (invalid zip bytes)
with open('data/sample_corpus/corrupt_manual.docx', 'wb') as f:
    f.write(b'PK\x03\x04CORRUPTED_DOCX_HEADER_DATA_NOT_A_VALID_ZIP_ARCHIVE')

# 3. Empty document
with open('data/sample_corpus/empty_procedure.txt', 'w') as f:
    pass

# 4. Scanned PDF (valid PDF structure with 1 blank page, no text streams)
# A minimal valid 1-page PDF with empty contents stream
scanned_pdf_content = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 0 >>
stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000202 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
251
%%EOF
"""
with open('data/sample_corpus/scanned_maintenance_log.pdf', 'wb') as f:
    f.write(scanned_pdf_content)

print("Generated sample fixtures successfully.")
