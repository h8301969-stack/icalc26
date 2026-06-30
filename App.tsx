import React, { useState, useMemo, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { safeEvaluate } from './utils/calculator';
import CalcButton from './components/CalcButton';
import HistoryPanel from './components/HistoryPanel';
import InvoiceDragHandle from './components/InvoiceDragHandle';
import SettingsPanel from './components/SettingsPanel';
import SearchPanel from './components/SearchPanel';
import BlurredBackground from './components/BlurredBackground';
import POSDashboard from './components/POSDashboard';
import WallpaperOverlay from './components/WallpaperOverlay';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Icons } from './constants';
import { usePWAPrompt } from './hooks/usePWAPrompt';
import { useSettings } from './hooks/useSettings';
import { useHistory } from './hooks/useHistory';
import { useCalculator } from './hooks/useCalculator';
import { useSwipeGesture } from './hooks/useGestures';
import { usePOS } from './hooks/usePOS';
import { useInvoice } from './hooks/useInvoice';

const AppContent: React.FC = () => {
  const { settings, updateSettings, triggerHaptic, isLight, formatCurrency } = useSettings();
  const disableCard = !!settings.disableCalculatorCard;
  const isLandscape = settings.layoutMode === 'landscape';
  const { history, saveResult } = useHistory();
  const { items, setItems, purchases, setPurchases } = usePOS(history);
  const { 
    expression, calcError, inputChar, 
    toggleSign, finalize, handleUndo, handleRedo, clearExpression, deleteLast,
    cursorPos, setCursorPos
  } = useCalculator(saveResult, triggerHaptic);

  const displayResult = expression === '0' ? '0' : safeEvaluate(expression);
  const liveResultParts = useMemo(() => {
    const formatted = formatCurrency(displayResult);
    if (settings.currency === 'GHS') {
      return { amount: formatted.replace(/ghs$/i, ''), suffix: 'ghs' };
    }
    return { amount: formatted, suffix: '' };
  }, [displayResult, formatCurrency, settings.currency]);
  const showLiveResult = displayResult !== '0' && displayResult !== '0.00';
  const isDraggingCursor = useRef(false);
  const {
    invoiceName,
    setInvoiceName,
    cartItems,
    actionLogs,
    runningTotal,
    saveCurrentInvoiceAndStartNew,
    printLogs,
    recordPrint,
  } = useInvoice(expression, items, settings.currency);

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPOSOpen, setIsPOSOpen] = useState(false);
  const [isPlusAnimating, setIsPlusAnimating] = useState(false);
  const [isHomeAnimating, setIsHomeAnimating] = useState(false);
  const [isSettingsAnimating, setIsSettingsAnimating] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchAnchorRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const gestures = useSwipeGesture(() => setIsHistoryOpen(true));
  const { showPrompt, handleInstall, handleDismiss } = usePWAPrompt();
  const displayContentRef = useRef<HTMLPreElement>(null);
  const expressionScrollRef = useRef<HTMLDivElement>(null);
  const baseDisplayFontSize = isLandscape ? 32 : 36;
  const [maxCharsPerLine, setMaxCharsPerLine] = useState(12);
  const edgePadding = disableCard ? '8%' : '1rem';

  const expressionLineCount = useMemo(() => {
    if (expression === '0') return 1;
    const chars = Math.max(6, maxCharsPerLine);
    return (expression.match(new RegExp(`.{1,${chars}}`, 'g')) ?? [expression]).length;
  }, [expression, maxCharsPerLine]);

  const expressionFontScale = useMemo(() => {
    const reductions = Math.min(Math.max(expressionLineCount - 1, 0), 2);
    return 1 - 0.12 * reductions;
  }, [expressionLineCount]);

  const displayFontSize = baseDisplayFontSize * expressionFontScale;
  const liveResultFontSize = displayFontSize * 1.2;
  const expressionLineHeight = 1.25;
  const visibleExpressionLines = 4;

  useLayoutEffect(() => {
    if (!displayContentRef.current) return;
    // font-size layout hook (reserved)
  }, [expression]);

  // Dynamic line breaking: reach ~10% edge of the card instead of fixed 10 chars (responsive)
  const formattedExpression = useMemo(() => {
    if (expression === '0') return '0';
    const chars = Math.max(6, maxCharsPerLine);
    return expression.match(new RegExp(`.{1,${chars}}`, 'g'))?.join('\n') ?? expression;
  }, [expression, maxCharsPerLine]);

  // Auto-scroll expression to bottom so latest chars are always visible
  useEffect(() => {
    const el = expressionScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [expression]);

  const mapClientXToCursorPos = useCallback((clientX: number) => {
    const container = expressionScrollRef.current;
    if (!container || expression === '0') return 0;
    const rect = container.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const containerWidth = rect.width * 0.84;
    return Math.max(0, Math.min(expression.length, Math.round((clickX / containerWidth) * (maxCharsPerLine || 10) * 1.1)));
  }, [expression, maxCharsPerLine]);

  // Keep movable blinker (cursor) within expression bounds
  useEffect(() => {
    if (cursorPos !== null && cursorPos > expression.length) {
      setCursorPos(expression.length);
    }
  }, [expression, cursorPos]);

  // Measure available width for dynamic line length (target ~10% edge margin)
  useEffect(() => {
    const measure = () => {
      const container = expressionScrollRef.current;
      if (!container) return;
      // Use ~84% of width for text (8% margin each side)
      const availWidth = container.clientWidth * 0.84;
      // Rough char width for the font (non-mono but good avg for this style)
      const approxCharWidth = baseDisplayFontSize * 0.58;
      const calculated = Math.max(8, Math.floor(availWidth / approxCharWidth));
      if (calculated !== maxCharsPerLine) setMaxCharsPerLine(calculated);
    };

    measure();

    const ro = new ResizeObserver(measure);
    if (expressionScrollRef.current) ro.observe(expressionScrollRef.current);

    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [baseDisplayFontSize, isLandscape, disableCard]);
  
  const isAnyModalOpen = isHistoryOpen || isPOSOpen || isSearchOpen;
  const isCardDimmed = isHistoryOpen || isPOSOpen;

  const closeSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
    searchInputRef.current?.blur();
  };

  const handleSearchInvoiceSelect = (name: string) => {
    setInvoiceName(name);
    closeSearch();
    triggerHaptic();
    setIsHistoryOpen(true);
  };

  const handleSearchInventorySelect = () => {
    closeSearch();
    triggerHaptic();
    setIsPOSOpen(true);
  };

  const handleNewInvoice = () => {
    saveCurrentInvoiceAndStartNew();
    clearExpression();
    triggerHaptic(1);
    setIsPlusAnimating(true);
  };

  // Declarative keypad definition (clean, no repetition)
  type KeyDef = {
    label: string;
    action: string;
    variant?: 'primary' | 'secondary';
    wide?: boolean;
    ariaLabel?: string;
  };

  const keypad: KeyDef[] = [
    { label: 'AC', action: 'AC', variant: 'secondary', ariaLabel: 'All Clear' },
    { label: '+/-', action: '±', variant: 'secondary', ariaLabel: 'Toggle positive or negative sign' },
    { label: '%', action: '%', variant: 'secondary', ariaLabel: 'Percent' },
    { label: '÷', action: '/', variant: 'primary', ariaLabel: 'Divide' },

    { label: '7', action: '7' },
    { label: '8', action: '8' },
    { label: '9', action: '9' },
    { label: '×', action: '*', variant: 'primary', ariaLabel: 'Multiply' },

    { label: '4', action: '4' },
    { label: '5', action: '5' },
    { label: '6', action: '6' },
    { label: '-', action: '-', variant: 'primary', ariaLabel: 'Subtract' },

    { label: '1', action: '1' },
    { label: '2', action: '2' },
    { label: '3', action: '3' },
    { label: '+', action: '+', variant: 'primary', ariaLabel: 'Add' },

    { label: '0', action: '0', wide: true },
    { label: '.', action: '.' },
    { label: '=', action: '=', variant: 'primary', ariaLabel: 'Equals' },
  ];

  const handleKeypad = (action: string) => {
    if (action === 'AC') return clearExpression();
    if (action === '±') return toggleSign();
    if (action === '=') return finalize();
    inputChar(action);
  };

  // Keyboard support for accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key;

    if (key === 'Escape' && isSearchOpen) {
      closeSearch();
      e.preventDefault();
      return;
    }

    if (isAnyModalOpen) return;
    
    // Numbers
    if (/^\d$/.test(key)) {
      inputChar(key);
      e.preventDefault();
    }
    // Operators
    else if (key === '+' || key === '-' || key === '*' || key === '/') {
      inputChar(key);
      e.preventDefault();
    }
    // Decimal point
    else if (key === '.') {
      inputChar('.');
      e.preventDefault();
    }
    // Enter or = for equals
    else if (key === 'Enter' || key === '=') {
      finalize();
      e.preventDefault();
    }
    // Backspace for delete
    else if (key === 'Backspace') {
      deleteLast();
      e.preventDefault();
    }
    else if (key === 'Escape') {
      clearExpression();
      e.preventDefault();
    }
  };

  return (
    <div className={`relative flex items-center justify-center h-dvh w-full overflow-hidden font-sans transition-colors duration-200 ${isLight ? 'bg-[#f2f2f7]' : 'bg-black'}`}
         {...gestures} onKeyDown={handleKeyDown}
         role="main"
         aria-label="Calculator Application">
      <BlurredBackground isLight={isLight} wallpapers={settings.customWallpapers} isUnlocked={isUnlocked} />

      {!isUnlocked && (
        <WallpaperOverlay isLight={isLight} accentColor={settings.accentColor} onEnter={() => { triggerHaptic(2); setIsUnlocked(true); }} />
      )}

      <div className={`fixed inset-0 z-20 flex items-center justify-center transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1) ${isUnlocked ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}`}>
        <div 
          className={`relative flex flex-col overflow-hidden transition-all duration-500 ${
            isLandscape
              ? disableCard
                ? 'w-[98%] h-[94%] sm:w-[96vw] sm:h-[92vh]'
                : 'w-[94%] h-[90vh] sm:w-[92vw] max-w-[920px] max-h-[640px] rounded-[26px]'
              : disableCard
                ? 'w-[97%] h-[98%] sm:w-[95vw] sm:h-[96vh]'
                : 'w-[94%] h-[96%] sm:w-[90vw] sm:h-[90vh] max-w-[430px] max-h-[932px] rounded-[26px]'
          } ${disableCard ? `bg-transparent ${isLight ? 'text-black' : 'text-white'}` : `${isLight ? 'bg-white/40 shadow-2xl text-black' : 'bg-white/10 shadow-2xl text-white'} backdrop-blur-(--glass-blur,24px)`} ${isCardDimmed ? 'blur-xl opacity-40 scale-[0.92]' : 'opacity-100'}`}
          style={{
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
            paddingBottom: 0,
            paddingLeft: 'max(1rem, env(safe-area-inset-left))'
          }}
        >
          {isSearchOpen && (
            <div
              className="absolute inset-x-0 bottom-0 z-40 bg-black/25 backdrop-blur-xl transition-all duration-300 pointer-events-none"
              style={{ top: '3.25rem' }}
              aria-hidden="true"
            />
          )}

          <div
            className="flex items-center z-50 relative pointer-events-none shrink-0"
            style={{
              paddingTop: 'max(0.2rem, calc(1rem - 1.5%))',
              paddingLeft: 'max(0.2rem, calc(1rem - 1%))',
              paddingRight: 'max(0.2rem, calc(1rem - 1%))',
              gap: 'max(0.15rem, calc(0.625rem - 0.8%))',
            }}
          >
            <button 
              onClick={handleNewInvoice} 
              onAnimationEnd={() => setIsPlusAnimating(false)}
              className={`pointer-events-auto h-8 w-8 shrink-0 rounded-full flex items-center justify-center transition-all duration-300 ${isPlusAnimating ? 'animate-plus-trigger' : ''} ${isSearchOpen ? 'blur-[2px] opacity-35' : ''} ${isLight ? 'bg-white/60 border-black/5 hover:bg-white/80 text-black' : 'bg-black/20 border-white/10 hover:bg-black/40 text-white'}`} 
              style={{ boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }}
              title="New Invoice"
            >
              <Icons.Plus size={16} />
            </button>
            
            <div
              ref={searchAnchorRef}
              className={`relative flex-1 min-w-0 z-[60] pointer-events-auto ${isSearchOpen ? 'isolate' : ''}`}
            >
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchOpen(true)}
                placeholder="Search"
                aria-label="Search invoices and inventory"
                aria-expanded={isSearchOpen}
                aria-controls="search-results-panel"
                className={`w-full py-1.5 px-4 text-center text-sm rounded-full outline-none border transition-all duration-300 blur-0 ${
                  isSearchOpen
                    ? 'bg-zinc-600 border-zinc-500/60 text-white placeholder-white/50 shadow-lg opacity-100'
                    : isLight
                      ? 'bg-white/60 border-black/5 text-black placeholder-black/30'
                      : 'bg-black/20 border-white/10 text-white placeholder-white/30'
                }`}
                style={
                  isSearchOpen
                    ? {
                        boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
                        WebkitTextFillColor: '#ffffff',
                        caretColor: '#ffffff',
                      }
                    : { boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }
                }
              />
              <SearchPanel
                isOpen={isSearchOpen}
                query={searchQuery}
                onClose={closeSearch}
                isLight={isLight}
                currency={settings.currency}
                invoiceName={invoiceName}
                runningTotal={runningTotal}
                actionLogs={actionLogs}
                inventory={items}
                onSelectInvoice={handleSearchInvoiceSelect}
                onSelectInventory={handleSearchInventorySelect}
                anchorRef={searchAnchorRef}
              />
            </div>
 
            <div
              className={`flex items-center shrink-0 pointer-events-auto transition-all duration-300 ${isSearchOpen ? 'blur-[2px] opacity-35' : ''}`}
              style={{ gap: 'max(0.1rem, calc(0.375rem - 0.8%))' }}
            >
              <button 
                onClick={() => { setIsPOSOpen(true); triggerHaptic(); setIsHomeAnimating(true); }} 
                onAnimationEnd={() => setIsHomeAnimating(false)}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${isHomeAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-white/60 border-black/5 hover:bg-white/80 text-black' : 'bg-black/20 border-white/10 hover:bg-black/40 text-white'}`} 
                style={{ boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }}
                title="Dashboard"
              >
                <Icons.Home size={16} />
              </button>
              <button 
                onClick={() => { setIsSettingsOpen(true); triggerHaptic(); setIsSettingsAnimating(true); }} 
                onAnimationEnd={() => setIsSettingsAnimating(false)}
                className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${isSettingsAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-white/60 border-black/5 hover:bg-white/80 text-black' : 'bg-black/20 border-white/10 hover:bg-black/40 text-white'}`} 
                style={{ boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }}
                title="Settings"
              >
                <Icons.Settings size={16} />
              </button>
            </div>
          </div>

          {showLiveResult && (
            <div
              className={`relative z-40 flex justify-center items-center shrink-0 pointer-events-none select-none overflow-hidden py-0.5 transition-all duration-300 ${isSearchOpen ? 'blur-xl opacity-40' : ''}`}
              style={{
                paddingLeft: edgePadding,
                paddingRight: edgePadding,
              }}
              aria-live="polite"
              aria-label={`Live result: ${liveResultParts.amount}${liveResultParts.suffix}`}
            >
              <div
                className={`
                  font-num tracking-[-0.04em] leading-none truncate max-w-full
                  ${isLight ? 'live-result-green-light' : 'live-result-green'}
                  animate-live-glow-pulse animate-live-spring-loop
                `}
                style={{
                  fontSize: `${liveResultFontSize}px`,
                }}
              >
                <span className="font-num-bold">{liveResultParts.amount}</span>
                {liveResultParts.suffix && (
                  <span className="font-num-light">{liveResultParts.suffix}</span>
                )}
              </div>
            </div>
          )}

          {/* ── Calculator body (portrait stack / landscape split) ── */}
          <div className={`flex-1 flex min-h-0 overflow-hidden pb-10 ${isLandscape ? 'flex-row' : 'flex-col'}`}>
            {isLandscape && (
              <div
                className={`relative z-10 shrink-0 grid grid-cols-4 grid-rows-5 min-h-0 overflow-hidden transition-all duration-300 ${isSearchOpen ? 'blur-xl opacity-40' : ''}`}
                style={{
                  width: '52%',
                  gap: disableCard ? 'max(3px, 1.2%)' : '8px',
                  paddingLeft: edgePadding,
                  paddingRight: disableCard ? '4%' : '0.75rem',
                  paddingBottom: disableCard ? '5%' : '0.5rem',
                  paddingTop: disableCard ? '2%' : '0.5rem',
                  marginBottom: '-2%',
                }}
              >
                {keypad.map((btn, idx) => (
                  <CalcButton
                    key={`land-${idx}`}
                    label={btn.label}
                    onClick={() => handleKeypad(btn.action)}
                    variant={btn.variant}
                    wide={btn.wide}
                    accentColor={settings.accentColor}
                    isLight={isLight}
                    ariaLabel={btn.ariaLabel}
                    large={disableCard}
                  />
                ))}
              </div>
            )}

            <div className={`flex flex-col min-h-0 min-w-0 ${isLandscape ? 'flex-1' : 'flex-1'}`}>
              {/* Display area */}
              <div
                className={`flex-1 flex flex-col items-center overflow-hidden min-h-0 transition-all duration-300 ${isLight ? 'text-black' : 'text-white'} ${isSearchOpen ? 'blur-xl opacity-40' : ''}`}
                style={{
                  paddingTop: isLandscape
                    ? (disableCard ? '4%' : '14%')
                    : (disableCard ? '4%' : '18%'),
                  paddingLeft: edgePadding,
                  paddingRight: edgePadding,
                }}
              >
                <div style={{ flex: 1 }} />

                {calcError && (
                  <div className="text-sm text-red-500 mb-1 text-center truncate max-w-full px-[8%]" role="alert">
                    {calcError}
                  </div>
                )}

                <div className="relative w-full max-w-full shrink-0">
                  <div
                  ref={expressionScrollRef}
                  className="no-scrollbar w-full max-w-full text-center cursor-text select-none pointer-events-auto overflow-x-hidden"
                  style={{
                    height: `${displayFontSize * expressionLineHeight * visibleExpressionLines}px`,
                    overflowY: 'auto',
                    paddingBottom: '0.25rem',
                    paddingLeft: '8%',
                    paddingRight: '8%',
                    boxSizing: 'border-box',
                    scrollBehavior: 'smooth',
                  }}
                  aria-label={`Expression: ${expression}`}
                  onClick={(e) => {
                    if (isDraggingCursor.current) return;
                    setCursorPos(mapClientXToCursorPos(e.clientX));
                  }}
                  onPointerMove={(e) => {
                    if (!isDraggingCursor.current) return;
                    setCursorPos(mapClientXToCursorPos(e.clientX));
                  }}
                  onPointerUp={() => {
                    isDraggingCursor.current = false;
                  }}
                  onPointerCancel={() => {
                    isDraggingCursor.current = false;
                  }}
                >
                  <pre
                    ref={displayContentRef}
                    className={`font-num-light max-w-full overflow-hidden break-all ${isLight ? 'text-black' : 'text-white'}`}
                    style={{
                      fontSize: `${displayFontSize}px`,
                      color: isLight ? '#000000' : '#ffffff',
                      transition: 'font-size 0.2s ease-out',
                      letterSpacing: '-0.03em',
                      lineHeight: 1.25,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      margin: 0,
                      textAlign: 'center',
                    }}
                  >
                    {expression === '0' ? <span style={{ opacity: 0.3 }}>0</span> : (
                      (() => {
                        const pos = (cursorPos ?? expression.length);
                        const before = expression.slice(0, pos);
                        const after = expression.slice(pos);
                        return (
                          <>
                            {before}
                            <span
                              className="inline-block w-[2px] align-middle animate-blink bg-current cursor-grab active:cursor-grabbing touch-none"
                              style={{
                                height: `${displayFontSize * 1.05}px`,
                                marginLeft: '-1px',
                                marginRight: '-1px',
                                opacity: 0.9,
                              }}
                              role="slider"
                              aria-label="Move cursor"
                              aria-valuemin={0}
                              aria-valuemax={expression.length}
                              aria-valuenow={pos}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                isDraggingCursor.current = true;
                                e.currentTarget.setPointerCapture(e.pointerId);
                                setCursorPos(mapClientXToCursorPos(e.clientX));
                              }}
                              onPointerMove={(e) => {
                                if (!isDraggingCursor.current) return;
                                e.stopPropagation();
                                setCursorPos(mapClientXToCursorPos(e.clientX));
                              }}
                              onPointerUp={(e) => {
                                e.stopPropagation();
                                isDraggingCursor.current = false;
                                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                                  e.currentTarget.releasePointerCapture(e.pointerId);
                                }
                              }}
                              onPointerCancel={(e) => {
                                isDraggingCursor.current = false;
                              }}
                            />
                            {after}
                          </>
                        );
                      })()
                    )}
                  </pre>
                </div>
                </div>
              </div>

              {/* Action toolbar */}
              <div
                className={`flex-none flex justify-between gap-2 py-1.5 rounded-full border transition-all duration-300 ${isLandscape ? 'mb-2' : 'mb-2 mx-2'} ${isSearchOpen ? 'blur-xl opacity-40' : ''} ${isLight ? 'bg-white/60 border-black/5 text-black' : 'bg-black/20 border-white/10 text-white'}`}
                style={{
                  boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 8px 28px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)',
                  marginLeft: isLandscape ? edgePadding : undefined,
                  marginRight: isLandscape ? edgePadding : undefined,
                  paddingLeft: isLandscape ? '0.75rem' : edgePadding,
                  paddingRight: isLandscape ? '0.75rem' : edgePadding,
                }}
              >
                <button onClick={handleUndo} className="flex-1 py-1.5 flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Undo"><Icons.Undo size={16} /></button>
                <button onClick={handleRedo} className="flex-1 py-1.5 flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Redo"><Icons.Redo size={16} /></button>
                <button onClick={() => setIsPOSOpen(true)} className="flex-1 py-1.5 flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Trends"><Icons.Trends size={16} /></button>
                <button onClick={deleteLast} className="flex-1 py-1.5 flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Delete"><Icons.Delete size={16} /></button>
              </div>
            </div>

            {!isLandscape && (
              <div
                className={`relative z-10 flex-[1.3] grid grid-cols-4 grid-rows-5 min-h-0 overflow-hidden transition-all duration-300 ${isSearchOpen ? 'blur-xl opacity-40' : ''}`}
                style={{
                  gap: disableCard ? 'max(3px, 1.2%)' : '8px',
                  paddingLeft: edgePadding,
                  paddingRight: edgePadding,
                  paddingBottom: disableCard ? '5%' : '0.5rem',
                  marginBottom: '-2%',
                }}
              >
                {keypad.map((btn, idx) => (
                  <CalcButton
                    key={`port-${idx}`}
                    label={btn.label}
                    onClick={() => handleKeypad(btn.action)}
                    variant={btn.variant}
                    wide={btn.wide}
                    accentColor={settings.accentColor}
                    isLight={isLight}
                    ariaLabel={btn.ariaLabel}
                    large={disableCard}
                  />
                ))}
              </div>
            )}
          </div>

          <InvoiceDragHandle
            isLight={isLight}
            disabled={isAnyModalOpen}
            edgePinned
            onDragOpen={() => {
              triggerHaptic();
              setIsHistoryOpen(true);
            }}
          />

          <SettingsPanel
            isOpen={isSettingsOpen} 
            onClose={() => setIsSettingsOpen(false)} 
            settings={settings} 
            updateSettings={(keyOrPatch, value) => {
              if (typeof keyOrPatch === 'string') updateSettings({ [keyOrPatch]: value } as Partial<typeof settings>);
              else updateSettings(keyOrPatch);
            }}
            onApplyAppearance={() => {
              triggerHaptic();
              setIsSettingsOpen(false);
            }}
            cartItems={cartItems}
            runningTotal={parseFloat(runningTotal) || 0}
            invoiceName={invoiceName}
            currency={settings.currency}
            onInvoicePrinted={recordPrint}
          />
        </div>
      </div>

      <HistoryPanel
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        isLight={isLight}
        currency={settings.currency}
        invoiceName={invoiceName}
        onInvoiceNameChange={setInvoiceName}
        cartItems={cartItems}
        actionLogs={actionLogs}
        runningTotal={runningTotal}
        printLogs={printLogs}
        profiles={settings.profiles ?? []}
        activeProfileId={settings.activeProfileId ?? ''}
        onInvoicePrinted={recordPrint}
      />
      <POSDashboard
        history={history}
        items={items}
        setItems={setItems}
        purchases={purchases}
        setPurchases={setPurchases}
        invoiceActionLogs={actionLogs}
        invoiceName={invoiceName}
        cartItems={cartItems}
        runningTotal={runningTotal}
        printLogs={printLogs}
        currency={settings.currency}
        isOpen={isPOSOpen}
        onClose={() => setIsPOSOpen(false)}
        isLight={isLight}
        accentColor={settings.accentColor}
        formatCurrency={formatCurrency}
        settings={settings}
        updateSettings={(keyOrPatch, value) => {
          if (typeof keyOrPatch === 'string') updateSettings({ [keyOrPatch]: value } as Partial<typeof settings>);
          else updateSettings(keyOrPatch);
        }}
        onInvoicePrinted={recordPrint}
      />
      <PWAInstallPrompt showPrompt={showPrompt} onInstall={handleInstall} onDismiss={handleDismiss} />
    </div>
  );
};

const App: React.FC = () => (
  <ErrorBoundary
    fallback={(error, retry) => (
      <div className="flex items-center justify-center h-dvh w-full bg-black p-4">
        <div className="max-w-md text-center text-white">
          <h1 className="text-2xl font-bold mb-4">⚠️ App Error</h1>
          <p className="text-gray-300 mb-6 font-mono text-sm wrap-break-word">
            {error.message}
          </p>
          <button
            onClick={retry}
            aria-label="Retry application"
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    )}
  >
    <AppContent />
  </ErrorBoundary>
);

export default App;
