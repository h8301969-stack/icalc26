import { countExpressionLines } from './expressionDisplay';

export const EXPRESSION_CHAR_WIDTH_RATIO = 0.58;
export const EXPRESSION_LINE_HEIGHT = 1.25;
export const PORTRAIT_LINE_HEIGHT = 1.1;
export const EXPRESSION_MIN_FONT_SIZE = 12;
export const PORTRAIT_AUTO_MAX_CHARS = 30;
export const PORTRAIT_AUTO_MAX_LINES = 6;
export const PORTRAIT_AUTO_CHARS_PER_LINE = 15;
export const PORTRAIT_AUTO_VISIBLE_LINES = 5;
export const EXPRESSION_SHRINK_FACTOR = 0.92;

export interface ExpressionLayout {
  charsPerLine: number;
  displayFontSize: number;
  visibleLines: number;
  viewportMaxHeight: number | null;
  breakAtPlus: boolean;
  lineHeight: number;
}

export const countWrappedLines = (
  expression: string,
  charsPerLine: number,
  breakAtPlus = false
): number => countExpressionLines(expression, charsPerLine, breakAtPlus);

const charsForWidth = (availWidth: number, fontSize: number, maxChars?: number): number => {
  const raw = Math.max(6, Math.floor(availWidth / (fontSize * EXPRESSION_CHAR_WIDTH_RATIO)));
  return maxChars ? Math.min(maxChars, raw) : raw;
};

export const computeAutoPortraitLayout = (
  expression: string,
  _availWidth: number,
  baseFontSize: number
): ExpressionLayout => {
  const chars = PORTRAIT_AUTO_CHARS_PER_LINE;
  const lines = countWrappedLines(expression, chars, false);
  const extraLines = Math.max(0, lines - PORTRAIT_AUTO_VISIBLE_LINES);
  const shrinkScale = Math.pow(EXPRESSION_SHRINK_FACTOR, extraLines);
  const displayFontSize = Math.max(
    EXPRESSION_MIN_FONT_SIZE,
    baseFontSize * shrinkScale
  );
  const viewportMaxHeight =
    PORTRAIT_AUTO_VISIBLE_LINES * baseFontSize * PORTRAIT_LINE_HEIGHT;

  return {
    charsPerLine: chars,
    displayFontSize,
    visibleLines: PORTRAIT_AUTO_VISIBLE_LINES,
    viewportMaxHeight,
    breakAtPlus: false,
    lineHeight: PORTRAIT_LINE_HEIGHT,
  };
};

export const computeAutoLandscapeLayout = (
  _expression: string,
  availWidth: number,
  availHeight: number,
  baseFontSize: number
): ExpressionLayout => {
  const safeHeight = Math.max(120, availHeight);
  const chars = charsForWidth(availWidth, baseFontSize, PORTRAIT_AUTO_MAX_CHARS);
  const visibleLines = Math.max(
    1,
    Math.floor(safeHeight / (baseFontSize * EXPRESSION_LINE_HEIGHT))
  );

  return {
    charsPerLine: chars,
    displayFontSize: baseFontSize,
    visibleLines,
    viewportMaxHeight: safeHeight,
    breakAtPlus: false,
    lineHeight: EXPRESSION_LINE_HEIGHT,
  };
};

export const computePresetLayout = (
  expression: string,
  availWidth: number,
  availHeight: number,
  baseFontSize: number,
  presetChars: number,
  presetLines: number,
  fillHeight: boolean,
  breakAtPlus = true
): ExpressionLayout => {
  const fitSize = availWidth > 0 ? availWidth / (presetChars * EXPRESSION_CHAR_WIDTH_RATIO) : baseFontSize;
  const fontSize = Math.min(baseFontSize, Math.max(EXPRESSION_MIN_FONT_SIZE, fitSize));
  const viewportMaxHeight = fillHeight && availHeight > 0
    ? availHeight
    : presetLines * fontSize * EXPRESSION_LINE_HEIGHT;

  return {
    charsPerLine: presetChars,
    displayFontSize: fontSize,
    visibleLines: presetLines,
    viewportMaxHeight,
    breakAtPlus,
    lineHeight: EXPRESSION_LINE_HEIGHT,
  };
};