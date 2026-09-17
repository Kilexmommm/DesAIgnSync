/**
 * CSS value helpers shared by the matching engine (DS-014) and the rules engine (DS-015).
 * Having a single definition of "same color" avoids the matching saying colors agree while the
 * rules engine reports a diff for the very same pair of values.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_FULL = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FUNCTION = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*[),]/i;

export const normalizeColor = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, '').replace(/^rgba?\(/, 'rgb(');

export const toRgb = (value: string): Rgb | undefined => {
  const input = value.trim();

  const short = HEX_SHORT.exec(input);
  if (short?.[1] && short[2] && short[3]) {
    return {
      r: Number.parseInt(`${short[1]}${short[1]}`, 16),
      g: Number.parseInt(`${short[2]}${short[2]}`, 16),
      b: Number.parseInt(`${short[3]}${short[3]}`, 16)
    };
  }

  const full = HEX_FULL.exec(input);
  if (full?.[1] && full[2] && full[3]) {
    return {
      r: Number.parseInt(full[1], 16),
      g: Number.parseInt(full[2], 16),
      b: Number.parseInt(full[3], 16)
    };
  }

  const rgb = RGB_FUNCTION.exec(input);
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    return {
      r: Number.parseInt(rgb[1], 10),
      g: Number.parseInt(rgb[2], 10),
      b: Number.parseInt(rgb[3], 10)
    };
  }

  return undefined;
};

export const colorsEqual = (left: string, right: string): boolean => {
  const leftRgb = toRgb(left);
  const rightRgb = toRgb(right);
  if (leftRgb && rightRgb) {
    return leftRgb.r === rightRgb.r && leftRgb.g === rightRgb.g && leftRgb.b === rightRgb.b;
  }
  return normalizeColor(left) === normalizeColor(right);
};

const luminanceChannel = (value: number): number => {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (rgb: Rgb): number =>
  0.2126 * luminanceChannel(rgb.r) + 0.7152 * luminanceChannel(rgb.g) + 0.0722 * luminanceChannel(rgb.b);

/** WCAG 2.1 contrast ratio, rounded to 2 decimals. Undefined when a color cannot be parsed. */
export const contrastRatio = (foreground: string, background: string): number | undefined => {
  const fg = toRgb(foreground);
  const bg = toRgb(background);
  if (!fg || !bg) return undefined;
  const foregroundLuminance = relativeLuminance(fg);
  const backgroundLuminance = relativeLuminance(bg);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
};

export const firstFontFamily = (value: string): string =>
  value.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '').toLowerCase() ?? '';
