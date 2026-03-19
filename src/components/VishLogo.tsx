interface VishLogoProps {
  size?: number;
  className?: string;
  glowing?: boolean;
}

export function VishLogo({ size = 48, className = "", glowing = false }: VishLogoProps) {
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      {/* Glow effect behind logo */}
      {glowing && (
        <div
          className="absolute inset-0 rounded-full animate-glow-breathe"
          style={{
            background: 'radial-gradient(circle, rgba(0, 245, 255, 0.3) 0%, transparent 70%)',
            width: size * 1.8,
            height: size * 1.8,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
      <img 
        src="/logo.png" 
        alt="Vish Logo" 
        width={size} 
        height={size} 
        className="relative z-10 object-contain drop-shadow-[0_0_15px_rgba(0,245,255,0.4)]" 
      />
    </div>
  );
}
