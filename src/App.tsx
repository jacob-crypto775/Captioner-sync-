import React, { useState, useEffect, useRef } from 'react';
import { CaptionSegment, BurnConfig } from './types';
import { 
  uploadToGoogleFileApi, 
  pollGoogleFileState, 
  generateTimestampedCaptions,
  generateTimestampedCaptionsInline,
  generateTimestampedCaptionsGroq,
  parseTimestampToSeconds,
  mapCaptionsToSelectedScript,
  correctCaptionsSpellingGemini
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
  category: string;
  config: BurnConfig;
}

const PRESETS: StylePreset[] = [
  // 💥 Active Word Zoom Category
  {
    id: 'bouncy-social-pink',
    name: '💗 Social Cherry Zoom',
    description: 'Vibrant cherry pink active words that spring-scale 1.35x. Perfect for modern reels.',
    category: '💥 Active Word Zoom',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 3.5,
      positionY: 80,
      highlightType: 'word-scale',
      activeWordColor: '#f43f5e',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'bouncy-social-yellow',
    name: '💛 Hormozi Neon Yellow',
    description: 'Classic high contrast bold Neon Yellow spoken words scaling up 1.35x for maximum emphasis.',
    category: '💥 Active Word Zoom',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000005',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 4,
      positionY: 82,
      highlightType: 'word-scale',
      activeWordColor: '#FFFF00',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'bouncy-sky-grow',
    name: '💎 Sky Blue Gravity Pop',
    description: 'Clean light sky blue active keywords zooming into focus on spoken segment cue points.',
    category: '💥 Active Word Zoom',
    config: {
      fontSize: 25,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 3,
      positionY: 80,
      highlightType: 'word-scale',
      activeWordColor: '#00FFFF',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'bouncy-lime-burst',
    name: '🦖 Neon Lime Giant Scale',
    description: 'Super-sized bright Neon Lime Green keyword highlight scaling up 1.45x for extreme punch.',
    category: '💥 Active Word Zoom',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 4,
      positionY: 80,
      highlightType: 'word-scale',
      activeWordColor: '#00FF00',
      activeWordBgColor: '#000000'
    }
  },

  // 🔥 Reels & Shorts Category
  {
    id: 'reels-word-highlight',
    name: '🔥 Alex Hormozi Yellow Pop',
    description: 'Active word gets a bright yellow capsule backdrop. Industry standard for high-retention reels.',
    category: '🔥 Reels & Shorts',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 3,
      positionY: 82,
      highlightType: 'word-bg',
      activeWordColor: '#000000',
      activeWordBgColor: '#eab308'
    }
  },
  {
    id: 'podcast-pill',
    name: '🎙️ Podcast Orange Pill',
    description: 'Rounded neon-orange pill background wraps the active word with high impact and energy.',
    category: '🔥 Reels & Shorts',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 2,
      positionY: 80,
      highlightType: 'podcast-pill',
      activeWordColor: '#ffffff',
      activeWordBgColor: '#f97316'
    }
  },
  {
    id: 'abdaal-green-capsule',
    name: '☘️ Abdaal Green Capsule',
    description: 'Clean light emerald capsule backdrop on active keywords. Perfect for clean content creator style.',
    category: '🔥 Reels & Shorts',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 2.5,
      positionY: 80,
      highlightType: 'word-bg',
      activeWordColor: '#ffffff',
      activeWordBgColor: '#22c55e'
    }
  },
  {
    id: 'crimson-aura-pop',
    name: '🍒 Crimson Aura Pop',
    description: 'Vivid cherry pink/red high-speed active word highlights for intense speech parts.',
    category: '🔥 Reels & Shorts',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 3,
      positionY: 82,
      highlightType: 'word-bg',
      activeWordColor: '#ffffff',
      activeWordBgColor: '#e11d48'
    }
  },

  // ⚡ Neon Glow Category
  {
    id: 'karaoke-glow',
    name: '❄️ Ice Cyan Glow',
    description: 'Active word pops with electric neon-cyan backlight glowing shadow and size surge.',
    category: '⚡ Neon Glow',
    config: {
      fontSize: 27,
      fontColor: '#e5e7eb',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 4,
      positionY: 78,
      highlightType: 'karaoke-glow',
      activeWordColor: '#22d3ee',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'neon-glow-green',
    name: '💚 Limelight Green Glow',
    description: 'Electric lime green aura text shadow that leaps out with radioactive energy.',
    category: '⚡ Neon Glow',
    config: {
      fontSize: 27,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 3.5,
      positionY: 78,
      highlightType: 'karaoke-glow',
      activeWordColor: '#a3e635',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'neon-glow-gold',
    name: '🌟 Solar Eclipse Gold',
    description: 'Sun-drenched bright gold electric backlight glow on spoken word segments.',
    category: '⚡ Neon Glow',
    config: {
      fontSize: 27,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 4,
      positionY: 78,
      highlightType: 'karaoke-glow',
      activeWordColor: '#fbbf24',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'neon-glow-purple',
    name: '💜 Cosmic Purple Majesty',
    description: 'Ultraviolet pulsing aura glow on spoken text segments for tech and space vibes.',
    category: '⚡ Neon Glow',
    config: {
      fontSize: 27,
      fontColor: '#e2e8f0',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 3,
      positionY: 78,
      highlightType: 'karaoke-glow',
      activeWordColor: '#c084fc',
      activeWordBgColor: '#000000'
    }
  },

  // 🎙️ Vlog & Podcast Category
  {
    id: 'vlog-green-outline',
    name: '✨ Clean Green Outline',
    description: 'High contrast black outlined letters with active words turning dynamic grass green.',
    category: '🎙️ Vlog & Podcast',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 3,
      positionY: 78,
      highlightType: 'word-color',
      activeWordColor: '#22c55e',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'vlog-sky-accent',
    name: '💎 Sky Blue Minimal',
    description: 'Clean vlogging layout with elegant water-like cold sky blue keyword highlights.',
    category: '🎙️ Vlog & Podcast',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 2,
      positionY: 80,
      highlightType: 'word-color',
      activeWordColor: '#38bdf8',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'vlog-candy-pink',
    name: '🍭 Pastel Candy Pink',
    description: 'Bright playful styling featuring a warm neon pink splash on spoken keywords.',
    category: '🎙️ Vlog & Podcast',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 2.5,
      positionY: 78,
      highlightType: 'word-color',
      activeWordColor: '#f472b6',
      activeWordBgColor: '#000000'
    }
  },

  // 🎞️ Cinematic & Clean Category
  {
    id: 'bold-cinematic',
    name: '📽️ Bold Cinematic Yellow',
    description: 'Thick black-outlined yellow lettering. Standard for documentaries, movies and dramatic audio.',
    category: '🎞️ Cinematic & Clean',
    config: {
      fontSize: 28,
      fontColor: '#facc15',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 4,
      positionY: 80,
      highlightType: 'none',
      activeWordColor: '#facc15',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'minimalist-modern',
    name: '📱 Minimalist Dark Plate',
    description: 'Elegant white dialogue centered inside an adjustable semi-transparent backdrop box.',
    category: '🎞️ Cinematic & Clean',
    config: {
      fontSize: 22,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.65,
      strokeColor: '#000000',
      strokeWidth: 0,
      positionY: 82,
      highlightType: 'none',
      activeWordColor: '#ffffff',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'classic-white',
    name: '🕊️ Plain High Contrast',
    description: 'Pure borderless white subtitle overlay with high legibility drop shadow backing.',
    category: '🎞️ Cinematic & Clean',
    config: {
      fontSize: 25,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 1.5,
      positionY: 84,
      highlightType: 'none',
      activeWordColor: '#ffffff',
      activeWordBgColor: '#000000'
    }
  },

  // 🎬 Pro Retaining Shorts Styles
  {
    id: 'hyper-reels-lime',
    name: '✨ Pro Reels Lime Green',
    description: 'Breathtaking 3D layout featuring neutral white secondary words and ultra-bold glowing neon lime green active words with strong text outlines.',
    category: '💥 Active Word Zoom',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 4,
      positionY: 80,
      highlightType: 'hyper-reels',
      activeWordColor: '#00FF00',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'hyper-reels-cyan',
    name: '⚡ Hyper Glow Cyber Blue',
    description: 'Intense glowing neon-cyan keyword highlight coupled with energetic tilt scaling.',
    category: '⚡ Neon Glow',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 4,
      positionY: 80,
      highlightType: 'hyper-reels',
      activeWordColor: '#00FFFF',
      activeWordBgColor: '#000000'
    }
  },
  {
    id: 'cursive-sandwich-yellow',
    name: '👑 Pro Cursive Sandwich',
    description: 'Slightly smaller, artistic handwriting cursive helper words paired with giant bold block-uppercase gold keyword highlights.',
    category: '🔥 Reels & Shorts',
    config: {
      fontSize: 26,
      fontColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0,
      strokeColor: '#000000',
      strokeWidth: 4.5,
      positionY: 80,
      highlightType: 'cursive-sandwich',
      activeWordColor: '#FFFF00',
      activeWordBgColor: '#000000'
    }
  }
];

function getBundledGeminiApiKey(): string {
  // @ts-ignore
  return import.meta.env.VITE_GEMINI_API_KEY || '';
}

export default function App() {
  // Core Workflow State
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Core Media State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isVertical, setIsVertical] = useState<boolean>(false);
  const [extractedAudioBlob, setExtractedAudioBlob] = useState<Blob | null>(null);
  
  // Transcribed Captions State (Standard initial Punjabi mock translations)
  const [captions, setCaptions] = useState<CaptionSegment[]>([
    { id: '1', startTime: 1.2, endTime: 4.5, text: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ, ਸਵਾਗਤ ਹੈ ਤੁਹਾਡਾ!' },
    { id: '2', startTime: 4.8, endTime: 8.0, text: 'Today we are burning dynamic Punjabi subtitles on the fly.' },
    { id: '3', startTime: 8.3, endTime: 12.0, text: 'ਪ੍ਰੋਫੈਸ਼ਨਲ ਵੀਡੀਓ ਸਬਟਾਈਟਲਸ ਹੁਣ ਮਿੰਟਾਂ ਵਿੱਚ ਤਿਆਰ ਕਰੋ।' },
    { id: '4', startTime: 12.4, endTime: 16.5, text: 'Simply upload your video, key in your API credentials, and click Transcribe.' },
    { id: '5', startTime: 17.0, endTime: 21.2, text: 'ਸਾਡੇ ਨਾਲ ਆਟੋ-ਕੈਲੀਬ੍ਰੇਟਿਡ ਵੀਡੀਓਜ਼ ਦਾ ਆਨੰਦ ਲਓ।' },
    { id: '6', startTime: 21.6, endTime: 26.0, text: 'Change styles, adjust offsets, and burn captions beautifully.' },
    { id: '7', startTime: 26.5, endTime: 31.0, text: 'ਸਾਰਾ ਕੁਝ ਤੁਹਾਡੀ ਉਂਗਲਾਂ \'ਤੇ ਬਹੁਤ ਆਸਾਨ ਤਰੀਕੇ ਨਾਲ।' },
    { id: '8', startTime: 31.5, endTime: 36.0, text: 'Export high-definition vertical reels or horizontal trailers with 1 click.' },
    { id: '9', startTime: 36.5, endTime: 41.5, text: 'ਧੰਨਵਾਦ ਜੀ, ਸਾਡੇ ਨਾਲ ਜੁੜਨ ਲਈ ਅਤੇ ਇਸ ਦੀ ਵਰਤੋਂ ਕਰਨ ਲਈ!' }
  ]);

  // Transcribe Flow States
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return localStorage.getItem('syncscript_gemini_key') || getBundledGeminiApiKey();
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
  const [isSpellingCorrecting, setIsSpellingCorrecting] = useState(false);
  const [spellConflictError, setSpellConflictError] = useState<string | null>(null);



  // Subtitle Custom Style configuration
  const [config, setConfig] = useState<BurnConfig>({
    fontSize: 26,
    fontColor: '#ffffff',
    backgroundColor: '#000000',
    backgroundOpacity: 0,
    strokeColor: '#000000',
    strokeWidth: 3.5,
    positionY: 80,
    highlightType: 'word-scale',
    activeWordColor: '#f43f5e',
    activeWordBgColor: '#000000'
  });

  const [selectedPresetId, setSelectedPresetId] = useState<string>('bouncy-social-pink');
  const [selectedPresetCategory, setSelectedPresetCategory] = useState<string>('💥 Active Word Zoom');

  // Video playback tracking helpers
  const [currentTime, setCurrentTime] = useState(0);
  const [activeCaptionText, setActiveCaptionText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [latencyOffset, setLatencyOffset] = useState<number>(0.3);

  // Synchronize active caption text with current time and segments using high-frequency requestAnimationFrame and native video events
  useEffect(() => {
    let rafId: number;
    let isRunning = true;

    const syncSubtitles = () => {
      const video = videoRef.current;
      if (!video) return;

      const time = video.currentTime;
      setCurrentTime(time);

      const lookAheadTime = time + latencyOffset;
      const matching = captions.find(c =>
        lookAheadTime >= c.startTime &&
        lookAheadTime < c.endTime
      );

      setActiveCaptionText(matching ? matching.text : '');

      // FIXED: Use video.paused directly - NOT isPlaying state
      if (!video.paused && !video.ended && isRunning) {
        rafId = requestAnimationFrame(syncSubtitles);
      }
    };

    const startLoop = () => {
      cancelAnimationFrame(rafId);
      isRunning = true;
      rafId = requestAnimationFrame(syncSubtitles);
    };

    const stopLoop = () => {
      syncSubtitles(); // one last update on pause
    };

    const video = videoRef.current;
    if (video) {
      video.addEventListener('play', startLoop);
      video.addEventListener('pause', stopLoop);
      video.addEventListener('ended', stopLoop);
      video.addEventListener('seeking', syncSubtitles);
      video.addEventListener('seeked', startLoop);
      video.addEventListener('timeupdate', syncSubtitles);

      // Start immediately if already playing
      if (!video.paused) startLoop();
      else syncSubtitles();
    }

    return () => {
      isRunning = false;
      cancelAnimationFrame(rafId);
      if (video) {
        video.removeEventListener('play', startLoop);
        video.removeEventListener('pause', stopLoop);
        video.removeEventListener('ended', stopLoop);
        video.removeEventListener('seeking', syncSubtitles);
        video.removeEventListener('seeked', startLoop);
        video.removeEventListener('timeupdate', syncSubtitles);
      }
    };
  }, [captions, videoUrl, currentStep, latencyOffset]);

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
      setExtractedAudioBlob(null); // Clear cached extracted audio
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

  // High-performance client-side Web Audio API audio-track extractor to prevent browser freezes
  const extractLowBitrateWav = async (file: File, onStatusUpdate?: (status: string) => void): Promise<Blob> => {
    if (onStatusUpdate) onStatusUpdate("Initializing audio extractor component...");
    
    // Auto-resample using browser hardware AudioContext standard setting
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const fileArrayBuffer = await file.arrayBuffer();
    
    if (onStatusUpdate) onStatusUpdate("Demuxing and decoding audio stream tracks to 16kHz...");
    const decodedBuffer = await audioCtx.decodeAudioData(fileArrayBuffer);
    
    if (onStatusUpdate) onStatusUpdate("Encoding mono 16kHz compressed audio blob...");
    
    // We only need 1 channel (mono) at 16000Hz to match classic speech models perfectly
    const channelData = decodedBuffer.getChannelData(0); // first channel
    const sampleCount = channelData.length;
    
    // Create WAV container
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    
    /* RIFF identifier */
    view.setUint32(0, 0x52494646, false); // "RIFF"
    /* file length */
    view.setUint32(4, 36 + sampleCount * 2, true);
    /* RIFF type */
    view.setUint32(8, 0x57415645, false); // "WAVE"
    /* format chunk identifier */
    view.setUint32(12, 0x666d7420, false); // "fmt "
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw pcm) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true); // mono
    /* sample rate */
    view.setUint32(24, 16000, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, 16000 * 2, true);
    /* block align */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    view.setUint32(36, 0x64617461, false); // "data"
    /* chunk length */
    view.setUint32(40, sampleCount * 2, true);
    
    // Convert float32 back to int16PCM
    let offset = 44;
    for (let i = 0; i < sampleCount; i++) {
      let sample = Math.max(-1, Math.min(1, channelData[i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
    
    const audioBlob = new Blob([buffer], { type: 'audio/wav' });
    
    // Clean up Web Audio reference completely to recover memory immediately
    await audioCtx.close();
    
    return audioBlob;
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
    setUploadProgress(5);

    let activeAudioBlob = extractedAudioBlob;

    try {
      if (!activeAudioBlob) {
        setUploadProgress(15);
        activeAudioBlob = await extractLowBitrateWav(videoFile, (status) => setTranscribeStatus(status));
        setExtractedAudioBlob(activeAudioBlob);
      }

      let parsedCaptions: CaptionSegment[] = [];
      let isGroqSuccessful = false;

      if (groqApiKey && groqApiKey.trim()) {
        setTranscribeStatus('Submitting extracted audio soundtrack to Groq Whisper v3 hardware accelerator...');
        setUploadProgress(40);
        
        try {
          parsedCaptions = await generateTimestampedCaptionsGroq(
            activeAudioBlob,
            groqApiKey.trim(),
            geminiApiKey.trim(),
            captionLanguageMode
          );
          isGroqSuccessful = true;
        } catch (groqErr: any) {
          console.warn('Groq Whisper failed, trying fallback to Gemini:', groqErr);
          setTranscribeStatus(`⚠️ Groq Whisper error: ${groqErr.message || 'Server Error'}. Auto-falling back to Gemini Core API...`);
          await new Promise(r => setTimeout(r, 2500));
        }
      }

      // If we didn't use Groq, or if Groq failed and we have no parsedCaptions
      if (!isGroqSuccessful) {
        setTranscribeStatus('Converting audio track into inline Base64 data...');
        setUploadProgress(60);
        
        // Convert the lightweight audio blob to base64 instead of heavy video!
        const base64Data = await fileToBase64(new File([activeAudioBlob], 'audio.wav', { type: 'audio/wav' }));
        setUploadProgress(70);
        setTranscribeStatus('Submitting lightweight audio to Gemini-2.5-flash cognitive models...');
        
        setUploadProgress(80);
        parsedCaptions = await generateTimestampedCaptionsInline(
          base64Data,
          'audio/wav', // Lightweight audio MIME type
          geminiApiKey.trim(),
          'gemini-2.5-flash',
          captionLanguageMode
        );

        setUploadProgress(90);
        setTranscribeStatus('Aligning audio timestamps and word layouts...');

        if (parsedCaptions && parsedCaptions.length > 0) {
          const calibrated = autoCalibrateCaptions(parsedCaptions);
          parsedCaptions = fixTimestamps(calibrated);
        } else {
          throw new Error('No transcripts returned by the Gemini core script parser.');
        }
      }

      // Load raw captions directly into UI and immediately trigger Gemini spell-checking chain
      if (parsedCaptions && parsedCaptions.length > 0) {
        setUploadProgress(90);
        setTranscribeStatus('Perfecting captions vocabulary with Gemini-2.5-flash spellcheck...');
        
        try {
          const textsToCorrect = parsedCaptions.map(c => c.text);
          const correctedTexts = await correctCaptionsSpellingGemini(
            textsToCorrect,
            captionLanguageMode,
            geminiApiKey.trim(),
            activeAudioBlob,
            (status) => setTranscribeStatus(`${status}`)
          );
          
          parsedCaptions = parsedCaptions.map((c, idx) => ({
            ...c,
            text: correctedTexts[idx] !== undefined ? correctedTexts[idx] : c.text
          }));
          setTranscribeStatus('Vocabulary perfected successfully!');
        } catch (spellErr: any) {
          console.warn('Auto-spellcheck failed, falling back to raw Whisper transcript:', spellErr);
          setTranscribeStatus('⚠️ Audio-assisted spellcheck bypassed. Standard transcript loaded.');
          await new Promise(r => setTimeout(r, 1500));
        }

        setCaptions(parsedCaptions);
        setUploadProgress(100);
        setTranscribeStatus('Successfully transcribed and perfected captions!');
        
        // Deliberate sleep for visual confirmation
        await new Promise(r => setTimeout(r, 800));
        setCurrentStep(2); // Auto-progress to edit phase
      } else {
        throw new Error('No transcripts returned by the transcribing engine.');
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

  // Manual trigger to correct spelling with Gemini (audio-assisted, paid-tier capabilities)
  const handleCorrectSpellingWithGemini = async () => {
    if (captions.length === 0) return;
    if (!geminiApiKey.trim()) {
      setSpellConflictError("Google Gemini API Key is missing. Please configure your key first.");
      return;
    }
    
    setIsSpellingCorrecting(true);
    setSpellConflictError(null);
    
    let activeAudioBlob = extractedAudioBlob;
    
    try {
      if (!activeAudioBlob && videoFile) {
        activeAudioBlob = await extractLowBitrateWav(videoFile, (status) => setTranscribeStatus(status));
        setExtractedAudioBlob(activeAudioBlob);
      }
      
      const textsToCorrect = captions.map(c => c.text);
      const correctedTexts = await correctCaptionsSpellingGemini(
        textsToCorrect,
        captionLanguageMode,
        geminiApiKey.trim(),
        activeAudioBlob,
        (status) => setTranscribeStatus(status)
      );
      
      setCaptions(prev => prev.map((c, idx) => ({
        ...c,
        text: correctedTexts[idx] !== undefined ? correctedTexts[idx] : c.text
      })));
      setTranscribeStatus("Successfully corrected spelling using audio-assisted Gemini 2.0 Flash!");
    } catch (err: any) {
      console.error(err);
      setSpellConflictError(err.message || 'Spell correction failed. Please verify your Gemini API key and try again.');
    } finally {
      setIsSpellingCorrecting(false);
      
      // Clean status after a brief delay
      setTimeout(() => {
        setTranscribeStatus("");
      }, 3000);
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

    const isVideoVertical = height > width;
    const referenceWidth = isVideoVertical ? 360 : 640;
    const sizeMultiplier = width / referenceWidth;
    const calculatedFontSize = Math.max(14, Math.round(config.fontSize * sizeMultiplier));
    
    ctx.font = `bold ${calculatedFontSize}px 'Inter', system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

    const paddingX = 24;
    const paddingY = 12;
    const x = width / 2;
    const y = (height * config.positionY) / 100;

    const maxWidth = width - 48;
    const words = baseText.split(' ');

    // Calculate active word index for canvas on seek duration
    const duration = activeSeg.endTime - activeSeg.startTime;
    const progress = duration > 0 ? Math.max(0, Math.min(0.99, (lookAheadTime - activeSeg.startTime) / duration)) : 0;
    const activeWordIndex = Math.floor(progress * words.length);

    let lines: string[] = [];
    // Clean, high-retention 2-lines layout constraint
    if (words.length <= 3) {
      lines = [baseText];
    } else {
      const mid = Math.ceil(words.length / 2);
      const l1 = words.slice(0, mid).join(' ');
      const l2 = words.slice(mid).join(' ');
      lines = [l1, l2];
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
      ctx.arcTo(bgX, bgY + bgX, bgX + bgW, bgY, r);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (config.highlightType !== 'none') {
      let wordCounter = 0;
      lines.forEach((line, index) => {
        const lineY = y - (totalBoxHeight / 2) + (index * lineHeight) + (lineHeight / 2);
        const lineWords = line.split(' ');
        
        // Dynamically compute exact total line width including scaled active word
        let totalLineWidth = 0;
        lineWords.forEach((word, idx) => {
          const isWordActive = (wordCounter + idx) === activeWordIndex;
          if (isWordActive && (config.highlightType === 'word-scale' || config.highlightType === 'hyper-reels')) {
            ctx.font = `900 ${Math.round(calculatedFontSize * 1.35)}px 'Montserrat', sans-serif`;
          } else if (isWordActive && config.highlightType === 'cursive-sandwich') {
            ctx.font = `950 italic ${Math.round(calculatedFontSize * 1.45)}px 'Montserrat', sans-serif`;
          } else if (config.highlightType === 'cursive-sandwich') {
            ctx.font = `700 ${Math.round(calculatedFontSize * 0.9)}px 'Caveat', cursive`;
          } else if (isWordActive && config.highlightType === 'karaoke-glow') {
            ctx.font = `bold ${Math.round(calculatedFontSize * 1.12)}px 'Inter', system-ui, sans-serif`;
          } else if (config.highlightType === 'hyper-reels') {
            ctx.font = `900 ${calculatedFontSize}px 'Montserrat', sans-serif`;
          } else {
            ctx.font = `bold ${calculatedFontSize}px 'Inter', system-ui, sans-serif`;
          }
          totalLineWidth += ctx.measureText(word).width;
          if (idx < lineWords.length - 1) {
            if (config.highlightType === 'cursive-sandwich') {
              ctx.font = `700 ${Math.round(calculatedFontSize * 0.9)}px 'Caveat', cursive`;
            } else if (config.highlightType === 'hyper-reels') {
              ctx.font = `900 ${calculatedFontSize}px 'Montserrat', sans-serif`;
            } else {
              ctx.font = `bold ${calculatedFontSize}px 'Inter', system-ui, sans-serif`;
            }
            totalLineWidth += ctx.measureText(' ').width;
          }
        });

        let startX = x - totalLineWidth / 2;
        let currentOffset = 0;
        
        ctx.textAlign = 'left';
        if (config.highlightType === 'cursive-sandwich') {
          ctx.font = `700 ${Math.round(calculatedFontSize * 0.9)}px 'Caveat', cursive`;
        } else if (config.highlightType === 'hyper-reels') {
          ctx.font = `900 ${calculatedFontSize}px 'Montserrat', sans-serif`;
        } else {
          ctx.font = `bold ${calculatedFontSize}px 'Inter', system-ui, sans-serif`;
        }
        const spaceWidth = ctx.measureText(' ').width;

        lineWords.forEach((word) => {
          const isActive = wordCounter === activeWordIndex;
          if (isActive && (config.highlightType === 'word-scale' || config.highlightType === 'hyper-reels')) {
            ctx.font = `900 ${Math.round(calculatedFontSize * 1.35)}px 'Montserrat', sans-serif`;
          } else if (isActive && config.highlightType === 'cursive-sandwich') {
            ctx.font = `950 italic ${Math.round(calculatedFontSize * 1.45)}px 'Montserrat', sans-serif`;
          } else if (config.highlightType === 'cursive-sandwich') {
            ctx.font = `700 ${Math.round(calculatedFontSize * 0.9)}px 'Caveat', cursive`;
          } else if (isActive && config.highlightType === 'karaoke-glow') {
            ctx.font = `bold ${Math.round(calculatedFontSize * 1.12)}px 'Inter', system-ui, sans-serif`;
          } else if (config.highlightType === 'hyper-reels') {
            ctx.font = `900 ${calculatedFontSize}px 'Montserrat', sans-serif`;
          } else {
            ctx.font = `bold ${calculatedFontSize}px 'Inter', system-ui, sans-serif`;
          }

          const wordWidth = ctx.measureText(word).width;
          const wordX = startX + currentOffset;
          
          wordCounter++;

          ctx.save();
          // Adjust canvas context variables based on different highlight types
          if (isActive) {
            if (config.highlightType === 'word-bg' || config.highlightType === 'podcast-pill') {
              ctx.fillStyle = config.activeWordBgColor || '#facc15';
              const rx = wordX - (config.highlightType === 'podcast-pill' ? 8 : 4);
              const ry = lineY - calculatedFontSize / 2 - (config.highlightType === 'podcast-pill' ? 5 : 2);
              const rw = wordWidth + (config.highlightType === 'podcast-pill' ? 16 : 8);
              const rh = calculatedFontSize + (config.highlightType === 'podcast-pill' ? 10 : 4);
              const radius = config.highlightType === 'podcast-pill' ? rh / 2 : 5;
              
              ctx.beginPath();
              ctx.moveTo(rx + radius, ry);
              ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, radius);
              ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, radius);
              ctx.arcTo(rx, ry + rh, rx, ry, radius);
              ctx.arcTo(rx, ry, rx + rw, ry, radius);
              ctx.closePath();
              ctx.fill();

              // Draw word text
              ctx.fillStyle = config.activeWordColor || '#000000';
              ctx.fillText(word, wordX, lineY);
            } else if (config.highlightType === 'word-color') {
              if (config.strokeWidth > 0) {
                ctx.strokeStyle = config.strokeColor || '#000000';
                ctx.lineWidth = config.strokeWidth * sizeMultiplier;
                ctx.lineJoin = 'round';
                ctx.strokeText(word, wordX, lineY);
              }
              ctx.fillStyle = config.activeWordColor || '#facc15';
              ctx.fillText(word, wordX, lineY);
            } else if (config.highlightType === 'karaoke-glow') {
              ctx.shadowColor = config.activeWordColor || '#22d3ee';
              ctx.shadowBlur = 12 * sizeMultiplier;
              ctx.font = `bold ${Math.round(calculatedFontSize * 1.12)}px 'Inter', system-ui, sans-serif`;
              
              if (config.strokeWidth > 0) {
                ctx.strokeStyle = config.strokeColor || '#000000';
                ctx.lineWidth = config.strokeWidth * sizeMultiplier;
                ctx.lineJoin = 'round';
                ctx.strokeText(word, wordX, lineY);
              }
              ctx.fillStyle = config.activeWordColor || '#22d3ee';
              ctx.fillText(word, wordX, lineY);
            } else if (config.highlightType === 'word-scale') {
              // Word Scale Pop Active State
              ctx.font = `900 ${Math.round(calculatedFontSize * 1.35)}px 'Montserrat', sans-serif`;
              
              if (config.strokeWidth > 0) {
                ctx.strokeStyle = config.strokeColor || '#000000';
                ctx.lineWidth = (config.strokeWidth + 1) * sizeMultiplier;
                ctx.lineJoin = 'round';
                ctx.strokeText(word, wordX, lineY);
              }
              ctx.fillStyle = config.activeWordColor || '#FFFF00';
              ctx.fillText(word, wordX, lineY);
            } else if (config.highlightType === 'hyper-reels') {
              // Neon Outer Glow + Rotated Tilt pop (Panel 3 / Panel 1)
              ctx.shadowColor = config.activeWordColor || '#00FF00';
              ctx.shadowBlur = 18 * sizeMultiplier;
              ctx.font = `900 italic ${Math.round(calculatedFontSize * 1.45)}px 'Montserrat', sans-serif`;
              
              if (config.strokeWidth > 0) {
                ctx.strokeStyle = config.strokeColor || '#000000';
                ctx.lineWidth = (config.strokeWidth + 2) * sizeMultiplier;
                ctx.lineJoin = 'round';
                ctx.strokeText(word, wordX, lineY);
              }
              ctx.fillStyle = config.activeWordColor || '#00FF00';
              ctx.fillText(word, wordX, lineY);
            } else if (config.highlightType === 'cursive-sandwich') {
              // Giant bold yellow/pink uppercase accent core (Panel 2)
              ctx.font = `950 italic ${Math.round(calculatedFontSize * 1.45)}px 'Montserrat', sans-serif`;
              
              if (config.strokeWidth > 0) {
                ctx.strokeStyle = config.strokeColor || '#000000';
                ctx.lineWidth = (config.strokeWidth + 2.5) * sizeMultiplier;
                ctx.lineJoin = 'round';
                ctx.strokeText(word, wordX, lineY);
              }
              ctx.fillStyle = config.activeWordColor || '#FFFF00';
              ctx.fillText(word, wordX, lineY);
            }
          } else {
            // Non-active word handling
            if (config.highlightType === 'karaoke-glow') {
              ctx.globalAlpha = 0.55;
            } else if (config.highlightType === 'word-scale' || config.highlightType === 'hyper-reels') {
              ctx.globalAlpha = 0.65; // subtle fade so active word pops dramatically!
            } else if (config.highlightType === 'cursive-sandwich') {
              ctx.globalAlpha = 0.75; // warm cursive fallback
            }
            if (config.highlightType === 'cursive-sandwich') {
              ctx.font = `700 ${Math.round(calculatedFontSize * 0.9)}px 'Caveat', cursive`;
            } else if (config.highlightType === 'hyper-reels') {
              ctx.font = `900 ${calculatedFontSize}px 'Montserrat', sans-serif`;
            } else {
              ctx.font = `bold ${calculatedFontSize}px 'Inter', system-ui, sans-serif`;
            }
            if (config.strokeWidth > 0) {
              ctx.strokeStyle = config.strokeColor || '#000000';
              ctx.lineWidth = config.strokeWidth * sizeMultiplier;
              ctx.lineJoin = 'round';
              ctx.strokeText(word, wordX, lineY);
            }
            ctx.fillStyle = config.fontColor || '#ffffff';
            ctx.fillText(word, wordX, lineY);
          }
          ctx.restore();

          currentOffset += wordWidth + spaceWidth;
        });
      });
    } else {
      ctx.textAlign = 'center';
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
    }
  };

  // High performance Canvas Media Recorder exporter (Real-time playback sync)
  const handleBurnAndExport = async () => {
    if (!videoUrl) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Matching video frame dimensions...');

    // We instantiate a temporal quiet video element specifically designed to run on background context
    const exportVideo = document.createElement('video');
    exportVideo.src = videoUrl;
    exportVideo.crossOrigin = 'anonymous';
    // Keep unmuted at 0 volume for optimal audio capture reliability on Chromium and secondary browsers
    exportVideo.muted = false;
    exportVideo.volume = 0;
    exportVideo.playsInline = true;

    // Standard high-reliability styling to keep video rendering in DOM active without browser background throttling
    exportVideo.style.position = 'fixed';
    exportVideo.style.top = '0';
    exportVideo.style.left = '0';
    exportVideo.style.width = '1px';
    exportVideo.style.height = '1px';
    exportVideo.style.opacity = '0.01';
    exportVideo.style.pointerEvents = 'none';
    exportVideo.style.zIndex = '-9999';
    document.body.appendChild(exportVideo);

    let recorder: MediaRecorder | null = null;
    let animationFrameId: number | null = null;

    const cleanup = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      try {
        exportVideo.pause();
      } catch (e) {}
      if (exportVideo.parentNode) {
        exportVideo.parentNode.removeChild(exportVideo);
      }
      setIsExporting(false);
    };

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

      // Attempt high-fidelity audio capture track injection
      try {
        const videoStream = (exportVideo as any).captureStream 
          ? (exportVideo as any).captureStream() 
          : (exportVideo as any).mozCaptureStream 
            ? (exportVideo as any).mozCaptureStream() 
            : null;
        if (videoStream) {
          const audioTracks = videoStream.getAudioTracks();
          if (audioTracks.length > 0) {
            canvasStream.addTrack(audioTracks[0]);
          }
        }
      } catch (audioErr) {
        console.warn('Audio track capture bypass launched:', audioErr);
      }

      let mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

      const chunks: Blob[] = [];
      recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // Set up a promise that resolves only when the recorder has stopped fully and finished processing chunks
      const recorderStoppedPromise = new Promise<void>((resolveStopped) => {
        if (!recorder) {
          resolveStopped();
          return;
        }
        recorder.onstop = () => {
          resolveStopped();
        };
      });

      // Set currentTime to start
      exportVideo.currentTime = 0;
      await new Promise<void>((resolve) => {
        const onSeek = () => {
          exportVideo.removeEventListener('seeked', onSeek);
          resolve();
        };
        exportVideo.addEventListener('seeked', onSeek);
      });

      // Start the media recorder
      recorder.start();
      setExportStatus('Burning subtitles in real-time...');

      // Running play loop with timing control
      await new Promise<void>((resolveRender, rejectRender) => {
        const FPS = 30;
        const frameInterval = 1000 / FPS;
        let lastFrameTime = performance.now();
        let isDone = false;

        const checkEnd = () => {
          if (isDone) return;
          if (exportVideo.ended || exportVideo.currentTime >= duration - 0.05) {
            isDone = true;
            resolveRender();
          }
        };

        const renderLoop = (now: number) => {
          if (isDone) return;

          checkEnd();
          if (isDone) return;

          const elapsed = now - lastFrameTime;
          if (elapsed >= frameInterval) {
            lastFrameTime = now - (elapsed % frameInterval);

            // Render video frame on high resolution canvas
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, videoWidth, videoHeight);
            try {
              ctx.drawImage(exportVideo, 0, 0, videoWidth, videoHeight);
            } catch (e) {
              console.warn('Failed to draw current frame:', e);
            }

            // Draw verbatim scaled subtitle overlays
            drawSubtitlesOnCanvas(ctx, videoWidth, videoHeight, exportVideo.currentTime);

            // Track proportional export progress matching the play clock
            const percentage = Math.min(99, Math.round((exportVideo.currentTime / duration) * 100));
            setExportProgress(percentage);
            setExportStatus(`Burning frames: ${percentage}%`);
          }

          animationFrameId = requestAnimationFrame(renderLoop);
        };

        exportVideo.onended = () => {
          if (!isDone) {
            isDone = true;
            resolveRender();
          }
        };

        exportVideo.onerror = (err) => {
          isDone = true;
          rejectRender(new Error('Playback failure during export: ' + String(err)));
        };

        // Start video playback
        exportVideo.play()
          .then(() => {
            animationFrameId = requestAnimationFrame(renderLoop);
          })
          .catch((err) => {
            rejectRender(new Error('Failed to initiate video playback: ' + err.message));
          });
      });

      // Once the playback loop finishes, cancel remaining anim frames immediately
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      setExportProgress(99);
      setExportStatus('Completing remaining audio encodes...');

      // Stop recorder and wait asynchronously for onstop to trigger
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      
      // Wait for all chunks to get fully compiled by MediaRecorder
      await recorderStoppedPromise;

      setExportStatus('Compiling video segments...');
      await new Promise(r => setTimeout(r, 600));

      if (chunks.length === 0) {
        throw new Error('No video frame segments were compiled during recording.');
      }

      const exportedBlob = new Blob(chunks, { type: chunks[0]?.type || 'video/webm' });
      const exportUrl = URL.createObjectURL(exportedBlob);
      
      const link = document.createElement('a');
      link.href = exportUrl;
      link.download = `syncscript-burned-${Date.now()}.${chunks[0]?.type?.includes('mp4') ? 'mp4' : 'webm'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setExportProgress(100);
      setExportStatus('Subtitle burn complete! File downloaded safely.');

    } catch (err: any) {
      console.error('Export run error:', err);
      alert(`Render error: ${err.message || err}`);
    } finally {
      cleanup();
    }
  };

  const handleResetProject = () => {
    setVideoFile(null);
    setVideoUrl(null);
    setIsVertical(false);
    setExtractedAudioBlob(null); // Clear cached extracted audio
    setCaptions([
      { id: '1', startTime: 1.2, endTime: 4.5, text: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ, ਸਵਾਗਤ ਹੈ ਤੁਹਾਡਾ!' },
      { id: '2', startTime: 4.8, endTime: 8.0, text: 'Today we are burning dynamic Punjabi subtitles on the fly.' },
      { id: '3', startTime: 8.3, endTime: 12.0, text: 'ਪ੍ਰੋਫੈਸ਼ਨਲ ਵੀਡੀਓ ਸਬਟਾਈਟਲਸ ਹੁਣ ਮਿੰਟਾਂ ਵਿੱਚ ਤਿਆਰ ਕਰੋ।' },
      { id: '4', startTime: 12.4, endTime: 16.5, text: 'Simply upload your video, key in your API credentials, and click Transcribe.' },
      { id: '5', startTime: 17.0, endTime: 21.2, text: 'ਸਾਡੇ ਨਾਲ ਆਟੋ-ਕੈਲੀਬ੍ਰੇਟਿਡ ਵੀਡੀਓਜ਼ ਦਾ ਆਨੰਦ ਲਓ।' },
      { id: '6', startTime: 21.6, endTime: 26.0, text: 'Change styles, adjust offsets, and burn captions beautifully.' },
      { id: '7', startTime: 26.5, endTime: 31.0, text: 'ਸਾਰਾ ਕੁਝ ਤੁਹਾਡੀ ਉਂਗਲਾਂ \'ਤੇ ਬਹੁਤ ਆਸਾਨ ਤਰੀਕੇ ਨਾਲ।' },
      { id: '8', startTime: 31.5, endTime: 36.0, text: 'Export high-definition vertical reels or horizontal trailers with 1 click.' },
      { id: '9', startTime: 36.5, endTime: 41.5, text: 'ਧੰਨਵਾਦ ਜੀ, ਸਾਡੇ ਨਾਲ ਜੁੜਨ ਲਈ ਅਤੇ ਇਸ ਦੀ ਵਰਤੋਂ ਕਰਨ ਲਈ!' }
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

  // Calculate split-word progress and active index for dynamic spoken highlighting
  const activeCaptionSplits = (() => {
    if (!currentActiveCaption) return { words: [], activeIndex: -1 };
    const words = currentActiveCaption.text.trim().split(/\s+/);
    const duration = currentActiveCaption.endTime - currentActiveCaption.startTime;
    const progress = duration > 0 
      ? Math.max(0, Math.min(0.99, (currentTime + latencyOffset - currentActiveCaption.startTime) / duration))
      : 0;
    const activeIndex = Math.floor(progress * words.length);
    return { words, activeIndex };
  })();

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
                      setExtractedAudioBlob(null); // Clear cached extracted audio
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

            {/* SPECIAL ACTION: CORRECT SPELLING WITH GEMINI */}
            <div className="bg-gradient-to-r from-amber-500/10 to-indigo-500/10 border border-neutral-850 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-amber-400 shrink-0 fill-amber-400/20 animate-pulse mt-0.5" />
                <div className="space-y-0.5">
                  <h4 className="text-[11px] font-bold text-neutral-200 uppercase tracking-wider">Supercharge with AI Spellchecker</h4>
                  <p className="text-[10px] text-neutral-400 leading-relaxed">
                    Instantly polish Punjabi script spelling, Romanized grammar, Devanagari matras, or English translation styles using Gemini 2.0 Flash in less than a second.
                  </p>
                </div>
              </div>
              <button
                onClick={handleCorrectSpellingWithGemini}
                disabled={isSpellingCorrecting || captions.length === 0}
                className="w-full sm:w-auto shrink-0 bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-neutral-950 font-black text-[10px] uppercase tracking-widest py-2.5 px-4 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                {isSpellingCorrecting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Correcting...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-neutral-950 font-black" />
                    <span>Correct Spelling with Gemini</span>
                  </>
                )}
              </button>
            </div>

            {spellConflictError && (
              <div className="p-3.5 bg-red-950/20 border border-red-500/25 rounded-2xl text-[11px] text-red-400 font-bold tracking-tight">
                ⚠️ {spellConflictError}
              </div>
            )}

            {/* INFO BOX INDICATING THE COMBINED AUTOMATIC PIPELINE */}
            <div className="bg-neutral-950/60 border border-neutral-850 p-4 rounded-2xl flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-amber-400 shrink-0 fill-amber-400/10" />
              <div className="space-y-0.5">
                <h4 className="text-[11px] font-bold text-neutral-200 uppercase tracking-widest">Wording & Spacing Calibrated</h4>
                <p className="text-[10px] text-neutral-450 leading-relaxed">
                  Groq Whisper v3 generates highly professional, perfectly spelled caption text matching your timeline.
                </p>
              </div>
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

            {/* CATEGORY SWITCHER TABS */}
            <div className="flex flex-wrap gap-1.5 p-1 bg-neutral-950 border border-neutral-850 rounded-2xl">
              {[
                '💥 Active Word Zoom',
                '🔥 Reels & Shorts',
                '⚡ Neon Glow',
                '🎙️ Vlog & Podcast',
                '🎞️ Cinematic & Clean'
              ].map((cat) => {
                const isCatActive = selectedPresetCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setSelectedPresetCategory(cat);
                      const firstInCat = PRESETS.find(p => p.category === cat);
                      if (firstInCat) {
                        applyStylePreset(firstInCat);
                      }
                    }}
                    className={`flex-1 text-center py-2 px-3 rounded-xl text-[10px] font-black tracking-wider uppercase transition-all whitespace-nowrap cursor-pointer ${
                      isCatActive 
                        ? 'bg-amber-500 text-neutral-950 shadow-md shadow-amber-500/10' 
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* PRESET CHIPS GRID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PRESETS.filter(p => p.category === selectedPresetCategory).map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                const { fontColor, strokeColor, strokeWidth, highlightType, activeWordColor, activeWordBgColor } = preset.config;
                
                const textShadowStyle = strokeWidth > 0 
                  ? `0px 0px ${strokeWidth}px ${strokeColor}, 1px 1px 1.5px ${strokeColor}, -1px -1px 1.5px ${strokeColor}` 
                  : 'none';

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyStylePreset(preset)}
                    className={`p-3 rounded-2xl border text-left flex flex-col space-y-3 transition-all outline-none relative cursor-pointer ${
                      isSelected 
                        ? 'bg-neutral-950 border-amber-500 ring-2 ring-amber-500/10' 
                        : 'bg-neutral-950 border-neutral-850 hover:border-neutral-700'
                    }`}
                  >
                    {/* SIMULATED VERTICAL VIDEO PREVIEW SCREEN */}
                    <div className="w-full h-40 rounded-xl bg-neutral-900 border border-neutral-850 relative overflow-hidden flex flex-col justify-between p-2.5 select-none">
                      
                      {/* Dark ambient overlay screen */}
                      <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-900/60 to-neutral-950/70"></div>
                      
                      {/* Visual ambient light burst from the active word hue */}
                      <div 
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 blur-2xl opacity-15 rounded-full"
                        style={{
                          backgroundColor: highlightType !== 'none' ? activeWordColor : fontColor
                        }}
                      />

                      {/* Header elements of simulated Reel */}
                      <div className="flex items-center justify-between z-10 w-full">
                        <div className="flex items-center gap-1 bg-black/60 px-1 py-0.5 rounded text-[7px] font-mono tracking-wider text-neutral-300 font-bold border border-neutral-800">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
                          <span>LIVE</span>
                        </div>
                        <div className="text-[7px] font-mono text-neutral-400">9:16 HD</div>
                      </div>

                      {/* Right sidebar quick interaction widget */}
                      <div className="absolute right-2 top-1/4 flex flex-col items-center gap-1.5 z-10 opacity-60">
                        <div className="w-4 h-4 bg-neutral-950/70 border border-neutral-850 rounded-full flex items-center justify-center text-[6px]">❤️</div>
                        <div className="w-4 h-4 bg-neutral-950/70 border border-neutral-850 rounded-full flex items-center justify-center text-[6px]">💬</div>
                      </div>

                      {/* HYBRID LIVE PREVIEW TEXT */}
                      <div className="w-full flex flex-col items-center text-center justify-center space-y-1.5 py-1 my-auto z-10">
                        {/* English Line */}
                        <div className="flex flex-wrap items-center justify-center gap-x-1 font-sans text-[10px] font-black tracking-wide leading-none uppercase">
                          <span style={{ color: fontColor, textShadow: textShadowStyle }}>To</span>
                          
                          {highlightType === 'word-bg' ? (
                            <span 
                              className="px-1.5 py-0.5 text-[9px] font-black rounded"
                              style={{ 
                                color: activeWordColor, 
                                backgroundColor: activeWordBgColor,
                                textShadow: 'none'
                              }}
                            >
                              GET
                            </span>
                          ) : highlightType === 'podcast-pill' ? (
                            <span 
                              className="px-2 py-0.5 text-[9px] font-black rounded-full border border-white/5 shadow-md scale-105"
                              style={{ 
                                color: activeWordColor, 
                                backgroundColor: activeWordBgColor,
                                textShadow: 'none'
                              }}
                            >
                              GET
                            </span>
                          ) : highlightType === 'word-color' ? (
                            <span 
                              className="font-extrabold"
                              style={{ 
                                color: activeWordColor, 
                                textShadow: textShadowStyle 
                              }}
                            >
                              GET
                            </span>
                          ) : highlightType === 'karaoke-glow' ? (
                            <span 
                              className="scale-105 font-black shrink-0 tracking-wider"
                              style={{ 
                                color: activeWordColor, 
                                textShadow: `0 0 8px ${activeWordColor}, 0 0 1.5px ${activeWordColor}` 
                              }}
                            >
                              GET
                            </span>
                          ) : highlightType === 'word-scale' ? (
                            <span 
                              className="font-black shrink-0 tracking-wider inline-block font-sans"
                              style={{ 
                                color: activeWordColor, 
                                textShadow: strokeWidth > 0 ? `0 0 ${strokeWidth+1}px ${strokeColor}, 1px 1.5px 3px rgba(0,0,0,0.8)` : '0 2px 4px rgba(0,0,0,0.8)',
                                transform: 'scale(1.3) rotate(-2deg)'
                              }}
                            >
                              GET
                            </span>
                          ) : highlightType === 'hyper-reels' ? (
                            <span 
                              className="font-black italic shrink-0 tracking-tight inline-block font-sans"
                              style={{ 
                                color: activeWordColor, 
                                textShadow: `0 0 14px ${activeWordColor}, 0 0 ${strokeWidth+1.5}px ${strokeColor || '#000000'}`,
                                transform: 'scale(1.35) rotate(-3deg)'
                              }}
                            >
                              GET
                            </span>
                          ) : highlightType === 'cursive-sandwich' ? (
                            <span 
                              className="font-black italic shrink-0 tracking-tight inline-block font-sans"
                              style={{ 
                                color: activeWordColor, 
                                textShadow: `0 0 ${strokeWidth+2.5}px ${strokeColor || '#000000'}, 2px 2px 4px rgba(0,0,0,0.9)`,
                                transform: 'scale(1.38) rotate(-4deg)'
                              }}
                            >
                              GET
                            </span>
                          ) : (
                            <span style={{ color: fontColor, textShadow: textShadowStyle }}>GET</span>
                          )}

                          <span style={{ color: fontColor, textShadow: textShadowStyle }}>STARTED</span>
                        </div>

                        {/* Punjabi Gurmukhi Line */}
                        <div className="flex flex-wrap items-center justify-center gap-x-1 text-[10px] font-bold tracking-tight leading-none">
                          <span style={{ color: fontColor, textShadow: textShadowStyle }}>ਆਓ</span>

                          {highlightType === 'word-bg' ? (
                            <span 
                              className="px-1.5 py-0.5 text-[9px] font-bold rounded"
                              style={{ 
                                color: activeWordColor, 
                                backgroundColor: activeWordBgColor,
                                textShadow: 'none'
                              }}
                            >
                              ਸ਼ੁਰੂ
                            </span>
                          ) : highlightType === 'podcast-pill' ? (
                            <span 
                              className="px-2 py-0.5 text-[9px] font-extrabold rounded-full scale-105"
                              style={{ 
                                color: activeWordColor, 
                                backgroundColor: activeWordBgColor,
                                textShadow: 'none'
                              }}
                            >
                              ਸ਼ੁਰੂ
                            </span>
                          ) : highlightType === 'word-color' ? (
                            <span 
                              style={{ 
                                color: activeWordColor, 
                                textShadow: textShadowStyle 
                              }}
                            >
                              ਸ਼ੁਰੂ
                            </span>
                          ) : highlightType === 'karaoke-glow' ? (
                            <span 
                              className="scale-105"
                              style={{ 
                                color: activeWordColor, 
                                textShadow: `0 0 8px ${activeWordColor}, 0 0 1.5px ${activeWordColor}` 
                              }}
                            >
                              ਸ਼ੁਰੂ
                            </span>
                          ) : highlightType === 'word-scale' ? (
                            <span 
                              className="font-bold shrink-0 inline-block font-sans"
                              style={{ 
                                color: activeWordColor, 
                                textShadow: strokeWidth > 0 ? `0 0 ${strokeWidth+1}px ${strokeColor}, 1px 1.5px 3px rgba(0,0,0,0.8)` : '0 2px 4px rgba(0,0,0,0.8)',
                                transform: 'scale(1.3) rotate(-2deg)'
                              }}
                            >
                              ਸ਼ੁਰੂ
                            </span>
                          ) : highlightType === 'hyper-reels' ? (
                            <span 
                              className="font-black italic shrink-0 inline-block font-sans"
                              style={{ 
                                color: activeWordColor, 
                                textShadow: `0 0 14px ${activeWordColor}, 0 0 ${strokeWidth+1.5}px ${strokeColor || '#000000'}`,
                                transform: 'scale(1.35) rotate(-3deg)'
                              }}
                            >
                              ਸ਼ੁਰੂ
                            </span>
                          ) : highlightType === 'cursive-sandwich' ? (
                            <span 
                              className="font-black italic shrink-0 inline-block font-sans"
                              style={{ 
                                color: activeWordColor, 
                                textShadow: `0 0 ${strokeWidth+2.5}px ${strokeColor || '#000000'}, 2px 2px 4px rgba(0,0,0,0.9)`,
                                transform: 'scale(1.38) rotate(-4deg)'
                              }}
                            >
                              ਸ਼ੁਰੂ
                            </span>
                          ) : (
                            <span style={{ color: fontColor, textShadow: textShadowStyle }}>ਸ਼ੁਰੂ</span>
                          )}

                          <span style={{ color: fontColor, textShadow: textShadowStyle }}>ਕਰੀਏ</span>
                        </div>
                      </div>

                      {/* Footer elements representing account labels */}
                      <div className="flex items-center gap-1 z-10 w-full text-left">
                        <div className="w-3.5 h-3.5 bg-amber-500 rounded-full flex items-center justify-center text-[7px] font-black shrink-0 text-black">S</div>
                        <div className="truncate flex flex-col">
                          <span className="text-[7px] font-bold text-neutral-300">@creator_sub</span>
                          <span className="text-[6px] text-neutral-500 truncate">Original Sound • Punjabi Style</span>
                        </div>
                      </div>
                    </div>

                    {/* TEXT DESCRIPTION LAYOUTS */}
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-neutral-250 truncate pr-2">{preset.name}</h4>
                        {isSelected && (
                          <span className="text-[8px] bg-amber-500/10 text-amber-400 font-bold uppercase py-0.5 px-1.5 rounded border border-amber-500/20 shrink-0">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-neutral-450 leading-relaxed line-clamp-2">{preset.description}</p>
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

                {/* ACTIVE WORD HIGHLIGHTING CONTROLS */}
                <div className="col-span-2 border-t border-neutral-900 pt-3 mt-1 space-y-3">
                  <div className="space-y-1">
                    <span className="block text-[8px] font-mono text-neutral-400 font-bold uppercase tracking-wider">Dynamic Word Highlight Effect</span>
                    <select
                      value={config.highlightType}
                      onChange={(e) => setConfig(prev => ({ 
                        ...prev, 
                        highlightType: e.target.value as any 
                      }))}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-xs font-semibold text-neutral-200 outline-none focus:border-indigo-550 transition-colors"
                    >
                      <option value="none">None (Standard captions)</option>
                      <option value="word-bg">🔥 Active Word Background Capsule</option>
                      <option value="podcast-pill">🎙️ Podcast Pill Capsule</option>
                      <option value="word-color">✨ Spoken Word Text Color</option>
                      <option value="karaoke-glow">⚡ Karaoke Pulsing Glow</option>
                      <option value="word-scale">💥 Active Word Zoom / Bouncy Scale</option>
                      <option value="hyper-reels">✨ Pro High-Retention Reels Glow</option>
                      <option value="cursive-sandwich">👑 Premium Cursive Sandwich Accent</option>
                    </select>
                  </div>

                  {config.highlightType !== 'none' && (
                    <div className="grid grid-cols-2 gap-3 animate-fadeIn">
                      <div className="space-y-1">
                        <span className="block text-[8px] font-mono text-neutral-500 uppercase font-bold text-neutral-400">Active Text Color</span>
                        <input
                          type="color"
                          value={config.activeWordColor}
                          onChange={(e) => setConfig(prev => ({ ...prev, activeWordColor: e.target.value }))}
                          className="w-full h-8 bg-neutral-900 border border-neutral-800 rounded px-2 cursor-pointer"
                        />
                      </div>

                      {(config.highlightType === 'word-bg' || config.highlightType === 'podcast-pill') && (
                        <div className="space-y-1">
                          <span className="block text-[8px] font-mono text-neutral-500 uppercase font-bold text-neutral-400">Backdrop Highlight Color</span>
                          <input
                            type="color"
                            value={config.activeWordBgColor}
                            onChange={(e) => setConfig(prev => ({ ...prev, activeWordBgColor: e.target.value }))}
                            className="w-full h-8 bg-neutral-900 border border-neutral-800 rounded px-2 cursor-pointer"
                          />
                        </div>
                      )}
                    </div>
                  )}
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
                  {currentActiveCaption && (
                    <div 
                      className="absolute text-center pointer-events-none px-4 select-none w-full animate-fadeIn z-10"
                      style={{ 
                        position: 'absolute',
                        top: `${config.positionY}%`,
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        fontFamily: "'Inter', sans-serif" 
                      }}
                    >
                      <div className="flex flex-col items-center justify-center text-center select-none w-full gap-y-1 md:gap-y-2">
                        {(() => {
                          const wordsCount = activeCaptionSplits.words.length;
                          const showTwoLines = (config.highlightType === 'word-scale' || config.highlightType === 'hyper-reels' || config.highlightType === 'cursive-sandwich') && wordsCount > 3;

                          if (showTwoLines) {
                            const mid = Math.ceil(wordsCount / 2);
                            const line1Words = activeCaptionSplits.words.slice(0, mid);
                            const line2Words = activeCaptionSplits.words.slice(mid);

                            const renderLine = (lineWords: string[], startIndex: number) => (
                              <div className="flex flex-wrap justify-center items-center gap-x-2.5 sm:gap-x-3.5 py-1 w-full text-center">
                                {lineWords.map((word, lineIdx) => {
                                  const originalIdx = startIndex + lineIdx;
                                  const isActive = originalIdx === activeCaptionSplits.activeIndex;
                                  const baseSize = isVertical ? Math.max(14, Math.round(config.fontSize * 0.75)) : config.fontSize;

                                  let wordStyle: React.CSSProperties = {
                                    fontSize: `${baseSize}px`,
                                    fontWeight: '950',
                                    transition: 'all 0.12s cubic-bezier(0.175, 0.885, 0.32, 1.25)',
                                    display: 'inline-block',
                                  };

                                  if (config.highlightType === 'cursive-sandwich' && !isActive) {
                                    wordStyle = {
                                      ...wordStyle,
                                      fontFamily: "'Caveat', cursive",
                                      fontSize: `${Math.round(baseSize * 1.15)}px`,
                                      fontWeight: '700',
                                      color: config.fontColor || '#ffffff',
                                      opacity: 0.85,
                                      textShadow: config.strokeWidth > 0 
                                        ? `0 0 ${config.strokeWidth}px ${config.strokeColor || '#000000'}, 1px 1.5px 2.5px rgba(0,0,0,0.9)` 
                                        : '0 1px 3px rgba(0,0,0,0.9)',
                                    };
                                  } else if (config.highlightType === 'hyper-reels' && !isActive) {
                                    wordStyle = {
                                      ...wordStyle,
                                      fontFamily: "'Montserrat', sans-serif",
                                      fontWeight: '900',
                                      color: config.fontColor || '#ffffff',
                                      opacity: 0.55,
                                      textShadow: config.strokeWidth > 0 
                                        ? `0 0 ${config.strokeWidth}px ${config.strokeColor || '#000000'}, 1px 1px 2px rgba(0,0,0,0.9)` 
                                        : '0 1px 3px rgba(0,0,0,0.9)',
                                    };
                                  } else if (isActive) {
                                    if (config.highlightType === 'cursive-sandwich') {
                                      wordStyle = {
                                        ...wordStyle,
                                        fontFamily: "'Montserrat', sans-serif",
                                        fontSize: `${Math.round(baseSize * 1.45)}px`,
                                        color: config.activeWordColor || '#FFFF00',
                                        transform: 'scale(1.4) rotate(-3.5deg)',
                                        textShadow: `0 0 ${config.strokeWidth + 4}px ${config.strokeColor || '#000000'}, 2px 3px 6px rgba(0,0,0,0.98)`,
                                        zIndex: 40,
                                        position: 'relative'
                                      };
                                    } else if (config.highlightType === 'hyper-reels') {
                                      wordStyle = {
                                        ...wordStyle,
                                        fontFamily: "'Montserrat', sans-serif",
                                        fontSize: `${Math.round(baseSize * 1.45)}px`,
                                        color: config.activeWordColor || '#00FF00',
                                        transform: 'scale(1.4) rotate(-2deg)',
                                        textShadow: `0 0 16px ${config.activeWordColor || '#00FF00'}, 0 0 ${config.strokeWidth + 3}px ${config.strokeColor || '#000000'}, 2px 2px 5px rgba(0,0,0,0.95)`,
                                        zIndex: 40,
                                        position: 'relative'
                                      };
                                    } else {
                                      // default word-scale
                                      wordStyle = {
                                        ...wordStyle,
                                        fontFamily: "'Montserrat', sans-serif",
                                        color: config.activeWordColor || '#f43f5e',
                                        transform: 'scale(1.35) rotate(-2deg)',
                                        textShadow: config.strokeWidth > 0 
                                          ? `0 0 ${config.strokeWidth + 2}px ${config.strokeColor}, 1px 1.5px 3px rgba(0,0,0,0.95)` 
                                          : '0 2px 6px rgba(0,0,0,0.95)',
                                        zIndex: 40,
                                        position: 'relative'
                                      };
                                    }
                                  } else {
                                    wordStyle = {
                                      ...wordStyle,
                                      fontFamily: "'Montserrat', sans-serif",
                                      color: config.fontColor || '#ffffff',
                                      opacity: 0.65,
                                      textShadow: config.strokeWidth > 0 
                                        ? `0 0 ${config.strokeWidth}px ${config.strokeColor}, 1px 1px ${config.strokeWidth}px ${config.strokeColor}, -1px -1px ${config.strokeWidth}px ${config.strokeColor}` 
                                        : '0 1px 3px rgba(0,0,0,0.9)',
                                    };
                                  }

                                  return (
                                    <span 
                                      key={originalIdx}
                                      className="inline-block px-0.5"
                                      style={wordStyle}
                                    >
                                      {word}
                                    </span>
                                  );
                                })}
                              </div>
                            );

                            return (
                              <>
                                {renderLine(line1Words, 0)}
                                {renderLine(line2Words, mid)}
                              </>
                            );
                          } else {
                            // Standard single row rendering
                            return (
                              <div className="flex flex-wrap justify-center items-center gap-x-2 gap-y-1 w-full text-center">
                                {activeCaptionSplits.words.map((word, idx) => {
                                  const isActive = idx === activeCaptionSplits.activeIndex;
                                  const baseSize = isVertical ? Math.max(12, Math.round(config.fontSize * 0.7)) : config.fontSize;

                                  // Custom styles for each word
                                  let wordStyle: React.CSSProperties = {
                                    fontSize: `${baseSize}px`,
                                    fontWeight: '800',
                                    transition: 'all 0.1s ease',
                                  };

                                  if (config.highlightType === 'word-bg' && isActive) {
                                    wordStyle = {
                                      ...wordStyle,
                                      color: config.activeWordColor,
                                      backgroundColor: config.activeWordBgColor,
                                      padding: '2px 8px',
                                      borderRadius: '6px',
                                      transform: 'scale(1.08)',
                                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                    };
                                  } else if (config.highlightType === 'podcast-pill' && isActive) {
                                    wordStyle = {
                                      ...wordStyle,
                                      color: config.activeWordColor,
                                      backgroundColor: config.activeWordBgColor,
                                      padding: '4px 12px',
                                      borderRadius: '999px',
                                      transform: 'scale(1.1)',
                                      boxShadow: '0 4px 15px rgba(0,0,0,0.4)',
                                    };
                                  } else if (config.highlightType === 'word-color' && isActive) {
                                    wordStyle = {
                                      ...wordStyle,
                                      color: config.activeWordColor,
                                      transform: 'scale(1.12)',
                                      textShadow: config.strokeWidth > 0 
                                        ? `0 0 ${config.strokeWidth}px ${config.strokeColor}, 1px 1px ${config.strokeWidth}px ${config.strokeColor}` 
                                        : '0 1px 4px rgba(0,0,0,0.9)',
                                    };
                                  } else if (config.highlightType === 'karaoke-glow' && isActive) {
                                    wordStyle = {
                                      ...wordStyle,
                                      color: config.activeWordColor,
                                      transform: 'scale(1.18)',
                                      textShadow: `0 0 10px ${config.activeWordColor}, 0 0 20px ${config.activeWordColor}`,
                                    };
                                  } else if (config.highlightType === 'word-scale' && isActive) {
                                    wordStyle = {
                                      ...wordStyle,
                                      color: config.activeWordColor,
                                      fontWeight: '900',
                                      transform: 'scale(1.35) rotate(-1.5deg)',
                                      textShadow: config.strokeWidth > 0 
                                        ? `0 0 ${config.strokeWidth + 1.5}px ${config.strokeColor}, 1px 1.5px 3px rgba(0,0,0,0.9)` 
                                        : '0 2px 5px rgba(0,0,0,0.9)',
                                      zIndex: 30,
                                      position: 'relative',
                                      transition: 'all 0.12s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                                    };
                                  } else {
                                    // Standard styling for non-highlighted word
                                    wordStyle = {
                                      ...wordStyle,
                                      color: config.fontColor,
                                      opacity: (config.highlightType === 'karaoke-glow') ? 0.55 : (config.highlightType === 'word-scale') ? 0.65 : 1,
                                      textShadow: config.strokeWidth > 0 
                                        ? `0 0 ${config.strokeWidth}px ${config.strokeColor}, 1px 1px ${config.strokeWidth}px ${config.strokeColor}, -1px -1px ${config.strokeWidth}px ${config.strokeColor}` 
                                        : '0 1px 3px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.7)',
                                    };
                                  }

                                  return (
                                    <span 
                                      key={idx}
                                      className="inline-block"
                                      style={wordStyle}
                                    >
                                      {word}
                                    </span>
                                  );
                                })}
                              </div>
                            );
                          }
                        })()}
                      </div>
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
