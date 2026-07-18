const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const STATUS_LABELS = Object.freeze({
  complete: "Complete",
  current: "Current",
  in_progress: "In progress",
  planned: "Planned",
  blocked: "Blocked",
  paused: "Paused",
});
const STATUS_CLASSES = new Set(Object.keys(STATUS_LABELS));

const statusState = document.querySelector("#status-state");
const verifiedStats = document.querySelector("#verified-stats");
const checklistStats = document.querySelector("#checklist-stats");
const checklistState = document.querySelector("#checklist-state");
const searchInput = document.querySelector("#search");
const statusFilter = document.querySelector("#status-filter");
const epicsContainer = document.querySelector("#epics");

let checklist;

function element(tagName, classes = [], text) {
  const node = document.createElement(tagName);
  if (classes.length) {
    node.classList.add(...classes);
  }
  if (text !== undefined) {
    node.textContent = String(text);
  }
  return node;
}

function statCard(value, label, extraClasses = []) {
  const card = element("div", ["stat", ...extraClasses]);
  card.append(element("strong", [], value), element("span", [], label));
  return card;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Invalid public status");
  }
  return value;
}

function requireNonNegativeInteger(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Invalid public status");
  }
  return value;
}

function validateStatus(data) {
  if (!isObject(data)) {
    throw new Error("Invalid public status");
  }

  const milestone = data.currentMilestone;
  const acceleration = data.currentAccelerationItem;
  const tests = data.tests;
  if (!isObject(milestone) || !isObject(acceleration) || !isObject(tests)) {
    throw new Error("Invalid public status");
  }

  const completed = data.completedAccelerationItems;
  if (
    !Array.isArray(completed) ||
    completed.some((item) => !Number.isInteger(item) || item <= 0)
  ) {
    throw new Error("Invalid public status");
  }

  const sourceCommit = requireString(data.sourceCommit);
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new Error("Invalid public status");
  }

  const lastVerifiedAt = requireString(data.lastVerifiedAt);
  if (!lastVerifiedAt.endsWith("Z") || !Number.isFinite(Date.parse(lastVerifiedAt))) {
    throw new Error("Invalid public status");
  }

  return {
    currentMilestone: {
      id: requireString(milestone.id),
      title: requireString(milestone.title),
      status: requireString(milestone.status),
    },
    completedAccelerationItems: completed,
    currentAccelerationItem: {
      id: requireNonNegativeInteger(acceleration.id),
      title: requireString(acceleration.title),
      status: requireString(acceleration.status),
    },
    tests: {
      passed: requireNonNegativeInteger(tests.passed),
      failed: requireNonNegativeInteger(tests.failed),
    },
    sourceCommit,
    lastVerifiedAt,
  };
}

function statusLabel(status) {
  return STATUS_LABELS[status] || "Unknown";
}

function statusClass(status) {
  return STATUS_CLASSES.has(status) ? status : "unknown";
}

function setVerifiedState(state, message) {
  statusState.classList.remove("loading", "fresh", "stale", "error");
  statusState.classList.add(state);
  statusState.textContent = message;
}

function renderVerifiedStatus(status) {
  const verifiedAt = Date.parse(status.lastVerifiedAt);
  const age = Date.now() - verifiedAt;
  const future = verifiedAt - Date.now() > FUTURE_TOLERANCE_MS;
  if (future || age > STALE_AFTER_MS) {
    setVerifiedState("stale", "Verified status is stale");
  } else {
    setVerifiedState("fresh", "Verified status is current");
  }

  const milestoneDetail = `${status.currentMilestone.title} — ${statusLabel(
    status.currentMilestone.status,
  )}`;
  const completedDetail = status.completedAccelerationItems.length
    ? `Items ${status.completedAccelerationItems.join(", ")}`
    : "No completed items";
  const accelerationDetail = `${status.currentAccelerationItem.title} — ${statusLabel(
    status.currentAccelerationItem.status,
  )}`;
  const testDetail = `Passing tests · ${status.tests.failed} failed`;
  const verifiedDate = new Date(verifiedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

  verifiedStats.replaceChildren(
    statCard(status.currentMilestone.id, milestoneDetail),
    statCard(status.completedAccelerationItems.length, completedDetail),
    statCard(`Item ${status.currentAccelerationItem.id}`, accelerationDetail),
    statCard(status.tests.passed, testDetail),
    statCard(status.sourceCommit, "Verified source commit", ["commit-stat"]),
    statCard(verifiedDate, status.lastVerifiedAt),
  );
}

function validateChecklist(data) {
  if (!isObject(data) || !Array.isArray(data.epics)) {
    throw new Error("Invalid checklist");
  }
  for (const epic of data.epics) {
    if (
      !isObject(epic) ||
      typeof epic.id !== "string" ||
      typeof epic.title !== "string" ||
      !Array.isArray(epic.tasks)
    ) {
      throw new Error("Invalid checklist");
    }
    for (const task of epic.tasks) {
      if (
        !isObject(task) ||
        typeof task.id !== "string" ||
        typeof task.title !== "string" ||
        typeof task.status !== "string"
      ) {
        throw new Error("Invalid checklist");
      }
    }
  }
  return data;
}

function allTasks() {
  return checklist.epics.flatMap((epic) => epic.tasks);
}

function renderChecklistSummary() {
  const tasks = allTasks();
  const completed = tasks.filter((task) => task.status === "complete").length;
  const percentage = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  checklistStats.replaceChildren(
    statCard(checklist.epics.length, "Epics"),
    statCard(tasks.length, "Total tasks"),
    statCard(completed, "Completed"),
    statCard(`${percentage}%`, "Overall progress"),
  );
}

function taskCard(task) {
  const card = element("div", ["task"]);
  const badge = element("span", ["status", statusClass(task.status)]);
  badge.textContent = statusLabel(task.status);
  card.append(
    element("div", ["task-id"], task.id),
    element("div", [], task.title),
    badge,
  );
  return card;
}

function epicCard(epic, visibleTasks) {
  const card = element("article", ["epic"]);
  const heading = element("div", ["epic-head"]);
  const titleGroup = element("div");
  const percentage = epic.tasks.length
    ? Math.round(
        (epic.tasks.filter((task) => task.status === "complete").length /
          epic.tasks.length) *
          100,
      )
    : 0;

  titleGroup.append(
    element("div", ["task-id"], epic.id),
    element("h3", [], epic.title),
  );
  heading.append(titleGroup, element("span", [], `${percentage}%`));

  const progress = element("div", ["progress"]);
  const progressFill = element("span");
  progressFill.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
  progress.append(progressFill);

  card.append(heading, progress, ...visibleTasks.map(taskCard));
  return card;
}

function drawEpics() {
  const query = searchInput.value.toLowerCase();
  const filter = statusFilter.value;
  const cards = [];

  for (const epic of checklist.epics) {
    const visibleTasks = epic.tasks.filter(
      (task) =>
        (filter === "all" || task.status === filter) &&
        `${task.id} ${task.title}`.toLowerCase().includes(query),
    );
    if (visibleTasks.length) {
      cards.push(epicCard(epic, visibleTasks));
    }
  }

  epicsContainer.replaceChildren(...cards);
}

async function loadVerifiedStatus() {
  setVerifiedState("loading", "Loading verified status…");
  try {
    const response = await fetch("data/status.json");
    if (!response.ok) {
      throw new Error("Status request failed");
    }
    renderVerifiedStatus(validateStatus(await response.json()));
  } catch {
    verifiedStats.replaceChildren();
    setVerifiedState("error", "Verified status unavailable");
  }
}

async function loadChecklist() {
  try {
    const response = await fetch("data/checklist.json");
    if (!response.ok) {
      throw new Error("Checklist request failed");
    }
    checklist = validateChecklist(await response.json());
    searchInput.disabled = false;
    statusFilter.disabled = false;
    checklistState.textContent = "";
    checklistState.classList.add("visually-hidden");
    renderChecklistSummary();
    drawEpics();
  } catch {
    checklistStats.replaceChildren();
    epicsContainer.replaceChildren();
    searchInput.disabled = true;
    statusFilter.disabled = true;
    checklistState.classList.remove("visually-hidden");
    checklistState.textContent = "Checklist unavailable.";
  }
}

searchInput.addEventListener("input", () => {
  if (checklist) {
    drawEpics();
  }
});
statusFilter.addEventListener("change", () => {
  if (checklist) {
    drawEpics();
  }
});

loadVerifiedStatus();
loadChecklist();
