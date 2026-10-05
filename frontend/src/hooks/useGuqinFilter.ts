import { computed, type ComputedRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { WoodBoard, WoodSpecies } from '../types/wood-board';

export type StageKey = 'select' | 'carve' | 'lacquer' | 'string';

export interface GuqinFilterApi {
  keyword: ComputedRef<string>;
  guqinNo: ComputedRef<string>;
  species: ComputedRef<string>;
  stage: ComputedRef<string>;
  activeCount: ComputedRef<number>;
  setFilter: (key: string, value: string) => void;
  reset: () => void;
  /** 按琴号 / 树种 / 关键字过滤板材 */
  applyBoards: (boards: WoodBoard[]) => WoodBoard[];
}

/**
 * 琴号、树种与工序阶段筛选条件：条件保存在 URL query 中，
 * 刷新与前进后退都能还原，板材登记页与琴坯进度页共用。
 */
export function useGuqinFilter(): GuqinFilterApi {
  const route = useRoute();
  const router = useRouter();

  const read = (key: string): string => {
    const value = route.query[key];
    return typeof value === 'string' ? value : '';
  };

  const keyword = computed(() => read('kw'));
  const guqinNo = computed(() => read('guqin'));
  const species = computed(() => read('species'));
  const stage = computed(() => read('stage'));

  const setFilter = (key: string, value: string) => {
    const query: Record<string, string> = {};
    Object.entries(route.query).forEach(([k, v]) => {
      if (typeof v === 'string' && v) query[k] = v;
    });
    if (value) {
      query[key] = value;
    } else {
      delete query[key];
    }
    void router.replace({ query });
  };

  const reset = () => {
    const query: Record<string, string> = {};
    Object.entries(route.query).forEach(([k, v]) => {
      if (!['kw', 'guqin', 'species', 'stage'].includes(k) && typeof v === 'string' && v) query[k] = v;
    });
    void router.replace({ query });
  };

  const activeCount = computed(() => [keyword.value, guqinNo.value, species.value, stage.value].filter(Boolean).length);

  const applyBoards = (boards: WoodBoard[]): WoodBoard[] => {
    const kw = keyword.value.trim().toLowerCase();
    return boards.filter((board) => {
      if (guqinNo.value && board.guqinNo !== guqinNo.value) return false;
      if (species.value && board.species !== (species.value as WoodSpecies)) return false;
      if (kw) {
        const haystack = `${board.boardNo} ${board.guqinNo} ${board.species} ${board.remark ?? ''}`.toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  };

  return { keyword, guqinNo, species, stage, activeCount, setFilter, reset, applyBoards };
}
