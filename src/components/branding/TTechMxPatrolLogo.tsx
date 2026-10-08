import { useState } from 'react';
import { TTECH_MX_PATROL_LOGO_ALT, TTECH_MX_PATROL_LOGO_SRC } from '@/lib/reportBranding';
import { cn } from '@/lib/utils';

type TTechMxPatrolLogoVariant = 'sidebar' | 'header' | 'scanner' | 'login' | 'report';

type TTechMxPatrolLogoProps = {
  variant?: TTechMxPatrolLogoVariant;
  className?: string;
  priority?: boolean;
  decorative?: boolean;
};

const ANIMATED_LOGO_SRC = '/mxpatrol-animated-logo.mp4';

const variantClass: Record<TTechMxPatrolLogoVariant, string> = {
  sidebar: 'w-[clamp(9rem,16vw,13rem)]',
  header: 'w-[clamp(8.75rem,14vw,16rem)]',
  scanner: 'w-36 max-w-[48vw]',
  login: 'w-[clamp(12rem,34vw,20rem)]',
  report: 'w-36 max-w-full',
};

export function TTechMxPatrolLogo({
  variant = 'header',
  className,
  priority = false,
  decorative = false,
}: TTechMxPatrolLogoProps) {
  const [videoReady, setVideoReady] = useState(false);
  const alt = decorative ? '' : TTECH_MX_PATROL_LOGO_ALT;

  return (
    <span className={cn('animated-logo relative inline-block max-w-full align-middle', variantClass[variant], className)}>
      <video
        className={cn('animated-logo-video block h-auto w-full object-contain', videoReady ? 'opacity-100' : 'opacity-0')}
        autoPlay
        muted
        loop
        playsInline
        preload='auto'
        aria-hidden='true'
        onLoadedData={() => setVideoReady(true)}
        onCanPlay={() => setVideoReady(true)}
        onError={() => setVideoReady(false)}
      >
        <source src={ANIMATED_LOGO_SRC} type='video/mp4' />
      </video>
      <img
        src={TTECH_MX_PATROL_LOGO_SRC}
        alt={alt}
        aria-hidden={decorative || undefined}
        loading={priority ? 'eager' : 'lazy'}
        decoding='async'
        className={cn(
          'animated-logo-fallback absolute inset-0 h-full w-full object-contain transition-opacity duration-200',
          videoReady ? 'opacity-0' : 'opacity-100',
        )}
      />
    </span>
  );
}

export default TTechMxPatrolLogo;
