
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Buddy, BuddyId, PracticeMode } from './types';
import { BUDDIES, SYSTEM_INSTRUCTION_BASE, PRACTICE_MODES } from './constants';
import { Avatar } from './components/Avatar';
import { Visualizer } from './components/Visualizer';

// Audio Helpers
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [selectedBuddyIds, setSelectedBuddyIds] = useState<BuddyId[]>([BUDDIES[0].id]);
  const [currentMode, setCurrentMode] = useState<PracticeMode>(PracticeMode.CHAT);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'active'>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const audioContextRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const sessionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);

  const selectedBuddies = BUDDIES.filter(b => selectedBuddyIds.includes(b.id));
  const activeModeInfo = PRACTICE_MODES.find(m => m.id === currentMode)!;

  const stopConversation = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.input.close();
      audioContextRef.current.output.close();
      audioContextRef.current = null;
    }
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
    setConnectionStatus('idle');
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  const startConversation = async () => {
    if (selectedBuddies.length === 0) return;
    setConnectionStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = { input: inputCtx, output: outputCtx };
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const personalities = selectedBuddies.map(b => `${b.name}: ${b.personality}`).join('\n');
      const voiceName = selectedBuddies[0].voice; 

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction: SYSTEM_INSTRUCTION_BASE + 
            "\n\nCURRENT PRACTICE MODE:\n" + activeModeInfo.prompt +
            "\n\nCURRENT ACTIVE CHARACTERS:\n" + personalities,
        },
        callbacks: {
          onopen: () => {
            setConnectionStatus('active');
            setIsListening(true);

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              setIsSpeaking(true);
              const buffer = await decodeAudioData(decode(audioData), outputCtx, 24000, 1);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              
              sourcesRef.current.add(source);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsSpeaking(false);
              };
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsSpeaking(false);
            }
          },
          onclose: () => {
            setConnectionStatus('idle');
            setIsListening(false);
          },
          onerror: (e) => {
            console.error('Gemini error:', e);
            stopConversation();
          },
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error('Failed to start conversation:', err);
      setConnectionStatus('idle');
      alert("Please allow microphone access to talk to your Zootopia friends!");
    }
  };

  const toggleBuddy = (buddyId: BuddyId) => {
    if (connectionStatus !== 'idle') stopConversation();
    
    setSelectedBuddyIds(prev => {
      if (prev.includes(buddyId)) {
        if (prev.length === 1) return prev; 
        return prev.filter(id => id !== buddyId);
      }
      return [...prev, buddyId];
    });
  };

  const handleModeChange = (mode: PracticeMode) => {
    if (connectionStatus !== 'idle') stopConversation();
    setCurrentMode(mode);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gradient-to-b from-sky-100 to-white">
      {/* App Header */}
      <header className="p-4 md:p-6 flex flex-col items-center shrink-0">
        <h1 className="text-3xl md:text-5xl text-blue-600 drop-shadow-sm flex items-center gap-3">
          <span>🚔</span> 周琢钦的英语乐园 <span>🍦</span>
        </h1>
        <p className="text-sm md:text-base text-slate-500 font-bold tracking-widest uppercase mt-1">
          Zootopia English Adventure
        </p>
      </header>

      {/* Mode & Character Sidebar/Top Bar */}
      <div className="flex flex-col gap-4 px-4 overflow-y-auto no-scrollbar shrink-0 mb-4">
        {/* Character Pickers */}
        <div className="flex justify-center gap-3 md:gap-5 py-2">
          {BUDDIES.map(buddy => (
            <Avatar 
              key={buddy.id}
              buddy={buddy} 
              isActive={selectedBuddyIds.includes(buddy.id)}
              onClick={() => toggleBuddy(buddy.id)}
            />
          ))}
        </div>

        {/* Mode Selectors */}
        <div className="flex justify-center gap-2 md:gap-3 flex-wrap max-w-3xl mx-auto">
          {PRACTICE_MODES.map(mode => (
            <button
              key={mode.id}
              onClick={() => handleModeChange(mode.id)}
              className={`px-4 py-2 rounded-2xl border-2 text-sm font-bold transition-all flex items-center gap-2 bouncy shadow-sm ${
                currentMode === mode.id 
                  ? 'bg-sky-500 border-sky-600 text-white scale-105 ring-2 ring-sky-200' 
                  : 'bg-white border-slate-100 text-slate-500 hover:border-sky-300'
              }`}
            >
              <span>{mode.icon}</span>
              <span className="hidden sm:inline">{mode.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Interaction Core */}
      <main className="flex-grow flex flex-col items-center justify-center p-4 relative">
        <div className="w-full max-w-4xl flex flex-col items-center gap-10">
          
          {/* Main Visual Component */}
          <div className="relative flex items-center justify-center">
            {/* Status Rings */}
            {connectionStatus === 'active' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className={`w-full h-full rounded-full border-4 animate-pulse-ring ${selectedBuddies[0].color.replace('bg-', 'border-')}`}></div>
                <div className={`absolute w-[120%] h-[120%] rounded-full border-2 opacity-20 animate-pulse-ring ${selectedBuddies[0].color.replace('bg-', 'border-')}`} style={{animationDelay: '0.5s'}}></div>
              </div>
            )}

            {/* Avatars Display */}
            <div className="flex items-center justify-center gap-4 relative z-10 min-h-[16rem]">
              {selectedBuddies.map((buddy, index) => (
                <div key={buddy.id} className="relative transition-all duration-500">
                  <div className={`absolute -inset-8 rounded-full blur-3xl opacity-30 ${buddy.color} ${isSpeaking ? 'animate-pulse' : 'opacity-0'}`}></div>
                  <img 
                    src={buddy.avatar} 
                    alt={buddy.name} 
                    className={`rounded-full border-8 border-white shadow-2xl bg-white p-4 relative z-10 transition-all duration-500
                      ${selectedBuddies.length === 1 ? 'w-64 h-64 md:w-80 md:h-80' : 'w-32 h-32 md:w-48 md:h-48'}
                      ${isSpeaking ? 'scale-110 shadow-sky-200 speaking-blob' : 'scale-100'}
                      ${connectionStatus === 'connecting' ? 'animate-bounce grayscale' : ''}`}
                    style={{ animationDelay: `${index * 0.15}s` }}
                  />
                  <div className={`absolute -bottom-4 left-1/2 -translate-x-1/2 z-20 px-6 py-1.5 rounded-full text-white text-lg font-black shadow-lg ${buddy.color} ring-4 ring-white`}>
                    {buddy.name.split(' ')[0]}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* HUD Info */}
          <div className="text-center space-y-2 z-20">
            <h2 className="text-4xl font-kids text-slate-800 tracking-tight">
              {connectionStatus === 'idle' && "Ready for adventure?"}
              {connectionStatus === 'connecting' && "Finding your friends..."}
              {connectionStatus === 'active' && (isSpeaking ? "Your friend is talking!" : "It's your turn! Speak English!")}
            </h2>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">
              Current Mission: <span className="text-sky-500 underline decoration-2 underline-offset-4">{activeModeInfo.description}</span>
            </p>
          </div>

          {/* Visualizer & Controls */}
          <div className="w-full max-w-md flex flex-col items-center gap-6">
            <Visualizer isListening={isListening} isSpeaking={isSpeaking} color={selectedBuddies[0].color} />
            
            <div className="w-full">
              {connectionStatus === 'idle' ? (
                <button 
                  onClick={startConversation}
                  className="w-full py-8 text-4xl text-white font-black rounded-full shadow-[0_15px_0_rgb(37,99,235)] bg-blue-500 hover:bg-blue-600 hover:shadow-[0_10px_0_rgb(37,99,235)] active:translate-y-2 active:shadow-none transition-all bouncy flex items-center justify-center gap-6"
                >
                  <span>START TALKING</span>
                  <span className="text-5xl">🎤</span>
                </button>
              ) : (
                <button 
                  onClick={stopConversation}
                  disabled={connectionStatus === 'connecting'}
                  className={`w-full py-8 text-4xl text-white font-black rounded-full shadow-[0_15px_0_rgb(220,38,38)] bg-red-500 hover:bg-red-600 hover:shadow-[0_10px_0_rgb(220,38,38)] active:translate-y-2 active:shadow-none transition-all bouncy flex items-center justify-center gap-6 ${connectionStatus === 'connecting' ? 'opacity-50 cursor-wait' : ''}`}
                >
                  <span>{connectionStatus === 'connecting' ? 'CONNECTING...' : 'STOP'}</span>
                  <span className="text-5xl">{connectionStatus === 'connecting' ? '⌛' : '👋'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="p-6 text-center shrink-0">
        <div className="inline-flex items-center gap-4 bg-white/40 px-6 py-2 rounded-full backdrop-blur-sm">
          <span className="text-xs font-bold text-slate-400">TIPS: Try saying "Hello Judy!"</span>
          <div className="w-1 h-1 rounded-full bg-slate-300"></div>
          <span className="text-xs font-bold text-sky-500 uppercase">English Practice Level: Master</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
