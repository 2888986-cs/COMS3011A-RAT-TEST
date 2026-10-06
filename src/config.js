const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = process.env.RAT_DATA_DIR
  ? path.resolve(process.env.RAT_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
const REPOS_DIR = path.join(DATA_DIR, 'repos');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const REGISTRY_FILE = path.join(DATA_DIR, 'registry.json');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PORT = Number(process.env.PORT) || 3000;

function ensureDataDirs() {
  for (const dir of [DATA_DIR, REPOS_DIR, UPLOADS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  REPOS_DIR,
  UPLOADS_DIR,
  REGISTRY_FILE,
  PUBLIC_DIR,
  PORT,
  ensureDataDirs,
};
