const fs = require('fs')
const path = require('path')
const multer = require('multer')
const { randomUUID } = require('crypto')

const uploadDir = path.resolve(__dirname, '..', '..', 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '')
    cb(null, `${randomUUID()}${extension}`)
  },
})

const fileFilter = (_req, _file, cb) => {
  // Chat supports broad file sharing; media-specific validation is handled in controllers.
  return cb(null, true)
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 150 * 1024 * 1024,
  },
})

module.exports = { upload }
