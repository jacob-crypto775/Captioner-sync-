export interface CaptionSegment {
  id: string;
  startTime: number; // in seconds, editable decimal
  endTime: number;   // in seconds, editable decimal
  text: string;
}

export interface Project {
  id: string;
  userId: string;
  videoName: string;
  captions: string; // stringified JSON array of CaptionSegment[]
  createdAt?: any;
  updatedAt?: any;
}

export interface BurnConfig {
  fontSize: number;       // e.g., 24
  fontColor: string;      // hex value e.g., #ffffff
  backgroundColor: string;// hex value e.g., #000000
  backgroundOpacity: number; // 0 to 1
  strokeColor: string; // default stroke outline e.g., #000000
  strokeWidth: number; // e.g. 2
  positionY: number;      // percentage from top of screen e.g., 85 for bottom
}

export interface UserSettings {
  geminiApiKey: string;
}
