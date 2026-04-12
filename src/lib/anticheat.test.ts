import { analyzeMoveTimings, validateGameIntegrity } from './anticheat';

describe('Anti-cheat Logic', () => {
  describe('analyzeMoveTimings', () => {
    test('should flag fast moves if average is below threshold', () => {
      // 12 moves (6 each for white/black)
      const moveHistory = [];
      let timestamp = 1000000;
      for (let i = 0; i < 24; i++) {
        // Each move takes 0.3 seconds (300ms) - below 0.5s threshold
        timestamp += 300;
        moveHistory.push({ from: 'e2', to: 'e4', timestamp });
      }

      const result = analyzeMoveTimings(moveHistory, 'white');

      expect(result.flags).toContain('FAST_MOVES');
      expect(result.score).toBeGreaterThan(0);
    });

    test('should flag consistent timing (bot-like behavior)', () => {
      const moveHistory = [];
      let timestamp = 1000000;
      for (let i = 0; i < 30; i++) {
        // Exactly 2 seconds per move - zero variance
        timestamp += 2000;
        moveHistory.push({ from: 'e2', to: 'e4', timestamp });
      }

      const result = analyzeMoveTimings(moveHistory, 'white');

      expect(result.flags).toContain('CONSISTENT_TIMING');
      expect(result.score).toBeGreaterThan(30);
    });
  });

  describe('validateGameIntegrity', () => {
    test('should return valid for correct move sequence', () => {
      const moveHistory = [
        { from: 'e2', to: 'e4', san: 'e4' },
        { from: 'e7', to: 'e5', san: 'e5' },
        { from: 'g1', to: 'f3', san: 'Nf3' },
      ];

      const result = validateGameIntegrity(moveHistory);
      expect(result.valid).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    test('should flag illegal moves', () => {
      const moveHistory = [
        { from: 'e2', to: 'e4', san: 'e4' },
        { from: 'e2', to: 'e5', san: 'e5' }, // Illegal: pawn cannot move to e5 in one go
      ];

      const result = validateGameIntegrity(moveHistory);
      expect(result.valid).toBe(false);
      expect(result.flags[0]).toContain('INVALID_MOVE');
    });
  });
});
