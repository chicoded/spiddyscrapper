const urlsEl = document.getElementById("urls");
const concurrencyEl = document.getElementById("concurrency");
const concurrencyValEl = document.getElementById("concurrency-val");
const chapterLimitEl = document.getElementById("chapter-limit");
const formatEl = document.getElementById("format");
const scrapeBtn = document.getElementById("scrape-btn");
const progressSection = document.getElementById("progress-section");
const progressList = document.getElementById("progress-list");
const resultsSection = document.getElementById("results-section");
const resultsList = document.getElementById("results-list");

const progressMap = new Map();

concurrencyEl.addEventListener("input", () => {
  concurrencyValEl.textContent = concurrencyEl.value;
});

scrapeBtn.addEventListener("click", startScrape);

async function startScrape() {
  const urls = urlsEl.value
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    alert("Please paste at least one novel URL.");
    return;
  }

  setLoading(true);
  progressSection.classList.remove("hidden");
  resultsSection.classList.add("hidden");
  progressList.innerHTML = "";
  resultsList.innerHTML = "";
  progressMap.clear();

  const body = {
    urls,
    concurrency: parseInt(concurrencyEl.value, 10),
    format: formatEl.value,
  };

  const limit = chapterLimitEl.value.trim();
  if (limit) body.chapter_limit = parseInt(limit, 10);

  try {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(await res.text());
    const { job_id } = await res.json();

    await listenToProgress(job_id);
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    setLoading(false);
  }
}

function listenToProgress(jobId) {
  return new Promise((resolve) => {
    const source = new EventSource(`/api/scrape/${jobId}/stream`);

    source.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "progress") {
        updateProgress(data);
      } else if (data.type === "done") {
        source.close();
        showResults(jobId, data.results);
        resolve();
      }
    };

    source.onerror = () => {
      source.close();
      fetch(`/api/scrape/${jobId}/status`)
        .then((r) => r.json())
        .then((job) => {
          if (job.results) showResults(jobId, job.results);
          resolve();
        })
        .catch(() => resolve());
    };
  });
}

function updateProgress(data) {
  let item = progressMap.get(data.url);

  if (!item) {
    item = document.createElement("div");
    item.className = "progress-item";
    item.innerHTML = `
      <div class="progress-header">
        <span class="progress-title">${escapeHtml(data.title || data.url)}</span>
        <span class="progress-count">0 / 0</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: 0%"></div>
      </div>
      <div class="progress-current">Starting...</div>
    `;
    progressList.appendChild(item);
    progressMap.set(data.url, item);
  }

  const total = data.total || 1;
  const completed = data.completed || 0;
  const pct = Math.round((completed / total) * 100);

  item.querySelector(".progress-title").textContent = data.title || data.url;
  item.querySelector(".progress-count").textContent = `${completed} / ${total}`;
  item.querySelector(".progress-bar-fill").style.width = `${pct}%`;
  item.querySelector(".progress-current").textContent =
    data.status === "completed"
      ? "Complete!"
      : `Downloading: ${data.current || "..."}`;
}

function showResults(jobId, results) {
  resultsSection.classList.remove("hidden");

  for (const result of results) {
    const item = document.createElement("div");
    item.className = "result-item" + (result.error ? " error" : "");

    if (result.error) {
      item.innerHTML = `
        <div class="result-info">
          <h3>Failed: ${escapeHtml(result.url || "Unknown")}</h3>
          <p>${escapeHtml(result.error)}</p>
        </div>
      `;
    } else {
      item.innerHTML = `
        <div class="result-info">
          <h3>${escapeHtml(result.title)}</h3>
          <p>${escapeHtml(result.author || "Unknown")} · ${result.chapters} chapters</p>
        </div>
        <button class="btn-download" data-file="${escapeHtml(result.filename)}">Download</button>
      `;
      item.querySelector(".btn-download").addEventListener("click", () => {
        window.location.href = `/api/download/${jobId}/${result.filename}`;
      });
    }

    resultsList.appendChild(item);
  }
}

function setLoading(loading) {
  scrapeBtn.disabled = loading;
  scrapeBtn.querySelector(".btn-text").classList.toggle("hidden", loading);
  scrapeBtn.querySelector(".btn-loader").classList.toggle("hidden", !loading);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
