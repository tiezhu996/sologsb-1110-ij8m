import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import { ACTION_LABELS, type ChangeAction, type StageKey } from '../types/changes';
import { sortLayers } from './layer';

/** 板材一句话摘要 */
export function boardSummary(board: WoodBoard): string {
  const parts = [
    board.part,
    board.boardNo,
    `${board.species}${board.grain}`,
    `厚${board.thicknessMm}mm`,
    board.defect !== '无' ? `缺陷：${board.defect}` : '',
    board.remark ? `备注：${board.remark}` : '',
  ].filter(Boolean);
  return parts.join('，');
}

/** 槽腹一句话摘要 */
export function chamberSummary(chamber: SoundChamber): string {
  const parts = [
    `纳音/龙池/凤沼厚度 ${chamber.nayinThickness}/${chamber.longchiThickness}/${chamber.fengzhaoThickness}mm`,
    `槽腹深${chamber.chamberDepth}mm`,
    `天地柱${chamber.postPos}`,
    chamber.poolSize ? `龙池凤沼 ${chamber.poolSize}` : '',
    chamber.carver ? `掏膛人${chamber.carver}` : '',
  ].filter(Boolean);
  return parts.join('，');
}

/** 单遍髹漆摘要 */
export function layerSummary(layer: LacquerLayer): string {
  const parts = [
    `配比${layer.mixRatio}`,
    `本遍${layer.layerThickness}mm`,
    `累计${layer.totalThickness}mm`,
    `${layer.curingTemp}℃/${layer.curingHumidity}%`,
    `${layer.polishGrit}目`,
    layer.operator ? layer.operator : '',
  ].filter(Boolean);
  return `第${layer.seq}遍：${parts.join('，')}`;
}

/** 同一次操作涉及的多遍髹漆（按遍次升序） */
export function lacquerSummary(layers: LacquerLayer[]): string {
  const list = sortLayers(layers);
  if (list.length === 0) return '';
  if (list.length === 1) return layerSummary(list[0]);
  const last = list[list.length - 1];
  const seqs = list.map((l) => l.seq);
  return `第${Math.min(...seqs)}~${Math.max(...seqs)}遍共${list.length}遍，累计厚度${last.totalThickness}mm`;
}

/** 上弦一句话摘要（音色评语只取首句纯文本） */
export function stringingSummary(stringing: Stringing): string {
  const parts = [
    stringing.stringType,
    `弦距${stringing.stringGap}mm`,
    stringing.nut,
    stringing.defects.some((d) => d !== '无') ? `缺陷：${stringing.defects.join('、')}` : '',
  ].filter(Boolean);
  const firstNote = [stringing.sanNote, stringing.anNote, stringing.fanNote, stringing.nineVirtues]
    .map((t) => t.trim())
    .find(Boolean);
  if (firstNote) parts.push(`评语「${firstNote.slice(0, 40)}${firstNote.length > 40 ? '…' : ''}」`);
  return parts.join('，');
}

/** 按阶段从业务记录生成一句话内容摘要 */
export function summarize(stage: StageKey, snapshots: unknown[]): string {
  switch (stage) {
    case 'board':
      return boardSummary(snapshots[0] as WoodBoard);
    case 'chamber':
      return chamberSummary(snapshots[0] as SoundChamber);
    case 'lacquer':
      return lacquerSummary(snapshots as LacquerLayer[]);
    case 'stringing':
      return stringingSummary(snapshots[0] as Stringing);
  }
}

/** 拼成台账里的完整摘要（动作 + 内容） */
export function fullSummary(action: ChangeAction, stage: StageKey, snapshots: unknown[]): string {
  return `${ACTION_LABELS[action]}${summarize(stage, snapshots)}`;
}

/** 取业务记录上的琴号 */
export function guqinNoOf(stage: StageKey, record: unknown): string {
  const row = record as { guqinNo?: unknown };
  return typeof row.guqinNo === 'string' ? row.guqinNo : '';
}
