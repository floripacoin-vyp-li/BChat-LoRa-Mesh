## Packages
framer-motion | Smooth transitions for messages and connection states
lucide-react | Icons for the dashboard

## Notes
- Tailwind Config - extend fontFamily:
fontFamily: {
  sans: ["Inter", "sans-serif"],
  mono: ["JetBrains Mono", "monospace"],
}
- Web Bluetooth API requires HTTPS or localhost to function.
- `navigator.bluetooth` might show TypeScript errors in some strict environments, so safe casting is used.
