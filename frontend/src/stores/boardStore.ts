import { defineStore } from 'pinia';
import { db, getDeviceId } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { pairBoards, boardUsable } from '../utils/wood';
import { createSummary, diffSummary, normalizeSyncRow, recordChange, stampChange } from '../utils/sync';
import type { BoardPart, BoardPair, WoodBoard, WoodDefect, WoodGrain, WoodSpecies } from '../types/wood-board';

export interface BoardInput {
  boardNo: string;
  guqinNo: string;
  part: BoardPart;
  species: WoodSpecies;
  dryYears: number;
  thicknessMm: number;
  grain: WoodGrain;
  defect: WoodDefect;
  receivedAt?: string;
  remark?: string;
}

interface BoardState {
  boards: WoodBoard[];
  hydrated: boolean;
}

/** 板材与面板/底板配对 */
export const useBoardStore = defineStore('board', {
  state: (): BoardState => ({ boards: [], hydrated: false }),

  getters: {
    /** 面板与底板按琴号配对并回显含水率 */
    pairs(state): BoardPair[] {
      return pairBoards(state.boards);
    },
    /** 可用板材数（无裂纹且阴干达标） */
    usableCount(state): number {
      return state.boards.filter(boardUsable).length;
    },
    guqinNos(state): string[] {
      return Array.from(new Set(state.boards.map((b) => b.guqinNo))).sort();
    },
    boardsOf(state) {
      return (guqinNo: string): WoodBoard[] => state.boards.filter((b) => b.guqinNo === guqinNo);
    },
  },

  actions: {
    async hydrate() {
      const rows = await db.boards.orderBy('boardNo').toArray();
      this.boards = rows.map((r) => normalizeSyncRow('boards', r));
      this.hydrated = true;
    },

    async addBoard(input: BoardInput): Promise<WoodBoard> {
      const deviceId = await getDeviceId();
      const board: WoodBoard = {
        id: uid('board'),
        boardNo: input.boardNo.trim(),
        guqinNo: input.guqinNo.trim(),
        part: input.part,
        species: input.species,
        dryYears: Number(input.dryYears) || 0,
        thicknessMm: Number(input.thicknessMm) || 0,
        grain: input.grain,
        defect: input.defect,
        receivedAt: input.receivedAt ?? new Date().toISOString(),
        remark: input.remark?.trim() || undefined,
      };
      const summary = createSummary('boards', board as unknown as Record<string, unknown>);
      const rev = stampChange(board, undefined, summary, deviceId);
      await db.boards.put(toPlain(board));
      await recordChange({ stage: 'boards', id: board.id, guqinNo: board.guqinNo, rev, summary, deviceId });
      this.boards = [normalizeSyncRow('boards', board), ...this.boards];
      return board;
    },

    async updateBoard(id: string, patch: Partial<BoardInput>) {
      const current = this.boards.find((b) => b.id === id);
      if (!current) return;
      const deviceId = await getDeviceId();
      const next: WoodBoard = { ...current, ...patch };
      const summary = diffSummary('boards', current as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>)
        ?? current.summary
        ?? '保存（内容无变化）';
      const rev = stampChange(next, current, summary, deviceId);
      await db.boards.put(toPlain(next));
      await recordChange({ stage: 'boards', id, guqinNo: next.guqinNo, rev, summary, deviceId });
      this.boards = this.boards.map((b) => (b.id === id ? normalizeSyncRow('boards', next) : b));
    },

    async removeBoard(id: string) {
      await db.boards.delete(id);
      this.boards = this.boards.filter((b) => b.id !== id);
    },

    /** 配对绑定：把某块板材与同琴号的另一部位板材绑定 */
    async pair(panelId: string, baseId: string) {
      const panel = this.boards.find((b) => b.id === panelId);
      const base = this.boards.find((b) => b.id === baseId);
      if (!panel || !base) return;
      const guqinNo = panel.guqinNo;
      const deviceId = await getDeviceId();
      const updated = [panel, base].map((b) => {
        const next: WoodBoard = { ...b, guqinNo };
        const summary = diffSummary('boards', b as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>)
          ?? b.summary
          ?? '配对绑定';
        const rev = stampChange(next, b, summary, deviceId);
        return { row: next, rev, summary };
      });
      for (const { row, rev, summary } of updated) {
        await db.boards.put(toPlain(row));
        await recordChange({ stage: 'boards', id: row.id, guqinNo, rev, summary, deviceId });
      }
      this.boards = this.boards.map((b) => {
        const hit = updated.find((u) => u.row.id === b.id);
        return hit ? normalizeSyncRow('boards', hit.row) : b;
      });
    },
  },
});
