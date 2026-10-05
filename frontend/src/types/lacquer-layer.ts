/** 灰胎髹漆遍次 */
export interface LacquerLayer {
  id: string;
  /** 琴号 */
  guqinNo: string;
  /** 遍次（从 1 开始，追加时自动 +1） */
  seq: number;
  /** 灰胎配比（鹿角霜:生漆） */
  mixRatio: string;
  /** 荫房温度（℃） */
  curingTemp: number;
  /** 荫房湿度（%） */
  curingHumidity: number;
  /** 打磨目数 */
  polishGrit: number;
  /** 本遍厚度（mm） */
  layerThickness: number;
  /** 累计厚度（mm），由本遍及之前各遍累加 */
  totalThickness: number;
  /** 施工日期 ISO */
  appliedAt: string;
  /** 髹漆人 */
  operator: string;
  /** 备注 */
  remark?: string;
}

/** 灰胎阶段常用配比 */
export const MIX_RATIOS: string[] = ['1:1', '1:1.2', '1:1.5', '1:2', '纯生漆'];
