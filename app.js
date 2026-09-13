const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const STATUS_LABELS = Object.freeze({
  complete: "Complete",
  ready: "Ready",
  ongoing: "Ongoing",
  planned: "Planned",
  blocked: "Blocked",
  failed: "Failed",
});
const STATUS_CLASSES = new Set(Object.keys(STATUS_LABELS));

const statusState = document.querySelector("#status-state");
const verifiedStats = document.querySelector("#verified-stats");
const runtimeWork = document.querySelector("#runtime-work");
const masterStats = document.querySelector("#master-stats");
const masterItems = document.querySelector("#master-items");
const roadmapStats = document.querySelector("#roadmap-stats");
const roadmapItems = document.querySelector("#roadmap-items");
const contentState = document.querySelector("#content-state");
const searchInput = document.querySelector("#search");
const statusFilter = document.querySelector("#status-filter");

let publicStatus;

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

function requireStatus(value) {
  const status = requireString(value);
  if (!STATUS_CLASSES.has(status)) {
    throw new Error("Invalid public status");
  }
  return status;
}

function requireInteger(value, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error("Invalid public status");
  }
  return value;
}

function validateList(value, validator) {
  if (!Array.isArray(value)) {
    throw new Error("Invalid public status");
  }
  return value.map(validator);
}

function validateStatus(data) {
  if (!isObject(data) || data.schemaVersion !== 3) {
    throw new Error("Invalid public status");
  }
  const milestone = data.currentMilestone;
  const checklist = data.masterChecklist;
  const runtime = data.runtime;
  const tests = data.tests;
  if (
    !isObject(milestone) ||
    !isObject(checklist) ||
    !isObject(runtime) ||
    !isObject(tests)
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
  const masterChecklist = validateList(checklist.items, (item, index) => {
    if (!isObject(item) || requireInteger(item.order, 1) !== index + 1) {
      throw new Error("Invalid public status");
    }
    return {
      order: item.order,
      id: requireString(item.id),
      title: requireString(item.title),
      status: requireStatus(item.status),
    };
  });
  const currentItemId = requireString(checklist.currentItemId);
  if (!masterChecklist.some((item) => item.id === currentItemId)) {
    throw new Error("Invalid public status");
  }
  const milestones = validateList(data.milestones, (item) => {
    if (!isObject(item)) {
      throw new Error("Invalid public status");
    }
    return {
      id: requireString(item.id),
      title: requireString(item.name),
      status: requireStatus(item.status),
    };
  });
  const activeWork = validateList(data.activeWork, (item) => {
    if (!isObject(item)) {
      throw new Error("Invalid public status");
    }
    return {
      id: requireString(item.taskId),
      title: requireString(item.title),
      status: requireStatus(item.status),
      blockedReason:
        item.blockedReason === null ? null : requireString(item.blockedReason),
    };
  });
  return {
    currentMilestone: {
      id: requireString(milestone.id),
      title: requireString(milestone.title),
      status: requireStatus(milestone.status),
    },
    masterChecklist,
    currentItemId,
    milestones,
    activeWork,
    runtime: { jarvisStatus: requireString(runtime.jarvisStatus) },
    tests: {
      passed: requireInteger(tests.passed),
      failed: requireInteger(tests.failed),
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

function setStatusState(state, message) {
  statusState.classList.remove("loading", "fresh", "stale", "error");
  statusState.classList.add(state);
  statusState.textContent = message;
}

function itemRow(item, identity) {
  const row = element("div", ["task"]);
  const badge = element("span", ["status", statusClass(item.status)]);
  badge.textContent = statusLabel(item.status);
  row.append(
    element("div", ["task-id"], identity),
    element("div", [], item.title),
    badge,
  );
  return row;
}

function itemPanel(title, subtitle, items) {
  const panel = element("article", ["epic"]);
  const heading = element("div", ["epic-head"]);
  const titleGroup = element("div");
  titleGroup.append(element("div", ["task-id"], subtitle), element("h3", [], title));
  heading.append(titleGroup);
  panel.append(heading, ...items);
  return panel;
}

function matches(item) {
  const query = searchInput.value.toLowerCase();
  const filter = statusFilter.value;
  return (
    (filter === "all" || item.status === filter) &&
    `${item.id} ${item.title}`.toLowerCase().includes(query)
  );
}

function renderLists() {
  const masterRows = publicStatus.masterChecklist
    .filter(matches)
    .map((item) => itemRow(item, String(item.order)));
  masterItems.replaceChildren(
    itemPanel("Ordered execution sequence", "MASTER", masterRows),
  );

  const roadmapRows = publicStatus.milestones
    .filter(matches)
    .map((item) => itemRow(item, item.id));
  roadmapItems.replaceChildren(
    itemPanel("AS-21 through AS-39", "PRODUCT", roadmapRows),
  );
}

function renderStatus(status) {
  const verifiedAt = Date.parse(status.lastVerifiedAt);
  const age = Date.now() - verifiedAt;
  const future = verifiedAt - Date.now() > FUTURE_TOLERANCE_MS;
  setStatusState(
    future || age > STALE_AFTER_MS ? "stale" : "fresh",
    future || age > STALE_AFTER_MS
      ? "Public status is stale"
      : "Public status is current",
  );

  const currentGate = status.masterChecklist.find(
    (item) => item.id === status.currentItemId,
  );
  verifiedStats.replaceChildren(
    statCard(
      status.currentMilestone.id,
      `${status.currentMilestone.title} — ${statusLabel(status.currentMilestone.status)}`,
    ),
    statCard(
      `Item ${currentGate.order}`,
      `${currentGate.title} — ${statusLabel(currentGate.status)}`,
    ),
    statCard(status.activeWork.length, "Safe Parallel tasks"),
    statCard(status.runtime.jarvisStatus, "Jarvis runtime"),
    statCard(status.tests.passed, `${status.tests.failed} tests failed`),
    statCard(status.sourceCommit, "Source commit", ["commit-stat"]),
  );

  if (status.activeWork.length) {
    runtimeWork.replaceChildren(
      itemPanel(
        "Safe Parallel lifecycle",
        "LIVE",
        status.activeWork.map((item) => itemRow(item, item.id)),
      ),
    );
  } else {
    runtimeWork.replaceChildren(
      itemPanel("Jarvis is idle", "LIVE", [
        element("p", ["message"], "No active Safe Parallel work."),
      ]),
    );
  }

  const completedMaster = status.masterChecklist.filter(
    (item) => item.status === "complete",
  ).length;
  masterStats.replaceChildren(
    statCard(status.masterChecklist.length, "Ordered items"),
    statCard(completedMaster, "Complete"),
    statCard(currentGate.order, "Current / next item"),
  );
  const completedMilestones = status.milestones.filter(
    (item) => item.status === "complete",
  ).length;
  roadmapStats.replaceChildren(
    statCard(status.milestones.length, "Product milestones"),
    statCard(completedMilestones, "Complete"),
    statCard(status.currentMilestone.id, "Next product milestone"),
  );
  searchInput.disabled = false;
  statusFilter.disabled = false;
  contentState.classList.add("visually-hidden");
  renderLists();
}

async function loadStatus() {
  setStatusState("loading", "Loading public status…");
  try {
    const response = await fetch("data/status.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Status request failed");
    }
    publicStatus = validateStatus(await response.json());
    renderStatus(publicStatus);
  } catch {
    setStatusState("error", "Public status unavailable");
    contentState.classList.remove("visually-hidden");
    contentState.textContent = "Validated public status is unavailable.";
  }
}

searchInput.addEventListener("input", () => publicStatus && renderLists());
statusFilter.addEventListener("change", () => publicStatus && renderLists());
loadStatus();
