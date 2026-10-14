const GEMINI_API_KEY = "AQ.Ab8RN6J0D6_jbf9rc6l1XguJCzUsoy8EwIbOe10SqrlZf4nVOA";
const PRISMTRACE_HOST = "https://prism.blockconvey.com";
const PRISMTRACE_PROJECT_ID = "bf542093-3681-478d-975d-ee3036341060";
const PRISMTRACE_API_KEY = "pt-sk-7279ddb9bcb9407ba49afb46dce7f653";

const GEMINI_MODEL = "gemini-1.5-flash";

function safeJSONParse(text) {
  try {
    const cleanedText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedText);
  } catch (err) {
    return null;
  }
}

// Step 2 Direct HTTP Telemetry Engine for Live PrismTrace Logging
async function logToPrismTrace(eventName, payloadData, latencyMs = 0) {
  try {
    const response = await fetch(`${PRISMTRACE_HOST}/api/traces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PRISMtrace-Key": PRISMTRACE_API_KEY
      },
      body: JSON.stringify({
        project_id: PRISMTRACE_PROJECT_ID,
        agent_id: "nogo-extension-agent",
        session_id: `session_${Date.now()}`,
        model: GEMINI_MODEL,
        input_messages: [{ role: "user", content: eventName }],
        output_message: JSON.stringify(payloadData),
        latency_ms: latencyMs
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[PrismTrace Error ${response.status}]:`, errText);
    } else {
      console.log(`[PrismTrace Recorded]: Event "${eventName}" sent live.`);
    }
  } catch (err) {
    console.error("[PrismTrace Connection Failure]:", err);
  }
}

function extractLocalKeywords(userPrompt) {
  const stopWords = ["study", "learn", "watch", "for", "mins", "minutes", "without", "distractions", "on", "youtube", "and", "the", "in", "to", "video", "videos", "tutorial", "tutorials", "course"];
  const words = userPrompt
    .toLowerCase()
    .replace(/[^\w\s]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w));

  return words.length > 0 ? words : [userPrompt.toLowerCase().trim()];
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PARSE_NATURAL_GOAL") {
    const startTime = Date.now();
    const localKeywords = extractLocalKeywords(request.text);
    const targetDuration = request.duration || 25;
    
    const instantGoal = {
      primaryGoal: request.text,
      allowedTopics: localKeywords,
      blockedTopics: ["gaming", "vlogs", "entertainment", "music", "comedy", "shorts"],
      duration: targetDuration
    };

    chrome.storage.local.set({
      rawGoal: request.text,
      parsedGoal: instantGoal,
      activeSession: true,
      focusStartTime: Date.now()
    }, () => {
      chrome.storage.local.remove('lastValidVideo');
      sendResponse({ success: true, parsed: instantGoal });
      
      logToPrismTrace("SESSION_START", { 
        prompt: request.text, 
        initialKeywords: localKeywords,
        targetDurationMins: targetDuration
      }, Date.now() - startTime);

      enhanceGoalWithGemini(request.text, instantGoal);
    });
    return true;
  }

  if (request.action === "LOG_SESSION_STOP") {
    chrome.storage.local.get(['focusStartTime', 'parsedGoal'], (data) => {
      const elapsedMins = data.focusStartTime ? Math.round((Date.now() - data.focusStartTime) / 60000) : 0;
      logToPrismTrace("SESSION_STOP", {
        reason: request.reason || "User Manual Stop",
        timeSpentMins: elapsedMins,
        targetMins: data.parsedGoal ? data.parsedGoal.duration : 0
      });
    });
    return true;
  }

  if (request.action === "LOG_FRICTION_ACTION") {
    logToPrismTrace("FRICTION_ACTION", {
      actionType: request.userAction,
      url: request.url
    });
    return true;
  }

  if (request.action === "EVALUATE_PAGE") {
    const { metadata, url } = request;
    if (!sender.tab || !sender.tab.id) return true;
    
    const tabId = sender.tab.id;

    chrome.storage.local.get(['parsedGoal', 'activeSession'], async (data) => {
      if (!data.activeSession || !data.parsedGoal) return;

      const evalResult = await evaluateContextFast(metadata, url, data.parsedGoal);
      handleEvalResult(tabId, evalResult);
    });
    return true;
  }

  if (request.action === "REAPPLY_CURRENT_OVERLAY") {
    if (sender.tab && sender.tab.id) {
      chrome.storage.local.get(['parsedGoal', 'activeSession'], (data) => {
        if (data.activeSession && data.parsedGoal) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "APPLY_FRICTION",
            evaluation: { reason: "Off-topic content blocked in Focus Mode." },
            goal: data.parsedGoal.primaryGoal
          }).catch(() => {});
        }
      });
    }
  }
});

async function enhanceGoalWithGemini(userPrompt, currentGoal) {
  const startTime = Date.now();
  const systemPrompt = `Extract allowed learning topics for goal: "${userPrompt}". Return strictly raw JSON: {"allowedTopics": ["topic1", "topic2"]}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
    });

    const data = await res.json();
    if (!data.error && data.candidates) {
      const parsed = safeJSONParse(data.candidates[0].content.parts[0].text);
      if (parsed && parsed.allowedTopics) {
        const combined = Array.from(new Set([...currentGoal.allowedTopics, ...parsed.allowedTopics.map(t => t.toLowerCase())]));
        chrome.storage.local.set({
          parsedGoal: { ...currentGoal, allowedTopics: combined }
        });
        logToPrismTrace("GOAL_ENHANCED", { original: userPrompt, enhancedTopics: combined }, Date.now() - startTime);
      }
    }
  } catch (e) {
    logToPrismTrace("GOAL_ENHANCE_FAILED", { error: e.message }, Date.now() - startTime);
  }
}

async function evaluateContextFast(metadata, pageUrl, parsedGoal) {
  const startTime = Date.now();

  if (pageUrl.includes("/shorts/")) {
    const result = {
      riskScore: 95,
      classification: "Highly distracting",
      reason: "Shorts are completely disabled during focus sessions."
    };
    logToPrismTrace("EVAL_SHORTS_BLOCKED", { url: pageUrl, metadata }, Date.now() - startTime);
    return result;
  }

  const prompt = `Focus Goal: "${parsedGoal.primaryGoal}"
Allowed Topics/Keywords: ${JSON.stringify(parsedGoal.allowedTopics)}
Current Video Title: "${metadata.title}"

Strict Decision Rules:
1. If the video title directly relates to learning or studying the topic, return riskScore 0.
2. If the video title is off-topic (entertainment, gaming, vlogs, news, off-topic tutorials), return riskScore 90.

Return strictly raw JSON format:
{
  "riskScore": 0 or 90,
  "reason": "short sentence explaining why it is on-topic or off-topic"
}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await res.json();
    const result = safeJSONParse(data.candidates[0].content.parts[0].text);
    const finalResult = result || performLocalFallback(metadata, parsedGoal);

    logToPrismTrace("EVAL_GEMINI_RESULT", { url: pageUrl, metadata, eval: finalResult }, Date.now() - startTime);
    return finalResult;
  } catch (err) {
    const fallbackResult = performLocalFallback(metadata, parsedGoal);
    logToPrismTrace("EVAL_FALLBACK_RESULT", { url: pageUrl, metadata, eval: fallbackResult, error: err.message }, Date.now() - startTime);
    return fallbackResult;
  }
}

function performLocalFallback(metadata, parsedGoal) {
  const titleLower = (metadata.title || "").toLowerCase();
  const allowed = parsedGoal.allowedTopics || [];

  const isMatch = allowed.some(t => t.length > 2 && titleLower.includes(t.toLowerCase()));

  return {
    riskScore: isMatch ? 0 : 90,
    classification: isMatch ? "Productive" : "Highly distracting",
    reason: isMatch 
      ? "Video matches focus topic keywords." 
      : `Off-topic video. Title does not match focus goal: "${parsedGoal.primaryGoal}"`
  };
}

function handleEvalResult(tabId, result) {
  chrome.storage.local.get(['parsedGoal', 'activeSession'], (data) => {
    if (!data.activeSession || !data.parsedGoal) return;

    if (result.riskScore > 70) {
      chrome.tabs.sendMessage(tabId, {
        action: "APPLY_FRICTION",
        evaluation: result,
        goal: data.parsedGoal.primaryGoal
      }).catch(() => {});
    } else {
      chrome.tabs.sendMessage(tabId, { action: "REMOVE_FRICTION" }).catch(() => {});
    }
  });
}

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.url && (details.url.includes("youtube.com/watch") || details.url.includes("youtube.com/shorts"))) {
    chrome.tabs.sendMessage(details.tabId, { action: "URL_CHANGED" }).catch(() => {});
  }
});