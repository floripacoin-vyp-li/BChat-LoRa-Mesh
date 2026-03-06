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
      // Meshtastic Service UUID: 6ba1b218-15a8-461f-a635-012110031999
      const MESHTASTIC_SERVICE_UUID = "6ba1b218-15a8-461f-a635-012110031999";
      const MESHTASTIC_DATA_CHAR_UUID = "8ba1b218-15a8-461f-a635-012110031999";
      
      console.log("Requesting device...");
      // Reverting to a more standard requestDevice call that often has better compatibility
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [MESHTASTIC_SERVICE_UUID]
      });

      console.log("Connecting to GATT Server...");
      const server = await device.gatt.connect();
      
      console.log("Getting Service...");
      const service = await server.getPrimaryService(MESHTASTIC_SERVICE_UUID);
      
      console.log("Getting Characteristic...");
      const characteristic = await service.getCharacteristic(MESHTASTIC_DATA_CHAR_UUID);
      
      // Store references
      (window as any).meshtasticChar = characteristic;
      (window as any).meshtasticDevice = device;

      console.log("Setting connected state...");
      setState({
        isConnected: true,
        deviceName: device.name || "Meshtastic Node",
        isConnecting: false,
      });

      const onDisconnect = () => {
        console.log("GATT Disconnected");
        setState({
          isConnected: false,
          deviceName: null,
          isConnecting: false,
        });
        toast({
          title: "Disconnected",
          description: "Connection to Meshtastic lost.",
          variant: "destructive",
        });
      };
      
      device.addEventListener('gattserverdisconnected', onDisconnect);
      (window as any)._onDisconnect = onDisconnect;

      toast({
        title: "Connected",
        description: `Successfully bridged to ${device.name || "device"}.`,
        style: { borderLeft: "4px solid hsl(var(--primary))" },
      });

    } catch (error: any) {
      console.error("BLE Connect Error:", error);
      
      setState({
        isConnected: false,
        deviceName: null,
        isConnecting: false,
      });
      
      if (error.name !== 'NotFoundError') {
        toast({
          title: "Connection Failed",
          description: error.message || "Failed to pair with device.",
          variant: "destructive",
        });
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
