import { TTECH_MX_PATROL_LOGO_ALT, TTECH_MX_PATROL_LOGO_SRC } from '@/lib/reportBranding';
import { cn } from '@/lib/utils';

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
    <img
      src={TTECH_MX_PATROL_LOGO_SRC}
      alt={decorative ? '' : TTECH_MX_PATROL_LOGO_ALT}
      aria-hidden={decorative || undefined}
      loading={priority ? 'eager' : 'lazy'}
      decoding='async'
      className={cn('h-auto object-contain', variantClass[variant], className)}
    />
  );
}

export default TTechMxPatrolLogo;
