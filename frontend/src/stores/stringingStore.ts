import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { StringDefect, StringType, Stringing, ToneVersion } from '../types/stringing';

export interface StringingInput {
  guqinNo: string;
  stringType: StringType;
  nut: string;
  stringGap: number;
  sanNote: string;
  anNote: string;
  fanNote: string;
  nineVirtues: string;
  defects: StringDefect[];
  strungAt?: string;
  operator: string;
  /** 保存时是否记录一条评语历史版本（用于文字版本对照） */
  keepVersion?: boolean;
}

interface StringingState {
  stringings: Stringing[];
  hydrated: boolean;
}

/** 上弦与文字评语（纯文本，不做音频处理） */
export const useStringingStore = defineStore('stringing', {
  state: (): StringingState => ({ stringings: [], hydrated: false }),

  getters: {
    byGuqin(state) {
      return (guqinNo: string): Stringing | undefined => state.stringings.find((s) => s.guqinNo === guqinNo);
    },
    /** 三段评语 + 九德的文字检索 */
    search(state) {
      return (keyword: string): Stringing[] => {
        const kw = keyword.trim().toLowerCase();
        if (!kw) return state.stringings;
        return state.stringings.filter((s) =>
          [s.guqinNo, s.sanNote, s.anNote, s.fanNote, s.nineVirtues, s.operator, s.defects.join(' ')]
            .join(' ')
            .toLowerCase()
            .includes(kw),
        );
      };
    },
    defectCount(state): number {
      return state.stringings.filter((s) => s.defects.some((d) => d !== '无')).length;
    },
  },

  actions: {
    async hydrate() {
      this.stringings = await db.stringings.orderBy('strungAt').reverse().toArray();
      this.hydrated = true;
    },

    async addStringing(input: StringingInput): Promise<Stringing> {
      const stringing: Stringing = {
        id: uid('stringing'),
        guqinNo: input.guqinNo.trim(),
        stringType: input.stringType,
        nut: input.nut.trim(),
        stringGap: Number(input.stringGap) || 0,
        sanNote: input.sanNote.trim(),
        anNote: input.anNote.trim(),
        fanNote: input.fanNote.trim(),
        nineVirtues: input.nineVirtues.trim(),
        defects: input.defects.length ? input.defects : ['无'],
        strungAt: input.strungAt ?? new Date().toISOString(),
        operator: input.operator.trim(),
        noteVersions: [],
      };
      await db.stringings.put(toPlain(stringing));
      this.stringings = [stringing, ...this.stringings];
      return stringing;
    },

    /** 保存评语：如内容有变化且 keepVersion，则把改动前的评语存入历史版本 */
    async updateStringing(id: string, patch: Partial<StringingInput>) {
      const current = this.stringings.find((s) => s.id === id);
      if (!current) return;
      const notesChanged =
        (patch.sanNote !== undefined && patch.sanNote.trim() !== current.sanNote) ||
        (patch.anNote !== undefined && patch.anNote.trim() !== current.anNote) ||
        (patch.fanNote !== undefined && patch.fanNote.trim() !== current.fanNote) ||
        (patch.nineVirtues !== undefined && patch.nineVirtues.trim() !== current.nineVirtues);

      const versions = [...current.noteVersions];
      if (notesChanged && patch.keepVersion !== false) {
        const version: ToneVersion = {
          id: uid('tone'),
          savedAt: new Date().toISOString(),
          sanNote: current.sanNote,
          anNote: current.anNote,
          fanNote: current.fanNote,
          nineVirtues: current.nineVirtues,
        };
        versions.unshift(version);
      }

      const next: Stringing = {
        ...current,
        guqinNo: patch.guqinNo?.trim() ?? current.guqinNo,
        stringType: patch.stringType ?? current.stringType,
        nut: patch.nut?.trim() ?? current.nut,
        stringGap: patch.stringGap !== undefined ? Number(patch.stringGap) : current.stringGap,
        sanNote: patch.sanNote?.trim() ?? current.sanNote,
        anNote: patch.anNote?.trim() ?? current.anNote,
        fanNote: patch.fanNote?.trim() ?? current.fanNote,
        nineVirtues: patch.nineVirtues?.trim() ?? current.nineVirtues,
        defects: patch.defects?.length ? patch.defects : current.defects,
        strungAt: patch.strungAt ?? current.strungAt,
        operator: patch.operator?.trim() ?? current.operator,
        noteVersions: versions,
      };
      await db.stringings.put(toPlain(next));
      this.stringings = this.stringings.map((s) => (s.id === id ? next : s));
    },

    async removeStringing(id: string) {
      await db.stringings.delete(id);
      this.stringings = this.stringings.filter((s) => s.id !== id);
    },
  },
});
