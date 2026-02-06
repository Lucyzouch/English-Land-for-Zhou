
import React from 'react';
import { Buddy } from '../types';

interface AvatarProps {
  buddy: Buddy;
  isActive: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

export const Avatar: React.FC<AvatarProps> = ({ buddy, isActive, size = 'md', onClick }) => {
  const sizeClasses = {
    sm: 'w-16 h-16 border-2',
    md: 'w-24 h-24 border-4',
    lg: 'w-48 h-48 border-8'
  };

  return (
    <div 
      onClick={onClick}
      className={`relative cursor-pointer transition-all duration-300 transform rounded-2xl overflow-hidden bouncy shadow-lg
        ${sizeClasses[size]} 
        ${isActive ? 'scale-110 border-yellow-400 ring-4 ring-yellow-200 z-10' : 'grayscale-[10%] border-white hover:scale-105'}`}
    >
      <div className={`w-full h-full p-1 bg-white flex items-center justify-center`}>
        <img 
          src={buddy.avatar} 
          alt={buddy.name} 
          className="w-full h-full object-contain"
        />
      </div>
      
      {isActive && (
        <div className="absolute top-1 right-1 bg-yellow-400 rounded-full p-1 shadow-sm">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
      )}

      <div className={`absolute bottom-0 left-0 right-0 py-1 text-center text-[10px] font-bold text-white ${buddy.color}`}>
        {buddy.name.split(' ')[0]}
      </div>
    </div>
  );
};
