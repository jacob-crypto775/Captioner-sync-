import { UserSettings, BurnConfig } from '../types';
import { Key, Eye, EyeOff, Check, AlertCircle, RefreshCw, Sliders, Type, Layout } from 'lucide-react';
import { useState } from 'react';

interface SettingsPanelProps {
  settings: UserSettings;
  onUpdateSettings: (settings: UserSettings) => void;
  config: BurnConfig;
  onUpdateConfig: (config: BurnConfig) => void;
  onClose?: () => void;
}

export default function SettingsPanel({
  settings,
  onUpdateSettings,
  config,
  onUpdateConfig,
  onClose
}: SettingsPanelProps) {
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  const handleApiKeyChange = (val: string) => {
    onUpdateSettings({ ...settings, geminiApiKey: val });
    setTestStatus('idle');
    setTestError('');
  };

  const handleTestApiKey = async () => {
    if (!settings.geminiApiKey) {
      setTestStatus('error');
      setTestError('Please enter an API Key first.');
      return;
    }

    setTestStatus('idle');
    try {
      // Direct simple test call to generateContent
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${settings.geminiApiKey.trim()}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello' }] }]
        })
      });
      if (res.ok) {
        setTestStatus('success');
      } else {
        const err = await res.json().catch(() => ({}));
        setTestStatus('error');
        setTestError(err?.error?.message || 'Invalid API Key');
      }
    } catch (e) {
      setTestStatus('error');
      setTestError('Connection failed. Please check internet access or CORS.');
    }
  };

  const colors = [
    { name: 'White', value: '#ffffff' },
    { name: 'Yellow', value: '#facc15' },
    { name: 'Red', value: '#f87171' },
    { name: 'Green', value: '#4ade80' },
    { name: 'Cyan', value: '#22d3ee' },
    { name: 'Black', value: '#000000' }
  ];

  return (
    <div id="settings-panel" className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 text-neutral-200 space-y-6 shadow-2xl">
      {/* SECTION 1: GEMINI API KEY */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-amber-400 font-medium border-b border-neutral-800 pb-2">
          <Key className="w-4 h-4" />
          <h3 className="text-sm font-semibold tracking-wide uppercase">AI Studio API Configuration</h3>
        </div>

        <p className="text-xs text-neutral-400 leading-relaxed">
          SyncScript processes all videos locally, but transcribes using your own Google Gemini free-tier. Add your AI Studio API key for 100% free transcription.
        </p>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-neutral-300">API Secret Key</label>
          <div className="relative flex items-center">
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.geminiApiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-amber-500 font-mono transition-colors pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={handleTestApiKey}
            className="flex items-center space-x-1.5 px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-md text-xs font-medium border border-amber-500/20 active:scale-95 transition-all cursor-pointer"
          >
            <RefreshCw className="w-3  h-3" />
            <span>Validate API Key</span>
          </button>

          {testStatus === 'success' && (
            <span className="flex items-center text-xs text-green-400 font-medium">
              <Check className="w-3.5 h-3.5 mr-1" /> Verified
            </span>
          )}

          {testStatus === 'error' && (
            <span className="flex items-center text-xs text-red-400 font-medium max-w-xs text-right truncate" title={testError}>
              <AlertCircle className="w-3.5 h-3.5 mr-1 flex-shrink-0" /> {testError}
            </span>
          )}
        </div>
      </div>

      {/* SECTION 2: SUBTITLE TYPOGRAPHY */}
      <div className="space-y-4 pt-1">
        <div className="flex items-center space-x-2 text-indigo-400 font-medium border-b border-neutral-800 pb-2">
          <Type className="w-4 h-4" />
          <h3 className="text-sm font-semibold tracking-wide uppercase">Subtitle Typography</h3>
        </div>

        {/* Font Color Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-neutral-300">Text Color</label>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => onUpdateConfig({ ...config, fontColor: c.value })}
                className={`w-7 h-7 rounded-full border transition-all relative ${
                  config.fontColor.toLowerCase() === c.value.toLowerCase()
                    ? 'border-indigo-400 scale-110 shadow-lg'
                    : 'border-neutral-700 hover:scale-105'
                }`}
                style={{ backgroundColor: c.value }}
                title={c.name}
              >
                {config.fontColor.toLowerCase() === c.value.toLowerCase() && (
                  <span
                    className="absolute inset-0 flex items-center justify-center text-[10px] font-bold"
                    style={{ color: c.value === '#ffffff' || c.value === '#facc15' ? '#000000' : '#ffffff' }}
                  >
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Font Size & Stroke */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-400">Font Size ({config.fontSize}px)</label>
            <input
              type="range"
              min="14"
              max="40"
              step="1"
              value={config.fontSize}
              onChange={(e) => onUpdateConfig({ ...config, fontSize: parseInt(e.target.value) })}
              className="w-full h-1 bg-neutral-850 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-400">Outline Width ({config.strokeWidth}px)</label>
            <input
              type="range"
              min="0"
              max="5"
              step="0.5"
              value={config.strokeWidth}
              onChange={(e) => onUpdateConfig({ ...config, strokeWidth: parseFloat(e.target.value) })}
              className="w-full h-1 bg-neutral-850 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>
        </div>

        {/* Outline Stroke Selector */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-neutral-300">Outline Color</label>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button
                key={`stroke-${c.value}`}
                type="button"
                onClick={() => onUpdateConfig({ ...config, strokeColor: c.value })}
                className={`w-6 h-6 rounded-md border transition-all ${
                  config.strokeColor.toLowerCase() === c.value.toLowerCase()
                    ? 'border-indigo-400 scale-110'
                    : 'border-neutral-700 hover:scale-105'
                }`}
                style={{ backgroundColor: c.value }}
                title={c.name}
              />
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 3: SUBTITLE CONTAINER & POSITION */}
      <div className="space-y-4 pt-1">
        <div className="flex items-center space-x-2 text-emerald-400 font-medium border-b border-neutral-800 pb-2">
          <Layout className="w-4 h-4" />
          <h3 className="text-sm font-semibold tracking-wide uppercase">Container & Layout</h3>
        </div>

        {/* Background color and opacity */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-400">Background Box-Opacity ({Math.round(config.backgroundOpacity * 100)}%)</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={config.backgroundOpacity}
              onChange={(e) => onUpdateConfig({ ...config, backgroundOpacity: parseFloat(e.target.value) })}
              className="w-full h-1 bg-neutral-850 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-300">Background Color</label>
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <button
                  key={`bg-${c.value}`}
                  type="button"
                  onClick={() => onUpdateConfig({ ...config, backgroundColor: c.value })}
                  className={`w-6 h-6 rounded-md border transition-all ${
                    config.backgroundColor.toLowerCase() === c.value.toLowerCase()
                      ? 'border-emerald-400 scale-110'
                      : 'border-neutral-700 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Vertical Position */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-neutral-400">Vertical Alignment ({config.positionY}%)</label>
          <input
            type="range"
            min="10"
            max="90"
            step="1"
            value={config.positionY}
            onChange={(e) => onUpdateConfig({ ...config, positionY: parseInt(e.target.value) })}
            className="w-full h-1 bg-neutral-850 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <div className="flex justify-between text-[10px] text-neutral-500">
            <span>Top</span>
            <span>Center</span>
            <span>Bottom</span>
          </div>
        </div>
      </div>
    </div>
  );
}
