import { useEffect, useState } from "react";

export function useGatewayPresence(): { gatewayOnline: boolean } {
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Fetch the initial operator count on mount
    fetch("/api/operator/count", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setCount(data.count ?? 0))
      .catch(() => {});

    // Listen for real-time updates dispatched by use-message-stream.ts
    const handleGatewayStatus = (event: Event) => {
      const { count: newCount } = (event as CustomEvent).detail;
      setCount(typeof newCount === "number" ? newCount : 0);
    };

    window.addEventListener("gateway-status", handleGatewayStatus);
    return () => window.removeEventListener("gateway-status", handleGatewayStatus);
  }, []);

  return { gatewayOnline: count > 0 };
}
