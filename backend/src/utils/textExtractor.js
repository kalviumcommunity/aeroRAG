import fs from 'fs/promises';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export const extractText = async (filePath, fileType) => {
  if (fileType === 'pdf') {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return {
      text: data.text,
      pageCount: data.numpages
    };
  } else if (fileType === 'txt') {
    const text = await fs.readFile(filePath, 'utf-8');
    return {
      text,
      pageCount: 1
    };
  } else {
    throw new Error('Unsupported file type');
  }
};
