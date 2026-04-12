'use client';

import { useEffect, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

export function ChessBoardVisual() {
  const [chess] = useState(() => new Chess());
  const [position, setPosition] = useState('start');
  const [moveIndex, setMoveIndex] = useState(0);
  const sequence = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];

  useEffect(() => {
    const timer = setInterval(() => {
      if (moveIndex >= sequence.length) {
        chess.reset();
        setPosition(chess.fen());
        setMoveIndex(0);
        return;
      }
      try {
        chess.move(sequence[moveIndex]);
        setPosition(chess.fen());
        setMoveIndex((v) => v + 1);
      } catch (e) {
        chess.reset();
        setPosition('start');
        setMoveIndex(0);
      }
    }, 1300);
    return () => clearInterval(timer);
  }, [moveIndex, chess]);

  return (
    <div className="w-full h-full relative">
      {/* Gold corner accents */}
      <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-amber-400/60 rounded-tl-2xl z-10 pointer-events-none" />
      <div className="absolute top-0 right-0 w-12 h-12 border-t-2 border-r-2 border-amber-400/60 rounded-tr-2xl z-10 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-12 h-12 border-b-2 border-l-2 border-amber-400/60 rounded-bl-2xl z-10 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-amber-400/60 rounded-br-2xl z-10 pointer-events-none" />
      
      <Chessboard
        position={position}
        arePiecesDraggable={false}
        areArrowsAllowed={false}
        boardOrientation="white"
        customDarkSquareStyle={{ backgroundColor: '#7b5a3e' }}
        customLightSquareStyle={{ backgroundColor: '#f0d9b5' }}
        customBoardStyle={{ borderRadius: '14px' }}
      />

      {/* Live indicator overlay */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 z-20">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/50" />
        <span className="text-[10px] text-emerald-400 font-bold tracking-wider uppercase">Demo Live Match</span>
      </div>
    </div>
  );
}
