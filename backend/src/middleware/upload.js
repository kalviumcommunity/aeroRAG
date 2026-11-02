import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Sanitize original filename
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.txt', '.docx', '.html', '.htm', '.md', '.markdown'];
  const ext = path.extname(file.originalname).toLowerCase();

  const allowedMimetypes = [
    'application/pdf',
    'text/plain',
    'text/html',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/octet-stream' // Browsers often send .docx or .md as octet-stream
  ];

  if (allowedExtensions.includes(ext) || allowedMimetypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Supported formats are PDF, TXT, DOCX, HTML, and Markdown (.pdf, .txt, .docx, .html, .md)`), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB for large aviation manuals
  fileFilter
});

export default upload;
