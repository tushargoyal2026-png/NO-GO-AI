let currentEvaluatedKey = "";
let isBlocked = false;

function resetState() {
  isBlocked = false;
  const overlay = document.getElementById("nogo-friction-overlay");
  if (overlay) overlay.remove();
}

function getYouTubeTitle() {
  const primaryTitleEl = document.querySelector(
    'h1.ytd-watch-metadata yt-formatted-string, h1.style-scope.ytd-watch-metadata, h1.ytd-video-primary-info-renderer, h2.ytd-reel-player-header-renderer'
  );
  if (primaryTitleEl && primaryTitleEl.innerText.trim()) {
    return primaryTitleEl.innerText.trim();
  }

  if (document.title && document.title.includes("- YouTube")) {
    const rawTitle = document.title.replace(/- YouTube$/i, "").trim();
    if (rawTitle && rawTitle !== "YouTube") {
      return rawTitle;
    }
  }

  return "";
}

function hardPauseVideo() {
  const videos = document.querySelectorAll("video");
  videos.forEach((video) => {
    video.pause();
    video.currentTime = 0;
  });
}

async function evaluateCurrentVideo() {
  const activeUrl = window.location.href;

  if (!activeUrl.includes("/watch") && !activeUrl.includes("/shorts")) {
    resetState();
    return;
  }

  if (activeUrl.includes("/shorts/")) {
    hardPauseVideo();
  }

  let title = "";
  let attempts = 0;

  while (!title && attempts < 10) {
    title = getYouTubeTitle();
    if (!title) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    attempts++;
  }

  if (!title && activeUrl.includes("/shorts/")) {
    title = "YouTube Short";
  }

  if (!title) return;

  const evaluationKey = `${activeUrl}::${title}`;
  if (currentEvaluatedKey === evaluationKey) return;
  currentEvaluatedKey = evaluationKey;

  chrome.runtime.sendMessage({
    action: "EVALUATE_PAGE",
    metadata: { title: title },
    url: activeUrl
  });
}

setInterval(() => {
  if (isBlocked) {
    hardPauseVideo();
    if (!document.getElementById("nogo-friction-overlay")) {
      chrome.runtime.sendMessage({ action: "REAPPLY_CURRENT_OVERLAY" });
    }
  }
}, 150);

document.addEventListener("click", (e) => {
  const anchor = e.target.closest("a");
  if (anchor && anchor.href && (anchor.href.includes("/watch") || anchor.href.includes("/shorts"))) {
    resetState();
    currentEvaluatedKey = "";
  }
}, true);

window.addEventListener("yt-navigate-start", () => {
  resetState();
  currentEvaluatedKey = "";
});

window.addEventListener("yt-navigate-finish", () => {
  resetState();
  currentEvaluatedKey = "";
  setTimeout(evaluateCurrentVideo, 200);
});

evaluateCurrentVideo();

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "URL_CHANGED") {
    resetState();
    currentEvaluatedKey = "";
    setTimeout(evaluateCurrentVideo, 200);
  }

  if (request.action === "APPLY_FRICTION") {
    const { evaluation, goal } = request;
    isBlocked = true;

    let overlay = document.getElementById("nogo-friction-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "nogo-friction-overlay";
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(15, 15, 15, 0.98); color: white; z-index: 2147483647;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        font-family: Arial, sans-serif; text-align: center; padding: 20px; box-sizing: border-box;
      `;
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div style="background: #222; border: 1px solid #333; padding: 30px; border-radius: 12px; max-width: 480px; width: 100%;">
        <h2 style="color: #ff4d4d; margin-top: 0;">NO GO Focus Mode Active</h2>
        <p style="font-size: 15px; color: #ddd;">
          This video conflicts with your focus goal:<br>
          <strong style="color: #4da6ff;">"${goal}"</strong>
        </p>
        <div style="background: #111; padding: 10px; border-radius: 6px; margin: 15px 0; font-size: 13px; color: #aaa; text-align: left;">
          <strong>AI Reason:</strong> ${evaluation.reason}
        </div>
        <button id="nogo-close-btn" style="
          background: #ff4d4d; border: none; color: white; width: 100%;
          padding: 12px; font-weight: bold; border-radius: 6px; cursor: pointer; font-size: 15px;
        ">Return to Focused Work</button>
      </div>
    `;

    hardPauseVideo();

    document.getElementById("nogo-close-btn").onclick = () => {
      chrome.runtime.sendMessage({ 
        action: "LOG_FRICTION_ACTION", 
        userAction: "CLICKED_RETURN_TO_WORK",
        url: window.location.href 
      });

      chrome.storage.local.get(['lastValidVideo', 'rawGoal'], (data) => {
        currentEvaluatedKey = "";
        if (data.lastValidVideo && data.lastValidVideo !== window.location.href) {
          window.location.href = data.lastValidVideo;
        } else {
          const query = encodeURIComponent(data.rawGoal || goal);
          window.location.href = `https://www.youtube.com/results?search_query=${query}`;
        }
      });
    };
  }

  if (request.action === "REMOVE_FRICTION") {
    resetState();
    if (window.location.href.includes("/watch?v=")) {
      chrome.storage.local.set({ lastValidVideo: window.location.href });
    }
  }
});