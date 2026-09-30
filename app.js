"use strict";

// 데이터 파일은 index.html과 같은 폴더에 둡니다.
const DATA_URL = new URL("./신청목록.json", document.baseURI);
const LIMIT_PER_PERSON = 10;
const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 20 });
const elements = {
  approvedCount: document.getElementById("approved-count"),
  rejectedCount: document.getElementById("rejected-count"),
  approvedTotal: document.getElementById("approved-total"),
  recordCount: document.getElementById("record-count"),
  list: document.getElementById("application-list"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
  errorPanel: document.getElementById("error-panel"),
  errorMessage: document.getElementById("error-message"),
  retryButton: document.getElementById("retry-button")
};

function validateApplications(data) {
  if (!Array.isArray(data)) {
    throw new Error("JSON의 최상위 값은 신청 목록 배열이어야 합니다.");
  }
  data.forEach((item, index) => {
    const location = `${index + 1}번째 신청 자료`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${location}의 형식이 올바르지 않습니다.`);
    }
    if (typeof item.지자체명 !== "string" || !item.지자체명.trim()) {
      throw new Error(`${location}에 지자체명이 필요합니다.`);
    }
    for (const key of ["인구수", "신청액"]) {
      if (typeof item[key] !== "number" || !Number.isFinite(item[key]) || item[key] < 0) {
        throw new Error(`${location}의 ${key}은(는) 0 이상의 유효한 숫자여야 합니다.`);
      }
    }
    if (!Number.isSafeInteger(item.인구수) || item.인구수 * LIMIT_PER_PERSON > Number.MAX_SAFE_INTEGER || item.신청액 > Number.MAX_SAFE_INTEGER) {
      throw new Error(`${location}의 인구수 또는 금액이 처리 가능한 범위를 벗어났습니다.`);
    }
  });
  return data;
}

function judgeApplication(application) {
  const limit = application.인구수 * LIMIT_PER_PERSON;
  // 경계값을 포함합니다. 신청액이 한도액과 같으면 승인입니다.
  const approved = application.신청액 <= limit;
  return { ...application, limit, approved };
}

function appendCell(row, value, className = "", isHeading = false) {
  const cell = document.createElement(isHeading ? "th" : "td");
  cell.textContent = value;
  if (className) cell.className = className;
  if (isHeading) cell.scope = "row";
  row.appendChild(cell);
  return cell;
}

function renderApplications(applications) {
  const judged = applications.map(judgeApplication);
  const summary = judged.reduce((total, item) => {
    if (item.approved) {
      total.approved += 1;
      total.amount += item.신청액;
    } else {
      total.rejected += 1;
    }
    return total;
  }, { approved: 0, rejected: 0, amount: 0 });
  if (!Number.isFinite(summary.amount) || summary.amount > Number.MAX_SAFE_INTEGER) {
    throw new Error("승인 신청액 합계가 처리 가능한 범위를 벗어났습니다.");
  }

  const fragment = document.createDocumentFragment();
  judged.forEach((item) => {
    const row = document.createElement("tr");
    appendCell(row, item.지자체명, "", true);
    appendCell(row, numberFormat.format(item.인구수), "number");
    appendCell(row, numberFormat.format(item.신청액), "number");
    appendCell(row, numberFormat.format(item.limit), "number");
    const decisionCell = appendCell(row, "", "decision");
    const badge = document.createElement("span");
    badge.className = `badge ${item.approved ? "badge-approved" : "badge-rejected"}`;
    badge.textContent = item.approved ? "승인" : "반려";
    decisionCell.appendChild(badge);
    fragment.appendChild(row);
  });
  elements.list.replaceChildren(fragment);
  elements.approvedCount.textContent = numberFormat.format(summary.approved);
  elements.rejectedCount.textContent = numberFormat.format(summary.rejected);
  elements.approvedTotal.textContent = numberFormat.format(summary.amount);
  elements.recordCount.textContent = `총 ${numberFormat.format(judged.length)}건`;
  elements.status.textContent = judged.length
    ? `자동 판정이 완료되었습니다. 승인 ${summary.approved}건, 반려 ${summary.rejected}건입니다.`
    : "신청 목록이 비어 있습니다.";
}

async function loadApplications() {
  elements.results.setAttribute("aria-busy", "true");
  elements.retryButton.disabled = true;
  elements.errorPanel.hidden = true;
  elements.status.textContent = "신청목록.json을 불러오고 있습니다.";
  elements.recordCount.textContent = "불러오는 중";
  elements.list.replaceChildren();
  for (const element of [elements.approvedCount, elements.rejectedCount, elements.approvedTotal]) {
    element.textContent = "—";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    if (location.protocol === "file:") {
      throw new Error("파일을 직접 열면 JSON을 읽을 수 없습니다. Netlify/Vercel에 배포하거나 로컬 HTTP 서버에서 열어 주세요.");
    }
    const response = await fetch(DATA_URL, { cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      throw new Error(`신청목록.json을 불러오지 못했습니다. HTTP 상태: ${response.status}. 파일 이름과 배포 위치를 확인해 주세요.`);
    }
    let data;
    try {
      // UTF-8 BOM이 있는 JSON도 지원합니다.
      data = JSON.parse((await response.text()).replace(/^\uFEFF/, ""));
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error("신청목록.json의 JSON 문법 또는 UTF-8 인코딩을 확인해 주세요.");
    }
    renderApplications(validateApplications(data));
  } catch (error) {
    elements.recordCount.textContent = "불러오기 실패";
    elements.status.textContent = "자료를 불러오지 못해 판정하지 않았습니다.";
    elements.errorMessage.textContent = error.name === "AbortError"
      ? "자료를 읽는 시간이 초과되었습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요."
      : error instanceof TypeError
        ? "자료에 연결할 수 없습니다. 네트워크와 신청목록.json의 배포 위치를 확인해 주세요."
        : error.message;
    elements.errorPanel.hidden = false;
  } finally {
    clearTimeout(timeout);
    elements.results.setAttribute("aria-busy", "false");
    elements.retryButton.disabled = false;
  }
}

elements.retryButton.addEventListener("click", loadApplications);
loadApplications();
