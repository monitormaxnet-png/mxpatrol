import { useState, type ReactNode } from 'react';

type MxPatrolVideoBackgroundProps = {
  children: ReactNode;
  shadeClassName?: string;
  shellClassName?: string;
};

export function MxPatrolVideoBackground({ children, shadeClassName = '', shellClassName = '' }: MxPatrolVideoBackgroundProps) {
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <div className={['mx-video-shell', shellClassName, videoFailed ? 'mx-video-shell--fallback-only' : ''].filter(Boolean).join(' ')}>
      <div className='mx-video-fallback' aria-hidden='true' />
      <video
        className='mx-video-background'
        autoPlay
        muted
        loop
        playsInline
        preload='auto'
        poster='/mxpatrol-background-fallback.jpg'
        src='/mxpatrol-background.mp4'
        aria-hidden='true'
        onLoadedData={() => setVideoFailed(false)}
        onCanPlay={() => setVideoFailed(false)}
        onError={() => setVideoFailed(true)}
      />
      <div className={['mx-video-shade', shadeClassName].filter(Boolean).join(' ')} aria-hidden='true' />
      <div className='mx-video-interface'>{children}</div>
    </div>
  );
}
