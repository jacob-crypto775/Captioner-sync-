import React, { useState } from 'react';
import { CaptionSegment } from '../types';
import { Trash2, Plus, Clock, FileText, Sparkles, Check } from 'lucide-react';

interface CaptionEditorProps {
  captions: CaptionSegment[];
  onUpdateCaptions: (captions: CaptionSegment[]) => void;
  onJumpToTime: (time: number) => void;
  currentTime: number;
}

export default function CaptionEditor({
  captions,
  onUpdateCaptions,
  onJumpToTime,
  currentTime
}: CaptionEditorProps) {
  const [newSegment, setNewSegment] = useState({ startTime: '', endTime: '', text: '' });

  const handleUpdateField = (id: string, field: keyof CaptionSegment, value: any) => {
    onUpdateCaptions(
      captions.map((item) => {
        if (item.id === id) {
          if (field === 'startTime' || field === 'endTime') {
            const parsedVal = parseFloat(value);
            return { ...item, [field]: isNaN(parsedVal) ? 0 : parsedVal };
          }
          return { ...item, [field]: value };
        }
        return item;
      })
    );
  };

  const handleDeleteSegment = (id: string) => {
    onUpdateCaptions(captions.filter((item) => item.id !== id));
  };

  const handleAddSegment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSegment.text.trim()) return;

    const start = parseFloat(newSegment.startTime) || 0;
    const end = parseFloat(newSegment.endTime) || start + 2;

    const added: CaptionSegment = {
      id: `man-seg-${Date.now()}`,
      startTime: start,
      endTime: end,
      text: newSegment.text
    };

    const updated = [...captions, added].sort((a, b) => a.startTime - b.startTime);
    onUpdateCaptions(updated);
    setNewSegment({ startTime: '', endTime: '', text: '' });
  };

  const handleSortCaptionsByTime = () => {
    const sorted = [...captions].sort((a, b) => a.startTime - b.startTime);
    onUpdateCaptions(sorted);
  };

  return (
    <div id="caption-editor" className="space-y-4 text-neutral-100 flex flex-col h-full">
      {/* TIMELINE CONTROLS HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-900 pb-3">
        <div className="flex items-center space-x-2">
          <Clock className="w-5 h-5 text-indigo-400" />
          <h3 className="text-sm font-semibold tracking-wide uppercase font-mono">Caption Timeline Editor</h3>
          <span className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold">
            {captions.length} Segments
          </span>
        </div>
        <button
          onClick={handleSortCaptionsByTime}
          className="px-3 py-1 bg-neutral-900 hover:bg-neutral-850 text-neutral-300 border border-neutral-805 rounded-lg text-xs font-medium cursor-pointer transition-colors active:scale-95"
        >
          Sort Chronologically
        </button>
      </div>

      {/* QUICK ADD FORM */}
      <form onSubmit={handleAddSegment} className="bg-neutral-950/40 border border-neutral-900 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
        <div className="sm:col-span-3 grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-wider font-mono">Start (s)</span>
            <input
              type="number"
              placeholder="0"
              step="0.01"
              min="0"
              value={newSegment.startTime}
              onChange={(e) => setNewSegment({ ...newSegment, startTime: e.target.value })}
              className="w-full bg-neutral-900 border border-neutral-805 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 text-neutral-100 placeholder-neutral-600 font-mono"
            />
          </div>
          <div className="space-y-1">
            <span className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-wider font-mono">End (s)</span>
            <input
              type="number"
              placeholder="3"
              step="0.01"
              min="0"
              value={newSegment.endTime}
              onChange={(e) => setNewSegment({ ...newSegment, endTime: e.target.value })}
              className="w-full bg-neutral-900 border border-neutral-805 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 text-neutral-100 placeholder-neutral-600 font-mono"
            />
          </div>
        </div>
        <div className="sm:col-span-7 space-y-1">
          <span className="block text-[10px] font-semibold text-neutral-500 uppercase tracking-wider font-mono">Subtitle Text Content</span>
          <input
            type="text"
            placeholder="Line to add (e.g., 'Welcome to SyncScript')"
            value={newSegment.text}
            onChange={(e) => setNewSegment({ ...newSegment, text: e.target.value })}
            className="w-full bg-neutral-900 border border-neutral-805 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500 text-neutral-100 placeholder-neutral-600"
          />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="w-full h-8.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer active:scale-95 transition-all flex items-center justify-center space-x-1"
          >
            <Plus className="w-4.5 h-4.5" />
            <span>Add</span>
          </button>
        </div>
      </form>

      {/* SCROLLABLE CAPTION CONTAINER */}
      <div className="flex-1 overflow-y-auto max-h-[350px] pr-1 space-y-3 scrollbar-thin">
        {captions.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-12 border border-dashed border-neutral-900 rounded-xl bg-neutral-950/20 text-neutral-500 space-y-2">
            <FileText className="w-10 h-10 text-neutral-600" />
            <p className="text-xs font-medium">No subtitles generated or created yet</p>
            <p className="text-[10px] text-neutral-600 max-w-xs leading-relaxed">
              Drop in a video & generate automatic English transcripts via Google AI Studio Gemini API, or click manual "Add" above.
            </p>
          </div>
        ) : (
          captions.map((item, index) => {
            const isActive = currentTime >= item.startTime && currentTime <= item.endTime;
            return (
              <div
                key={item.id}
                className={`p-3.5 border rounded-xl gap-3 transition-all grid grid-cols-1 md:grid-cols-12 items-center leading-normal select-none ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-500/5 shadow-inner'
                    : 'border-neutral-900 bg-neutral-950/40 hover:border-neutral-800'
                }`}
              >
                {/* ID AND TIME GRID (Col 1-4) */}
                <div className="md:col-span-4 grid grid-cols-12 items-center gap-2">
                  {/* Jump To Timing Indicator */}
                  <div className="col-span-2 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => onJumpToTime(item.startTime)}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                        isActive
                          ? 'bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                          : 'bg-neutral-900 hover:bg-neutral-850 text-neutral-400 hover:text-neutral-200'
                      }`}
                      title="Seek player to start of subtitle"
                    >
                      <span className="text-[9px] font-bold font-mono">▶</span>
                    </button>
                  </div>

                  {/* Input In and Out times */}
                  <div className="col-span-5 flex flex-col space-y-0.5">
                    <span className="text-[9px] font-bold text-neutral-600 uppercase font-mono">Start Section</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={item.startTime}
                      onChange={(e) => handleUpdateField(item.id, 'startTime', e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-850 px-2 py-1 rounded text-xs text-indigo-300 font-mono focus:outline-none focus:border-indigo-500 text-center"
                    />
                  </div>

                  <div className="col-span-5 flex flex-col space-y-0.5">
                    <span className="text-[9px] font-bold text-neutral-600 uppercase font-mono">End Section</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={item.endTime}
                      onChange={(e) => handleUpdateField(item.id, 'endTime', e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-850 px-2 py-1 rounded text-xs text-indigo-305 font-mono focus:outline-none focus:border-indigo-500 text-center"
                    />
                  </div>
                </div>

                {/* SUBTITLE TEXT (Col 5-11) */}
                <div className="md:col-span-7 flex flex-col">
                  <textarea
                    rows={1}
                    value={item.text}
                    onChange={(e) => handleUpdateField(item.id, 'text', e.target.value)}
                    className="w-full bg-neutral-900/40 border border-neutral-850 px-3 py-1.5 rounded-lg text-xs hover:border-neutral-850 focus:outline-none focus:border-indigo-500 transition-colors placeholder-neutral-700 resize-none"
                    placeholder="Subtitle wording..."
                  />
                </div>

                {/* DELETE ACTION BUTTON (Col 12) */}
                <div className="md:col-span-1 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => handleDeleteSegment(item.id)}
                    className="p-2 text-neutral-500 hover:text-red-400 bg-neutral-900 hover:bg-red-950/15 rounded-lg transition-colors border border-neutral-850 hover:border-red-500/20 active:scale-95 cursor-pointer"
                    title="Delete timing segment"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
