import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'node:crypto';

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const isPdf = extension === '.pdf' && file.mimetype === 'application/pdf';
  const isText = extension === '.txt' && file.mimetype === 'text/plain';
  if (isPdf || isText) {
    cb(null, true);
  } else {
    const error = new Error('Invalid file type. Only matching PDF and TXT files are allowed.');
    error.statusCode = 400;
    cb(error, false);
  }
};

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter
});

export default upload;
