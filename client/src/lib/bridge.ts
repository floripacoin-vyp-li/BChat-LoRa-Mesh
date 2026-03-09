import { buildBitchatToRadio } from "./meshtastic";

export function initBridge(): void {
  (window as any).bitchatReceived = (bytes: Uint8Array, peerName: string) => {
    const send = (window as any).meshtasticSend;
    if (!send) {
      console.warn("BLB: BitChat message received but no LoRa transport active — dropped");
      return;
    }
    console.log(`BLB: BitChat → LoRa (${bytes.length}B from "${peerName}")`);
    send(buildBitchatToRadio(bytes));
    fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: "system",
        content: `[BLB] BitChat → LoRa: ${bytes.length}B from ${peerName}`,
      }),
    }).then(() => {
      (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
    });
  };
  console.log("BLB: Bridge initialized — waiting for transports");
}
