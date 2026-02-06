
import React from 'react';

interface VisualizerProps {
  isListening: boolean;
  isSpeaking: boolean;
  color?: string;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isListening, isSpeaking, color = 'bg-blue-400' }) => {
  const isActive = isListening || isSpeaking;

  return (
    <div className="flex items-center justify-center gap-2 h-16 w-full max-w-xs">
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className={`w-2.5 rounded-full transition-all duration-300 shadow-sm ${
            isActive ? color : 'bg-slate-200'
          }`}
          style={{
            height: isActive 
              ? `${Math.random() * 80 + 20}%` 
              : '15%',
            opacity: isActive ? (1 - (Math.abs(i - 6) / 10)) : 0.3,
            transitionDelay: `${i * 30}ms`,
            animation: isActive ? 'wave 1.2s infinite ease-in-out' : 'none',
            animationDelay: `${i * 0.08}s`
          }}
        />
      ))}
    </div>
  );
};
