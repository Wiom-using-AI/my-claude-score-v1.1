'use strict';

// Raw ANSI escape codes — zero dependencies
const ESC = '\x1b[';
const RESET = `${ESC}0m`;

// ── TTY and color capability detection ──────────────────────────────
const isTTY = process.stdout.isTTY === true;
const noColor = 'NO_COLOR' in process.env;
const useColor = isTTY && !noColor;

// 256-color support detection
const has256Color = useColor && (
  /256color|truecolor/i.test(process.env.COLORTERM || '') ||
  /256color/i.test(process.env.TERM || '') ||
  process.platform === 'win32'
);

const plain = s => s;

const style = useColor ? {
  bold:      s => `${ESC}1m${s}${RESET}`,
  dim:       s => `${ESC}2m${s}${RESET}`,
  underline: s => `${ESC}4m${s}${RESET}`,
} : { bold: plain, dim: plain, underline: plain };

const fg = useColor ? {
  red:         s => `${ESC}31m${s}${RESET}`,
  green:       s => `${ESC}32m${s}${RESET}`,
  yellow:      s => `${ESC}33m${s}${RESET}`,
  blue:        s => `${ESC}34m${s}${RESET}`,
  magenta:     s => `${ESC}35m${s}${RESET}`,
  cyan:        s => `${ESC}36m${s}${RESET}`,
  white:       s => `${ESC}37m${s}${RESET}`,
  gray:        s => `${ESC}90m${s}${RESET}`,
  brightGreen: s => `${ESC}92m${s}${RESET}`,
  brightYellow:s => `${ESC}93m${s}${RESET}`,
  brightCyan:  s => `${ESC}96m${s}${RESET}`,
  brightWhite: s => `${ESC}97m${s}${RESET}`,
  orange: has256Color
    ? (s => `${ESC}38;5;208m${s}${RESET}`)
    : (s => `${ESC}33m${s}${RESET}`),
} : {
  red: plain, green: plain, yellow: plain, blue: plain,
  magenta: plain, cyan: plain, white: plain, gray: plain,
  brightGreen: plain, brightYellow: plain, brightCyan: plain,
  brightWhite: plain, orange: plain,
};

const bg = useColor ? {
  red:    s => `${ESC}41m${s}${RESET}`,
  green:  s => `${ESC}42m${s}${RESET}`,
  yellow: s => `${ESC}43m${s}${RESET}`,
  blue:   s => `${ESC}44m${s}${RESET}`,
  cyan:   s => `${ESC}46m${s}${RESET}`,
  white:  s => `${ESC}47m${s}${RESET}`,
  gray:   s => `${ESC}100m${s}${RESET}`,
} : {
  red: plain, green: plain, yellow: plain, blue: plain,
  cyan: plain, white: plain, gray: plain,
};

/** Strip ANSI codes and return visible character count */
function visibleLength(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Pad string to target visible width (right-pad with spaces) */
function padEnd(str, width) {
  const visible = visibleLength(str);
  if (visible >= width) return str;
  return str + ' '.repeat(width - visible);
}

/** Pad string to target visible width (left-pad with spaces) */
function padStart(str, width) {
  const visible = visibleLength(str);
  if (visible >= width) return str;
  return ' '.repeat(width - visible) + str;
}

/**
 * Truncate an ANSI-colored string to maxWidth visible characters.
 * Preserves ANSI codes and appends '...' + RESET when truncated.
 */
function truncate(str, maxWidth) {
  if (maxWidth < 4) return str;
  const visible = visibleLength(str);
  if (visible <= maxWidth) return str;

  const ansiRe = /\x1b\[[0-9;]*m/g;
  let out = '';
  let visCount = 0;
  let lastIndex = 0;
  let match;

  while ((match = ansiRe.exec(str)) !== null) {
    const textBefore = str.slice(lastIndex, match.index);
    for (const ch of textBefore) {
      if (visCount >= maxWidth - 3) {
        return out + '...';
      }
      out += ch;
      visCount++;
    }
    out += match[0];
    lastIndex = ansiRe.lastIndex;
  }

  const remaining = str.slice(lastIndex);
  for (const ch of remaining) {
    if (visCount >= maxWidth - 3) {
      return out + '...';
    }
    out += ch;
    visCount++;
  }

  return out;
}

module.exports = { style, fg, bg, visibleLength, padEnd, padStart, truncate, RESET };
