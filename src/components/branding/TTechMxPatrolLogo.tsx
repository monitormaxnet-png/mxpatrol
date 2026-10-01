import { TTECH_MX_PATROL_LOGO_ALT, TTECH_MX_PATROL_LOGO_SRC } from '@/lib/reportBranding';
import { cn } from '@/lib/utils';
import logoVideo from '@/assets/mx-patrol-logo.mp4.asset.json';

type TTechMxPatrolLogoVariant = 'sidebar' | 'header' | 'scanner' | 'login' | 'report';

type TTechMxPatrolLogoProps = {
  variant?: TTechMxPatrolLogoVariant;
  className?: string;
  priority?: boolean;
  decorative?: boolean;
};

const variantClass: Record<TTechMxPatrolLogoVariant, string> = {
  sidebar: 'w-36 max-w-full',
  header: 'w-32 max-w-full',
  scanner: 'w-36 max-w-[48vw]',
  login: 'w-64 max-w-full',
  report: 'w-36 max-w-full',
};

export function TTechMxPatrolLogo({
  variant = 'header',
  className,
  priority = false,
  decorative = false,
}: TTechMxPatrolLogoProps) {
  return (
    <video
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      poster={TTECH_MX_PATROL_LOGO_SRC}
      aria-label={decorative ? undefined : TTECH_MX_PATROL_LOGO_ALT}
      aria-hidden={decorative || undefined}
      data-priority={priority || undefined}
      className={cn('pointer-events-none block h-auto aspect-[832/480] object-contain border-0 outline-none mx-auto', variantClass[variant], className)}
    >
      <source src={logoVideo.url} type="video/mp4" />
    </video>
  );
}

export default TTechMxPatrolLogo;
