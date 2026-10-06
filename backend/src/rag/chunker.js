export const chunkText = (text, maxTokens = 500, overlapTokens = 50) => {
  // Approximate chunking based on word count (~4 chars/token roughly equates to checking words)
  // To keep it simple, we use a word-based approach
  const words = text.split(/\s+/);
  const chunks = [];
  let currentChunkIndex = 0;

  for (let i = 0; i < words.length; i += (maxTokens - overlapTokens)) {
    const chunkWords = words.slice(i, i + maxTokens);
    if (chunkWords.length === 0) break;
    
    const chunkText = chunkWords.join(' ');
    
    chunks.push({
      text: chunkText,
      chunkIndex: currentChunkIndex,
      startChar: 0, // Simplified char index tracking for this demo
      endChar: 0
    });
    
    currentChunkIndex++;
  }

  return chunks;
};
