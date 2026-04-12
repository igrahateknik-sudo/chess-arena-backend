/**
 * FIDE-standard ELO calculation
 */
import logger from './logger';

const K_FACTOR = {
  new: 40, // < 30 games or rating < 1000
  standard: 20, // < 2400
  master: 10, // >= 2400
};

function getKFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < 30 || rating < 1000) return K_FACTOR.new;
  if (rating >= 2400) return K_FACTOR.master;
  return K_FACTOR.standard;
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function calculateEloChange(
  playerRating: number,
  opponentRating: number,
  result: 'win' | 'loss' | 'draw',
  gamesPlayed = 30,
): number {
  const K = getKFactor(playerRating, gamesPlayed);
  const expected = expectedScore(playerRating, opponentRating);
  const actual = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  return Math.round(K * (actual - expected));
}

export function calculateBothElo(
  whiteRating: number,
  blackRating: number,
  result: 'white' | 'black' | 'draw',
): { whiteChange: number; blackChange: number } {
  logger.info(
    `[ELO] Menghitung perubahan rating: White(${whiteRating}) vs Black(${blackRating}) Result: ${result}`,
  );
  // result: 'white' | 'black' | 'draw'
  const whiteResult = result === 'white' ? 'win' : result === 'draw' ? 'draw' : 'loss';
  const blackResult = result === 'black' ? 'win' : result === 'draw' ? 'draw' : 'loss';

  return {
    whiteChange: calculateEloChange(whiteRating, blackRating, whiteResult),
    blackChange: calculateEloChange(blackRating, whiteRating, blackResult),
  };
}
