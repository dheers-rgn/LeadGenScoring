// Regenesys Business School inline SVG logo (tree icon)
export default function RegenesysLogo({ size = 64 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Tree trunk */}
      <rect x="37" y="52" width="6" height="18" rx="2" fill="#f5c400" />
      {/* Tree layers */}
      <polygon points="40,8 22,36 58,36" fill="#f5c400" />
      <polygon points="40,20 18,50 62,50" fill="#e6b800" opacity="0.85" />
      {/* Highlight */}
      <polygon points="40,8 22,36 40,36" fill="#fff" opacity="0.12" />
    </svg>
  );
}
