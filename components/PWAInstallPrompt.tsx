import React from 'react';
import { Icons } from '../constants';
import type { PwaInstallMode } from '../utils/pwaInstall';

interface PWAInstallPromptProps {
  showPrompt: boolean;
  installMode: PwaInstallMode | null;
  onInstall: () => void;
  onDismiss: () => void;
}

const IOSSteps: React.FC<{ needsSafari: boolean }> = ({ needsSafari }) => (
  <ol className="space-y-3 text-sm text-gray-700 leading-relaxed">
    {needsSafari && (
      <li className="flex gap-3 items-start">
        <span className="shrink-0 w-6 h-6 rounded-full bg-blue-500/15 text-blue-600 text-xs font-black flex items-center justify-center">1</span>
        <span>
          Open this page in <strong>Safari</strong> (copy the link from your browser menu).
        </span>
      </li>
    )}
    <li className="flex gap-3 items-start">
      <span className="shrink-0 w-6 h-6 rounded-full bg-blue-500/15 text-blue-600 text-xs font-black flex items-center justify-center">
        {needsSafari ? '2' : '1'}
      </span>
      <span className="flex items-center gap-1.5 flex-wrap">
        Tap the <strong>Share</strong> button
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-200/80 text-gray-700">
          <Icons.Share size={16} />
        </span>
        at the bottom of Safari.
      </span>
    </li>
    <li className="flex gap-3 items-start">
      <span className="shrink-0 w-6 h-6 rounded-full bg-blue-500/15 text-blue-600 text-xs font-black flex items-center justify-center">
        {needsSafari ? '3' : '2'}
      </span>
      <span>
        Scroll the menu and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
      </span>
    </li>
  </ol>
);

const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({
  showPrompt,
  installMode,
  onInstall,
  onDismiss,
}) => {
  if (!showPrompt || !installMode) return null;

  const isIOS = installMode === 'ios-safari' || installMode === 'ios-other';

  return (
    <div className="fixed inset-0 z-50 flex items-end pointer-events-none">
      <div
        className="absolute inset-0 bg-black/40 pointer-events-auto"
        onClick={onDismiss}
      />

      <div className="relative w-full pb-safe pointer-events-auto animate-in slide-in-from-bottom-4 duration-300 rounded-[15.6px]">
        <div className="mx-4 mb-4 rounded-[15.6px] bg-gradient-to-br from-white/80 to-white/70 backdrop-blur-xl border border-white/40 shadow-2xl overflow-hidden">
          <div className="p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 flex-1">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white">
                  {isIOS ? <Icons.Share size={24} /> : <Icons.Download size={24} />}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">
                    {isIOS ? 'Add to Home Screen' : 'Install iCalc'}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {isIOS ? 'Install iCalc like a native app' : 'Add to your home screen'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="flex-shrink-0 text-gray-500 hover:text-gray-700 transition-colors"
                aria-label="Dismiss install prompt"
              >
                <Icons.Delete size={20} />
              </button>
            </div>

            {isIOS ? (
              <IOSSteps needsSafari={installMode === 'ios-other'} />
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">
                Get quick access to your calculator app directly from your home screen. Works offline and loads instantly.
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onDismiss}
                className="flex-1 py-3 px-4 rounded-[10.4px] font-medium text-gray-700 bg-white/50 hover:bg-white/70 transition-colors border border-white/60"
              >
                {isIOS ? 'Got it' : 'Not now'}
              </button>
              {!isIOS && (
                <button
                  type="button"
                  onClick={onInstall}
                  className="flex-1 py-3 px-4 rounded-[10.4px] font-medium text-white bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 transition-all shadow-lg"
                >
                  Install now
                </button>
              )}
            </div>

            <p className="app-subtext text-[10px] opacity-45 text-gray-500 text-center">
              {isIOS
                ? 'iOS installs through Safari — there is no one-tap install button'
                : 'You can install or uninstall anytime from your device settings'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PWAInstallPrompt;