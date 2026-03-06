import { useState, useCallback } from "react";
import { useToast } from "./use-toast";

interface BLEState {
  isConnected: boolean;
  deviceName: string | null;
  isConnecting: boolean;
}

export function useBLE() {
  const [state, setState] = useState<BLEState>({
    isConnected: false,
    deviceName: null,
    isConnecting: false,
  });
  const { toast } = useToast();

  const connect = useCallback(async () => {
    // Check if Web Bluetooth API is available
    if (!navigator || !(navigator as any).bluetooth) {
      toast({
        title: "Bluetooth Not Supported",
        description: "Your browser does not support the Web Bluetooth API. Try Chrome or Edge.",
        variant: "destructive",
      });
      return;
    }

    setState((prev) => ({ ...prev, isConnecting: true }));

    try {
      const SERVICE_UUID = "6ba1b218-15a8-461f-a635-012110031999";
      const DATA_UUID = "8ba1b218-15a8-461f-a635-012110031999";
      
      console.log("BLE: Opening device picker...");
      // Reverting to the most compatible requestDevice call
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID]
      });

      console.log("BLE: Device selected:", device.name);
      const server = await device.gatt.connect();
      
      console.log("BLE: GATT connected");
      // CRITICAL: We set state as soon as GATT connects
      setState({
        isConnected: true,
        deviceName: device.name || "Meshtastic Node",
        isConnecting: false,
      });

      // Start notifications to keep link active
      try {
        const service = await server.getPrimaryService(SERVICE_UUID);
        const characteristic = await service.getCharacteristic(DATA_UUID);
        
        (window as any).meshtasticChar = characteristic;
        (window as any).meshtasticDevice = device;

        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
          const value = event.target.value;
          
          // Meshtastic packets start with '!' (0x21) for text or other markers
          // We'll log the raw bytes for debugging
          const bytes = new Uint8Array(value.buffer);
          console.log("BLE: Incoming Buffer:", Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '));

          let content = "";
          try {
            // Try to see if there's an ASCII string in there (very basic decoding)
            const decoder = new TextDecoder('utf-8', { fatal: false });
            content = decoder.decode(bytes);
            
            // Filter out non-printable characters for the UI
            content = content.replace(/[^\x20-\x7E]/g, '');
            
            if (content.length < 2) {
              console.log("BLE: Packet too short or binary, skipping UI post");
              return;
            }
          } catch (e) {
            console.log("BLE: Binary packet detected, skipping UI");
            return;
          }

          console.log("BLE: Decoded Content:", content);

          // Post received message to backend
          fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sender: 'node',
              content: content
            })
          }).then(() => {
            (window as any).queryClient?.invalidateQueries({ queryKey: ['/api/messages'] });
          });
        });
        console.log("BLE: Notifications started");

        // PROBE ROUTINE: Try to read some device info/config
        try {
           console.log("BLE: Probing device capabilities...");
           
           // Meshtastic nodes usually have a Device Info service (0x180A)
           // and often a custom configuration service.
           // Since we are connected to the main data service, we can try to
           // discover other services to see what's available.
           const services = await server.getPrimaryServices();
           console.log("BLE: Available Services:", services.map(s => s.uuid));
           
           const deviceName = device.name;
           console.log(`BLE: Device ${deviceName} linked. Monitoring for LoRa traffic.`);
           
           // If we find the Device Information Service, we can read the hardware version
           try {
             const infoService = await server.getPrimaryService('device_information');
             const modelChar = await infoService.getCharacteristic('model_number_string');
             const model = await modelChar.readValue();
             console.log("BLE: Hardware Model:", new TextDecoder().decode(model));
           } catch (e) {
             console.log("BLE: Could not read model info");
           }
        } catch (probeErr) {
           console.log("BLE: Extended probe not supported by this node version", probeErr);
        }
      } catch (e) {
        console.warn("BLE: Service/Char lookup failed, but GATT is alive", e);
      }

      // System message
      fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: 'system',
          content: `UPLINK ESTABLISHED: Bridged to ${device.name || "device"}.`
        })
      }).then(() => {
        window.dispatchEvent(new CustomEvent('ble-connected'));
        (window as any).queryClient?.invalidateQueries({ queryKey: ['/api/messages'] });
      });

      const onDisconnect = () => {
        console.log("BLE: Disconnected");
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({ title: "Disconnected", variant: "destructive" });
      };
      
      device.addEventListener('gattserverdisconnected', onDisconnect);
      (window as any)._onDisconnect = onDisconnect;

      toast({ title: "Connected", description: `Bridged to ${device.name}.` });

    } catch (error: any) {
      console.error("BLE Error:", error);
      setState({ isConnected: false, deviceName: null, isConnecting: false });
      if (error.name !== 'NotFoundError') {
        toast({ title: "Connection Failed", description: error.message, variant: "destructive" });
      }
    } finally {
      setState((prev) => ({ ...prev, isConnecting: false }));
    }
  }, [toast]);

  const disconnect = useCallback(() => {
    if ((window as any).meshtasticDevice) {
      (window as any).meshtasticDevice.gatt.disconnect();
    }
    setState({
      isConnected: false,
      deviceName: null,
      isConnecting: false,
    });
    
    toast({
      title: "Disconnected",
      description: "Manually disconnected from Meshtastic.",
    });
  }, [toast]);

  return {
    ...state,
    connect,
    disconnect,
  };
}
