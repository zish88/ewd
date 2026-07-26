export type ObdEcuStatus = {
  id: string;
  req: string;
  rsp: string;
  online: boolean;
};

export type ObdDtcItem = {
  ecu: string;
  code: string;
  status: string;
  raw?: string;
  title_ru?: string;
  title_en?: string;
  obd_code?: string;
  dict_ecu?: string;
};

/** Universal live signal from Mode 01 (or ELM) — not tied to a single PID. */
export type ObdSignal = {
  id: string;
  pid: string;
  name: string;
  value: number | string;
  unit?: string;
};

export type ObdBusStatus = {
  ok?: boolean;
  state?: string;
  txErr?: number;
  rxErr?: number;
  busErr?: number;
  lastScanAgeMs?: number | null;
  supportedPidCount?: number;
  signalCount?: number;
};

export type ObdScanPayload = {
  vin?: string | null;
  bus?: string;
  device?: string;
  readOnlyDefault?: boolean;
  ecus?: ObdEcuStatus[];
  dtcs?: ObdDtcItem[];
  /** Dynamic Mode 01 values from supported-PID discovery. */
  signals?: ObdSignal[];
  supportedPids?: string[];
  busStatus?: ObdBusStatus;
  /** @deprecated Prefer `signals`. Kept for older demo JSON. */
  live?: Record<string, number | string>;
  error?: string;
};

export type ObdSignalsPayload = {
  bus?: string;
  device?: string;
  signals?: ObdSignal[];
  supportedPids?: string[];
  busStatus?: ObdBusStatus;
};
