import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  safeEvaluate,
  evaluateExpression,
  CalculationError,
  sanitizeClipboardExpression,
} from '../utils/calculator';
import {
  cleanPosExpressionForEval,
  evaluatePosExpression,
  formatInventoryPriceSegment,
  isPosStyleExpression,
} from '../utils/posExpression';

export const useCalculator = (
  onEvaluate: (expr: string, res: string) => void,
  triggerHaptic: (m?: number) => void
) => {
  const [expression, setExpression] = useState('0');
  const [isResultMode, setIsResultMode] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [calcError, setCalcError] = useState<string | null>(null);

  // Movable blinker / cursor position inside the expression (preferred insertion point)
  const [cursorPos, setCursorPos] = useState(0);

  const pushToUndo = useCallback((val: string) => {
    setUndoStack(prev => [...prev, val].slice(-50));
    setRedoStack([]);
  }, []);

  const runningResult = useMemo(() => {
    if (expression === '0' || !expression) return '0.00';
    return safeEvaluate(expression, 2);
  }, [expression]);

  useEffect(() => {
    if (expression === '0' || !expression) {
      setCalcError(null);
      return;
    }
    try {
      const cleanExpr = isPosStyleExpression(expression)
        ? cleanPosExpressionForEval(expression)
        : expression.replace(/[+\-*/%×÷(]+$/i, '');
      if (!cleanExpr || cleanExpr === '0') {
        setCalcError(null);
        return;
      }
      if (isPosStyleExpression(cleanExpr)) {
        evaluatePosExpression(cleanExpr);
      } else {
        evaluateExpression(cleanExpr);
      }
      setCalcError(null);
    } catch (err) {
      setCalcError(err instanceof CalculationError ? err.message : 'Invalid expression');
    }
  }, [expression]);

  const inputChar = useCallback((raw: string) => {
    triggerHaptic();
    pushToUndo(expression);

    // Normalize incoming symbols
    let char = raw;
    if (char === '×') char = '*';
    if (char === '÷') char = '/';

    const ops = ['+', '-', '*', '/', '%'] as const;
    const isOp = (ops as readonly string[]).includes(char);

    if (isResultMode) {
      setIsResultMode(false);
      if (isOp) {
        const sym = char === '*' ? '×' : char === '/' ? '÷' : char;
        const newExpr = expression + sym;
        setExpression(newExpr);
        setCursorPos(newExpr.length);
        return;
      }
      const fresh = char === '.' ? '0.' : char;
      setExpression(fresh);
      setCursorPos(fresh.length);
      return;
    }

    setIsResultMode(false);
    setExpression(prev => {
      const sym = char === '*' ? '×' : char === '/' ? '÷' : char;

      let pos = cursorPos;
      if (pos < 0 || pos > prev.length) pos = prev.length;

      // Special handling when at '0' start
      if (prev === '0' && !['+', '×', '÷', '.', '%'].includes(sym)) {
        const newExpr = sym;
        setCursorPos(newExpr.length);
        return newExpr;
      }

      const last = prev.slice(-1);
      const lastIsOp = ['+', '-', '×', '÷', '*', '/', '%'].includes(last);

      if (isOp && lastIsOp && pos === prev.length) {
        if (char === '-' && !['-', '×', '÷', '+', '/', '%'].includes(prev.slice(-2, -1))) {
          // allow
        } else {
          const newExpr = prev.slice(0, -1) + sym;
          setCursorPos(newExpr.length);
          return newExpr;
        }
      }

      // Insert at current cursor position (movable blinker support)
      const newExpr = prev.slice(0, pos) + sym + prev.slice(pos);
      setCursorPos(pos + 1);
      return newExpr;
    });
  }, [expression, isResultMode, triggerHaptic, pushToUndo, cursorPos]);

  const toggleSign = useCallback(() => {
    triggerHaptic();
    pushToUndo(expression);

    if (isResultMode || expression === '0') {
      setIsResultMode(false);
      if (expression.startsWith('-')) {
        setExpression(expression.slice(1) || '0');
      } else if (expression !== '0') {
        setExpression('-' + expression);
      }
      return;
    }

    const match = expression.match(/([+\-*/%×÷(]|^)(-?\d*\.?\d*)$/);
    if (!match) {
      setExpression(expression.startsWith('-') ? expression.slice(1) : '-' + expression);
      return;
    }

    const prefix = expression.slice(0, match.index! + (match[1] ? match[1].length : 0));
    let lastNum = match[2] || '0';
    if (lastNum === '' || lastNum === '-') lastNum = '0';
    const toggled = lastNum.startsWith('-') ? lastNum.slice(1) : '-' + lastNum;
    const newExpr = (prefix + toggled)
      .replace(/([+\-*/%×÷])-/g, '$1-')
      .replace(/--/g, '-')
      .replace(/\+-/g, '-');
    setExpression(newExpr || '0');
  }, [expression, isResultMode, triggerHaptic, pushToUndo]);

  const finalize = useCallback(() => {
    triggerHaptic(2);
    const finalRes = runningResult;
    onEvaluate(expression, finalRes);
    setIsResultMode(true);
    pushToUndo(expression);
    setExpression(finalRes);
    setCursorPos(finalRes.length);
  }, [expression, runningResult, triggerHaptic, onEvaluate, pushToUndo]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    triggerHaptic();
    const current = expression;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(old => [...old, current]);
    setUndoStack(old => old.slice(0, -1));
    setExpression(prev);
    setCursorPos(prev.length);
    setIsResultMode(false);
  }, [undoStack, expression, triggerHaptic]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    triggerHaptic();
    const current = expression;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(old => [...old, current]);
    setRedoStack(old => old.slice(0, -1));
    setExpression(next);
    setCursorPos(next.length);
    setIsResultMode(false);
  }, [redoStack, expression, triggerHaptic]);

  const clearExpression = useCallback(() => {
    triggerHaptic();
    setExpression('0');
    setIsResultMode(false);
    setCursorPos(0);
  }, [triggerHaptic]);

  const deleteLast = useCallback(() => {
    triggerHaptic();
    setExpression(prev => {
      let pos = cursorPos;
      if (pos === null || pos < 0) pos = prev.length;
      if (pos === 0) return prev || '0';
      const newExpr = prev.slice(0, pos - 1) + prev.slice(pos);
      setCursorPos(Math.max(0, pos - 1));
      return newExpr || '0';
    });
    setIsResultMode(false);
  }, [triggerHaptic, cursorPos]);

  const pasteExpression = useCallback((raw: string) => {
    const sanitized = sanitizeClipboardExpression(raw);
    if (!sanitized) return;

    triggerHaptic();
    pushToUndo(expression);
    setIsResultMode(false);

    setExpression((prev) => {
      let pos = cursorPos;
      if (pos < 0 || pos > prev.length) pos = prev.length;

      if (prev === '0') {
        setCursorPos(sanitized.length);
        return sanitized;
      }

      const newExpr = prev.slice(0, pos) + sanitized + prev.slice(pos);
      setCursorPos(pos + sanitized.length);
      return newExpr;
    });
  }, [expression, cursorPos, triggerHaptic, pushToUndo]);

  const addInventoryItem = useCallback((price: number) => {
    triggerHaptic();
    pushToUndo(expression);
    setIsResultMode(false);

    const segment = formatInventoryPriceSegment(price);

    setExpression((prev) => {
      if (prev === '0') {
        setCursorPos(segment.length);
        return segment;
      }

      let pos = cursorPos;
      if (pos < 0 || pos > prev.length) pos = prev.length;

      const before = prev.slice(0, pos);
      const needsSeparator = before.length > 0 && !before.endsWith('+');
      const insert = needsSeparator ? `+${segment}` : segment;
      const newExpr = before + insert + prev.slice(pos);
      setCursorPos(pos + insert.length);
      return newExpr;
    });
  }, [expression, cursorPos, triggerHaptic, pushToUndo]);

  return {
    expression,
    setExpression,
    calcError,
    inputChar,
    toggleSign,
    finalize,
    handleUndo,
    handleRedo,
    clearExpression,
    deleteLast,
    addInventoryItem,
    pasteExpression,
    cursorPos,
    setCursorPos,
  };
};