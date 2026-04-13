import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { X, Camera } from "lucide-react";

interface BchQrScannerProps {
  onScanned: (value: string) => void;
  onClose: () => void;
}

export function BchQrScanner({ onScanned, onClose }: BchQrScannerProps) {
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
        if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setScanning(true);
        }
      } catch {
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
        const val = code.data.trim();
        const lower = val.toLowerCase();
        const isBchUri = lower.startsWith("bitcoincash:");
        const isCashAddr = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{26,45}$/.test(lower);
        const isLegacy = /^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/.test(val);
        if (isBchUri || isCashAddr || isLegacy) {
          cancelAnimationFrame(rafRef.current);
          streamRef.current?.getTracks().forEach((t) => t.stop());
          onScanned(val);
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera size={16} className="text-primary" />
            <span className="text-sm font-mono text-foreground uppercase tracking-wide">
              Scan BCH QR Code
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-bch-scanner"
          >
            <X size={18} />
          </button>
        </div>

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
              data-testid="video-bch-scanner"
            />
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

        <canvas ref={canvasRef} className="hidden" />

        <p className="text-xs font-mono text-muted-foreground/50 text-center">
          Point at a BCH address QR code (wallet, invoice, or CashAddr)
        </p>
      </div>
    </div>
  );
}
