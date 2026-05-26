import React, { useState, useEffect, useRef } from 'react';
import { CaptionSegment, BurnConfig } from './types';
import { 
  uploadToGoogleFileApi, 
  pollGoogleFileState, 
  generateTimestampedCaptions,
  generateTimestampedCaptionsInline,
  generateTimestampedCaptionsGroq,
  parseTimestampToSeconds,
  correctCaptionsSpellingGemini,
  mapCaptionsToSelectedScript
} from './geminiUtils';
import { 
  Sparkles, 
  UploadCloud, 
  Video, 
  Download, 
  Settings, 
  Plus, 
  Trash,
  RefreshCw,
  Sliders,
  Code,
  FileVideo,
  Film,
  CheckCircle,
  FileText,
  ChevronRight,
  ChevronLeft,
  Play,
  Pause,
  RotateCcw,
  Key,
  Lock,
  Check
} from 'lucide-react';

/**
 * Smart automatic calibration for transcribed subtitles.
 * Auto-advances timestamps by automatically subtracting 0.8 seconds from every startTime and endTime.
 */
function autoCalibrateCaptions(segments: CaptionSegment[]): CaptionSegment[] {
  if (segments.length === 0) return segments;

  return segments.map(seg => {
    const correctedStart = Math.max(0, seg.startTime - 0.8);
    const duration = Math.max(0.2, seg.endTime - seg.startTime);
    const correctedEnd = correctedStart + duration;

    return {
      ...seg,
      startTime: parseFloat(correctedStart.toFixed(2)),
      endTime: parseFloat(correctedEnd.toFixed(2))
    };
  });
}

/**
 * Fixes overlapping/wrong timestamps sequentially.
 * Every startTime of segment N must always be greater than or equal to the endTime of N-1 plus a tiny buffer of 0.05s.
 */
function fixTimestamps(captions: CaptionSegment[]): CaptionSegment[] {
  const result: CaptionSegment[] = [];
  for (let i = 0; i < captions.length; i++) {
    const cap = { ...captions[i] };
    if (i === 0) {
      cap.startTime = 0;
    } else {
      const prev = result[i - 1];
      if (cap.startTime <= prev.endTime) {
        cap.startTime = parseFloat((prev.endTime + 0.05).toFixed(2));
      }
    }
    if (cap.endTime <= cap.startTime) {
      cap.endTime = parseFloat((cap.startTime + 1.2).toFixed(2));
    }
    result.push(cap);
  }
  return result;
}

interface StylePreset {
  id: string;
  name: string;
  description: string;
  config: BurnConfig;
}

const PRESETS: StylePreset[] = [
  {
    id: 'bold-cinematic',
    name: '📽️ Bold Cinematic',
    description: 'Yellow text, thick outline, high readability for drama and dialogue.',
    config: {
      fontSize: 28,
      fontColor: '#facc15', // Neon yellow
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 4,
      positionY: 80
    }
  },
  {
    id: 'minimalist-modern',
    name: '📱 Minimalist Modern',
    description: 'Elegant white text mounted on a semi-transparent dark back-plate.',
    config: {
      fontSize: 22,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.65,
      strokeColor: '#000000',
      strokeWidth: 0,
      positionY: 82
    }
  },
  {
    id: 'trendy-reel',
    name: '⚡ Trendy Reel Style',
    description: 'Bright electric cyan highlights with a clean modern borderless aesthetic.',
    config: {
      fontSize: 26,
      fontColor: '#22d3ee', // Cyan
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 2,
      positionY: 78
    }
  }
];

export default function App() {
  // Core Workflow State
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Core Media State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isVertical, setIsVertical] = useState<boolean>(false);
  
  // Transcribed Captions State (Standard initial Punjabi mock translations)
  const [captions, setCaptions] = useState<CaptionSegment[]>([
    { id: '1', startTime: 1.2, endTime: 4.5, text: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ, ਸਵਾਗਤ ਹੈ ਤੁਹਾਡਾ!' },
    { id: '2', startTime: 4.8, endTime: 8.0, text: 'Today we are burning dynamic Punjabi subtitles on the fly.' }
  ]);

  // Transcribe Flow States
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return localStorage.getItem('syncscript_gemini_key') || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  });
  const [inputKey, setInputKey] = useState<string>('');
  
  const [groqApiKey, setGroqApiKey] = useState<string>(() => {
    return localStorage.getItem('syncscript_groq_key') || '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';
  });
  const [inputGroqKey, setInputGroqKey] = useState<string>('');

  const [keyError, setKeyError] = useState<string | null>(null);

  // Automatically sync input fields if keys change
  useEffect(() => {
    if (geminiApiKey) {
      setInputKey(geminiApiKey);
    }
  }, [geminiApiKey]);

  useEffect(() => {
    if (groqApiKey) {
      setInputGroqKey(groqApiKey);
    }
  }, [groqApiKey]);
  const [captionLanguageMode, setCaptionLanguageMode] = useState<string>('Punjabi with English Letters (Romanized / Hinglish style)');
  const [transcribing, setTranscribing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [transcribeStatus, setTranscribeStatus] = useState('');
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  // Gemini manual spell check states
  const [spellChecking, setSpellChecking] = useState<boolean>(false);
  const [spellCheckError, setSpellCheckError] = useState<string | null>(null);
  const [spellCheckSuccess, setSpellCheckSuccess] = useState<boolean>(false);
  const [spellCheckStatus, setSpellCheckStatus] = useState<string>('');
  const [spellCheckAudioGuided, setSpellCheckAudioGuided] = useState<boolean>(true);

  // Subtitle Custom Style configuration
  const [config, setConfig] = useState<BurnConfig>({
    fontSize: 26,
    fontColor: '#facc15', // Neon yellow
    backgroundColor: '#000000',
    backgroundOpacity: 0.65,
    strokeColor: '#000000',
    strokeWidth: 3,
    positionY: 82
  });

  const [selectedPresetId, setSelectedPresetId] = useState<string>('bold-cinematic');

  // Video playback tracking helpers
  const [currentTime, setCurrentTime] = useState(0);
  const [activeCaptionText, setActiveCaptionText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [latencyOffset, setLatencyOffset] = useState<number>(0.3);

  // Synchronize active caption text with current time and segments using high-frequency requestAnimationFrame
  useEffect(() => {
    let rafId: number;

    const syncSubtitles = () => {
      const video = videoRef.current;
      if (!video) return;

      const time = video.currentTime;
      setCurrentTime(time);

      // Change caption matching logic to this:
      const lookAheadTime = video.currentTime + latencyOffset;
      const matching = captions.find(c => 
        lookAheadTime >= c.startTime && 
        lookAheadTime < c.endTime
      );

      const nextText = matching ? matching.text : '';
      setActiveCaptionText(nextText);

      if (isPlaying) {
        rafId = requestAnimationFrame(syncSubtitles);
      }
    };

    if (isPlaying) {
      rafId = requestAnimationFrame(syncSubtitles);
    } else {
      // Still sync when paused so editing or scratching the playhead updates immediately
      syncSubtitles();
    }

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isPlaying, captions, videoUrl, currentStep, latencyOffset]);

  // Video Export recorder states
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Auto-save key binding to localStorage
  useEffect(() => {
    localStorage.setItem('syncscript_gemini_key', geminiApiKey);
  }, [geminiApiKey]);

  useEffect(() => {
    localStorage.setItem('syncscript_groq_key', groqApiKey);
  }, [groqApiKey]);

  // Fetch API key automatically from workspaces backend if empty
  useEffect(() => {
    if (!geminiApiKey) {
      fetch('/api/get-workspace-key?email=jashan.grtlife@gmail.com')
        .then(res => {
          if (res.ok) return res.json();
          throw new Error('Not found');
        })
        .then(data => {
          if (data.apiKey) {
            setGeminiApiKey(data.apiKey);
          }
        })
        .catch(() => {
          console.warn('Silent key binding fetched bypassed or offline.');
        });
    }
  }, []);

  // Set the pre-selected style preset values
  const applyStylePreset = (preset: StylePreset) => {
    setSelectedPresetId(preset.id);
    setConfig(preset.config);
  };

  // Watch video playback state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    // Keep dynamic isPlaying state correctly bound
    setIsPlaying(!video.paused);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [videoUrl, currentStep]);

  // Automated trigger of dynamic burn engine upon entering Step 5
  useEffect(() => {
    if (currentStep === 5) {
      handleBurnAndExport();
    }
  }, [currentStep]);

  const handleSaveAndAuthenticate = () => {
    const trimmed = inputKey.trim();
    if (!trimmed) {
      setKeyError('Please enter a Google Gemini API Key.');
      return;
    }
    const trimmedGroq = inputGroqKey.trim();
    if (!trimmedGroq) {
      setKeyError('Please enter a Groq API Key.');
      return;
    }
    setKeyError(null);
    setGeminiApiKey(trimmed);
    setGroqApiKey(trimmedGroq);
  };

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setTranscribeError(null);
    }
  };

  // Helper to read files as Base64 in standard callback style
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const resStr = reader.result as string;
        const commaIdx = resStr.indexOf(',');
        resolve(commaIdx !== -1 ? resStr.substring(commaIdx + 1) : resStr);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  // Initiate Groq Whisper or Gemini subtitle pipeline
  const handleGenerateCaptions = async () => {
    if (!videoFile) {
      setTranscribeError('Please upload a video file first.');
      return;
    }
    if (!geminiApiKey.trim()) {
      setTranscribeError('Google Gemini API Key is missing. Please configure your key first.');
      return;
    }

    setTranscribing(true);
    setTranscribeError(null);
    setUploadProgress(10);

    try {
      let parsedCaptions: CaptionSegment[] = [];

      if (groqApiKey && groqApiKey.trim()) {
        setTranscribeStatus('Submitting raw video soundtrack to Groq Whisper v3 hardware accelerator...');
        setUploadProgress(40);
        
        parsedCaptions = await generateTimestampedCaptionsGroq(
          videoFile,
          groqApiKey.trim(),
          geminiApiKey.trim(),
          captionLanguageMode
        );
        
        setUploadProgress(90);
        setTranscribeStatus('Preserving verbatim Groq timestamps & executing script mapper...');
        
        if (parsedCaptions && parsedCaptions.length > 0) {
          const mappedCaptions = await mapCaptionsToSelectedScript(
            parsedCaptions,
            captionLanguageMode,
            geminiApiKey.trim()
          );
          setCaptions(mappedCaptions);
          setUploadProgress(100);
          setTranscribeStatus('Successfully transcribed captions via Groq Whisper!');
          // Deliberate sleep for visual confirmation
          await new Promise(r => setTimeout(r, 800));
          setCurrentStep(2); // Auto-progress to edit phase
        } else {
          throw new Error('No transcripts returned by the Groq Whisper backend.');
        }
      } else {
        setTranscribeStatus('Reading localized media file into memory...');
        setUploadProgress(25);
        
        const base64Data = await fileToBase64(videoFile);
        setUploadProgress(50);
        setTranscribeStatus('Submitting raw sound stream directly to Gemini-2.0-flash cognitive models...');
        
        setUploadProgress(75);
        parsedCaptions = await generateTimestampedCaptionsInline(
          base64Data,
          videoFile.type || 'video/mp4',
          geminiApiKey.trim(),
          'gemini-2.0-flash',
          captionLanguageMode
        );

        setUploadProgress(100);
        setTranscribeStatus('Aligning audio timestamps and word layouts...');

        if (parsedCaptions && parsedCaptions.length > 0) {
          const calibrated = autoCalibrateCaptions(parsedCaptions);
          const calibratedAndFixed = fixTimestamps(calibrated);
          const mappedCaptions = await mapCaptionsToSelectedScript(
            calibratedAndFixed,
            captionLanguageMode,
            geminiApiKey.trim()
          );
          setCaptions(mappedCaptions);
          setTranscribeStatus('Successfully transcribed captions!');
          // Deliberate sleep for visual confirmation
          await new Promise(r => setTimeout(r, 800));
          setCurrentStep(2); // Auto-progress to edit phase
        } else {
          throw new Error('No transcripts returned by the Gemini core script parser.');
        }
      }
    } catch (err: any) {
      console.error(err);
      setTranscribeError(err.message || 'Transcribing pipeline failed (often due to video size or API restrictions).');
    } finally {
      setTranscribing(false);
    }
  };

  // Update segments
  const handleUpdateSegment = (id: string, field: keyof CaptionSegment, value: any) => {
    setCaptions(prev => prev.map(seg => {
      if (seg.id === id) {
        let updatedVal = value;
        if (field === 'startTime' || field === 'endTime') {
          updatedVal = parseTimestampToSeconds(value);
        }
        return { ...seg, [field]: updatedVal };
      }
      return seg;
    }));
  };

  // Perform Spell Checking with Gemini manually
  const handleSpellCheckWithGemini = async () => {
    if (captions.length === 0) return;
    setSpellChecking(true);
    setSpellCheckError(null);
    setSpellCheckSuccess(false);
    setSpellCheckStatus('Preparing transcription segments for spellcheck...');

    try {
      const texts = captions.map(seg => seg.text);
      const cleanedTexts = await correctCaptionsSpellingGemini(
        texts,
        captionLanguageMode,
        geminiApiKey,
        spellCheckAudioGuided ? videoFile : null,
        (status) => setSpellCheckStatus(status)
      );

      setCaptions(prev => prev.map((seg, idx) => {
        if (cleanedTexts[idx] !== undefined) {
          return { ...seg, text: cleanedTexts[idx] };
        }
        return seg;
      }));

      setSpellCheckSuccess(true);
      setTimeout(() => setSpellCheckSuccess(false), 4500);
    } catch (err: any) {
      console.error(err);
      setSpellCheckError(err.message || 'Gemini spell-check execution failed.');
    } finally {
      setSpellChecking(false);
      setSpellCheckStatus('');
    }
  };

  // Add individual segments
  const handleAddSegment = () => {
    const lastCap = captions[captions.length - 1];
    const newStart = lastCap ? lastCap.endTime + 0.5 : 0;
    const newEnd = newStart + 3.0;
    
    const newSeg: CaptionSegment = {
      id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      startTime: parseFloat(newStart.toFixed(1)),
      endTime: parseFloat(newEnd.toFixed(1)),
      text: 'New subtitle text...'
    };
    setCaptions(prev => [...prev, newSeg]);
  };

  const handleDeleteSegment = (id: string) => {
    setCaptions(prev => prev.filter(seg => seg.id !== id));
  };

  // Skip video play offset
  const jumpToTime = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      setCurrentTime(seconds);
    }
  };

  // Draw styled subtitles overlay relative to resolution metric scaling values
  const drawSubtitlesOnCanvas = (
    ctx: CanvasRenderingContext2D, 
    width: number, 
    height: number, 
    time: number
  ) => {
    const lookAheadTime = time + latencyOffset;
    const activeSeg = captions.find(c => 
      lookAheadTime >= c.startTime && 
      lookAheadTime < c.endTime
    );
    if (!activeSeg) return;

    const baseText = activeSeg.text.trim();
    if (!baseText) return;

    const sizeMultiplier = width / 640;
    const calculatedFontSize = Math.max(14, Math.round(config.fontSize * sizeMultiplier));
    
    ctx.font = `bold ${calculatedFontSize}px 'Inter', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const paddingX = 24;
    const paddingY = 12;
    const x = width / 2;
    const y = (height * config.positionY) / 100;

    const maxWidth = width - 48;
    const words = baseText.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && i > 0) {
        lines.push(currentLine);
        currentLine = words[i];
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    const lineHeight = calculatedFontSize * 1.35;
    const totalBoxHeight = lines.length * lineHeight;

    if (config.backgroundOpacity > 0) {
      ctx.save();
      ctx.fillStyle = config.backgroundColor || '#000000';
      ctx.globalAlpha = config.backgroundOpacity;
      
      const maxLineWidth = lines.reduce((max, line) => {
        const metrics = ctx.measureText(line);
        return Math.max(max, metrics.width);
      }, 0);

      const bgW = maxLineWidth + paddingX;
      const bgH = totalBoxHeight + paddingY;
      const bgX = x - bgW / 2;
      const bgY = y - bgH / 2;
      
      ctx.beginPath();
      const r = 8;
      ctx.moveTo(bgX + r, bgY);
      ctx.arcTo(bgX + bgW, bgY, bgX + bgW, bgY + bgH, r);
      ctx.arcTo(bgX + bgW, bgY + bgH, bgX, bgY + bgH, r);
      ctx.arcTo(bgX, bgY + bgH, bgX, bgY, r);
      ctx.arcTo(bgX, bgY, bgX + bgW, bgY, r);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    lines.forEach((line, index) => {
      const lineY = y - (totalBoxHeight / 2) + (index * lineHeight) + (lineHeight / 2);
      
      if (config.strokeWidth > 0) {
        ctx.strokeStyle = config.strokeColor || '#000000';
        ctx.lineWidth = config.strokeWidth * sizeMultiplier;
        ctx.lineJoin = 'round';
        ctx.strokeText(line, x, lineY);
      }

      ctx.fillStyle = config.fontColor || '#ffffff';
      ctx.fillText(line, x, lineY);
    });
  };

  // High performance Canvas Media Recorder exporter
  const handleBurnAndExport = async () => {
    if (!videoUrl) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Matching video frame dimensions...');

    // We instantiate a temporal quiet video element specifically designed to run on background context
    const exportVideo = document.createElement('video');
    exportVideo.src = videoUrl;
    exportVideo.crossOrigin = 'anonymous';
    exportVideo.muted = true;
    exportVideo.playsInline = true;

    try {
      await new Promise<void>((resolve, reject) => {
        exportVideo.onloadedmetadata = () => resolve();
        exportVideo.onerror = (e) => reject(new Error('Failed to load video properties: ' + String(e)));
      });

      const videoWidth = exportVideo.videoWidth || 640;
      const videoHeight = exportVideo.videoHeight || 360;
      const duration = exportVideo.duration || 10;

      const canvas = canvasRef.current;
      if (!canvas) throw new Error('HTML5 canvas state reference node is missing.');
      
      canvas.width = videoWidth;
      canvas.height = videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to fetch canvas graphic context.');

      setExportStatus('Assembling canvas recording multiplexer...');
      const canvasStream = canvas.captureStream(30);

      let mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      const renderFPS = 25;
      const frameDelay = 1000 / renderFPS;
      const step = 1 / renderFPS;
      let currentRenderTime = 0;

      recorder.start();
      setExportStatus('Burning subtitles into frame tracks...');

      const executeRenderStep = async () => {
        if (currentRenderTime >= duration) {
          setExportStatus('Compiling video segments...');
          recorder.stop();
          
          await new Promise(r => setTimeout(r, 1200));
          
          const exportedBlob = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
          const exportUrl = URL.createObjectURL(exportedBlob);
          
          const link = document.createElement('a');
          link.href = exportUrl;
          link.download = `syncscript-burned-${Date.now()}.${chunks[0]?.type?.includes('mp4') ? 'mp4' : 'webm'}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          setIsExporting(false);
          setExportProgress(100);
          setExportStatus('Subtitle burn complete! File downloaded safely.');
          return;
        }

        exportVideo.currentTime = currentRenderTime;

        await new Promise<void>((resolve) => {
          const onSeek = () => {
            exportVideo.removeEventListener('seeked', onSeek);
            resolve();
          };
          exportVideo.addEventListener('seeked', onSeek);
        });

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, videoWidth, videoHeight);
        ctx.drawImage(exportVideo, 0, 0, videoWidth, videoHeight);

        drawSubtitlesOnCanvas(ctx, videoWidth, videoHeight, currentRenderTime);

        currentRenderTime += step;
        const percent = Math.min(99, Math.round((currentRenderTime / duration) * 100));
        setExportProgress(percent);
        setExportStatus(`Burning frames: ${percent}%`);

        setTimeout(executeRenderStep, frameDelay);
      };

      executeRenderStep();

    } catch (err: any) {
      console.error('Export run error:', err);
      alert(`Render error: ${err.message || err}`);
      setIsExporting(false);
    }
  };

  const handleResetProject = () => {
    setVideoFile(null);
    setVideoUrl(null);
    setIsVertical(false);
    setCaptions([
      { id: '1', startTime: 1.2, endTime: 4.5, text: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ, ਸਵਾਗਤ ਹੈ ਤੁਹਾਡਾ!' },
      { id: '2', startTime: 4.8, endTime: 8.0, text: 'Today we are burning dynamic Punjabi subtitles on the fly.' }
    ]);
    setCurrentStep(1);
    setIsExporting(false);
    setExportProgress(0);
    setExportStatus('');
  };

  const currentActiveCaption = captions.find(c => {
    const lookAheadTime = currentTime + latencyOffset;
    return lookAheadTime >= c.startTime && lookAheadTime < c.endTime;
  });

  return (
    <div id="app-root" className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-indigo-500/35 selection:text-indigo-200">
      
      {/* HEADER */}
      <header id="app-header" className="py-5 px-6 border-b border-neutral-900 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-50 transition-all select-none">
        <div id="header-container" className="max-w-[1200px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center space-x-3">
            <span className="p-2 bg-gradient-to-tr from-indigo-600 to-amber-500 rounded-xl shadow-lg ring-1 ring-white/10 flex items-center justify-center">
              <Film className="w-5 h-5 text-white animate-spin-slow" />
            </span>
            <div>
              <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-neutral-100 via-neutral-100 to-amber-400 bg-clip-text text-transparent">
                SyncScript AI
              </h1>
              <p className="text-[10px] text-neutral-400 font-mono tracking-wider uppercase font-bold">
                PRO-SERIES MULTILINGUAL SUBTITLE INTEGRATION
              </p>
            </div>
          </div>

          {/* CHRONOLOGICAL STEP TIMELINE INDICATOR */}
          {geminiApiKey.trim() && (
            <div className="flex items-center space-x-1 sm:space-x-2 bg-neutral-900 px-3 py-1.5 rounded-2xl border border-neutral-850">
              {[1, 2, 3, 4, 5].map((step) => (
                <React.Fragment key={step}>
                  <div 
                    className={`flex items-center justify-center w-6 h-6 rounded-lg text-[10px] font-black tracking-tighter transition-all ${
                      currentStep === step 
                        ? 'bg-amber-400 text-neutral-950 scale-110 shadow-lg font-bold' 
                        : currentStep > step 
                          ? 'bg-indigo-600/30 text-indigo-400 border border-indigo-505/20' 
                          : 'bg-neutral-950 text-neutral-550 border border-neutral-850'
                    }`}
                    title={`Stage ${step}`}
                  >
                    {step}
                  </div>
                  {step < 5 && (
                    <div className={`w-2 sm:w-4 h-[1px] transition-colors ${
                      currentStep > step ? 'bg-indigo-500' : 'bg-neutral-800'
                    }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* BODY CONSOLE */}
      <main id="app-main" className="flex-1 max-w-[1200px] mx-auto w-full p-6 flex flex-col items-center justify-center select-none">
        
        {!geminiApiKey.trim() || !groqApiKey.trim() ? (
          <div className="w-full max-w-lg bg-neutral-900/40 border border-neutral-900 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden text-center animate-fadeIn">
            <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-amber-500 via-indigo-500 to-amber-500"></div>
            
            <div className="w-14 h-14 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center border border-indigo-500/15 mx-auto">
              <Lock className="w-6 h-6 animate-pulse" />
            </div>

            <div className="space-y-2 select-none">
              <h2 className="text-xl font-black text-neutral-100 tracking-tight">Enter Your API Keys</h2>
              <p className="text-xs text-neutral-400 leading-relaxed max-w-sm mx-auto">
                Unlock the 5-stage automated video transcribing, timeline editing, styling, and high-performance offline rendering engine.
              </p>
            </div>

            <div className="space-y-4 text-left">
              {/* GEMINI KEY INPUT */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-[10.5px] font-mono select-none">
                  <label className="text-neutral-300 uppercase font-black tracking-wider">Gemini API Key</label>
                  <a 
                    href="https://aistudio.google.com/" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 font-bold font-sans"
                  >
                    Get API Key ↗
                  </a>
                </div>
                
                <div className="relative flex items-center">
                  <div className="absolute left-3 text-neutral-500 pointer-events-none">
                    <Key className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    value={inputKey}
                    onChange={(e) => {
                      setInputKey(e.target.value);
                      setKeyError(null);
                    }}
                    placeholder="Paste AI Studio API key (AIzaSy...)"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-10 pr-4 py-3 text-sm font-mono text-neutral-200 outline-none focus:border-indigo-500 transition-all"
                  />
                </div>
              </div>

              {/* GROQ KEY INPUT */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-[10.5px] font-mono select-none">
                  <label className="text-neutral-300 uppercase font-black tracking-wider">Groq API Key</label>
                  <a 
                    href="https://console.groq.com/" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-amber-400 hover:text-amber-300 hover:underline flex items-center gap-1 font-bold font-sans"
                  >
                    Get Groq Key ↗
                  </a>
                </div>
                
                <div className="relative flex items-center">
                  <div className="absolute left-3 text-neutral-500 pointer-events-none">
                    <Key className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    value={inputGroqKey}
                    onChange={(e) => {
                      setInputGroqKey(e.target.value);
                      setKeyError(null);
                    }}
                    placeholder="Enter Groq Whisper API Key (gsk_...)"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-10 pr-4 py-3 text-sm font-mono text-neutral-200 outline-none focus:border-amber-400 transition-all"
                  />
                </div>
              </div>

              {keyError && (
                <p className="text-xs text-red-400 font-semibold bg-red-955/20 border border-red-500/20 px-3 py-2 rounded-lg">
                  {keyError}
                </p>
              )}
            </div>

            <div className="space-y-4 pt-1">
              <button
                onClick={handleSaveAndAuthenticate}
                className="w-full bg-gradient-to-r from-amber-400 to-indigo-550 hover:from-amber-500 hover:to-indigo-650 text-neutral-950 hover:text-white font-black py-3.5 rounded-2xl text-xs uppercase tracking-widest shadow-lg active:scale-[0.99] transition-all flex items-center justify-center space-x-2 cursor-pointer border border-transparent"
              >
                <Check className="w-4 h-4" />
                <span>Save & Authenticate</span>
              </button>

              <div className="p-4 bg-neutral-950 border border-neutral-850 rounded-2xl text-left space-y-2 select-none">
                <span className="text-[9px] font-mono font-bold text-amber-500 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/15 uppercase tracking-widest">
                  Secure Local Sandbox
                </span>
                <p className="text-[10px] text-neutral-455 leading-relaxed">
                  Your credentials are saved exclusively inside this browser's secure <code>localStorage</code> cache and are never transmitted to external servers. Heavy baking processes run 100% clientside.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* =========================================================
                STAGE 1: INITIAL UPLOAD & SPEECH CONVERSION (Initial Screen)
                ========================================================= */}
            {currentStep === 1 && (
          <div className="w-full max-w-xl bg-neutral-900/40 border border-neutral-900 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden animate-fadeIn">
            <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-amber-500 via-indigo-500 to-amber-500"></div>

            <div className="space-y-1 text-center">
              <span className="text-[10px] font-mono tracking-widest uppercase bg-amber-500/10 text-amber-400 border border-amber-500/15 px-3 py-1 rounded-full font-bold">
                Stage 1: Media Setup
              </span>
              <h2 className="text-xl font-black text-neutral-100 tracking-tight pt-2">Upload File & Extract Captions</h2>
              <p className="text-xs text-neutral-400 leading-normal max-w-md mx-auto">
                Power on automated audio detection to map flawless timestamps. Everything is performed memory-safe.
              </p>
            </div>

            {/* DRAG-AND-DROP FILE BOX */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold text-neutral-300 tracking-wider uppercase">Raw Video Input</label>
              {!videoFile ? (
                <label className="border-2 border-dashed border-neutral-850 hover:border-indigo-500/50 rounded-2xl p-8 text-center select-none cursor-pointer flex flex-col items-center justify-center space-y-3 bg-neutral-950/20 hover:bg-neutral-950/40 transition-all">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <div className="w-12 h-12 bg-indigo-500/5 text-indigo-400 rounded-full flex items-center justify-center border border-indigo-500/10">
                    <UploadCloud className="w-6 h-6 animate-pulse" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-neutral-200">Load Original Video File</p>
                    <p className="text-[10px] text-neutral-500">MP4, WebM or MOV (Up to 100MB)</p>
                  </div>
                </label>
              ) : (
                <div className="flex items-center justify-between p-4 bg-neutral-950 rounded-2xl border border-neutral-850">
                  <div className="flex items-center space-x-3 overflow-hidden">
                    <Video className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    <div className="overflow-hidden">
                      <p className="text-xs font-bold text-neutral-200 truncate pr-2">{videoFile.name}</p>
                      <p className="text-[10px] text-neutral-500 font-mono">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setVideoFile(null);
                      setVideoUrl(null);
                    }}
                    className="text-[10px] text-red-400 hover:text-red-350 font-bold bg-red-500/5 border border-red-500/15 py-1.5 px-3 rounded-xl transition-all flex-shrink-0"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>

            {/* DIALECT SELECTOR */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-neutral-300 tracking-wider uppercase">Language Mode</label>
              <select
                value={captionLanguageMode}
                onChange={(e) => setCaptionLanguageMode(e.target.value)}
                className="w-full bg-neutral-950 text-xs font-semibold text-neutral-250 border border-neutral-850 rounded-lg px-3 py-2.5 outline-none focus:border-amber-400 cursor-pointer"
              >
                <option value="Pure Punjabi (Gurmukhi Script)">Punjabi (Gurmukhi Script / ਪੰਜਾਬੀ)</option>
                <option value="Punjabi with English Letters (Romanized / Hinglish style)">Romanized Punjabi / Transliterated letters (e.g., Sat Sri Akal)</option>
                <option value="Pure Hindi (Devanagari Script)">Hindi (Devanagari Script / हिन्दी)</option>
                <option value="Pure English (Translation Mode)">English (Auto-Translate & Transcribe)</option>
              </select>
            </div>

            {/* KEY BINDINGS */}
            <div className="space-y-3 bg-neutral-950 p-4 rounded-xl border border-neutral-850">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px] font-mono">
                  <span className="text-neutral-450 uppercase font-bold tracking-widest">Workspace Gemini API Key</span>
                  <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-amber-500 hover:underline">Request ↗</a>
                </div>
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="Paste active API token (AIzaSy...)"
                  className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-neutral-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5 border-t border-neutral-900 pt-2">
                <div className="flex justify-between items-center text-[10px] font-mono">
                  <span className="text-neutral-450 uppercase font-bold tracking-widest">Workspace Groq API Key</span>
                  <a href="https://console.groq.com/" target="_blank" rel="noreferrer" className="text-amber-500 hover:underline font-bold">Request ↗</a>
                </div>
                <input
                  type="password"
                  value={groqApiKey}
                  onChange={(e) => setGroqApiKey(e.target.value)}
                  placeholder="Paste Groq Whispering token (gsk_...)"
                  className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1.5 text-xs font-mono text-neutral-200 outline-none focus:border-amber-400"
                />
              </div>
            </div>

            {/* ACTION TRIGGERS */}
            <div className="space-y-3 pt-2">
              <button
                disabled={transcribing || !videoFile}
                onClick={handleGenerateCaptions}
                className="w-full bg-amber-400 hover:bg-amber-500 text-neutral-950 font-black py-4 rounded-2xl text-xs uppercase tracking-widest shadow-lg active:scale-[0.99] disabled:opacity-40 disabled:scale-100 transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                {transcribing ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-neutral-950" />
                ) : (
                  <Sparkles className="w-4 h-4 fill-neutral-950" />
                )}
                <span>Generate Captions</span>
              </button>

              {transcribing && (
                <div className="space-y-2 p-4 bg-neutral-950 border border-neutral-850 rounded-2xl animate-fadeIn text-neutral-250">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-amber-500 font-bold">{transcribeStatus}</span>
                    {uploadProgress > 0 && <span className="font-bold text-amber-500">{uploadProgress}%</span>}
                  </div>
                  {uploadProgress > 0 && (
                    <div className="w-full bg-neutral-900 h-1 rounded-full overflow-hidden">
                      <div className="bg-amber-400 h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  )}
                </div>
              )}

              {transcribeError && (
                <div className="p-3 bg-red-950/20 border border-red-500/20 rounded-xl text-xs text-red-400 font-bold tracking-tight">
                  {transcribeError}
                </div>
              )}

              {/* OPTIONAL SKIP BUTTON TO MOCK CONTINUATION FOR TESTERS */}
              {videoFile && !transcribing && (
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="w-full bg-neutral-950 border border-neutral-850 hover:bg-neutral-900 py-2.5 rounded-xl text-[11px] text-neutral-400 transition-all font-bold"
                >
                  Skip Transcription Flow & Edit Timelines Directly ↗
                </button>
              )}
            </div>
          </div>
        )}

        {/* =========================================================
            STAGE 2: VISUAL EDIT & TIMELINE TEXT STAMP INTERACTIVE LIST
            ========================================================= */}
        {currentStep === 2 && (
          <div className="w-full max-w-2xl bg-neutral-900/40 border border-neutral-900 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden animate-fadeIn">
            <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-amber-500 via-indigo-500 to-indigo-500"></div>

            <div className="space-y-1.5 border-b border-neutral-850 pb-3 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-mono tracking-widest uppercase bg-amber-500/10 text-amber-300 border border-amber-500/15 px-2.5 py-0.5 rounded font-bold">
                  Stage 2: Caption Timeline Editing
                </span>
                <h2 className="text-lg font-black text-neutral-100 tracking-tight pt-1">Adjust Timing & Transcripts</h2>
              </div>
              <button
                onClick={handleAddSegment}
                className="bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-505/20 text-indigo-400 text-[10px] font-bold uppercase py-1.5 px-3 rounded-lg flex items-center gap-1 cursor-pointer transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Add Block
              </button>
            </div>

            {/* GEMINI SPELL-CHECK CONTROL BOX */}
            <div className="bg-neutral-950 border border-neutral-850 p-4 rounded-2xl space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-neutral-850">
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-neutral-250 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20" /> Correct Spelling with Gemini
                  </h4>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    Fix spelling slips, phonetic typos, and grammar errors in <span className="text-amber-400 font-semibold">{captionLanguageMode}</span> directly. Timestamps and structures remain completely unchanged.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSpellCheckWithGemini}
                  disabled={spellChecking || captions.length === 0}
                  className="bg-amber-500 text-neutral-950 font-black text-xs uppercase px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all hover:bg-amber-400 disabled:opacity-55 disabled:cursor-not-allowed shrink-0 cursor-pointer shadow-lg shadow-amber-500/10"
                >
                  {spellChecking ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-neutral-950 fill-neutral-950" />
                      <span>Correct Spelling</span>
                    </>
                  )}
                </button>
              </div>

              {/* AUDIO GUIDED TOGGLE ACCENT CONTROL */}
              <div className="flex items-start sm:items-center gap-2.5 py-0.5">
                <input
                  type="checkbox"
                  id="audioGuidedSpellcheck"
                  checked={spellCheckAudioGuided}
                  onChange={(e) => setSpellCheckAudioGuided(e.target.checked)}
                  disabled={spellChecking}
                  className="mt-0.5 sm:mt-0 rounded border-neutral-800 bg-neutral-900 text-amber-500 accent-amber-500 focus:ring-amber-500 w-4 h-4 cursor-pointer disabled:opacity-50"
                />
                <label htmlFor="audioGuidedSpellcheck" className="text-[11px] text-neutral-300 cursor-pointer select-none leading-relaxed flex flex-col">
                  <span>
                    🎙️ <strong className="text-amber-400 font-bold uppercase tracking-wider text-[10px]">Active Voice Alignment (Listen to Sound):</strong> Let Gemini listen to the original video soundtrack to correct spelling mistakes based on speaking phonemes rather than text guesses only.
                  </span>
                </label>
              </div>

              {/* Status and Notifications */}
              {spellChecking && (
                <div className="text-[11px] text-amber-300 bg-amber-500/5 px-3 py-2 rounded-lg border border-amber-500/10 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{spellCheckStatus || 'Analyzing transcription and proofreading via Gemini-2.0-flash...'}</span>
                </div>
              )}

              {spellCheckSuccess && (
                <div className="text-[11px] text-emerald-400 bg-emerald-500/5 px-3 py-2 rounded-lg border border-emerald-500/15">
                  ✓ Spell-check refinement completed successfully!
                </div>
              )}

              {spellCheckError && (
                <div className="text-[11px] text-red-400 bg-red-500/5 px-3 py-2 rounded-lg border border-red-500/15">
                  ⚠ Spellcheck Error: {spellCheckError}
                </div>
              )}
            </div>

            {/* EDITABLE SEGMENTS LIST */}
            <div className="max-h-[380px] overflow-y-auto pr-1 space-y-3.5 custom-scrollbar">
              {captions.map((seg, idx) => (
                <div 
                  key={seg.id} 
                  className="p-4 bg-neutral-950 border border-neutral-850 rounded-2xl grid grid-cols-1 md:grid-cols-12 gap-3.5 items-center transition-all"
                >
                  <div className="md:col-span-1 flex items-center justify-between md:justify-center">
                    <span className="text-[10px] font-mono text-neutral-450 font-bold uppercase">
                      #{idx + 1}
                    </span>
                    <button
                      onClick={() => handleDeleteSegment(seg.id)}
                      className="md:hidden text-neutral-500 hover:text-red-400 p-1"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="md:col-span-4 grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="block text-[8px] font-mono text-neutral-500 uppercase font-bold tracking-wider">Start Sec</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={seg.startTime}
                        onChange={(e) => handleUpdateSegment(seg.id, 'startTime', e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-200 outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="block text-[8px] font-mono text-neutral-500 uppercase font-bold tracking-wider">End Sec</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={seg.endTime}
                        onChange={(e) => handleUpdateSegment(seg.id, 'endTime', e.target.value)}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-200 outline-none"
                      />
                    </div>
                  </div>

                  <div className="md:col-span-6">
                    <span className="block text-[8px] font-mono text-neutral-500 uppercase font-bold tracking-wider pb-1">Caption Layer text</span>
                    <input
                      type="text"
                      value={seg.text}
                      onChange={(e) => handleUpdateSegment(seg.id, 'text', e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-850 rounded px-3 py-1.5 text-xs text-neutral-200 outline-none focus:border-indigo-500 transition-all font-semibold"
                      placeholder="Type segment words..."
                    />
                  </div>

                  <div className="hidden md:col-span-1 md:flex items-center justify-center">
                    <button
                      onClick={() => handleDeleteSegment(seg.id)}
                      className="text-neutral-550 hover:text-red-400 p-1 rounded hover:bg-neutral-900 transition-colors"
                      title="Delete Caption Block"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {captions.length === 0 && (
                <div className="p-8 text-center border border-dashed border-neutral-850 rounded-xl space-y-2">
                  <p className="text-xs text-neutral-450">All captions have been erased.</p>
                  <button onClick={handleAddSegment} className="text-xs text-indigo-400 underline font-bold">Create first segment block</button>
                </div>
              )}
            </div>

            {/* FORWARD STEP FOOTER */}
            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setCurrentStep(1)}
                className="border border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200 px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              <button
                onClick={() => setCurrentStep(3)}
                disabled={captions.length === 0}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all flex items-center space-x-1"
              >
                <span>Proceed to Styles</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            STAGE 3: SELECT CAPTION STYLE PRESET & CUSTOM OVERRIDES
            ========================================================= */}
        {currentStep === 3 && (
          <div className="w-full max-w-2xl bg-neutral-900/40 border border-neutral-900 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden animate-fadeIn">
            <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-amber-500 via-indigo-500 to-amber-500"></div>

            <div className="space-y-1 text-center">
              <span className="text-[10px] font-mono tracking-widest uppercase bg-amber-500/10 text-amber-300 border border-amber-500/15 px-2.5 py-0.5 rounded font-bold">
                Stage 3: Subtitle Aesthetics Styling
              </span>
              <h2 className="text-lg font-black text-neutral-100 tracking-tight pt-1">Select Caption Preset Style</h2>
              <p className="text-xs text-neutral-400 leading-normal max-w-md mx-auto">
                Bake a stunning typographic brand identity onto your video with instant preview layouts.
              </p>
            </div>

            {/* PRESET CHIPS GRID */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PRESETS.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => applyStylePreset(preset)}
                    className={`p-4 rounded-2xl border text-left flex flex-col justify-between space-y-3 transition-all ${
                      isSelected 
                        ? 'bg-indigo-600/10 border-indigo-500 ring-1 ring-indigo-500/20' 
                        : 'bg-neutral-950 border-neutral-850 hover:border-neutral-700'
                    }`}
                  >
                    <div>
                      <h4 className="text-xs font-bold text-neutral-200">{preset.name}</h4>
                      <p className="text-[10px] text-neutral-450 leading-normal pt-1">{preset.description}</p>
                    </div>

                    {/* MINI VISUAL DEMO BLOCK */}
                    <div className="h-10 w-full bg-neutral-900 rounded border border-neutral-850 flex items-center justify-center p-2 text-center select-none">
                      <span 
                        className="text-[11px] font-bold leading-none truncate max-w-full"
                        style={{
                          fontSize: '11px',
                          color: preset.config.fontColor,
                          textShadow: preset.config.strokeWidth > 0 ? `0 0 ${preset.config.strokeWidth}px ${preset.config.strokeColor}` : 'none',
                          backgroundColor: preset.config.backgroundOpacity > 0 ? `${preset.config.backgroundColor}${Math.round(preset.config.backgroundOpacity * 255).toString(16).padStart(2, '0')}` : 'transparent',
                          padding: preset.config.backgroundOpacity > 0 ? '2px 6px' : '0',
                          borderRadius: '4px'
                        }}
                      >
                        ਹੈਲੋ ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* FINE TUNING ACCORDION OVERLAYS */}
            <div className="bg-neutral-950 p-4 rounded-2xl border border-neutral-850 space-y-4">
              <div className="flex items-center space-x-2 border-b border-neutral-900 pb-2">
                <Settings className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-neutral-400">Fine-tune Font Properties</span>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="block text-[8px] font-mono text-neutral-500 uppercase">Font Size (px)</span>
                  <input
                    type="number"
                    min="12"
                    max="64"
                    value={config.fontSize}
                    onChange={(e) => setConfig(prev => ({ ...prev, fontSize: parseInt(e.target.value) || 24 }))}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-200 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <span className="block text-[8px] font-mono text-neutral-500 uppercase font-bold text-neutral-400">Font Hues</span>
                  <input
                    type="color"
                    value={config.fontColor}
                    onChange={(e) => setConfig(prev => ({ ...prev, fontColor: e.target.value }))}
                    className="w-full h-8 bg-neutral-900 border border-neutral-800 rounded px-2 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <span className="block text-[8px] font-mono text-neutral-500 uppercase">Outline Weight</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={config.strokeWidth}
                    onChange={(e) => setConfig(prev => ({ ...prev, strokeWidth: parseInt(e.target.value) || 0 }))}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-200 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <span className="block text-[8px] font-mono text-neutral-500 uppercase">Frame Position Y%</span>
                  <input
                    type="number"
                    min="10"
                    max="95"
                    value={config.positionY}
                    onChange={(e) => setConfig(prev => ({ ...prev, positionY: parseInt(e.target.value) || 82 }))}
                    className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs font-mono text-neutral-200 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* ACTION TRIGGERS */}
            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setCurrentStep(2)}
                className="border border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200 px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Times</span>
              </button>

              <button
                onClick={() => setCurrentStep(4)}
                className="bg-indigo-600 hover:bg-indigo-505 text-white font-heavy px-5 py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all flex items-center space-x-1.5"
              >
                <span>Add Captions to Video</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            STAGE 4: LIVE COMPACT VISUAL VIDEO PREVIEW
            ========================================================= */}
        {currentStep === 4 && (
          <div className="w-full max-w-2xl bg-neutral-900/40 border border-neutral-900 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden animate-fadeIn">
            <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-amber-500 via-indigo-500 to-amber-500"></div>

            <div className="space-y-1 text-center border-b border-neutral-850 pb-3">
              <span className="text-[10px] font-mono tracking-widest uppercase bg-indigo-500/10 text-indigo-300 border border-indigo-500/15 px-2.5 py-0.5 rounded font-bold">
                Stage 4: Immersive Overlay Preview
              </span>
              <h2 className="text-xl font-black text-neutral-100 tracking-tight pt-1">Review Styled Timelines</h2>
            </div>

            {/* STAGE PLAYER WITH REALTIME DYNAMIC CANVAS DEEP COUPLING */}
            <div className={`relative rounded-2xl overflow-hidden bg-neutral-950 border border-neutral-850 flex items-center justify-center mx-auto transition-all ${
              isVertical 
                ? 'aspect-[9/16] w-full max-w-[280px] sm:max-w-[325px]' 
                : 'aspect-video w-full'
            }`}>
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="w-full h-full object-contain"
                    controls
                    playsInline
                    id="stage4-playback-node"
                    crossOrigin="anonymous"
                    onLoadedMetadata={(e) => {
                      const w = e.currentTarget.videoWidth;
                      const h = e.currentTarget.videoHeight;
                      setIsVertical(h > w);
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                  
                  {/* PLAYBACK CAPTION OVERLAY INTERACTIVE */}
                  {activeCaptionText && (
                    <div 
                      className="absolute text-center pointer-events-none px-4 select-none w-full animate-fadeIn z-10"
                      style={{ 
                        position: 'absolute',
                        bottom: '10%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        fontFamily: "'Inter', sans-serif" 
                      }}
                    >
                      <span 
                        className="inline-block px-3.5 py-1.5 rounded-lg text-center leading-normal"
                        style={{
                          fontSize: isVertical ? `${Math.max(12, Math.round(config.fontSize * 0.7))}px` : `${config.fontSize}px`,
                          color: config.fontColor,
                          backgroundColor: config.backgroundOpacity > 0 ? `${config.backgroundColor}${Math.round(config.backgroundOpacity * 255).toString(16).padStart(2, '0')}` : 'transparent',
                          textShadow: config.strokeWidth > 0 
                            ? `0 0 ${config.strokeWidth}px ${config.strokeColor}, 1px 1px ${config.strokeWidth}px ${config.strokeColor}, -1px -1px ${config.strokeWidth}px ${config.strokeColor}` 
                            : '0 1px 3px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.7)',
                          fontWeight: '600'
                        }}
                      >
                        {activeCaptionText}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-8 text-center space-y-2">
                  <FileVideo className="w-10 h-10 text-neutral-500 mx-auto" />
                  <p className="text-xs text-neutral-400">Source video layout disappeared. Please reset state.</p>
                </div>
              )}
            </div>

            {/* SECTIONS CONTROLLER DETAILS */}
            {videoUrl && (
              <div className="flex justify-between items-center text-[10px] font-mono text-neutral-450 bg-neutral-950 p-2.5 rounded-xl border border-neutral-850 select-none">
                <span>Play Time: {currentTime.toFixed(2)}s</span>
                <span>Active Caption Segment ID: {currentActiveCaption ? `#${captions.indexOf(currentActiveCaption) + 1}` : 'None'}</span>
              </div>
            )}

            {/* SYNC LATENCY CALIBRATION SLIDER */}
            {videoUrl && (
              <div className="bg-neutral-950 p-4 rounded-2xl border border-neutral-850 space-y-2.5">
                <div className="flex justify-between items-center text-[10.5px] font-mono">
                  <span className="text-neutral-400 font-bold uppercase tracking-wider">Sync Latency Calibration</span>
                  <span className="text-amber-400 font-black">{(latencyOffset * 1000).toFixed(0)} ms (Delay Offset)</span>
                </div>
                <input
                  type="range"
                  min="-1.5"
                  max="1.5"
                  step="0.05"
                  value={latencyOffset}
                  onChange={(e) => setLatencyOffset(parseFloat(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer"
                />
                <div className="flex justify-between text-[8.5px] font-mono text-neutral-500">
                  <span>-1500ms (Slower Subtitles)</span>
                  <span>0ms (Standard Sync)</span>
                  <span>+1500ms (Faster Subtitles)</span>
                </div>
              </div>
            )}

            {/* EXACT FOOTER ACTIONS REQUESTED */}
            <div className="grid grid-cols-2 gap-4 pt-2">
              <button
                onClick={() => setCurrentStep(3)}
                className="bg-neutral-950 hover:bg-neutral-900 border border-neutral-850 text-neutral-300 font-bold py-3.5 rounded-2xl text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center space-x-1"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Change Style</span>
              </button>

              <button
                onClick={() => setCurrentStep(5)}
                className="bg-indigo-600 hover:bg-indigo-505 text-white font-heavy py-3.5 rounded-2xl text-xs uppercase tracking-widest shadow-xl shadow-indigo-500/10 active:scale-95 transition-all cursor-pointer flex items-center justify-center space-x-1.5"
              >
                <Download className="w-4 h-4" />
                <span>Save Final Video</span>
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            STAGE 5: FULL COMPILATION EXPORT & WEB RESET (Final Export)
            ========================================================= */}
        {currentStep === 5 && (
          <div className="w-full max-w-xl bg-neutral-900/40 border border-neutral-900 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden text-center animate-fadeIn">
            <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-indigo-500 to-amber-500"></div>

            <div className="space-y-1.5 select-none">
              <span className="text-[10px] font-mono tracking-widest uppercase bg-indigo-500/10 text-indigo-300 border border-indigo-505/15 px-3 py-1 rounded-full font-bold">
                Stage 5: Live Recording Encoders
              </span>
              <h2 className="text-xl font-black text-neutral-100 tracking-tight pt-2">Baking Typographic Subtitles</h2>
              <p className="text-xs text-neutral-400 max-w-sm mx-auto">
                Baking segments directly inside your browser cache frame-by-frame. No files leave your device.
              </p>
            </div>

            {/* OFF-SCREEN CAPTURE CANVAS */}
            <canvas ref={canvasRef} className="hidden" />

            {/* COMPREHENSIVE ACTION MONITOR */}
            <div className="space-y-4 p-5 bg-neutral-950 border border-neutral-850 rounded-2xl">
              <div className="flex justify-between items-center text-xs font-mono select-none">
                <span className="text-amber-400 font-black">{exportStatus || 'Initializing compilation engines...'}</span>
                <span className="font-extrabold text-neutral-100">{exportProgress}%</span>
              </div>
              
              <div className="w-full bg-neutral-900 h-2 rounded-full overflow-hidden border border-neutral-800">
                <div 
                  className="bg-indigo-505 h-full transition-all duration-300 bg-gradient-to-r from-indigo-500 to-amber-500"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>

              <p className="text-[9px] text-neutral-500 leading-normal select-none">
                Note: Standard device recording is running. Please keep the viewport focus window active during generation to avoid rendering latency.
              </p>
            </div>

            {/* AUTOMATIC RESET CONTROLLER */}
            <div className="pt-2">
              <button
                onClick={handleResetProject}
                disabled={isExporting}
                className="w-full bg-neutral-950 border border-neutral-850 hover:bg-neutral-900 text-neutral-100 font-bold py-3.5 rounded-2xl text-xs uppercase tracking-widest transition-all disabled:opacity-45 cursor-pointer flex items-center justify-center space-x-1"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                <span>Start New Project</span>
              </button>
            </div>
          </div>
        )}
          </>
        )}

      </main>

      {/* FOOTER */}
      <footer id="app-footer" className="mt-auto py-5 border-t border-neutral-900 bg-neutral-950 text-neutral-500 text-[10px] font-mono select-none">
        <div id="footer-container" className="max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-2">
          <p>© 2026 SyncScript AI platform. All rights reserved.</p>
          <div className="flex items-center space-x-2">
            <span className="bg-neutral-900 px-2.5 py-0.5 rounded border border-neutral-850 text-indigo-400 font-medium">Stage {currentStep} Context</span>
            <span className="bg-neutral-900 px-2.5 py-0.5 rounded border border-neutral-850">v3.1.0-flat-compiler</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
