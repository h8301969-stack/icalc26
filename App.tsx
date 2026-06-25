import React, { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { safeEvaluate } from './utils/calculator';
import CalcButton from './components/CalcButton';
import HistoryPanel from './components/HistoryPanel';
import SettingsPanel from './components/SettingsPanel';
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
  const { history, saveResult } = useHistory();
  const { items, setItems, purchases, setPurchases } = usePOS(history);
  const { 
    expression, setExpression, calcError, inputChar, 
    toggleSign, finalize, handleUndo, handleRedo, clearExpression 
  } = useCalculator(saveResult, triggerHaptic);
  const {
    invoiceName,
    setInvoiceName,
    cartItems,
    actionLogs,
    runningTotal,
    saveCurrentInvoiceAndStartNew,
  } = useInvoice(expression, items, settings.currency);

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPOSOpen, setIsPOSOpen] = useState(false);
  const [isPlusAnimating, setIsPlusAnimating] = useState(false);
  const [isHomeAnimating, setIsHomeAnimating] = useState(false);
  const [isSettingsAnimating, setIsSettingsAnimating] = useState(false);
  
  const gestures = useSwipeGesture(() => setIsHistoryOpen(true));
  const { showPrompt, handleInstall, handleDismiss } = usePWAPrompt();
  const displayContentRef = useRef<HTMLPreElement>(null);
  const expressionScrollRef = useRef<HTMLDivElement>(null);
  const [displayFontSize] = useState(20);

  useLayoutEffect(() => {
    if (!displayContentRef.current) return;
    // font-size layout hook (reserved)
  }, [expression]);

  // Break expression into lines of 10 chars each
  const formattedExpression = useMemo(() => {
    if (expression === '0') return '0';
    return expression.match(/.{1,10}/g)?.join('\n') ?? expression;
  }, [expression]);

  // Auto-scroll expression to bottom so latest chars are always visible
  useEffect(() => {
    const el = expressionScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [expression]);
  
  const isAnyModalOpen = isHistoryOpen || isPOSOpen;

  const handleNewInvoice = () => {
    saveCurrentInvoiceAndStartNew();
    clearExpression();
    triggerHaptic(1);
    setIsPlusAnimating(true);
  };

  // Keyboard support for accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isAnyModalOpen) return; // Disable when modals are open

    const key = e.key;
    
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
      setExpression(prev => prev.slice(0, -1) || '0');
      e.preventDefault();
    }
    // Escape for clear
    else if (key === 'Escape') {
      setExpression('0');
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
          className={`relative w-[94%] h-[96%] sm:w-[90vw] sm:h-[90vh] max-w-[430px] max-h-[932px] flex flex-col rounded-[26px] overflow-hidden transition-all duration-500 ${isLight ? 'bg-white/40 shadow-2xl text-black' : 'bg-white/10 shadow-2xl text-white'} backdrop-blur-(--glass-blur,24px) ${isAnyModalOpen ? 'blur-xl opacity-40 scale-[0.92]' : 'opacity-100'}`}
          style={{
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))'
          }}
        >
          <div className="flex justify-between items-center px-4 pt-4 pb-2 z-50 relative pointer-events-none">
            <button 
              onClick={handleNewInvoice} 
              onAnimationEnd={() => setIsPlusAnimating(false)}
              className={`pointer-events-auto h-8 w-8 rounded-full flex items-center justify-center transition-all ${isPlusAnimating ? 'animate-plus-trigger' : ''} ${isLight ? 'bg-white/60 border-black/5 hover:bg-white/80 text-black' : 'bg-black/20 border-white/10 hover:bg-black/40 text-white'}`} 
              style={{ boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }}
              title="New Invoice"
            >
              <Icons.Plus size={16} />
            </button>
            
            <input
              type="text"
              placeholder="Search"
              className={`w-[193px] pointer-events-auto py-1.5 px-4 text-center text-sm rounded-full outline-none border transition-all ${isLight ? 'bg-white/60 border-black/5 focus:bg-white/80 text-black placeholder-black/30' : 'bg-black/20 border-white/10 focus:bg-black/40 text-white placeholder-white/30'}`}
              style={{ boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 0 12px rgba(255,255,255,0.6), 0 0 4px rgba(255,255,255,0.3)' }}
            />
 
            <div className="flex items-center gap-1.5 pointer-events-auto">
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
          
          {/* ── Display area ─────────────────────────────────────── */}
          <div
            className="flex-1 flex flex-col items-center px-4 overflow-hidden min-h-0"
            style={{ paddingTop: '13%' }}
          >
            {/* Live result — 40px bold, full opacity, just below search bar */}
            <div
              className="w-full text-center font-black tracking-tighter"
              style={{ fontSize: 35, lineHeight: 1.1, transition: 'opacity 0.15s' }}
              role="status"
              aria-live="polite"
              aria-label={`Result: ${safeEvaluate(expression)}`}
            >
              {expression === '0' ? '0' : safeEvaluate(expression)}
            </div>

            {/* Flexible gap pushes expression to the bottom */}
            <div style={{ flex: 1 }} />

            {calcError && (
              <div className="text-sm text-red-500 mb-1 text-center truncate max-w-full" role="alert">
                {calcError}
              </div>
            )}

            {/* Expression — full opacity, 10 chars/line, 4 lines then scrollable */}
            <div
              ref={expressionScrollRef}
              className="no-scrollbar w-full text-center"
              style={{
                height: `${displayFontSize * 1.25 * 4}px`,   // 4 visible lines
                overflowY: 'auto',
                paddingBottom: '0.25rem',
                scrollBehavior: 'smooth',
              }}
              aria-label={`Expression: ${expression}`}
            >
              <pre
                ref={displayContentRef}
                style={{
                  fontFamily:    'inherit',
                  fontSize:      `${displayFontSize}px`,
                  fontWeight:    300,
                  letterSpacing: '-0.03em',
                  lineHeight:    1.25,
                  whiteSpace:    'pre-wrap',
                  margin:        0,
                  textAlign:     'center',
                }}
              >
                {expression === '0' ? <span style={{ opacity: 0.3 }}>0</span> : formattedExpression}
              </pre>
            </div>
          </div>

          <div 
            className={`flex-none flex justify-between gap-2 mb-2 px-4 mx-2 py-1.5 rounded-full border transition-all ${isLight ? 'bg-white/60 border-black/5 text-black' : 'bg-black/20 border-white/10 text-white'}`}
            style={{ boxShadow: isLight ? '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)' : '0 8px 28px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)' }}
          >
              <button onClick={handleUndo} className="flex-1 py-1.5 flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Undo"><Icons.Undo size={16} /></button>
              <button onClick={handleRedo} className="flex-1 py-1.5 flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Redo"><Icons.Redo size={16} /></button>
              <button onClick={() => setIsPOSOpen(true)} className="flex-1 py-1.5 flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Trends"><Icons.Trends size={16} /></button>
              <button onClick={() => { triggerHaptic(); setExpression(prev => prev.slice(0, -1) || '0'); }} className="flex-1 py-1.5 flex justify-center hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-all" title="Delete"><Icons.Delete size={16} /></button>
          </div>

          <div className="flex-[1.3] grid grid-cols-4 grid-rows-5 gap-2 px-4 pb-4 min-h-0">
            <CalcButton label="AC" onClick={clearExpression} variant="secondary" isLight={isLight} ariaLabel="All Clear" />
            <CalcButton label="+/-" onClick={toggleSign} variant="secondary" isLight={isLight} ariaLabel="Toggle positive or negative sign" />
            <CalcButton label="%" onClick={() => inputChar('%')} variant="secondary" isLight={isLight} ariaLabel="Percent" />
            <CalcButton label="÷" onClick={() => inputChar('/')} variant="primary" accentColor={settings.accentColor} isLight={isLight} ariaLabel="Divide" />
            
            {[7,8,9].map(n => <CalcButton key={n} label={n.toString()} onClick={() => inputChar(n.toString())} isLight={isLight} />)}
            <CalcButton label="×" onClick={() => inputChar('*')} variant="primary" accentColor={settings.accentColor} isLight={isLight} ariaLabel="Multiply" />
            
            {[4,5,6].map(n => <CalcButton key={n} label={n.toString()} onClick={() => inputChar(n.toString())} isLight={isLight} />)}
            <CalcButton label="-" onClick={() => inputChar('-')} variant="primary" accentColor={settings.accentColor} isLight={isLight} ariaLabel="Subtract" />
            
            {[1,2,3].map(n => <CalcButton key={n} label={n.toString()} onClick={() => inputChar(n.toString())} isLight={isLight} />)}
            <CalcButton label="+" onClick={() => inputChar('+')} variant="primary" accentColor={settings.accentColor} isLight={isLight} ariaLabel="Add" />
            
            <CalcButton label="0" onClick={() => inputChar('0')} wide isLight={isLight} />
            <CalcButton label="." onClick={() => inputChar('.')} isLight={isLight} />
            <CalcButton label="=" onClick={finalize} variant="primary" accentColor={settings.accentColor} isLight={isLight} ariaLabel="Equals" />
          </div>
          <SettingsPanel 
            isOpen={isSettingsOpen} 
            onClose={() => setIsSettingsOpen(false)} 
            settings={settings} 
            updateSettings={(k, v) => updateSettings({ [k]: v })} 
            cartItems={cartItems}
            runningTotal={parseFloat(runningTotal) || 0}
            invoiceName={invoiceName}
            currency={settings.currency}
          />
        </div>
      </div>

      <HistoryPanel
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onClear={() => {
          clearExpression();
          triggerHaptic();
        }}
        isLight={isLight}
        currency={settings.currency}
        invoiceName={invoiceName}
        onInvoiceNameChange={setInvoiceName}
        cartItems={cartItems}
        actionLogs={actionLogs}
        runningTotal={runningTotal}
      />
      <POSDashboard
        history={history}
        items={items}
        setItems={setItems}
        purchases={purchases}
        setPurchases={setPurchases}
        invoiceActionLogs={actionLogs}
        isOpen={isPOSOpen}
        onClose={() => setIsPOSOpen(false)}
        isLight={isLight}
        accentColor={settings.accentColor}
        formatCurrency={formatCurrency}
        updateSettings={(k, v) => updateSettings({ [k]: v })}
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
