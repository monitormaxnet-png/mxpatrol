const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });
  await page.goto('http://127.0.0.1:8080/login', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2500);
  const result = await page.evaluate(() => {
    const styleOf = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        tag: el.tagName,
        className: String(el.className),
        display: s.display,
        visibility: s.visibility,
        opacity: s.opacity,
        zIndex: s.zIndex,
        position: s.position,
        width: s.width,
        height: s.height,
        top: s.top,
        right: s.right,
        bottom: s.bottom,
        left: s.left,
        filter: s.filter,
        backgroundColor: s.backgroundColor,
        backgroundImage: s.backgroundImage,
        transform: s.transform,
        mixBlendMode: s.mixBlendMode,
        pointerEvents: s.pointerEvents,
      };
    };
    const video = document.querySelector('.login-shell__video');
    const overlay = document.querySelector('.login-shell__overlay');
    const ui = document.querySelector('.login-shell__ui');
    const centerStack = document.elementsFromPoint(innerWidth / 2, innerHeight / 2).slice(0, 12).map(styleOf);
    return {
      url: location.href,
      videoExists: !!video,
      videoState: video ? {
        paused: video.paused,
        ended: video.ended,
        readyState: video.readyState,
        currentTime: video.currentTime,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        currentSrc: video.currentSrc,
      } : null,
      videoStyle: styleOf(video),
      overlayStyle: styleOf(overlay),
      uiStyle: styleOf(ui),
      centerStack,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();

