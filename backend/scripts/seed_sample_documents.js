import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';
import config from '../src/config/env.js';
import User from '../src/models/User.js';
import Document from '../src/models/Document.js';
import { ingestDocument } from '../src/rag/ingester.js';
import logger from '../src/utils/logger.js';

const SAMPLE_DOCS = [
  {
    documentId: 'SOP-OPS-737-04',
    title: 'Boeing 737 Sterile Cockpit Procedures (Rev 4.0)',
    documentType: 'Operational Manual',
    version: '4.0',
    issueDate: new Date('2024-01-05'),
    effectiveDate: new Date('2024-01-15'),
    status: 'CURRENT',
    supersedes: ['SOP-OPS-737-03'],
    sourceFile: 'SOP-OPS-737-04.txt',
    fileType: 'txt'
  },
  {
    documentId: 'SOP-OPS-737-03',
    title: 'Boeing 737 Sterile Cockpit Procedures (Rev 3.0 - Outdated)',
    documentType: 'Operational Manual',
    version: '3.0',
    issueDate: new Date('2021-05-20'),
    effectiveDate: new Date('2021-06-01'),
    status: 'SUPERSEDED',
    supersededBy: 'SOP-OPS-737-04',
    sourceFile: 'SOP-OPS-737-03.txt',
    fileType: 'txt'
  },
  {
    documentId: 'QRH-EMER-01',
    title: 'Boeing 737 Emergency Descent Quick Reference Checklist',
    documentType: 'Quick Reference Handbook',
    version: '2.1',
    issueDate: new Date('2023-08-15'),
    effectiveDate: new Date('2023-09-01'),
    status: 'CURRENT',
    supersedes: [],
    sourceFile: 'QRH-EMER-01.md',
    fileType: 'md'
  },
  {
    documentId: 'OPS-BUL-2024-08',
    title: 'Severe Turbulence Penetration Procedures & Speeds',
    documentType: 'Safety Bulletin',
    version: '1.0',
    issueDate: new Date('2024-03-18'),
    effectiveDate: new Date('2024-03-20'),
    status: 'CURRENT',
    supersedes: [],
    sourceFile: 'OPS-BUL-2024-08.html',
    fileType: 'html'
  },
  {
    documentId: 'FAR-PART-121-639',
    title: 'FAA 14 CFR Part 121.639 Domestic IFR Fuel Reserves',
    documentType: 'Regulatory Directive',
    version: '2023.1',
    issueDate: new Date('2022-12-15'),
    effectiveDate: new Date('2023-01-01'),
    status: 'CURRENT',
    supersedes: [],
    sourceFile: 'FAR-PART-121-639.txt',
    fileType: 'txt'
  },
  {
    documentId: 'SOP-WINTER-OPS-2022',
    title: 'Winter Ground De-Icing Holdover Guidelines (2022-2023 Season)',
    documentType: 'Standard Operating Procedure',
    version: 'WIN-2022.2',
    issueDate: new Date('2022-10-15'),
    effectiveDate: new Date('2022-11-01'),
    expiryDate: new Date('2023-04-30'),
    status: 'EXPIRED',
    supersedes: [],
    sourceFile: 'SOP-WINTER-OPS-2022.txt',
    fileType: 'txt'
  }
];

async function seed() {
  logger.info(`Connecting to MongoDB at ${config.MONGO_URI}...`);
  try {
    await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    logger.error(`Could not connect to MongoDB: ${err.message}. Please verify MongoDB is running.`);
    process.exit(1);
  }

  // 1. Ensure uploads directory exists
  const uploadsDir = path.resolve('uploads');
  await fs.mkdir(uploadsDir, { recursive: true });

  // 2. Seed Default Users
  const usersToSeed = [
    {
      name: 'Chief Flight Dispatcher (Admin)',
      email: 'admin@aerorag.internal',
      password: 'AdminPassword123!',
      role: 'admin'
    },
    {
      name: 'Ground Operations Agent',
      email: 'staff@aerorag.internal',
      password: 'StaffPassword123!',
      role: 'ground_staff'
    }
  ];

  let adminUser = null;
  for (const u of usersToSeed) {
    let existing = await User.findOne({ email: u.email });
    if (!existing) {
      existing = await User.create(u);
      logger.info(`Created default user: ${u.email} (${u.role})`);
    } else {
      existing.role = u.role;
      await existing.save();
      logger.info(`Existing user verified: ${u.email} (${u.role})`);
    }
    if (existing.role === 'admin') adminUser = existing;
  }

  // 3. Seed Sample Documents
  const sampleCorpusDir = path.resolve('..', 'data', 'sample_corpus');
  const localCorpusDir = path.resolve('data', 'sample_corpus');
  let corpusDir = sampleCorpusDir;
  try {
    await fs.access(sampleCorpusDir);
  } catch {
    corpusDir = localCorpusDir;
  }

  logger.info(`Reading sample documents from ${corpusDir}...`);

  for (const docMeta of SAMPLE_DOCS) {
    const srcFilePath = path.join(corpusDir, docMeta.sourceFile);
    const destFilePath = path.join(uploadsDir, `${docMeta.documentId}-${docMeta.sourceFile}`);

    try {
      await fs.copyFile(srcFilePath, destFilePath);
    } catch (err) {
      logger.warn(`Could not copy ${srcFilePath}: ${err.message}. Creating placeholder.`);
      await fs.writeFile(destFilePath, `# ${docMeta.title}\nDocument ID: ${docMeta.documentId}\nStatus: ${docMeta.status}\n`);
    }

    let existingDoc = await Document.findOne({ documentId: docMeta.documentId });
    if (!existingDoc) {
      existingDoc = await Document.create({
        documentId: docMeta.documentId,
        title: docMeta.title,
        documentType: docMeta.documentType,
        version: docMeta.version,
        issueDate: docMeta.issueDate,
        effectiveDate: docMeta.effectiveDate,
        expiryDate: docMeta.expiryDate,
        status: docMeta.status,
        supersedes: docMeta.supersedes,
        supersededBy: docMeta.supersededBy,
        filePath: destFilePath,
        fileType: docMeta.fileType,
        processingStatus: 'PROCESSING',
        createdBy: adminUser._id
      });
      logger.info(`Created Document record: ${docMeta.documentId}`);
    } else {
      existingDoc.title = docMeta.title;
      existingDoc.documentType = docMeta.documentType;
      existingDoc.version = docMeta.version;
      existingDoc.issueDate = docMeta.issueDate;
      existingDoc.effectiveDate = docMeta.effectiveDate;
      existingDoc.expiryDate = docMeta.expiryDate;
      existingDoc.status = docMeta.status;
      existingDoc.supersedes = docMeta.supersedes;
      existingDoc.supersededBy = docMeta.supersededBy;
      existingDoc.filePath = destFilePath;
      existingDoc.fileType = docMeta.fileType;
      await existingDoc.save();
      logger.info(`Updated Document metadata: ${docMeta.documentId}`);
    }

    // Ingest into vector store
    try {
      const chunks = await ingestDocument(docMeta.documentId);
      logger.info(`Ingested ${docMeta.documentId}: ${chunks} chunks indexed`);
    } catch (ingestErr) {
      logger.error(`Error ingesting ${docMeta.documentId}: ${ingestErr.message}`);
    }
  }

  logger.info('Sample airline corpus and default users successfully seeded!');
}

seed()
  .catch(error => {
    logger.error(`Seeding failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
