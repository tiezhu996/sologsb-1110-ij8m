import type { LacquerLayer } from '../types/lacquer-layer';

const DAY_MS = 86_400_000;

/** 按遍次升序排序 */
export function sortLayers(layers: LacquerLayer[]): LacquerLayer[] {
  return [...layers].sort((a, b) => a.seq - b.seq);
}

/** 累计厚度：本遍及之前各遍厚度累加 */
export function cumulativeThickness(layers: LacquerLayer[], uptoSeq?: number): number {
  const limit = uptoSeq ?? Number.POSITIVE_INFINITY;
  const sum = sortLayers(layers)
    .filter((layer) => layer.seq <= limit)
    .reduce((acc, layer) => acc + (Number(layer.layerThickness) || 0), 0);
  return Number(sum.toFixed(3));
}

/** 下一遍遍次号 */
export function nextSeq(layers: LacquerLayer[]): number {
  return layers.reduce((max, layer) => Math.max(max, layer.seq), 0) + 1;
}

/** 养护天数：该遍施工至今的天数 */
export function curingDays(layer: LacquerLayer, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(layer.appliedAt).getTime()) / DAY_MS));
}

/** 荫房温湿度是否落在工艺窗口（温度 20~30℃、湿度 70~85%） */
export function curingInRange(temp: number, humidity: number): boolean {
  return temp >= 20 && temp <= 30 && humidity >= 70 && humidity <= 85;
}

/** 每遍平均厚度（mm） */
export function averageThickness(layers: LacquerLayer[]): number {
  if (layers.length === 0) {
    return 0;
  }
  return Number((cumulativeThickness(layers) / layers.length).toFixed(3));
}

/** 达到目标厚度还需的遍次估算（按当前每遍平均厚度） */
export function layersToTarget(layers: LacquerLayer[], targetMm: number): number {
  const avg = averageThickness(layers);
  if (avg <= 0) {
    return 0;
  }
  const remain = targetMm - cumulativeThickness(layers);
  return remain <= 0 ? 0 : Math.ceil(remain / avg);
}

/** 髹漆工艺目标累计厚度（mm），成琴灰胎常见区间 */
export const TARGET_TOTAL_MM = 1.2;

export function formatDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return formatDate(new Date());
}
