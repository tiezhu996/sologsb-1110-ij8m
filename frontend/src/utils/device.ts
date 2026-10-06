import { getMeta, setMeta } from './db';
import { uid } from './id';

/** 设备信息（meta 表持久化，亦随备份导出作为对账身份） */
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  createdAt: string;
}

const DEVICE_KEY = 'device';

/** 取本机设备信息；首次使用时自动生成（平板 A / 平板 B 各持各的 id） */
export async function getDevice(): Promise<DeviceInfo> {
  const raw = await getMeta(DEVICE_KEY);
  if (raw) {
    try {
      const info = JSON.parse(raw) as DeviceInfo;
      if (info.deviceId) return info;
    } catch {
    // 落库的 JSON 损坏则重新生成
    }
  }
  const info: DeviceInfo = {
    deviceId: uid('dev'),
    deviceName: `平板-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  await setMeta(DEVICE_KEY, JSON.stringify(info));
  return info;
}

export async function renameDevice(deviceName: string): Promise<DeviceInfo> {
  const current = await getDevice();
  const next: DeviceInfo = { ...current, deviceName: deviceName.trim() || current.deviceName };
  await setMeta(DEVICE_KEY, JSON.stringify(next));
  return next;
}
