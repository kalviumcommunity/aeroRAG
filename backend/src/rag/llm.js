import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';
import logger from '../utils/logger.js';

let genAI;
if (config.GOOGLE_API_KEY && !config.DEMO_MODE) {
  genAI = new GoogleGenerativeAI(config.GOOGLE_API_KEY);
}

const SYSTEM_PROMPT = `
You are AeroRAG, an airline procedure verification assistant.

Answer ONLY using the provided retrieved airline documents.
Never invent procedures, regulations, dates, or operational instructions.
If the retrieved documents do not contain enough information, clearly state:
"I could not find sufficient information in the available airline documents."

When multiple documents discuss the same procedure, prefer the latest valid document according to effective date and supersession metadata.
Always identify the source document used for the answer.
If an older document has been superseded, explicitly mention it should not be treated as the current procedure.

Format your answer clearly with:
1. Direct answer
2. Which document is current/authoritative
3. Any supersession notes
`;

function generateMockAnswer(contextChunks) {
  if (!contextChunks || contextChunks.length === 0) {
    return "I could not find sufficient information in the available airline documents.";
  }
  
  const sources = [...new Set(contextChunks.map(c => `${c.metadata.documentId} - ${c.metadata.documentTitle} (Status: ${c.metadata.status})`))];
  
  return `[MOCK ANSWER - DEMO MODE]
1. Direct answer: Based on the retrieved mock data, the requested procedure is covered in the following documents.
2. Authoritative documents: ${sources.join(', ')}
3. Supersession notes: Please verify the status of these documents carefully.`;
}

export const generateAnswer = async (query, contextChunks) => {
  if (config.DEMO_MODE || !genAI) {
    return generateMockAnswer(contextChunks);
  }

  const contextString = contextChunks.map((c, i) => `
--- Source ${i + 1} ---
Document ID: ${c.metadata.documentId}
Title: ${c.metadata.documentTitle}
Status: ${c.metadata.status}
Effective Date: ${c.metadata.effectiveDate}
Supersedes: ${c.metadata.supersedes || 'None'}
Content:
${c.document}
`).join('\n');

  const prompt = `
${SYSTEM_PROMPT}

User Query: ${query}

Retrieved Documents:
${contextString}
`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error) {
    logger.error(`Error generating LLM answer: ${error.message}`);
    throw error;
  }
};
