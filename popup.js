document.addEventListener("DOMContentLoaded", () => {
  const setupView = document.getElementById("setup-view");
  const activeView = document.getElementById("active-view");
  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("btn-stop");
  const goalInput = document.getElementById("goal-input");
  const timerInput = document.getElementById("timer-input");
  const statusDiv = document.getElementById("status");
  const liveTimer = document.getElementById("live-timer");
  const activeGoalText = document.getElementById("active-goal-text");

  let timerInterval = null;

  function formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function startLiveTimer(startTime, targetMinutes) {
    if (timerInterval) clearInterval(timerInterval);

    function update() {
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      const targetSeconds = targetMinutes * 60;
      
      liveTimer.innerText = `${formatTime(elapsedSeconds)} / ${formatTime(targetSeconds)}`;
    }

    update();
    timerInterval = setInterval(update, 1000);
  }

  chrome.storage.local.get(['activeSession', 'parsedGoal', 'focusStartTime', 'rawGoal'], (data) => {
    if (data.activeSession && data.focusStartTime) {
      setupView.style.display = "none";
      activeView.style.display = "block";
      activeGoalText.innerText = `Goal: "${data.rawGoal || (data.parsedGoal ? data.parsedGoal.primaryGoal : '')}"`;

      const targetDuration = data.parsedGoal ? data.parsedGoal.duration : 25;
      startLiveTimer(data.focusStartTime, targetDuration);
    } else {
      setupView.style.display = "block";
      activeView.style.display = "none";
    }
  });

  startBtn.addEventListener("click", () => {
    const goalText = goalInput ? goalInput.value.trim() : "";
    const durationMins = parseInt(timerInput ? timerInput.value : 25, 10) || 25;

    if (!goalText) {
      if (statusDiv) statusDiv.innerText = "Please enter a focus goal.";
      return;
    }

    if (statusDiv) statusDiv.innerText = "Initializing focus goal...";

    chrome.runtime.sendMessage(
      { action: "PARSE_NATURAL_GOAL", text: goalText, duration: durationMins },
      (response) => {
        if (chrome.runtime.lastError) {
          if (statusDiv) statusDiv.innerText = "Error: Service worker inactive. Refresh YouTube.";
          return;
        }
        if (response && response.success) {
          if (statusDiv) statusDiv.innerText = "Focus Mode Active!";
          setTimeout(() => window.close(), 800);
        }
      }
    );
  });

  stopBtn.addEventListener("click", () => {
    if (timerInterval) clearInterval(timerInterval);

    chrome.runtime.sendMessage({ action: "LOG_SESSION_STOP", reason: "User Manual Stop" });

    chrome.storage.local.set({ activeSession: false }, () => {
      activeView.style.display = "none";
      setupView.style.display = "block";
      if (statusDiv) statusDiv.innerText = "Session ended.";
    });
  });
});