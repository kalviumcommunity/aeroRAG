/**
 * Chunks document text into semantically coherent passages
 * while detecting section headers and tracking position metadata.
 */
export const chunkText = (text, maxWords = 250, overlapWords = 35) => {
  if (!text || typeof text !== 'string') return [];

  // Split into paragraphs / lines
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let currentWords = [];
  let currentSection = 'General Procedure';
  let chunkIndex = 0;
  let charCursor = 0;

  // Regex to detect aviation manual headings
  const headingRegex = /^(?:(?:[0-9]+(?:\.[0-9]+)*\s+[-–—]?\s*|[#]{1,4}\s+|SECTION\s+[0-9]+|CHAPTER\s+[0-9]+|PROCEDURE:?\s+)[A-Z0-9\s/(),._-]{3,100}|[A-Z0-9\s/(),._-]{4,60}:)$/m;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Check if the paragraph starts with or is a section heading
    const firstLine = trimmed.split('\n')[0].trim();
    if (headingRegex.test(firstLine) || (firstLine.length < 80 && /^[0-9]+\.\s+[A-Z]/.test(firstLine))) {
      currentSection = firstLine.replace(/^[#\s]+/, '').replace(/[:.]\s*$/, '').trim();
    }

    const words = trimmed.split(/\s+/).filter(Boolean);

    // If adding this paragraph exceeds maxWords, finalize current chunk
    if (currentWords.length + words.length > maxWords && currentWords.length > 0) {
      const chunkText = currentWords.join(' ');
      chunks.push({
        text: chunkText,
        chunkIndex,
        section: currentSection,
        wordCount: currentWords.length,
        startChar: charCursor,
        endChar: charCursor + chunkText.length
      });
      charCursor += chunkText.length + 1;
      chunkIndex++;

      // Overlap with trailing words of previous chunk
      const overlap = currentWords.slice(-overlapWords);
      currentWords = [...overlap, ...words];
    } else {
      currentWords.push(...words);
    }
  }

  // Final remaining chunk
  if (currentWords.length > 0) {
    const chunkText = currentWords.join(' ');
    chunks.push({
      text: chunkText,
      chunkIndex,
      section: currentSection,
      wordCount: currentWords.length,
      startChar: charCursor,
      endChar: charCursor + chunkText.length
    });
  }

  return chunks;
};
