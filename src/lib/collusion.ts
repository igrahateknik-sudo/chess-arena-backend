/**
 * Collusion Detection — Match-Fixing & Material Gifting
 */

import { Chess, PieceSymbol, Color } from 'chess.js';
import prisma from './prisma';

// Nilai bidak (centipawn)
const PIECE_VALUES: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// ── Helpers ────────────────────────────────────────────────────────────────

function countMaterial(chess: Chess) {
  const board = chess.board();
  const scores: Record<Color, number> = { w: 0, b: 0 };
  for (const row of board) {
    for (const sq of row) {
      if (sq) scores[sq.color] += PIECE_VALUES[sq.type] || 0;
    }
  }
  return scores;
}

// ── Detector 1: Repeat Pair ────────────────────────────────────────────────

export async function detectRepeatPair(userAId: string, userBId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  try {
    const games = await prisma.game.findMany({
      where: {
        OR: [
          { white_id: userAId, black_id: userBId },
          { white_id: userBId, black_id: userAId },
        ],
        status: 'finished',
        ended_at: { gte: thirtyDaysAgo },
      },
      orderBy: { ended_at: 'desc' },
      select: {
        id: true,
        winner: true,
        ended_at: true,
        move_history: true,
        white_id: true,
        black_id: true,
      },
    });

    if (games.length < 5) return { flags: [], score: 0 };

    const gameCount = games.length;
    let aWins = 0,
      bWins = 0,
      draws = 0;
    for (const g of games) {
      const aIsWhite = g.white_id === userAId;
      if (g.winner === 'draw') {
        draws++;
        continue;
      }
      const aWon = (g.winner === 'white' && aIsWhite) || (g.winner === 'black' && !aIsWhite);
      if (aWon) aWins++;
      else bWins++;
    }

    const flags: string[] = [];
    let score = 0;

    if (gameCount > 15) {
      flags.push(`REPEAT_PAIR:${gameCount}games`);
      score += gameCount > 25 ? 35 : 20;
    } else if (gameCount > 10) {
      flags.push(`REPEAT_PAIR:${gameCount}games`);
      score += 15;
    }

    const total = aWins + bWins + draws;
    const aWinRate = total > 0 ? aWins / total : 0;
    const bWinRate = total > 0 ? bWins / total : 0;

    if (aWinRate >= 0.8 && total >= 8) {
      flags.push(`ONE_SIDED_WINS:A_wins_${Math.round(aWinRate * 100)}%`);
      score += aWinRate >= 0.9 ? 40 : 25;
    } else if (bWinRate >= 0.8 && total >= 8) {
      flags.push(`ONE_SIDED_WINS:B_wins_${Math.round(bWinRate * 100)}%`);
      score += bWinRate >= 0.9 ? 40 : 25;
    }

    const shortGames = games.filter((g) => {
      const moves = (g.move_history as any[]) || [];
      return moves.length <= 8;
    });

    if (shortGames.length >= 3 && shortGames.length / gameCount >= 0.3) {
      flags.push(`FAST_RESIGN_PATTERN:${shortGames.length}of${gameCount}`);
      score += 30;
    }

    return { flags, score, stats: { gameCount, aWins, bWins, draws } };
  } catch (e: any) {
    console.error('[Collusion:detectRepeatPair]', e.message);
    return { flags: [], score: 0 };
  }
}

// ── Detector 2: Material Gifting ────────────────────────────────────────────

export function detectMaterialGifting(moveHistory: any[]) {
  if (!moveHistory || moveHistory.length < 6) return { flags: [], score: 0 };

  const chess = new Chess();
  const gifts: Record<'white' | 'black', any[]> = { white: [], black: [] };

  for (let i = 0; i < moveHistory.length; i++) {
    const m = moveHistory[i];
    const color: 'white' | 'black' = i % 2 === 0 ? 'white' : 'black';
    const colorChar: Color = i % 2 === 0 ? 'w' : 'b';

    const matBefore = countMaterial(chess);

    let result;
    try {
      result = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    } catch {
      break;
    }
    if (!result) break;

    const matAfter = countMaterial(chess);
    const ownDelta = matAfter[colorChar] - matBefore[colorChar];
    if (ownDelta <= -300 && !result.captured) {
      gifts[color].push({
        move: i,
        san: result.san,
        drop: -ownDelta,
      });
    }
  }

  const flags: string[] = [];
  let score = 0;

  for (const color of ['white', 'black'] as const) {
    if (gifts[color].length >= 2) {
      flags.push(`MATERIAL_GIFT:${color.toUpperCase()}:${gifts[color].length}times`);
      score += gifts[color].length >= 3 ? 40 : 25;
    }
  }

  return { flags, score, gifts };
}

// ── Main: runCollusionDetection ────────────────────────────────────────────

export async function runCollusionDetection(
  gameId: string,
  whiteId: string,
  blackId: string,
  moveHistory: any[],
  endReason: string,
) {
  try {
    console.log(`[Collusion] Analyzing game ${gameId}...`);

    const pairResult = await detectRepeatPair(whiteId, blackId);
    const giftResult = detectMaterialGifting(moveHistory);
    const currentGameShort = moveHistory.length <= 8 && endReason === 'resign';

    const combined: any = {
      white: {
        flags: [
          ...pairResult.flags,
          ...giftResult.flags.filter((f) => f.includes('WHITE')),
          ...(currentGameShort ? ['FAST_RESIGN:current_game'] : []),
        ],
        score: pairResult.score + giftResult.flags.filter((f) => f.includes('WHITE')).length * 20,
      },
      black: {
        flags: [
          ...pairResult.flags,
          ...giftResult.flags.filter((f) => f.includes('BLACK')),
          ...(currentGameShort ? ['FAST_RESIGN:current_game'] : []),
        ],
        score: pairResult.score + giftResult.flags.filter((f) => f.includes('BLACK')).length * 20,
      },
    };

    combined.white.suspicious = combined.white.score >= 25;
    combined.black.suspicious = combined.black.score >= 25;

    if (pairResult.flags.length > 0 || giftResult.flags.length > 0) {
      console.warn('[Collusion] Suspicious patterns detected:', {
        gameId,
        pairFlags: pairResult.flags,
        giftFlags: giftResult.flags,
        stats: pairResult.stats,
      });

      const userA = whiteId < blackId ? whiteId : blackId;
      const userB = whiteId < blackId ? blackId : whiteId;

      await prisma.collusionFlag
        .create({
          data: {
            game_id: gameId,
            user_id_a: userA,
            user_id_b: userB,
            pair_flags: JSON.stringify(pairResult.flags),
            gift_flags: JSON.stringify(giftResult.flags),
            pair_score: pairResult.score,
            pair_stats: JSON.stringify(pairResult.stats),
            detected_at: new Date(),
            reviewed: false,
          },
        })
        .catch((e) => console.error('[Collusion] DB insert failed:', e.message));
    }

    return combined;
  } catch (err: any) {
    console.error('[Collusion] runCollusionDetection error:', err.message);
    return {
      white: { flags: [], score: 0, suspicious: false },
      black: { flags: [], score: 0, suspicious: false },
    };
  }
}
