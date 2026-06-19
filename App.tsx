import React, { useState, useMemo, useRef, useLayoutEffect } from 'react';
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

const AppContent: React.FC = () => {
  const { settings, updateSettings, triggerHaptic, isLight, formatCurrency } = useSettings();
  const { history, setHistory, saveResult, clearHistory } = useHistory();
  const { 
    expression, setExpression, calcError, inputChar, 
    toggleSign, finalize, handleUndo, handleRedo, clearExpression 
  } = useCalculator(saveResult, triggerHaptic);

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPOSOpen, setIsPOSOpen] = useState(false);
  
  const gestures = useSwipeGesture(() => setIsHistoryOpen(true));
  const { showPrompt, handleInstall, handleDismiss } = usePWAPrompt();
  const displayContentRef = useRef<HTMLDivElement>(null);
  const [displayFontSize, setDisplayFontSize] = useState(116.16); 

  useLayoutEffect(() => {
    if (!displayContentRef.current) return;
    // ... (keep layout logic here or move to useFontSize)
  }, [expression]);
  
  const isAnyModalOpen = isHistoryOpen || isSettingsOpen || isPOSOpen;

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
    <div className={`relative flex items-center justify-center h-[100dvh] w-full overflow-hidden font-sans transition-colors duration-200 ${isLight ? 'bg-[#f2f2f7]' : 'bg-black'}`}
         {...gestures} onKeyDown={handleKeyDown}
         role="main"
         aria-label="Calculator Application">
      <BlurredBackground isLight={isLight} wallpapers={settings.customWallpapers} isUnlocked={isUnlocked} />

      {!isUnlocked && (
        <WallpaperOverlay isLight={isLight} accentColor={settings.accentColor} onEnter={() => { triggerHaptic(2); setIsUnlocked(true); }} />
      )}

      <div className={`fixed inset-0 z-20 flex items-center justify-center transition-all duration-700 cubic-bezier(0.16, 1, 0.3, 1) ${isUnlocked ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}`}>
        <div 
          className={`relative w-[94%] h-[96%] sm:w-[90vw] sm:h-[90vh] max-w-[430px] max-h-[932px] flex flex-col rounded-[26px] overflow-hidden transition-all duration-500 ${isLight ? 'bg-white/40 shadow-2xl text-black' : 'bg-white/10 shadow-2xl text-white'} backdrop-blur-[var(--glass-blur,24px)] ${isAnyModalOpen ? 'blur-xl opacity-40 scale-[0.92]' : 'opacity-100'}`}
          style={{
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))'
          }}
        >
          <div className="absolute top-[1%] left-1/2 -translate-x-1/2 z-50">
            <input 
              type="text" 
              placeholder="Search" 
              className={`w-32 py-1.5 px-4 text-center text-sm rounded-full outline-none border transition-all ${isLight ? 'bg-white/60 border-black/5 focus:bg-white/80 text-black placeholder-black/30' : 'bg-black/20 border-white/10 focus:bg-black/40 text-white placeholder-white/30'}`}
            />
          </div>

          <div className="flex justify-end p-4 absolute top-4 left-0 right-0 z-50 pointer-events-none">
            <button onClick={() => { setIsSettingsOpen(true); triggerHaptic(); }} className={`pointer-events-auto p-3 rounded-2xl ${isLight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/10 hover:bg-white/20'}`}><Icons.Settings size={22} /></button>
          </div>
          
          <div className="flex-1 flex flex-col justify-end items-center py-4 px-4 overflow-hidden min-h-0">
            {calcError && (
              <div className="text-sm text-red-500 mb-2 text-center truncate max-w-full" role="alert">
                {calcError}
              </div>
            )}
            <div 
              ref={displayContentRef} 
              style={{ fontSize: `${displayFontSize}px` }} 
              className="font-light tracking-tighter break-all w-full text-center"
              role="status"
              aria-live="polite"
              aria-label={`Display: ${expression}`}
            >
              {expression === '0' ? <span className="opacity-20">0</span> : expression}
            </div>
          </div>

          <div className="flex-none flex justify-between gap-2 mb-2 px-4 mx-2 py-1.5 rounded-[15.6px] bg-current/5">
              <button onClick={handleUndo} className="flex-1 py-3 flex justify-center hover:bg-white/10 rounded-xl"><Icons.Undo size={18} /></button>
              <button onClick={handleRedo} className="flex-1 py-3 flex justify-center hover:bg-white/10 rounded-xl"><Icons.Redo size={18} /></button>
              <button onClick={() => setIsPOSOpen(true)} className="flex-1 py-3 flex justify-center hover:bg-white/10 rounded-xl"><Icons.Trends size={18} /></button>
              <button onClick={() => { triggerHaptic(); setExpression(prev => prev.slice(0, -1) || '0'); }} className="flex-1 py-3 flex justify-center hover:bg-white/10 rounded-xl"><Icons.Delete size={18} /></button>
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
        </div>
      </div>

      <HistoryPanel history={history} isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} onClear={clearHistory} onSelect={(i) => { setExpression(i.result); setIsHistoryOpen(false); }} isLight={isLight} />
      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} updateSettings={(k, v) => updateSettings({ [k]: v })} />
      <POSDashboard history={history} isOpen={isPOSOpen} onClose={() => setIsPOSOpen(false)} isLight={isLight} accentColor={settings.accentColor} formatCurrency={formatCurrency} updateSettings={(k, v) => updateSettings({ [k]: v })} />
      <PWAInstallPrompt showPrompt={showPrompt} onInstall={handleInstall} onDismiss={handleDismiss} />
    </div>
  );
};

const App: React.FC = () => (
  <ErrorBoundary
    fallback={(error, retry) => (
      <div className="flex items-center justify-center h-[100dvh] w-full bg-black p-4">
        <div className="max-w-md text-center text-white">
          <h1 className="text-2xl font-bold mb-4">⚠️ App Error</h1>
          <p className="text-gray-300 mb-6 font-mono text-sm break-words">
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
