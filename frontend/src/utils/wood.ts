import type { BoardPair, WoodBoard } from '../types/wood-board';

/** 由阴干年限推算含水率（%）：阴干越久含水率越低，收敛到 5% 左右 */
export function moisturePctOf(dryYears: number): number {
  const years = Number(dryYears) || 0;
  const pct = 14.5 - years * 1.15;
  return Number(Math.min(14.5, Math.max(5, pct)).toFixed(1));
}

/** 是否为可用板材：无裂纹且阴干 ≥ 3 年 */
export function boardUsable(board: WoodBoard): boolean {
  return board.defect !== '裂纹' && board.dryYears >= 3;
}

/** 面板与底板按琴号配对 */
export function pairBoards(boards: WoodBoard[]): BoardPair[] {
  const map = new Map<string, BoardPair>();
  boards.forEach((board) => {
    const pair = map.get(board.guqinNo) ?? {
      guqinNo: board.guqinNo,
      species: board.species,
      moisturePct: 0,
      matched: false,
    };
    if (board.part === '面板') {
      pair.panel = board;
    } else {
      pair.base = board;
    }
    map.set(board.guqinNo, pair);
  });

  return Array.from(map.values())
    .map((pair) => {
      const matched = Boolean(pair.panel && pair.base);
      const years = Math.max(pair.panel?.dryYears ?? 0, pair.base?.dryYears ?? 0);
      return { ...pair, matched, moisturePct: moisturePctOf(years) };
    })
    .sort((a, b) => a.guqinNo.localeCompare(b.guqinNo));
}

/** 面板/底板厚度差（mm），差值过大需再刨削 */
export function thicknessGap(pair: BoardPair): number {
  if (!pair.panel || !pair.base) {
    return 0;
  }
  return Number(Math.abs(pair.panel.thicknessMm - pair.base.thicknessMm).toFixed(1));
}
