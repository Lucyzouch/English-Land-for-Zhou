
import React from 'react';

interface VisualizerProps {
  isListening: boolean;
  isSpeaking: boolean;
  color?: string;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isListening, isSpeaking, color = 'bg-blue-400' }) => {
  return (
    <div className="flex items-center justify-center gap-1 h-12 w-full">
      {[...Array(8)].map((_, i) => (
        <div
          key={i}
          className={`w-2 rounded-full transition-all duration-150 ${
            isListening || isSpeaking ? color : 'bg-gray-200'
          }`}
          style={{
            height: isListening || isSpeaking 
              ? `${Math.random() * 100 + 20}%` 
              : '20%',
            transitionDelay: `${i * 50}ms`,
            animation: isListening || isSpeaking ? 'wave 1s infinite' : 'none',
            animationDelay: `${i * 0.1}s`
          }}
        />
      ))}
    </div>
  );
};
