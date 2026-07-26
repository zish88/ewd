/**
 * Best-effort Web Bluetooth connection to BLE ELM / UART-style OBD dongles.
 * Classic BT SPP is not supported by Web Bluetooth.
 * Session can stay open across UI minimize; disconnect on hard close.
 */

const UART_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
const UART_RX = "0000fff1-0000-1000-8000-00805f9b34fb";
const UART_TX = "0000fff2-0000-1000-8000-00805f9b34fb";

const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

type BleChar = {
  properties: { writeWithoutResponse?: boolean };
  writeValueWithoutResponse: (d: BufferSource) => Promise<void>;
  writeValue: (d: BufferSource) => Promise<void>;
  startNotifications: () => Promise<BleChar>;
  stopNotifications: () => Promise<BleChar>;
  addEventListener: (type: string, listener: (ev: Event) => void) => void;
  removeEventListener: (type: string, listener: (ev: Event) => void) => void;
  value?: DataView;
};

type BleServer = {
  connected: boolean;
  getPrimaryService: (u: string) => Promise<{ getCharacteristic: (u: string) => Promise<BleChar> }>;
  disconnect: () => void;
};

type BleDevice = {
  id: string;
  name?: string;
  gatt?: { connect: () => Promise<BleServer>; connected?: boolean };
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export function bleObdSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as { bluetooth?: unknown }).bluetooth);
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function writeChunk(ch: BleChar, text: string): Promise<void> {
  const data = enc(text.endsWith("\r") ? text : `${text}\r`);
  const payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  if (ch.properties.writeWithoutResponse) {
    await ch.writeValueWithoutResponse(payload);
  } else {
    await ch.writeValue(payload);
  }
}

type Session = {
  device: BleDevice;
  server: BleServer;
  rx: BleChar;
  tx: BleChar;
  onDisconnect: () => void;
};

let session: Session | null = null;
const linkListeners = new Set<(linked: boolean) => void>();

function notifyLink() {
  const linked = Boolean(session?.server.connected);
  for (const fn of linkListeners) fn(linked);
}

export function subscribeElmBleLink(fn: (linked: boolean) => void): () => void {
  linkListeners.add(fn);
  fn(Boolean(session?.server.connected));
  return () => {
    linkListeners.delete(fn);
  };
}

export function elmBleLinked(): boolean {
  return Boolean(session?.server.connected);
}

export async function disconnectElmBle(): Promise<void> {
  const s = session;
  session = null;
  if (!s) {
    notifyLink();
    return;
  }
  s.device.removeEventListener("gattserverdisconnected", s.onDisconnect);
  try {
    await s.rx.stopNotifications();
  } catch {
    /* ignore */
  }
  try {
    if (s.server.connected) s.server.disconnect();
  } catch {
    /* ignore */
  }
  notifyLink();
}

export async function connectElmBle(): Promise<string> {
  if (!bleObdSupported()) {
    throw new Error("Web Bluetooth недоступен (нужен Chrome/Edge на Android или desktop).");
  }
  if (session?.server.connected) {
    return session.device.name || session.device.id || "BLE ELM";
  }
  await disconnectElmBle();

  const bluetooth = (
    navigator as unknown as {
      bluetooth: {
        requestDevice: (o: object) => Promise<BleDevice>;
      };
    }
  ).bluetooth;
  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [UART_SERVICE, NUS_SERVICE],
  });
  if (!device.gatt) throw new Error("Нет GATT на устройстве.");
  const server = await device.gatt.connect();

  let rx: BleChar;
  let tx: BleChar;
  try {
    const service = await server.getPrimaryService(UART_SERVICE);
    rx = await service.getCharacteristic(UART_RX);
    tx = await service.getCharacteristic(UART_TX);
  } catch {
    const service = await server.getPrimaryService(NUS_SERVICE);
    rx = await service.getCharacteristic(NUS_RX);
    tx = await service.getCharacteristic(NUS_TX);
  }

  await rx.startNotifications();
  const onDisconnect = () => {
    if (session?.device === device) {
      session = null;
      notifyLink();
    }
  };
  device.addEventListener("gattserverdisconnected", onDisconnect);
  session = { device, server, rx, tx, onDisconnect };
  notifyLink();
  return device.name || device.id || "BLE ELM";
}

/** Run AT init + Mode 01 sample PIDs + Mode 03 on an open (or freshly opened) BLE session. */
export async function scanElmBleAt(): Promise<string> {
  if (!session?.server.connected) {
    await connectElmBle();
  }
  const s = session;
  if (!s?.server.connected) throw new Error("BLE не подключен.");

  let buf = "";
  const onVal = (ev: Event) => {
    const target = ev.target as unknown as BleChar | null;
    if (!target) return;
    const v = target.value;
    if (!v) return;
    buf += new TextDecoder().decode(v.buffer);
  };
  s.rx.addEventListener("characteristicvaluechanged", onVal);

  // 0100 = supported PID bitmap; then a few common Mode 01 PIDs + DTC list.
  const cmds = ["ATZ", "ATE0", "ATL0", "ATH0", "0100", "010C", "010D", "0111", "03"];
  const parts: string[] = [];
  try {
    for (const cmd of cmds) {
      buf = "";
      await writeChunk(s.tx, cmd);
      await new Promise((r) => setTimeout(r, cmd === "ATZ" ? 1500 : 800));
      if (buf.trim()) parts.push(buf.trim());
    }
  } finally {
    s.rx.removeEventListener("characteristicvaluechanged", onVal);
  }

  const combined = parts.join("\n");
  if (!combined.trim()) {
    throw new Error("BLE-устройство ответило пусто. Classic SPP ELM из браузера недоступен — нужен BLE UART.");
  }
  return combined;
}
