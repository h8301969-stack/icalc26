import React from 'react';
import { Icons } from '../constants';

interface PWAInstallPromptProps {
  showPrompt: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}

const PWAInstallPrompt: React.FC<PWAInstallPromptProps> = ({ showPrompt, onInstall, onDismiss }) => {
  if (!showPrompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end pointer-events-none">
      {/* Semi-transparent backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 pointer-events-auto"
        onClick={onDismiss}
      />
      
      {/* Prompt card */}
      <div className="relative w-full pb-safe pointer-events-auto animate-in slide-in-from-bottom-4 duration-300">
        <div className="mx-4 mb-4 rounded-3xl bg-gradient-to-br from-white/80 to-white/70 backdrop-blur-xl border border-white/40 shadow-2xl overflow-hidden">
          <div className="p-6 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 flex-1">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white">
                  <Icons.Download size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Install iCalc</h3>
                  <p className="text-sm text-gray-600">Add to your home screen</p>
                </div>
              </div>
              <button
                onClick={onDismiss}
                className="flex-shrink-0 text-gray-500 hover:text-gray-700 transition-colors"
              >
                <Icons.Delete size={20} />
              </button>
            </div>

            {/* Description */}
            <p className="text-sm text-gray-700 leading-relaxed">
              Get quick access to your calculator app directly from your home screen. Works offline and loads instantly.
            </p>

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={onDismiss}
                className="flex-1 py-3 px-4 rounded-xl font-medium text-gray-700 bg-white/50 hover:bg-white/70 transition-colors border border-white/60"
              >
                Not now
              </button>
              <button
                onClick={onInstall}
                className="flex-1 py-3 px-4 rounded-xl font-medium text-white bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 transition-all shadow-lg"
              >
                Install now
              </button>
            </div>

            {/* Helpful hint */}
            <p className="text-xs text-gray-500 text-center">
              You can install or uninstall anytime from your device settings
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PWAInstallPrompt;
