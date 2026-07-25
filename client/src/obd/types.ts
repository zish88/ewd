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

export type ObdScanPayload = {
  vin?: string | null;
  bus?: string;
  device?: string;
  readOnlyDefault?: boolean;
  ecus?: ObdEcuStatus[];
  dtcs?: ObdDtcItem[];
  live?: { coolantC?: number };
  error?: string;
};
