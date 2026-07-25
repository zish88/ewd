/**
 * Best-effort Web Bluetooth connection to BLE ELM / UART-style OBD dongles.
 * Classic BT SPP is not supported by Web Bluetooth.
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

export function bleObdSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as { bluetooth?: unknown }).bluetooth);
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function writeChunk(ch: BleChar, text: string): Promise<void> {
  const data = enc(text.endsWith("\r") ? text : `${text}\r`);
  if (ch.properties.writeWithoutResponse) {
    await ch.writeValueWithoutResponse(data);
  } else {
    await ch.writeValue(data);
  }
}

export async function scanElmBleAt(): Promise<string> {
  if (!bleObdSupported()) {
    throw new Error("Web Bluetooth недоступен (нужен Chrome/Edge на Android или desktop).");
  }
  const bluetooth = (navigator as { bluetooth: { requestDevice: (o: object) => Promise<{ gatt?: { connect: () => Promise<{ getPrimaryService: (u: string) => Promise<{ getCharacteristic: (u: string) => Promise<BleChar> }> }> } }> } }).bluetooth;
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

  let buf = "";
  const onVal = (ev: Event) => {
    const target = ev.target as BleChar;
    const v = target.value;
    if (!v) return;
    buf += new TextDecoder().decode(v.buffer);
  };
  await rx.startNotifications();
  rx.addEventListener("characteristicvaluechanged", onVal);

  const cmds = ["ATZ", "ATE0", "ATL0", "ATH0", "0105", "03"];
  for (const cmd of cmds) {
    buf = "";
    await writeChunk(tx, cmd);
    await new Promise((r) => setTimeout(r, cmd === "ATZ" ? 1500 : 800));
  }

  rx.removeEventListener("characteristicvaluechanged", onVal);
  try {
    await rx.stopNotifications();
  } catch {
    /* ignore */
  }

  if (!buf.trim()) {
    throw new Error("BLE-устройство ответило пусто. Classic SPP ELM из браузера недоступен — нужен BLE UART.");
  }
  return buf;
}
