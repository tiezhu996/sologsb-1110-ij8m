/** 弦材质 */
export type StringType = '丝弦' | '钢弦';

/** 常见缺陷（多选文字标记） */
export type StringDefect = '打板' | '抗指' | '沙音' | '无';

/** 评语历史版本，用于文字版本对照 */
export interface ToneVersion {
  id: string;
  savedAt: string;
  sanNote: string;
  anNote: string;
  fanNote: string;
  nineVirtues: string;
}

/** 上弦与音色文字评价 */
export interface Stringing {
  id: string;
  /** 琴号 */
  guqinNo: string;
  /** 弦材质 */
  stringType: StringType;
  /** 雁足与绒扣 */
  nut: string;
  /** 弦距（mm） */
  stringGap: number;
  /** 散音评语（纯文本） */
  sanNote: string;
  /** 按音评语（纯文本） */
  anNote: string;
  /** 泛音评语（纯文本） */
  fanNote: string;
  /** 九德文字简述 */
  nineVirtues: string;
  /** 缺陷标记 */
  defects: StringDefect[];
  /** 上弦日期 ISO */
  strungAt: string;
  /** 上弦人 */
  operator: string;
  /** 历次评语版本（倒序，最新在前） */
  noteVersions: ToneVersion[];
}

/** 三段评语 + 九德的编辑草稿 */
export interface ToneDraft {
  sanNote: string;
  anNote: string;
  fanNote: string;
  nineVirtues: string;
}

export const STRING_TYPES: StringType[] = ['丝弦', '钢弦'];
export const STRING_DEFECTS: StringDefect[] = ['无', '打板', '抗指', '沙音'];
export const NINE_VIRTUES = ['奇', '古', '透', '静', '润', '圆', '清', '匀', '芳'];
