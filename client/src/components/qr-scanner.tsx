import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { X, Camera } from "lucide-react";

export const BCB_KEY_PREFIX = "BCB-KEY:";

export interface ScannedKey {
  alias: string;
  publicKeyBase64: string;
}

export function parseQRKey(data: string): ScannedKey | null {
  if (!data.startsWith(BCB_KEY_PREFIX)) return null;
  const rest = data.slice(BCB_KEY_PREFIX.length);
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) return null;
  return {
    alias: rest.slice(0, colonIdx),
    publicKeyBase64: rest.slice(colonIdx + 1),
  };
}

export function buildQRKeyPayload(alias: string, publicKeyBase64: string): string {
  return `${BCB_KEY_PREFIX}${alias}:${publicKeyBase64}`;
}

interface QRScannerProps {
  onScanned: (result: ScannedKey) => void;
  onClose: () => void;
}

export function QRScanner({ onScanned, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let active = true;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setScanning(true);
        }
      } catch (e: any) {
        setError("Camera access denied. Please allow camera permissions and try again.");
      }
    }

    startCamera();

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!scanning) return;

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code?.data) {
        const parsed = parseQRKey(code.data);
        if (parsed) {
          // Stop camera before calling onScanned
          cancelAnimationFrame(rafRef.current);
          streamRef.current?.getTracks().forEach((t) => t.stop());
          onScanned(parsed);
          return;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [scanning, onScanned]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera size={16} className="text-primary" />
            <span className="text-sm font-mono text-foreground uppercase tracking-wide">
              Scan BCB Key
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-scanner"
          >
            <X size={18} />
          </button>
        </div>

        {/* Camera feed */}
        {error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-6 text-center">
            <p className="text-sm font-mono text-destructive">{error}</p>
          </div>
        ) : (
          <div className="relative rounded-2xl overflow-hidden bg-black border border-white/10">
            <video
              ref={videoRef}
              className="w-full"
              muted
              playsInline
              data-testid="video-scanner"
            />
            {/* Scanning overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 relative">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-primary rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-primary rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-primary rounded-br-lg" />
                {scanning && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary/60 animate-[scan_2s_ease-in-out_infinite]" />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Hidden canvas for processing */}
        <canvas ref={canvasRef} className="hidden" />

        <p className="text-xs font-mono text-muted-foreground/50 text-center">
          Point at the other user's BCB QR code
        </p>
      </div>
    </div>
  );
}
