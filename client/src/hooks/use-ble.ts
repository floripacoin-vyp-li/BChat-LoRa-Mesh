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
      // Mock connection request to Meshtastic or any BLE device
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        // In a real Meshtastic app, you'd filter by specific service UUIDs:
        // filters: [{ services: ['...'] }]
      });

      setState({
        isConnected: true,
        deviceName: device.name || "Unknown Device",
        isConnecting: false,
      });

      // Handle abrupt disconnects
      device.addEventListener('gattserverdisconnected', () => {
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
      });

      toast({
        title: "Connected",
        description: `Successfully bridged to ${device.name || "device"}.`,
        style: { borderLeft: "4px solid hsl(var(--primary))" },
      });

    } catch (error: any) {
      console.error("BLE Connect Error:", error);
      setState((prev) => ({ ...prev, isConnecting: false }));
      
      // Don't show toast if user just cancelled the picker
      if (error.name !== 'NotFoundError') {
        toast({
          title: "Connection Failed",
          description: error.message || "Failed to pair with device.",
          variant: "destructive",
        });
      }
    }
  }, [toast]);

  const disconnect = useCallback(() => {
    // In a full implementation, you'd keep the gatt server reference and call disconnect()
    // For this UI mockup, we'll reset state
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
