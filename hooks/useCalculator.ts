import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  safeEvaluate,
  tryEvaluateExpression,
  sanitizeClipboardExpression,
} from '../utils/calculator';
import {
  formatInventoryPriceSegment,
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
  const cursorPosRef = useRef(0);

  useEffect(() => {
    cursorPosRef.current = cursorPos;
  }, [cursorPos]);

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
    const result = tryEvaluateExpression(expression);
    setCalcError(result === null ? 'Invalid expression' : null);
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
        cursorPosRef.current = newExpr.length;
        setExpression(newExpr);
        setCursorPos(newExpr.length);
        return;
      }
      const fresh = char === '.' ? '0.' : char;
      cursorPosRef.current = fresh.length;
      setExpression(fresh);
      setCursorPos(fresh.length);
      return;
    }

    setIsResultMode(false);
    setExpression(prev => {
      const sym = char === '*' ? '×' : char === '/' ? '÷' : char;

      let pos = cursorPosRef.current;
      if (pos < 0 || pos > prev.length) pos = prev.length;

      // Special handling when at '0' start
      if (prev === '0' && !['+', '×', '÷', '.', '%'].includes(sym)) {
        const newExpr = sym;
        const nextPos = newExpr.length;
        cursorPosRef.current = nextPos;
        setCursorPos(nextPos);
        return newExpr;
      }

      const last = prev.slice(-1);
      const lastIsOp = ['+', '-', '×', '÷', '*', '/', '%'].includes(last);

      if (isOp && lastIsOp && pos === prev.length) {
        if (char === '-' && !['-', '×', '÷', '+', '/', '%'].includes(prev.slice(-2, -1))) {
          // allow
        } else {
          const newExpr = prev.slice(0, -1) + sym;
          const nextPos = newExpr.length;
          cursorPosRef.current = nextPos;
          setCursorPos(nextPos);
          return newExpr;
        }
      }

      // Insert at current cursor position (movable blinker support)
      const newExpr = prev.slice(0, pos) + sym + prev.slice(pos);
      const nextPos = pos + 1;
      cursorPosRef.current = nextPos;
      setCursorPos(nextPos);
      return newExpr;
    });
  }, [expression, isResultMode, triggerHaptic, pushToUndo]);

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
    onEvaluate(expression, runningResult);
  }, [expression, runningResult, triggerHaptic, onEvaluate]);

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
    cursorPosRef.current = 0;
    setCursorPos(0);
  }, [triggerHaptic]);

  const deleteLast = useCallback(() => {
    triggerHaptic();
    setExpression(prev => {
      let pos = cursorPosRef.current;
      if (pos === null || pos < 0) pos = prev.length;
      if (pos === 0) return prev || '0';
      const newExpr = prev.slice(0, pos - 1) + prev.slice(pos);
      const nextPos = Math.max(0, pos - 1);
      cursorPosRef.current = nextPos;
      setCursorPos(nextPos);
      return newExpr || '0';
    });
    setIsResultMode(false);
  }, [triggerHaptic]);

  const pasteExpression = useCallback((raw: string) => {
    const sanitized = sanitizeClipboardExpression(raw);
    if (!sanitized) return;

    triggerHaptic();
    pushToUndo(expression);
    setIsResultMode(false);

    setExpression((prev) => {
      let pos = cursorPosRef.current;
      if (pos < 0 || pos > prev.length) pos = prev.length;

      if (prev === '0') {
        cursorPosRef.current = sanitized.length;
        setCursorPos(sanitized.length);
        return sanitized;
      }

      const newExpr = prev.slice(0, pos) + sanitized + prev.slice(pos);
      const nextPos = pos + sanitized.length;
      cursorPosRef.current = nextPos;
      setCursorPos(nextPos);
      return newExpr;
    });
  }, [expression, triggerHaptic, pushToUndo]);

  const addInventoryItem = useCallback((price: number) => {
    triggerHaptic();
    pushToUndo(expression);
    setIsResultMode(false);

    const segment = formatInventoryPriceSegment(price);

    setExpression((prev) => {
      if (prev === '0') {
        cursorPosRef.current = segment.length;
        setCursorPos(segment.length);
        return segment;
      }

      let pos = cursorPosRef.current;
      if (pos < 0 || pos > prev.length) pos = prev.length;

      const before = prev.slice(0, pos);
      const needsSeparator = before.length > 0 && !before.endsWith('+');
      const insert = needsSeparator ? `+${segment}` : segment;
      const newExpr = before + insert + prev.slice(pos);
      const nextPos = pos + insert.length;
      cursorPosRef.current = nextPos;
      setCursorPos(nextPos);
      return newExpr;
    });
  }, [expression, triggerHaptic, pushToUndo]);

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