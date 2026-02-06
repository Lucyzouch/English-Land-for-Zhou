
export enum BuddyId {
  JUDY = 'judy',
  NICK = 'nick',
  CLAWHAUSER = 'clawhauser',
  FLASH = 'flash'
}

export enum PracticeMode {
  CHAT = 'chat',
  ROLEPLAY = 'roleplay',
  VOCABULARY = 'vocabulary',
  STORY = 'story'
}

export interface PracticeModeInfo {
  id: PracticeMode;
  name: string;
  icon: string;
  description: string;
  prompt: string;
}

export interface Buddy {
  id: BuddyId;
  name: string;
  voice: string;
  avatar: string;
  description: string;
  personality: string;
  color: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}
