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

/**
 * Uploads a file (video or audio) directly to Google's File API using a resumable upload session.
 * This runs 100% on the client and supports large file streaming.
 */
export async function uploadToGoogleFileApi(
  file: File,
  apiKey: string,
  onProgress?: (progress: number) => void
): Promise<{ fileName: string; fileUri: string }> {
  const finalGeminiKey = apiKey || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
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
  const finalGeminiKey = apiKey || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
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
  modelName: string = 'gemini-2.0-flash',
  languageMode: string = 'Pure English (Translation Mode)'
): Promise<CaptionSegment[]> {
  const finalGeminiKey = apiKey || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
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
- NEVER overlap timestamps
- Each segment MAX 4 words only
- startTime of segment N must ALWAYS be >= endTime of segment N-1
- Timestamps must match EXACTLY when words are spoken in audio
- No guessing - listen carefully to actual speech timing`
              : `Transcribe this video audio EXACTLY word by word. Target language instruction: ${targetPromptLanguage}
Return JSON array only:
[{"startTime": 0.0, "endTime": 1.5, "text": "transcribed words"}]

Rules:
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
  modelName: string = 'gemini-2.0-flash',
  languageMode: string = 'Pure English (Translation Mode)'
): Promise<CaptionSegment[]> {
  const finalGeminiKey = apiKey || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
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
- NEVER overlap timestamps
- Each segment MAX 4 words only
- startTime of segment N must ALWAYS be >= endTime of segment N-1
- Timestamps must match EXACTLY when words are spoken in audio
- No guessing - listen carefully to actual speech timing`
              : `Transcribe this video audio EXACTLY word by word. Target language instruction: ${targetPromptLanguage}
Return JSON array only:
[{"startTime": 0.0, "endTime": 1.5, "text": "transcribed words"}]

Rules:
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
 * Calls Groq Whisper API to transcribe a file and then uses Gemini to translate script if needed.
 */
export async function generateTimestampedCaptionsGroq(
  videoFile: File,
  groqApiKey: string,
  geminiApiKey: string,
  selectedLanguage: string
): Promise<CaptionSegment[]> {
  const formData = new FormData();
  // Ensure the third argument 'audio.mp4' is specified as filename for correct processing
  formData.append('file', videoFile, 'audio.mp4');
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');

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

  // Map to CaptionSegment
  const mappedSegments: CaptionSegment[] = rawBlocks.map((seg: any, idx: number) => ({
    id: `seg-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
    startTime: typeof seg.start === 'number' ? seg.start : Number(seg.startTime || 0),
    endTime: typeof seg.end === 'number' ? seg.end : Number(seg.endTime || 1.5),
    text: String(seg.text || '')
  }));

  // Batch Spell-Check Pipeline (Groq -> Gemini Single API Call)
  const finalGeminiKey = geminiApiKey || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  if (finalGeminiKey && finalGeminiKey.trim()) {
    const rawTexts = mappedSegments.map(s => s.text);
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${finalGeminiKey}`;
    
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `You are an expert Punjabi language proofreader and script modifier. You will receive an array of transcribed text strings. Fix spelling mistakes, missing matras, and phonetic errors. 
STRICT RULES:
1. Maintain the exact original words used by the speaker (e.g., if they say 'agar', keep it as 'agar', do not translate it to 'jekar'). Do not paraphrase.
2. Keep the array indices, structure, and length identical to the input.
3. Return ONLY a valid JSON array containing the corrected strings, with no markdown wrappers or extra commentary.

Input text strings:
${JSON.stringify(rawTexts)}`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    };

    try {
      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        const result = await response.json();
        const rawResponseText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawResponseText) {
          let cleanedText = rawResponseText.trim();
          if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/```$/, '').trim();
          }
          const correctedTexts = JSON.parse(cleanedText);
          if (Array.isArray(correctedTexts)) {
            for (let i = 0; i < mappedSegments.length; i++) {
              if (correctedTexts[i] !== undefined) {
                mappedSegments[i].text = String(correctedTexts[i]).trim();
              }
            }
          }
        }
      } else {
        console.warn('Gemini spell-check API failed, returning original Groq transcripts.', response.status);
      }
    } catch (err) {
      console.error('Failed to run batch spell-checker/refiner with Gemini, falling back to original texts:', err);
    }
  }

  return mappedSegments;
}

/**
 * Script converter helper using Gemini 2.0 Flash
 */
export async function convertToGurmukhi(romanText: string, geminiApiKey: string): Promise<string> {
  const finalGeminiKey = geminiApiKey || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${finalGeminiKey}`;
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
