import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { toPlain } from '../utils/plain';
import { applyMerge, buildMergePlan, markHistoryRedone, type ConflictChoices, type MergeOutcome, type MergePlan } from '../utils/merge';
import type { ChangeEntry, MergeHistoryItem, StageKey } from '../types/sync';

interface MergeState {
  /** 解析对端备份后生成的对账预案（null = 尚未载入） */
  plan: MergePlan | null;
  /** 冲突操作员选择：stage → matchKey → 本机/对端 */
  choices: ConflictChoices;
  applying: boolean;
  history: MergeHistoryItem[];
  changes: ChangeEntry[];
}

/** 离线对账合并：预案、冲突选择、未选内容后补历史、变更摘要流水 */
export const useMergeStore = defineStore('merge', {
  state: (): MergeState => ({
    plan: null,
    choices: { boards: {}, chambers: {}, lacquers: {}, stringings: {} },
    applying: false,
    history: [],
    changes: [],
  }),

  getters: {
    /** 尚未选择的冲突条数 */
    unresolvedCount(state): number {
      if (!state.plan) return 0;
      return state.plan.conflicts.filter((c) => !state.choices[c.stage]?.[c.matchKey]).length;
    },
    pendingHistory(state): MergeHistoryItem[] {
      return state.history.filter((h) => !h.redone);
    },
  },

  actions: {
    /** 读取对端导出的 JSON，生成按琴号对账的合并预案 */
    async loadPlan(text: string): Promise<MergePlan> {
      const plan = await buildMergePlan(text);
      this.plan = plan;
      this.choices = { boards: {}, chambers: {}, lacquers: {}, stringings: {} };
      return plan;
    },

    clearPlan() {
      this.plan = null;
      this.choices = { boards: {}, chambers: {}, lacquers: {}, stringings: {} };
    },

    choose(stage: StageKey, matchKey: string, side: 'local' | 'incoming') {
      this.choices[stage][matchKey] = side;
    },

    /** 全部冲突统一选一边（操作员仍可逐条改） */
    chooseAll(side: 'local' | 'incoming') {
      if (!this.plan) return;
      for (const c of this.plan.conflicts) {
        this.choices[c.stage][c.matchKey] = side;
      }
    },

    async apply(): Promise<MergeOutcome> {
      if (!this.plan) throw new Error('尚未载入对端备份');
      this.applying = true;
      try {
        const outcome = await applyMerge(this.plan, toPlain(this.choices));
        await this.hydrateHistory();
        await this.hydrateChanges();
        return outcome;
      } finally {
        this.applying = false;
      }
    },

    async hydrateHistory() {
      this.history = await db.mergeHistory.orderBy('createdAt').reverse().toArray();
    },

    async hydrateChanges() {
      this.changes = await db.changes.orderBy('lastAt').reverse().toArray();
    },

    async markRedone(id: string) {
      await markHistoryRedone(id);
      await this.hydrateHistory();
    },

    async removeHistory(id: string) {
      await db.mergeHistory.delete(id);
      await this.hydrateHistory();
    },
  },
});
