
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Buddy, BuddyId, ChatMessage, PracticeMode } from './types';
import { BUDDIES, SYSTEM_INSTRUCTION_BASE, PRACTICE_MODES } from './constants';
import { Avatar } from './components/Avatar';
import { Visualizer } from './components/Visualizer';

// Helper for encoding/decoding
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
  const [isActive, setIsActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const audioContextRef = useRef<{
    input: AudioContext;
    output: AudioContext;
  } | null>(null);
  
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
    setIsActive(false);
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  const startConversation = async () => {
    if (selectedBuddies.length === 0) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = { input: inputCtx, output: outputCtx };
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const personalities = selectedBuddies.map(b => `${b.name}: ${b.personality}`).join('\n');
      const voiceName = selectedBuddies[0].voice; 

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview',
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
            setIsActive(true);
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
            setIsActive(false);
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
      setIsActive(false);
    }
  };

  const toggleBuddy = (buddyId: BuddyId) => {
    if (isActive) stopConversation();
    
    setSelectedBuddyIds(prev => {
      if (prev.includes(buddyId)) {
        if (prev.length === 1) return prev; 
        return prev.filter(id => id !== buddyId);
      }
      return [...prev, buddyId];
    });
  };

  const handleModeChange = (mode: PracticeMode) => {
    if (isActive) stopConversation();
    setCurrentMode(mode);
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 max-w-5xl mx-auto">
      {/* Header */}
      <header className="w-full text-center py-6">
        <h1 className="text-4xl md:text-5xl text-blue-600 mb-2 drop-shadow-sm flex flex-wrap items-center justify-center gap-3">
          <span>🚔</span> 周琢钦的英语乐园 <span>🍦</span>
        </h1>
        <p className="text-lg text-slate-500 font-medium italic">English Paradise — Zhou Zhuoqin's Playground!</p>
      </header>

      {/* Buddy Selection */}
      <div className="w-full flex justify-center gap-4 md:gap-6 mb-4 overflow-x-auto py-4 px-2 no-scrollbar">
        {BUDDIES.map(buddy => (
          <Avatar 
            key={buddy.id}
            buddy={buddy} 
            isActive={selectedBuddyIds.includes(buddy.id)}
            onClick={() => toggleBuddy(buddy.id)}
          />
        ))}
      </div>

      {/* Mode Selection */}
      <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-3 mb-8 px-2">
        {PRACTICE_MODES.map(mode => (
          <button
            key={mode.id}
            onClick={() => handleModeChange(mode.id)}
            className={`p-3 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 bouncy ${
              currentMode === mode.id 
                ? 'bg-sky-500 border-sky-600 text-white shadow-lg scale-105' 
                : 'bg-white border-slate-100 text-slate-600 hover:border-sky-300'
            }`}
          >
            <span className="text-2xl">{mode.icon}</span>
            <span className="text-xs font-black uppercase tracking-tight">{mode.name}</span>
            <span className={`text-[9px] font-medium ${currentMode === mode.id ? 'text-sky-100' : 'text-slate-400'}`}>
              {mode.description}
            </span>
          </button>
        ))}
      </div>

      {/* Main Interactive Zone */}
      <main className="w-full flex-grow flex flex-col items-center justify-center">
        
        {/* Friend Party View - Full width and centered */}
        <div className="w-full max-w-2xl bg-white/50 backdrop-blur-sm rounded-[3rem] p-8 md:p-12 flex flex-col items-center gap-8 border-4 border-white shadow-xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-transparent to-white/20 pointer-events-none"></div>
          
          <div className="flex flex-wrap justify-center items-center gap-6 md:gap-12 min-h-[16rem]">
            {selectedBuddies.map((buddy, index) => (
              <div key={buddy.id} className="relative group">
                <div className={`absolute -inset-6 rounded-full blur-3xl opacity-40 ${buddy.color} animate-pulse`}></div>
                <img 
                  src={buddy.avatar} 
                  alt={buddy.name} 
                  className={`rounded-full border-4 border-white shadow-2xl bg-white p-3 relative z-10 transition-all duration-300
                    ${selectedBuddies.length === 1 ? 'w-56 h-56 md:w-72 md:h-72' : 'w-28 h-28 md:w-40 md:h-40'}
                    ${isSpeaking ? 'animate-wave scale-110' : 'scale-100'}`}
                  style={{ animationDelay: `${index * 0.2}s` }}
                />
                <div className={`absolute -bottom-3 left-1/2 -translate-x-1/2 z-20 px-4 py-1 rounded-full text-white text-sm font-bold shadow-md ${buddy.color}`}>
                  {buddy.name.split(' ')[0]}
                </div>
              </div>
            ))}
          </div>
          
          <div className="text-center z-10 w-full">
            <h2 className="text-3xl font-kids text-slate-700 mb-2">
              {selectedBuddies.length > 1 ? "Zootopia Party! 🎈" : selectedBuddies[0].name}
            </h2>
            <div className="flex items-center justify-center gap-3">
               <span className="bg-sky-100 text-sky-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                 Mode: {activeModeInfo.name}
               </span>
               {isActive && (
                 <div className="flex items-center gap-2 bg-green-100 px-3 py-1 rounded-full">
                   <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                   <span className="text-green-600 text-[10px] font-bold uppercase">Live</span>
                 </div>
               )}
            </div>
          </div>

          <Visualizer isListening={isListening} isSpeaking={isSpeaking} color={selectedBuddies[0].color} />

          <div className="w-full flex justify-center pt-4">
            {!isActive ? (
              <button 
                onClick={startConversation}
                className="w-full max-w-sm px-10 py-6 text-3xl text-white font-black rounded-[2rem] shadow-[0_12px_0_rgb(37,99,235)] bg-blue-500 hover:bg-blue-600 hover:shadow-[0_10px_0_rgb(37,99,235)] active:translate-y-1 active:shadow-none transition-all bouncy flex items-center justify-center gap-4"
              >
                <span>TALK NOW!</span>
                <span className="text-4xl">🎤</span>
              </button>
            ) : (
              <button 
                onClick={stopConversation}
                className="w-full max-w-sm px-10 py-6 text-3xl text-white font-black rounded-[2rem] shadow-[0_12px_0_rgb(220,38,38)] bg-red-500 hover:bg-red-600 hover:shadow-[0_10px_0_rgb(220,38,38)] active:translate-y-1 active:shadow-none transition-all bouncy flex items-center justify-center gap-4"
              >
                <span>STOP</span>
                <span className="text-4xl">👋</span>
              </button>
            )}
          </div>
          
          {!isActive && (
             <p className="text-slate-400 text-sm font-medium animate-bounce mt-4">
               Click the button to start your English adventure!
             </p>
          )}
        </div>
      </main>

      <footer className="mt-12 mb-6 w-full text-center">
        <p className="text-slate-400 text-sm font-medium tracking-wide">✨ Practice makes perfect! Speak English every day! ✨</p>
      </footer>
    </div>
  );
};

export default App;
