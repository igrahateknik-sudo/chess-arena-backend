import { calculateEloChange, calculateBothElo } from './elo';

describe('ELO Calculation Logic', () => {
  test('Winner should gain points, loser should lose points', () => {
    const whiteRating = 1200;
    const blackRating = 1200;

    const { whiteChange, blackChange } = calculateBothElo(whiteRating, blackRating, 'white');

    expect(whiteChange).toBeGreaterThan(0);
    expect(blackChange).toBeLessThan(0);
    // Standard K factor for 1200 is 20.
    // Win against equal is K * (1 - 0.5) = 20 * 0.5 = 10
    expect(whiteChange).toBe(10);
    expect(blackChange).toBe(-10);
  });

  test('Draw should result in minimal change for equal ratings', () => {
    const whiteRating = 1500;
    const blackRating = 1500;

    const { whiteChange, blackChange } = calculateBothElo(whiteRating, blackRating, 'draw');

    expect(whiteChange).toBe(0);
    expect(blackChange).toBe(0);
  });

  test('Underdog should gain more points when winning against a pro', () => {
    const proRating = 2400; // Strong player
    const casualRating = 1000; // Weak player

    // Casual wins against pro
    // K-factor for casual (1000) is 20 (standard) or 40 (new)
    // Games played = 100, rating >= 1000 => K is 20
    const changeForCasual = calculateEloChange(casualRating, proRating, 'win', 100);
    const changeForPro = calculateEloChange(proRating, casualRating, 'loss', 100);

    // Against much stronger opponent, it should be higher than 10
    expect(changeForCasual).toBeGreaterThan(15);
    expect(changeForPro).toBeLessThan(-5); // Pro loses fewer points due to K-factor 10
  });
});
