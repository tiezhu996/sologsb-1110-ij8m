/** 板材部位 */
export type BoardPart = '面板' | '底板';

/** 木材树种 */
export type WoodSpecies = '桐木' | '杉木' | '梓木';

/** 木纹 */
export type WoodGrain = '直纹' | '水波纹';

/** 缺陷 */
export type WoodDefect = '无' | '节疤' | '裂纹';

/** 板材（面板 / 底板） */
export interface WoodBoard {
  id: string;
  /** 板材号 */
  boardNo: string;
  /** 所属琴号：同一琴号下面板与底板配对绑定 */
  guqinNo: string;
  /** 面板 / 底板 */
  part: BoardPart;
  /** 树种 */
  species: WoodSpecies;
  /** 阴干年限（年） */
  dryYears: number;
  /** 厚度（mm） */
  thicknessMm: number;
  /** 木纹 */
  grain: WoodGrain;
  /** 缺陷 */
  defect: WoodDefect;
  /** 入库时间 ISO */
  receivedAt: string;
  /** 备注 */
  remark?: string;
}

export const BOARD_PARTS: BoardPart[] = ['面板', '底板'];
export const WOOD_SPECIES: WoodSpecies[] = ['桐木', '杉木', '梓木'];
export const WOOD_GRAINS: WoodGrain[] = ['直纹', '水波纹'];
export const WOOD_DEFECTS: WoodDefect[] = ['无', '节疤', '裂纹'];

/** 配对后的琴坯板材（面板 + 底板 + 含水率回显） */
export interface BoardPair {
  guqinNo: string;
  panel?: WoodBoard;
  base?: WoodBoard;
  species: WoodSpecies | '';
  /** 回显含水率（由阴干年限推算，%） */
  moisturePct: number;
  matched: boolean;
}
