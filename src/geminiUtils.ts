import { CaptionSegment } from './types';

interface FileUploadResponse {
  file: {
    name: string;
    displayName: string;
    mimeType: string;
    size: string;
    createTime: string;
    updateTime: string;
    state: 'STATE_UNSPECIFIED' | 'PROCESSING' | 'ACTIVE' | 'FAILED';
    uri: string;
  };
}

function getBundledGeminiApiKey(): string {
  // @ts-ignore
  return import.meta.env.VITE_GEMINI_API_KEY || '';
}

/**
 * Uploads a file (video or audio) directly to Google's File API using a resumable upload session.
 * This runs 100% on the client and supports large file streaming.
 */
export async function uploadToGoogleFileApi(
  file: File,
  apiKey: string,
  onProgress?: (progress: number) => void
): Promise<{ fileName: string; fileUri: string }> {
  const finalGeminiKey = apiKey || getBundledGeminiApiKey();
  // 1. Initial POST request to request upload location
  const initUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${finalGeminiKey}`;
  
  const initHeaders = new Headers({
    'X-Goog-Upload-Protocol': 'resumable',
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Length': file.size.toString(),
    'X-Goog-Upload-Header-Content-Type': file.type || 'video/mp4',
    'Content-Type': 'application/json'
  });

  const metadata = {
    file: {
      displayName: file.name
    }
  };

  const initResponse = await fetch(initUrl, {
    method: 'POST',
    headers: initHeaders,
    body: JSON.stringify(metadata)
  });

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(`Failed to initiate Google File upload: ${initResponse.status} ${errorText}`);
  }

  const uploadLocation = initResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadLocation) {
    throw new Error('Google File upload response missing X-Goog-Upload-URL header.');
  }

  // 2. Perform the upload using XMLHttpRequest or fetch with progress tracking if possible.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadLocation, true);
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          onProgress(percentComplete);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const fileData = JSON.parse(xhr.responseText) as FileUploadResponse;
          resolve({
            fileName: fileData.file.name, // e.g. "files/abc123xyz"
            fileUri: fileData.file.uri     // e.g. "https://generativelanguage.googleapis.com/v1beta/files/abc123xyz"
          });
        } catch (e) {
          reject(new Error('Failed to parse file upload response: ' + String(e)));
        }
      } else {
        reject(new Error(`Materialization request failed during finalization: ${xhr.status} ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during Google File API upload.'));
    xhr.send(file);
  });
}

/**
 * Polls the Google File API until the file is ACTIVE (processed and ready for Gemini).
 */
export async function pollGoogleFileState(
  fileName: string,
  apiKey: string,
  onStatusUpdate?: (status: string) => void
): Promise<void> {
  const finalGeminiKey = apiKey || getBundledGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${finalGeminiKey}`;

  while (true) {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`File polling request failed: ${response.status} ${errorText}`);
    }

    const fileData = (await response.json()) as FileUploadResponse['file'];
    const state = fileData.state;

    if (onStatusUpdate) {
      onStatusUpdate(`Processing: file state is ${state}`);
    }

    if (state === 'ACTIVE') {
      return; // Ready!
    } else if (state === 'FAILED') {
      throw new Error('Google File transcription pipeline failed validation on ingest.');
    }

    // Wait 2 seconds before polling again
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * Safely parses any Gemini generated timestamp or raw number format to precise decimal seconds.
 * Handles BB:CC, AA:BB:CC, SS.SS, milliseconds, comma representations, brackets, and raw digits.
 */
export function parseTimestampToSeconds(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }

  // Convert to string and clean brackets, quotes, braces
  let str = String(val).trim().replace(/[\[\]"'\(\)\{\}]/g, '').trim();
  if (!str) return 0;

  str = str.replace(/,/g, '.');

  if (/^\d+(\.\d+)?$/.test(str)) {
    const parsed = parseFloat(str);
    return isNaN(parsed) ? 0 : parsed;
  }

  const parts = str.split(':');
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  } else if (parts.length === 3) {
    const hrs = parseFloat(parts[0]) || 0;
    const mins = parseFloat(parts[1]) || 0;
    const secs = parseFloat(parts[2]) || 0;
    return hrs * 3600 + mins * 60 + secs;
  }

  const rawNum = parseFloat(str);
  return isNaN(rawNum) ? 0 : rawNum;
}

/**
 * Calls Gemini to transcribe the video via inline base64 and output timestamped segments matching our React schema.
 */
export async function generateTimestampedCaptionsInline(
  base64Data: string,
  mimeType: string,
  apiKey: string,
  modelName: string = 'gemini-2.5-flash-lite',
  languageMode: string = 'Pure English (Translation Mode)'
): Promise<CaptionSegment[]> {
  const finalGeminiKey = apiKey || getBundledGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${finalGeminiKey}`;

  let targetPromptLanguage = '';
  switch (languageMode) {
    case 'Pure Punjabi (Gurmukhi Script)':
      targetPromptLanguage = 'Write the output strictly in Pure Punjabi using the Gurmukhi script (e.g. ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ). Do not translate into English or Hindi.';
      break;
    case 'Punjabi with English Letters (Romanized / Hinglish style)':
      targetPromptLanguage = 'Write the output in Punjabi but strictly using English/Roman alphabet letters (Romanized transliteration / Hinglish-style dialect, e.g. "Sat Sri Akal", "ki haal hai", "tusan ki kar rahe ho").';
      break;
    case 'Pure Hindi (Devanagari Script)':
      targetPromptLanguage = 'Write the output strictly in Pure Hindi using the Devanagari script (e.g. नमस्ते). Do not translate into English or Punjabi.';
      break;
    case 'Pure English (Translation Mode)':
    default:
      targetPromptLanguage = 'Translate any spoken text into correct English and write the output subtitles strictly in Pure English.';
      break;
  }

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType
            }
          },
          {
            text: languageMode === 'Pure Punjabi (Gurmukhi Script)'
              ? `Transcribe this video audio EXACTLY word by word in Punjabi (Gurmukhi script). 
Return JSON array only:
[{"startTime": 0.0, "endTime": 1.5, "text": "ਪੰਜਾਬੀ ਸ਼ਬਦ"}]

Rules:
- You MUST transcribe the entire video/audio length from 0.0 seconds all the way until the very end of the file. Do NOT truncate, omit, or stop transcribing halfway through. Everything spoken must be transcribed chronologically.
- NEVER overlap timestamps
- Each segment MAX 4 words only
- startTime of segment N must ALWAYS be >= endTime of segment N-1
- Timestamps must match EXACTLY when words are spoken in audio
- No guessing - listen carefully to actual speech timing`
              : `Transcribe this video audio EXACTLY word by word. Target language instruction: ${targetPromptLanguage}
Return JSON array only:
[{"startTime": 0.0, "endTime": 1.5, "text": "transcribed words"}]

Rules:
- You MUST transcribe the entire video/audio length from 0.0 seconds all the way until the very end of the file. Do NOT truncate, omit, or stop transcribing halfway through. Everything spoken must be transcribed chronologically.
- NEVER overlap timestamps
- Each segment MAX 4 words only
- startTime of segment N must ALWAYS be >= endTime of segment N-1
- Timestamps must match EXACTLY when words are spoken in audio
- No guessing - listen carefully to actual speech timing`
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        description: 'A chronologically ordered list of timestamped subtitle blocks',
        items: {
          type: 'OBJECT',
          properties: {
            startTime: {
              type: 'NUMBER',
              description: 'Start of subtitle timing block in seconds (number representation with decimal, e.g. 0.5)'
            },
            endTime: {
              type: 'NUMBER',
              description: 'End of subtitle timing block in seconds (number representation with decimal, e.g. 3.2)'
            },
            text: {
              type: 'STRING',
              description: 'The exact text matching that subtitle duration segment'
            }
          },
          required: ['startTime', 'endTime', 'text']
        }
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini transcription generation failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Empty response received from the Gemini transcript generation pipeline.');
  }

  try {
    const jsonParsed = JSON.parse(rawText.trim());
    if (Array.isArray(jsonParsed)) {
      return jsonParsed.map((seg, idx) => ({
        id: seg.id || `seg-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
        startTime: parseTimestampToSeconds(seg.startTime),
        endTime: parseTimestampToSeconds(seg.endTime),
        text: String(seg.text || '')
      }));
    } else {
      throw new Error('Gemini response returned JSON but was not a list array.');
    }
  } catch (parseError) {
    console.error('Failed to parse Gemini output JSON:', rawText);
    throw new Error(`Failed to parse structured captions from Gemini: ${parseError}`);
  }
}

/**
 * Calls Gemini to transcribe the video and output timestamped segments matching our React schema.
 */
export async function generateTimestampedCaptions(
  fileUri: string,
  mimeType: string,
  apiKey: string,
  modelName: string = 'gemini-2.5-flash-lite',
  languageMode: string = 'Pure English (Translation Mode)'
): Promise<CaptionSegment[]> {
  const finalGeminiKey = apiKey || getBundledGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${finalGeminiKey}`;

  let targetPromptLanguage = '';
  switch (languageMode) {
    case 'Pure Punjabi (Gurmukhi Script)':
      targetPromptLanguage = 'Write the output strictly in Pure Punjabi using the Gurmukhi script (e.g. ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ). Do not translate into English or Hindi.';
      break;
    case 'Punjabi with English Letters (Romanized / Hinglish style)':
      targetPromptLanguage = 'Write the output in Punjabi but strictly using English/Roman alphabet letters (Romanized transliteration / Hinglish-style dialect, e.g. "Sat Sri Akal", "ki haal hai", "tusan ki kar rahe ho").';
      break;
    case 'Pure Hindi (Devanagari Script)':
      targetPromptLanguage = 'Write the output strictly in Pure Hindi using the Devanagari script (e.g. नमस्ते). Do not translate into English or Punjabi.';
      break;
    case 'Pure English (Translation Mode)':
    default:
      targetPromptLanguage = 'Translate any spoken text into correct English and write the output subtitles strictly in Pure English.';
      break;
  }

  const requestBody = {
    contents: [
      {
        parts: [
          {
            fileData: {
              fileUri: fileUri,
              mimeType: mimeType
            }
          },
          {
            text: languageMode === 'Pure Punjabi (Gurmukhi Script)'
              ? `Transcribe this video audio EXACTLY word by word in Punjabi (Gurmukhi script). 
Return JSON array only:
[{"startTime": 0.0, "endTime": 1.5, "text": "ਪੰਜਾਬੀ ਸ਼ਬਦ"}]

Rules:
- You MUST transcribe the entire video/audio length from 0.0 seconds all the way until the very end of the file. Do NOT truncate, omit, or stop transcribing halfway through. Everything spoken must be transcribed chronologically.
- NEVER overlap timestamps
- Each segment MAX 4 words only
- startTime of segment N must ALWAYS be >= endTime of segment N-1
- Timestamps must match EXACTLY when words are spoken in audio
- No guessing - listen carefully to actual speech timing`
              : `Transcribe this video audio EXACTLY word by word. Target language instruction: ${targetPromptLanguage}
Return JSON array only:
[{"startTime": 0.0, "endTime": 1.5, "text": "transcribed words"}]

Rules:
- You MUST transcribe the entire video/audio length from 0.0 seconds all the way until the very end of the file. Do NOT truncate, omit, or stop transcribing halfway through. Everything spoken must be transcribed chronologically.
- NEVER overlap timestamps
- Each segment MAX 4 words only
- startTime of segment N must ALWAYS be >= endTime of segment N-1
- Timestamps must match EXACTLY when words are spoken in audio
- No guessing - listen carefully to actual speech timing`
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        description: 'A chronologically ordered list of timestamped subtitle blocks',
        items: {
          type: 'OBJECT',
          properties: {
            startTime: {
              type: 'NUMBER',
              description: 'Start of subtitle timing block in seconds (number representation with decimal, e.g. 0.5)'
            },
            endTime: {
              type: 'NUMBER',
              description: 'End of subtitle timing block in seconds (number representation with decimal, e.g. 3.2)'
            },
            text: {
              type: 'STRING',
              description: 'The exact text matching that subtitle duration segment'
            }
          },
          required: ['startTime', 'endTime', 'text']
        }
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini transcription generation failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Empty response received from the Gemini transcript generation pipeline.');
  }

  try {
    const jsonParsed = JSON.parse(rawText.trim());
    if (Array.isArray(jsonParsed)) {
      return jsonParsed.map((seg, idx) => ({
        id: seg.id || `seg-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
        startTime: parseTimestampToSeconds(seg.startTime),
        endTime: parseTimestampToSeconds(seg.endTime),
        text: String(seg.text || '')
      }));
    } else {
      throw new Error('Gemini response returned JSON but was not a list array.');
    }
  } catch (parseError) {
    console.error('Failed to parse Gemini output JSON:', rawText);
    throw new Error(`Failed to parse structured captions from Gemini: ${parseError}`);
  }
}

/**
 * Calls Groq Whisper API to transcribe a file in the user's selected language.
 */
export async function generateTimestampedCaptionsGroq(
  audioBlob: File | Blob,
  groqApiKey: string,
  geminiApiKey: string,
  selectedLanguage: string
): Promise<CaptionSegment[]> {
  const formData = new FormData();
  // Ensure the third argument 'audio.wav' is specified as filename for correct processing
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');
  formData.append('temperature', '0.0');

  // Map user-selected language dynamically to Groq Whisper parameters as requested
  formData.append('language', selectedLanguage);

  let whisperPrompt = '';
  if (selectedLanguage === 'pa') {
    whisperPrompt = 'ਮੈਂ ਪੰਜਾਬੀ ਵਿੱਚ ਬੋਲ ਰਿਹਾ ਹਾਂ, ਕਿਰਪਾ ਕਰਕੇ ਪੰਜਾਬੀ ਵਿੱਚ ਲਿਖੋ।';
  } else if (selectedLanguage === 'hi') {
    whisperPrompt = 'हिन्दी में ट्रांसक्रिप्ट करें।';
  } else if (selectedLanguage === 'en') {
    whisperPrompt = 'Transcribe or translate the audio stream accurately into English subtitles.';
  }

  if (whisperPrompt) {
    formData.append('prompt', whisperPrompt);
  }

  const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqApiKey}` },
    body: formData
  });

  if (!groqResponse.ok) {
    let errorDetail = '';
    try {
      const errJson = await groqResponse.json();
      console.error('Groq Error:', errJson);
      errorDetail = JSON.stringify(errJson);
    } catch (e) {
      errorDetail = await groqResponse.text();
    }
    throw new Error(`Groq Whisper transcription failed: ${groqResponse.status} ${errorDetail}`);
  }

  const groqData = await groqResponse.json();
  console.log('Groq full response:', groqData);

  // Safely extract transcription blocks either from words array (for word-level precision) or segments array
  let rawBlocks: any[] = [];

  if (groqData.words && groqData.words.length > 0) {
    // If word-level timing is returned, bundle words into segments of max 4 words to match sub-title standards
    const words = groqData.words;
    const maxWordsPerChunk = 4;
    for (let i = 0; i < words.length; i += maxWordsPerChunk) {
      const slice = words.slice(i, i + maxWordsPerChunk);
      const chunkText = slice.map((w: any) => w.word || w.text || '').join(' ');
      const start = slice[0].start;
      const end = slice[slice.length - 1].end;
      rawBlocks.push({
        start: start,
        end: end,
        text: chunkText
      });
    }
  } else if (groqData.segments && groqData.segments.length > 0) {
    rawBlocks = groqData.segments;
  } else if (groqData.text) {
    // Single static fallback block if no granular segments can be derived
    rawBlocks = [{
      start: 0,
      end: 2,
      text: groqData.text
    }];
  }

  if (rawBlocks.length === 0) {
    console.warn('Unable to find any segments, words, or text in Groq response payload.', groqData);
    return [];
  }

  // Map to CaptionSegment directly, leaving it unedited by Gemini for immediate user layout editing
  const mappedSegments: CaptionSegment[] = rawBlocks.map((seg: any, idx: number) => ({
    id: `seg-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
    startTime: typeof seg.start === 'number' ? seg.start : Number(seg.startTime || 0),
    endTime: typeof seg.end === 'number' ? seg.end : Number(seg.endTime || 1.5),
    text: String(seg.text || '')
  }));

  return mappedSegments;
}

/**
 * Helper to convert Blob or File to Base64 in browser standard environment
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read blob data'));
    reader.onload = () => {
      const resStr = reader.result as string;
      const commaIdx = resStr.indexOf(',');
      resolve(commaIdx !== -1 ? resStr.substring(commaIdx + 1) : resStr);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Manually or automatically triggered spell-checker/refiner that uses Gemini 2.5 Flash
 * to correct spelling mistakes IN THE SAME language without changing meaning or translation,
 * with optional direct audio context for phoneme alignment and extreme precision.
 * 
 * Timeline Preservation Constraint: Ensures that every start and end timestamp is strictly 
 * parsed and preserved or safely synchronized.
 */
export async function correctCaptionsSpellingGemini(
  captions: CaptionSegment[],
  languageMode: string,
  apiKey: string,
  audioBlob?: Blob | null,
  onStatusUpdate?: (status: string) => void
): Promise<CaptionSegment[]> {
  const finalGeminiKey = apiKey || getBundledGeminiApiKey();
  if (!finalGeminiKey) {
    throw new Error('Gemini API key is required for spell-checking. Please check your settings.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${finalGeminiKey}`;

  // Build targeted context instructions based on current languageMode selection
  let langContext = languageMode;
  if (languageMode.includes('Gurmukhi')) {
    langContext = 'Punjabi Written in Gurmukhi Script (ਪੰਜਾਬੀ ਗੁਰਮੁਖੀ)';
  } else if (languageMode.includes('Romanized') || languageMode.includes('English Letters')) {
    langContext = 'Romanized Punjabi (Hinglish / transliterated Punjabi styling using Latin/English alphabet characters)';
  } else if (languageMode.includes('Hindi') || languageMode.includes('Devanagari')) {
    langContext = 'Hindi (Devanagari script)';
  } else if (languageMode.includes('English')) {
    langContext = 'English';
  }

  // Format payload exactly as a flat array of strings to avoid confusing the model with numeric parameters
  const payloadToRefine = captions.map(c => c.text);

  const fileParts: any[] = [];
  if (audioBlob) {
    if (onStatusUpdate) onStatusUpdate('Encoding audio track for voice-assisted proofreading (Option 1: Analyze Audio)...');
    try {
      const base64Audio = await blobToBase64(audioBlob);
      fileParts.push({
        inlineData: {
          data: base64Audio,
          mimeType: audioBlob.type || 'audio/wav'
        }
      });
    } catch (e: any) {
      console.warn('Failed to convert audio blob to Base64:', e);
      if (onStatusUpdate) onStatusUpdate('⚠️ Audio track encoding failed. Proceeding with text-only refinement...');
    }
  }

  const prompt = audioBlob
    ? `You are a high-precision subtitle refiner. Listen closely to the provided audio file and correct any spelling, hearing, or grammatical mistakes in the provided Punjabi/Hindi/English Groq captions text (Option 1: Analyze Audio).
Do not summarize, do not change the sentence structure, and do not drop any words. Return the exact same number of lines in the corrected version. Keep the exact same translation script (Roman Punjabi stays Roman, Gurmukhi stays Gurmukhi). Save the pure corrected text back to the corresponding JSON indices.

Language context: ${langContext}

CRITICAL DIRECTIVES:
1. STRICT ARRAY SIZE CONSERVATION (No Dropped Captions): You MUST return a JSON array containing EXACTLY ${captions.length} elements. Each index in the output array corresponds to the input array index. No merging or dropping of segments.
2. STRICTLY PRESERVE THE ORIGINAL SCRIPT AND STYLE.
3. Return ONLY a JSON string array of corrected strings (e.g., ["string1", "string2", ...]). Do NOT wrap the JSON inside markdown code blocks or \`\`\`json wrappers.

Input text lines to refine:
${JSON.stringify(payloadToRefine, null, 2)}`
    : `You are a lightning-fast spell-checker. Correct the spelling mistakes in this text. Do not summarize, do not change the sentence structure, and do not drop any words. Return the exact same number of words/sentences in the corrected version. Keep the exact same translation script (Roman Punjabi stays Roman, Gurmukhi stays Gurmukhi). Return ONLY the corrected lines as a clean JSON array.

Language context: ${langContext}

CRITICAL DIRECTIVES:
1. STRICT ARRAY SIZE CONSERVATION (No Dropped Captions): You are ONLY allowed to fix spelling typos. You MUST NOT delete, skip, merge, or remove any lines. The total count of output JSON array items MUST EXACTLY match the input array count of ${captions.length} elements.
2. STRICTLY PRESERVE THE ORIGINAL SCRIPT AND STYLE. If the text language mode is Romanized Punjabi / English Letters, you MUST keep it in Romanized letters with correct spellings! Keep Gurmukhi in Gurmukhi, English in English, and Hindi in Hindi.
3. Return ONLY a JSON string array of corrected strings (e.g., ["string1", "string2", ...]). Do NOT wrap the JSON inside markdown code blocks or \`\`\`json wrappers.

Input text lines to refine:
${JSON.stringify(payloadToRefine, null, 2)}`;

  if (onStatusUpdate) {
    onStatusUpdate(audioBlob ? 'Perfecting transcript using voice-assisted Gemini audio analyzer...' : 'Perfecting transcript via lightning-fast Gemini text spellchecker...');
  }

  const requestBody = {
    contents: [
      {
        parts: [
          ...fileParts,
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'STRING'
        }
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini spellcheck service failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Received an empty response payload from the Gemini correction system.');
  }

  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/```$/, '').trim();
  }

  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error('Spellcheck result parse error: output did not produce a corresponding JSON array.');
  }

  if (parsed.length !== captions.length) {
    console.warn(`Gemini parsed array length mismatch. Expected: ${captions.length}, Got: ${parsed.length}. Best-effort timestamp locking applied.`);
  }

  // Create a deep copy of original captions to lock timestamps completely to pristine Groq timelines
  const groqSegments: CaptionSegment[] = captions.map((original) => ({ ...original }));
  const geminiCorrectedText = parsed;

  // Absolute Timestamp Locking: Loop through and only align text strings index-by-index (array-matching safety check)
  for (let i = 0; i < geminiCorrectedText.length; i++) {
    if (groqSegments[i]) {
      groqSegments[i].text = typeof geminiCorrectedText[i] === 'string' ? String(geminiCorrectedText[i]).trim() : String(geminiCorrectedText[i]);
    }
  }

  return groqSegments;
}

/**
 * Text-only conversion utility that translates or transliterates 
 * generated captions to match the user's desired script/language mode 
 * without modifying any timestamps or indices.
 */
export async function mapCaptionsToSelectedScript(
  captions: CaptionSegment[],
  languageMode: string,
  apiKey: string,
  onStatusUpdate?: (status: string) => void
): Promise<CaptionSegment[]> {
  if (!captions || captions.length === 0) return captions;

  const BATCH_SIZE = 25;
  if (captions.length > 30) {
    const batches: CaptionSegment[][] = [];
    for (let i = 0; i < captions.length; i += BATCH_SIZE) {
      batches.push(captions.slice(i, i + BATCH_SIZE));
    }
    const results = await Promise.allSettled(
      batches.map(batch => mapCaptionsToSelectedScript(batch, languageMode, apiKey, onStatusUpdate))
    );
    return results.map((r, i) => r.status === 'fulfilled' ? r.value : batches[i]).flat();
  }

  const finalGeminiKey = apiKey || getBundledGeminiApiKey();
  if (!finalGeminiKey) {
    console.warn('Skipping script mapping pass because Gemini API key is missing.');
    if (onStatusUpdate) {
      onStatusUpdate('⚠️ Gemini API key is missing from Vercel! Skipping spellcheck & using raw Groq output.');
      await new Promise(r => setTimeout(r, 2200));
    }
    return captions;
  }

  const texts = captions.map(c => c.text);

  let targetPrompt = '';
  if (languageMode.includes('Gurmukhi')) {
    targetPrompt = 'Convert/Translate all input segments strictly into Pure Punjabi using the Gurmukhi script (e.g., ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ). Do NOT output in Roman letters, and do NOT translate into English. If it is already in Gurmukhi, keep it as is, but refine typos.';
  } else if (languageMode.includes('Romanized') || languageMode.includes('English Letters')) {
    targetPrompt = 'Convert/Transliterate all input segments strictly into Romanized Punjabi (Latin/English letters, e.g., "Sat Sri Akal", "ki haal chal hai", "tusan ki kar rahe ho"). Do NOT use Gurmukhi or Devanagari characters, and do NOT translate the meaning to English. Keep the spoken Punjabi words written in English letters verbatim.';
  } else if (languageMode.includes('Hindi') || languageMode.includes('Devanagari')) {
    targetPrompt = 'Translate or transcribe all input segments strictly into Pure Hindi using Devanagari script (e.g., नमस्ते, आप कैसे हैं). Do not use Gurmukhi or Roman script. Keep the original meaning and timeline aligned.';
  } else if (languageMode.includes('English') || languageMode.includes('Translation')) {
    targetPrompt = 'Translate all input segments strictly into natural, fluent Pure English. Ensure timing/duration slots maintain their exact spoken translations.';
  } else {
    return captions;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${finalGeminiKey}`;

  const prompt = `You are an AI subtitle wizard acting as the second stage of a high-performance hybrid pipeline (Groq Whisper v3 + Gemini).
Groq Whisper has processed the video audio and generated high-quality timestamps, but its raw transcript wording is rough, phonetically literal, or has grammatical, spelling, formatting and language slips.

Your job is to read all transcription segments together as a single continuous dialogue/monologue, and rewrite, proofread, and refine the wording of each segment so the total flow is 100% natural, correct, fluent, and extremely professional in the target language style, suitable for high-impact social media captions (capturing the right emotional depth).

TARGET LANGUAGE SPECIFICATION:
${targetPrompt}

STRICT OPERATIONAL DIRECTIVES:
1. Preserve the continuous sentence flow. Do NOT translate Romanized Punjabi into English or Gurmukhi script. Convert it to standard, clean Romanized script spelling (e.g., "Satsriakal" to "Sat Sri Akal", "vyah" to "Vyah", "vadhia" to "Vadiya", "gro" to "Grow").
2. For Gurmukhi Punjabi, keep correct Gurmukhi script characters with precise spelling, spaces, and matras.
3. Fix all stuttering, raw phonetic mistakes, weird punctuation, or lowercase errors, returning clean, readable words suited for Instagram Reels, YouTube, and TikTok video subtitles (which use short, high-impact phrasing).
4. Maintain the EXACT same index and order of the original array (the input has ${texts.length} elements). Do NOT skip, merge, or change the item count.
5. Return ONLY a valid JSON string array of corrected strings (e.g., ["string1", "string2", ...]). Do NOT wrap the JSON inside markdown code blocks or \`\`\`json wrappers.

Input segments:
${JSON.stringify(texts)}`;

  try {
    if (onStatusUpdate) {
      onStatusUpdate('Combining Groq timestamps with Gemini wording engine...');
    }

    const requestBody = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        }
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.error('Script mapping API request failed:', response.status);
      if (onStatusUpdate) {
        if (response.status === 429) {
          onStatusUpdate('⚠️ Gemini rate-limited (429 Quota Exceeded). Using raw Groq output.');
        } else {
          onStatusUpdate(`⚠️ Gemini mapping failed (HTTP ${response.status}). Using raw Groq output.`);
        }
        await new Promise(r => setTimeout(r, 2200));
      }
      return captions;
    }

    const result = await response.json();
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return captions;

    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (parsed.length !== captions.length) {
        console.warn(`Script mapper parsed array length mismatch. Expected: ${captions.length}, Got: ${parsed.length}. Best-effort timestamp locking applied.`);
      }

      // Create a deep copy of original captions to lock pristine Groq timelines
      const correctedCaptions: CaptionSegment[] = captions.map((original) => ({ ...original }));

      // Absolute Timestamp Locking: Loop through and only align text strings index-by-index (array-matching safety check)
      for (let i = 0; i < parsed.length; i++) {
        if (correctedCaptions[i]) {
          correctedCaptions[i].text = typeof parsed[i] === 'string' ? String(parsed[i]).trim() : String(parsed[i]);
        }
      }

      return correctedCaptions;
    } else {
      console.warn('Script mapper parsed array is not a valid array.');
    }
  } catch (error: any) {
    console.error('Failed to map captions script via Gemini:', error);
    if (onStatusUpdate) {
      onStatusUpdate('⚠️ Gemini connection error. Using raw Groq output.');
      await new Promise(r => setTimeout(r, 2200));
    }
  }

  return captions;
}

/**
 * Mode 2: Aligns a perfect script text onto raw Groq timestamps index-by-index using Gemini's cognitive flow.
 * Ensures timestamps remain 100% locked during replacement.
 */
export async function alignScriptWithTimestampsGemini(
  captions: CaptionSegment[],
  scriptText: string,
  apiKey: string,
  onStatusUpdate?: (status: string) => void
): Promise<CaptionSegment[]> {
  const finalGeminiKey = apiKey || getBundledGeminiApiKey();
  if (!finalGeminiKey) {
    throw new Error('Gemini API key is required to align scripts. Please configure your key first.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${finalGeminiKey}`;

  if (onStatusUpdate) {
    onStatusUpdate('Aligning custom script text onto Groq caption timestamps...');
  }

  const rawBins = captions.map((c, i) => `#${i + 1}: "${c.text}"`).join('\n');

  const prompt = `You are an expert subtitle script alignment assistant.
You have two inputs:
1. A sequencially ordered list of ${captions.length} raw subtitle segment bins (which has spelling mistakes, transcript errors, or missing words):
${rawBins}

2. The correct, pristine text script transcript:
"${scriptText}"

YOUR TASK:
Align the words, phrases, or sentences from the correct pristine text script perfectly onto the ${captions.length} corresponding raw subtitle segment bins sequentially.
Replace the inaccurate text inside each numbered segment bin with the actual matching, correct phrases/words from the pristine script.
Ensure the flow is natural, keep the original sentence order, and make sure you allocate text to exactly ${captions.length} segments.

CRITICAL DIRECTIVES:
1. STRICT ARRAY SIZE CONSERVATION: You MUST return a JSON array containing EXACTLY ${captions.length} elements. Each index in the output array corresponds to the bin index. No merging or dropping.
2. Return ONLY a JSON string array of corrected strings (e.g., ["segment1_text", "segment2_text", ...]). Do NOT wrap the JSON inside markdown code blocks or \`\`\`json wrappers.

Provide the finalized text for each segment:`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'STRING'
        }
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini alignment failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Received an empty response payload from the Gemini alignment system.');
  }

  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/```$/, '').trim();
  }

  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error('Alignment result did not produce a valid JSON array.');
  }

  // Create a deep copy of original captions to lock timestamps completely to pristine Groq timelines
  const groqSegments: CaptionSegment[] = captions.map((original) => ({ ...original }));

  // Absolute Timestamp Locking: Loop through and only align text strings index-by-index (array-matching safety check)
  for (let i = 0; i < parsed.length; i++) {
    if (groqSegments[i]) {
      groqSegments[i].text = typeof parsed[i] === 'string' ? String(parsed[i]).trim() : String(parsed[i]);
    }
  }

  return groqSegments;
}

/**
 * Script converter helper using Gemini 3.5 Flash
 */
export async function convertToGurmukhi(romanText: string, geminiApiKey: string): Promise<string> {
  const finalGeminiKey = geminiApiKey || getBundledGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${finalGeminiKey}`;
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `Convert Roman Punjabi to Gurmukhi script ONLY.
Word by word. NEVER change meaning. NEVER use synonyms.
Input: "${romanText}"
Return ONLY Gurmukhi text.`
          }
        ]
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini script conversion failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  return result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

/**
 * Deprecated helper method kept for backward compatibility alias
 */
export async function convertRomanToGurmukhi(groqText: string, geminiApiKey: string): Promise<string> {
  return convertToGurmukhi(groqText, geminiApiKey);
}
