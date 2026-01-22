export default function SellerevLogo({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="logo-purple" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:hsl(229, 84%, 63%);stop-opacity:1" />
          <stop offset="100%" style="stop-color:hsl(257, 69%, 71%);stop-opacity:1" />
        </linearGradient>
      </defs>
      
      {/* Isometric cube icon - centered and slightly above vertical center */}
      <g transform="translate(16, 18)">
        {/* Front-Left Face (solid parallelogram, darker purple) */}
        <path
          d="M -7 1 L -7 7 L -3 11 L -3 5 Z"
          fill="url(#logo-purple)"
          opacity="0.85"
        />
        
        {/* Top Face (parallelogram, lighter purple) */}
        <path
          d="M -3 5 L 5 5 L 9 1 L 1 1 Z"
          fill="url(#logo-purple)"
        />
        
        {/* Top Face Cutout 1 (dark parallelogram for contrast) */}
        <path
          d="M 0 3 L 3 3 L 5 1 L 2 1 Z"
          fill="hsl(225, 15%, 8%)"
        />
        
        {/* Top Face Cutout 2 (dark parallelogram) */}
        <path
          d="M -2 4 L 1 4 L 3 2 L 0 2 Z"
          fill="hsl(225, 15%, 8%)"
        />
        
        {/* Front-Right Face (parallelogram, medium purple) */}
        <path
          d="M 5 5 L 5 11 L 9 7 L 9 1 Z"
          fill="url(#logo-purple)"
        />
        
        {/* Bar 1 (left, shortest, dark parallelogram) */}
        <path
          d="M 6 7 L 6 9 L 8 8 L 8 6 Z"
          fill="hsl(225, 15%, 8%)"
        />
        
        {/* Bar 2 (middle, medium, dark parallelogram) */}
        <path
          d="M 7 6 L 7 9.5 L 9 8.5 L 9 5 Z"
          fill="hsl(225, 15%, 8%)"
        />
        
        {/* Bar 3 (right, tallest, dark parallelogram) */}
        <path
          d="M 8 5 L 8 10 L 10 9 L 10 4 Z"
          fill="hsl(225, 15%, 8%)"
        />
      </g>
    </svg>
  );
}

