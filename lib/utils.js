'use strict';

const fs = require('fs');
const path = require('path');

/** Read file, return string or null on any error. Strips UTF-8 BOM if present. */
function safeReadFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    // Strip UTF-8 BOM (Windows editors like Notepad add this)
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return content;
  } catch {
    return null;
  }
}

/** Parse JSON string, return object or null */
function safeJsonParse(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** Read + parse JSON file in one step */
function safeReadJson(filePath) {
  return safeJsonParse(safeReadFile(filePath));
}

/** Count words (split on whitespace) */
function wordCount(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Count lines in a file (reads full content) */
function lineCount(filePath) {
  const content = safeReadFile(filePath);
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

/** Read directory entries, return [] on error */
function safeReaddir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

/** Count files matching an extension in a directory (non-recursive) */
function countFiles(dirPath, extension) {
  return safeReaddir(dirPath).filter(f => f.endsWith(extension)).length;
}

/** Check if file exists and has >0 bytes */
function fileExistsAndNonEmpty(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/** Check if a directory exists */
function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/** Days since file was last modified */
function daysAgo(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
  } catch {
    return Infinity;
  }
}

/** List full paths of files matching extension in a directory */
function listFiles(dirPath, extension) {
  return safeReaddir(dirPath)
    .filter(f => f.endsWith(extension))
    .map(f => path.join(dirPath, f));
}

/** Clamp a number between min and max */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  safeReadFile,
  safeJsonParse,
  safeReadJson,
  wordCount,
  lineCount,
  safeReaddir,
  countFiles,
  fileExistsAndNonEmpty,
  dirExists,
  daysAgo,
  listFiles,
  clamp,
};
