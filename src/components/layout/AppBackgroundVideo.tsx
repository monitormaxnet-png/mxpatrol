import { memo, useEffect, useRef } from "react";
import bgVideo from "@/assets/web-background.mp4.asset.json";

/** Mounted once at the app root so it never restarts on page changes. */
const AppBackgroundVideo = memo(() => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      const v = ref.current;
      if (!v) return;
      if (mq.matches) v.pause();
      else v.play().catch(() => {});
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <>
      <video
        ref={ref}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-hidden="true"
        className="app-background-video"
      >
        <source src={bgVideo.url} type="video/mp4" />
      </video>
      <div className="app-video-overlay" aria-hidden="true" />
    </>
  );
});

export default AppBackgroundVideo;
