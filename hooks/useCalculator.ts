import { useState, useMemo, useCallback } from 'react';
import { safeEvaluate, CalculationError } from '../utils/calculator';

export const useCalculator = (
  onEvaluate: (expr: string, res: string) => void,
  triggerHaptic: (m?: number) => void
) => {
  const [expression, setExpression] = useState('0');
  const [isResultMode, setIsResultMode] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [calcError, setCalcError] = useState<string | null>(null);

  const pushToUndo = useCallback((val: string) => {
    setUndoStack(prev => [...prev, val].slice(-50));
    setRedoStack([]);
  }, []);

  const runningResult = useMemo(() => {
    try {
      setCalcError(null);
      if (expression === '0' || !expression) return '0.00';
      return safeEvaluate(expression, 2);
    } catch (err) {
      if (err instanceof CalculationError) setCalcError(err.message);
      return '0.00';
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
        // chain operation from current result
        const sym = char === '*' ? '×' : char === '/' ? '÷' : char;
        setExpression(prev => prev + sym);
        return;
      }
      // fresh start for digit / decimal
      if (char === '.') {
        setExpression('0.');
      } else {
        setExpression(char);
      }
      return;
    }

    setIsResultMode(false);
    setExpression(prev => {
      const sym = char === '*' ? '×' : char === '/' ? '÷' : char;
      if (prev === '0' && !['+', '×', '÷', '.', '%'].includes(sym)) {
        return sym;
      }
      // replace trailing operator with new one (except allowing minus for negatives)
      const last = prev.slice(-1);
      const lastIsOp = ['+', '-', '×', '÷', '*', '/', '%'].includes(last);
      if (isOp && lastIsOp) {
        if (char === '-' && !['-', '×', '÷', '+', '/', '%'].includes(prev.slice(-2, -1))) {
          // allow minus for starting negative term after op? keep simple: append
        } else {
          return prev.slice(0, -1) + sym;
        }
      }
      return prev + sym;
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
    let newExpr = (prefix + toggled)
      .replace(/([+\-*/%×÷])\-/g, '$1-')
      .replace(/--/g, '-')
      .replace(/\+\-/g, '-');
    setExpression(newExpr || '0');
  }, [expression, isResultMode, triggerHaptic, pushToUndo]);

  const finalize = useCallback(() => {
    triggerHaptic(2);
    const finalRes = runningResult;
    onEvaluate(expression, finalRes);
    setIsResultMode(true);
    pushToUndo(expression);
    setExpression(finalRes);
  }, [expression, runningResult, triggerHaptic, onEvaluate, pushToUndo]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    triggerHaptic();
    const current = expression;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(old => [...old, current]);
    setUndoStack(old => old.slice(0, -1));
    setExpression(prev);
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
    setIsResultMode(false);
  }, [redoStack, expression, triggerHaptic]);

  const clearExpression = useCallback(() => {
    triggerHaptic();
    setExpression('0');
    setIsResultMode(false);
  }, [triggerHaptic]);

  const deleteLast = useCallback(() => {
    triggerHaptic();
    setExpression(prev => prev.slice(0, -1) || '0');
    setIsResultMode(false);
  }, [triggerHaptic]);

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
  };
};