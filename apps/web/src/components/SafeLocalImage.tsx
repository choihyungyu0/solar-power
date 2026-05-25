import { useState } from 'react';

type SafeLocalImageProps = {
  src: string;
  fallbackSrc?: string;
  alt: string;
  className?: string;
};

function SafeLocalImage({ src, fallbackSrc, alt, className }: SafeLocalImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [hasFailed, setHasFailed] = useState(false);

  if (hasFailed) {
    return (
      <div className={`${className ?? ''} imagePlaceholder`} role="img" aria-label={alt}>
        <span>이코햇</span>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={currentSrc}
      alt={alt}
      onError={() => {
        if (fallbackSrc && currentSrc !== fallbackSrc) {
          setCurrentSrc(fallbackSrc);
          return;
        }

        setHasFailed(true);
      }}
    />
  );
}

export default SafeLocalImage;
