import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { PostPos, SoundChamber, ThicknessMark } from '../types/sound-chamber';

export interface ChamberInput {
  guqinNo: string;
  nayinThickness: number;
  longchiThickness: number;
  fengzhaoThickness: number;
  chamberDepth: number;
  postPos: PostPos;
  poolSize: string;
  carvedAt?: string;
  carver: string;
  remark?: string;
}

interface ChamberState {
  chambers: SoundChamber[];
  hydrated: boolean;
}

/** 槽腹尺寸与剖面派生值 */
export const useChamberStore = defineStore('chamber', {
  state: (): ChamberState => ({ chambers: [], hydrated: false }),

  getters: {
    byGuqin(state) {
      return (guqinNo: string): SoundChamber | undefined => state.chambers.find((c) => c.guqinNo === guqinNo);
    },
    /** 三处厚度标注点，供 DimensionChart 绘制剖面标注 */
    marksOf(state) {
      return (guqinNo: string): ThicknessMark[] => {
        const chamber = state.chambers.find((c) => c.guqinNo === guqinNo);
        if (!chamber) return [];
        return [
          { key: 'nayinThickness', label: '纳音', value: chamber.nayinThickness },
          { key: 'longchiThickness', label: '龙池', value: chamber.longchiThickness },
          { key: 'fengzhaoThickness', label: '凤沼', value: chamber.fengzhaoThickness },
        ];
      };
    },
    /** 三处厚度极差（mm），差值过大说明掏膛不均 */
    thicknessSpread(state) {
      return (guqinNo: string): number => {
        const chamber = state.chambers.find((c) => c.guqinNo === guqinNo);
        if (!chamber) return 0;
        const list = [chamber.nayinThickness, chamber.longchiThickness, chamber.fengzhaoThickness];
        return Number((Math.max(...list) - Math.min(...list)).toFixed(1));
      };
    },
    /** 深径比：槽腹深度 / 面板平均厚度 */
    depthRatio(state) {
      return (guqinNo: string): number => {
        const chamber = state.chambers.find((c) => c.guqinNo === guqinNo);
        if (!chamber) return 0;
        const avg = (chamber.nayinThickness + chamber.longchiThickness + chamber.fengzhaoThickness) / 3;
        return avg > 0 ? Number((chamber.chamberDepth / avg).toFixed(2)) : 0;
      };
    },
  },

  actions: {
    async hydrate() {
      this.chambers = await db.chambers.orderBy('carvedAt').reverse().toArray();
      this.hydrated = true;
    },

    /** 每张琴一份槽腹记录：存在则更新，不存在则新增 */
    async saveChamber(input: ChamberInput): Promise<SoundChamber> {
      const existed = this.chambers.find((c) => c.guqinNo === input.guqinNo);
      const chamber: SoundChamber = {
        id: existed?.id ?? uid('chamber'),
        guqinNo: input.guqinNo.trim(),
        nayinThickness: Number(input.nayinThickness) || 0,
        longchiThickness: Number(input.longchiThickness) || 0,
        fengzhaoThickness: Number(input.fengzhaoThickness) || 0,
        chamberDepth: Number(input.chamberDepth) || 0,
        postPos: input.postPos,
        poolSize: input.poolSize.trim(),
        carvedAt: input.carvedAt ?? existed?.carvedAt ?? new Date().toISOString(),
        carver: input.carver.trim(),
        remark: input.remark?.trim() || undefined,
      };
      await db.chambers.put(toPlain(chamber));
      this.chambers = existed
        ? this.chambers.map((c) => (c.id === chamber.id ? chamber : c))
        : [chamber, ...this.chambers];
      return chamber;
    },

    async removeChamber(id: string) {
      await db.chambers.delete(id);
      this.chambers = this.chambers.filter((c) => c.id !== id);
    },
  },
});
