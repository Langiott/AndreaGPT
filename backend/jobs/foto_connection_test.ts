import test from "node:test";
import assert from "node:assert/strict";
import { recuperaFoto, serviziFoto } from "./foto_connection";

const discovery = "adb-phone _adb-tls-connect._tcp 192.168.2.220:42777\nadb-pair _adb-tls-pairing._tcp 192.168.2.220:40000\nadb-other _adb-tls-connect._tcp 192.168.2.221:41000";
test("scopre solo la porta di connessione dello stesso IP", () => {
  assert.deepEqual(serviziFoto(discovery, "192.168.2.220"), [{ nome: "adb-phone", ip: "192.168.2.220", porta: 42777 }]);
});
test("recupera una porta cambiata e verifica lo stato device", async () => {
  let connected = false;
  const calls: string[][] = [];
  const result = await recuperaFoto({ ip: "192.168.2.220", porta: 40337 }, async args => {
    calls.push(args);
    if (args[0] === "mdns") return discovery;
    if (args[0] === "connect") { connected = true; return "connected to 192.168.2.220:42777"; }
    return `List of devices attached\n192.168.2.221:41000\tdevice\n${connected ? "192.168.2.220:42777\tdevice" : ""}`;
  }, true);
  assert.deepEqual(result, { seriale: "192.168.2.220:42777", conf: { ip: "192.168.2.220", porta: 42777 } });
  assert.deepEqual(calls.filter(args => args[0] === "connect"), [["connect", "192.168.2.220:42777"]]);
});
test("accetta il nome mDNS del telefono già collegato senza ritentare", async () => {
  const result = await recuperaFoto({ ip: "192.168.2.220", porta: 40337 }, async args => {
    assert.notEqual(args[0], "connect");
    return args[0] === "mdns" ? discovery : "List of devices attached\nadb-phone._adb-tls-connect._tcp\tdevice";
  }, false);
  assert.equal(result?.conf.porta, 42777);
});
test("non usa altri telefoni o un trasporto offline se mDNS non è disponibile", async () => {
  const result = await recuperaFoto({ ip: "192.168.2.220", porta: 40337 }, async args => {
    if (args[0] === "mdns") throw new Error("unsupported");
    if (args[0] === "connect") return "connected to 192.168.2.220:40337";
    return "List of devices attached\n192.168.2.221:41000\tdevice\n192.168.2.220:40337\toffline";
  }, true);
  assert.equal(result, undefined);
});
