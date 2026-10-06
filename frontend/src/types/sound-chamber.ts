/** 天地柱位置 */
export type PostPos = '天柱偏左' | '天柱中' | '天柱偏右' | '未定';

/** 槽腹尺寸（掏膛） */
export interface SoundChamber {
  id: string;
  /** 琴号 */
  guqinNo: string;
  /** 纳音处面板厚度（mm） */
  nayinThickness: number;
  /** 龙池处面板厚度（mm） */
  longchiThickness: number;
  /** 凤沼处面板厚度（mm） */
  fengzhaoThickness: number;
  /** 槽腹深度（mm） */
  chamberDepth: number;
  /** 天地柱位置 */
  postPos: PostPos;
  /** 龙池凤沼尺寸（mm，长×宽） */
  poolSize: string;
  /** 掏膛日期 ISO */
  carvedAt: string;
  /** 掏膛人 */
  carver: string;
  /** 备注 */
  remark?: string;
  /** 演示样例标记：合并导入时正式记录不会被带此标记的样例改写 */
  isDemo?: boolean;
}

export const POST_POSITIONS: PostPos[] = ['天柱偏左', '天柱中', '天柱偏右', '未定'];

/** 三处厚度标注点（用于剖面 SVG 标注） */
export interface ThicknessMark {
  key: 'nayinThickness' | 'longchiThickness' | 'fengzhaoThickness';
  label: string;
  value: number;
}
