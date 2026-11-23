/**
 * ==========================================
 * 國小體育器材借還系統 - 前端主程式
 * ==========================================
 */

const APP_CONFIG = {
  // 1. 填入部署完成的獨立 GAS Web App 網址 (/exec 結尾)
  GAS_API_URL: 'https://script.google.com/macros/s/AKfycbwiKIUQUY4F2rBTsr5jv6PE7He5lFWzdRXLvfRcXaZR__PNJ-_MnZ2jo4Ukve5BGc8oEg/exec',

  // 2. 填入 Google Cloud OAuth 2.0 用戶端 ID (必須與 Code.gs 一致)
  GOOGLE_CLIENT_ID: '341910377782-3unva3oggi84vp88uga23horpumjaptt.apps.googleusercontent.com'
};

// 全域狀態管理
const state = {
  idToken: sessionStorage.getItem('pe_id_token') || '',
  user: null,
  equipment: [],
  myActiveLogs: [],
  myHistoryLogs: [],
  adminData: null,
  cart: {}, // { eqId: qty }
  selectedCategory: '全部',
  searchKeyword: ''
};

let eqModalInstance = null;

// 初始化入口
window.addEventListener('DOMContentLoaded', () => {
  eqModalInstance = new bootstrap.Modal(document.getElementById('eqModal'));
  bindEvents();
  initGoogleAuth();
});

function bindEvents() {
  // 登出
  document.getElementById('btnLogout').addEventListener('click', logout);

  // 送出老師帳號申請
  document.getElementById('formApply').addEventListener('submit', handleApplySubmit);

  // 搜尋器材
  document.getElementById('searchEqInput').addEventListener('input', (e) => {
    state.searchKeyword = e.target.value.trim().toLowerCase();
    renderEquipmentGrid();
  });

  // 送出借用清單
  document.getElementById('formBorrowSubmit').addEventListener('submit', handleBorrowSubmit);

  // 管理員儲存器材
  document.getElementById('formEqSave').addEventListener('submit', handleEqSaveSubmit);
}

/**
 * 初始化 Google 登入按鈕 (Google Identity Services)
 */
function initGoogleAuth() {
  const waitGIS = setInterval(() => {
    if (window.google && google.accounts && google.accounts.id) {
      clearInterval(waitGIS);
      google.accounts.id.initialize({
        client_id: APP_CONFIG.GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse
      });

      google.accounts.id.renderButton(
        document.getElementById('googleBtnContainer'),
        { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: 260 }
      );

      // 若 sessionStorage 已有 token，自動驗證恢復登入狀態
      if (state.idToken) {
        verifyAuthWithBackend(true);
      }
    }
  }, 150);
}

function handleGoogleCredentialResponse(response) {
  state.idToken = response.credential;
  sessionStorage.setItem('pe_id_token', state.idToken);
  verifyAuthWithBackend(false);
}

/**
 * 呼叫 GAS API 共用函式 (使用 text/plain 避開 CORS 預檢)
 */
async function callGasApi(action, payload = {}, showGlobalLoader = true) {
  if (showGlobalLoader) toggleLoader(true);
  try {
    const res = await fetch(APP_CONFIG.GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({
        action: action,
        idToken: state.idToken,
        ...payload
      })
    });

    const data = await res.json();
    if (!data.success && data.code === 'INVALID_TOKEN') {
      Swal.fire('登入已過期', '為了帳號安全，請重新使用學校 Google 帳號登入。', 'warning').then(() => {
        logout();
      });
      return null;
    }
    return data;
  } catch (err) {
    console.error('API Error:', err);
    Swal.fire('連線錯誤', '無法連接系統伺服器，請確認網路或 GAS 部署設定。', 'error');
    return null;
  } finally {
    if (showGlobalLoader) toggleLoader(false);
  }
}

/**
 * 驗證使用者帳號與審核狀態
 */
async function verifyAuthWithBackend(isAutoRestore) {
  document.getElementById('loginLoading').classList.remove('d-none');
  const res = await callGasApi('checkAuth', {}, !isAutoRestore);
  document.getElementById('loginLoading').classList.add('d-none');

  if (!res) return;
  if (!res.success) {
    if (isAutoRestore) {
      logout();
    } else {
      Swal.fire('無法登入', res.error || '驗證失敗', 'error');
    }
    return;
  }

  if (res.authStatus === 'UNREGISTERED') {
    showSection('viewApply');
    document.getElementById('applyEmail').value = res.email;
    document.getElementById('applyName').value = res.googleName || '';
    document.getElementById('navUserArea').classList.remove('d-none');
    document.getElementById('navUserName').textContent = res.email;
  } else if (res.authStatus === 'PENDING') {
    showSection('viewPending');
    document.getElementById('navUserArea').classList.remove('d-none');
    document.getElementById('navUserName').textContent = res.user.name;
    document.getElementById('pendingIcon').className = 'bi bi-hourglass-split fs-1 text-warning mb-3';
    document.getElementById('pendingTitle').textContent = '帳號審核中';
    document.getElementById('pendingDesc').innerHTML = `${escapeHtml(res.user.name)} 老師您好，您的申請已送交體育組。<br>審核通過後即可開始借用器材！`;
  } else if (res.authStatus === 'REJECTED') {
    showSection('viewPending');
    document.getElementById('navUserArea').classList.remove('d-none');
    document.getElementById('navUserName').textContent = res.user.name;
    document.getElementById('pendingIcon').className = 'bi bi-slash-circle fs-1 text-danger mb-3';
    document.getElementById('pendingTitle').textContent = '帳號未核准 / 已停權';
    document.getElementById('pendingDesc').textContent = '您的帳號目前無法使用本系統，如有疑問請洽體育組。';
  } else if (res.authStatus === 'APPROVED') {
    state.user = res.user;
    enterMainApp();
  }
}

async function handleApplySubmit(e) {
  e.preventDefault();
  const name = document.getElementById('applyName').value.trim();
  const titleClass = document.getElementById('applyTitleClass').value.trim();
  const phone = document.getElementById('applyPhone').value.trim();

  const res = await callGasApi('applyAccount', { name, titleClass, phone });
  if (res && res.success) {
    await Swal.fire('申請已送出', res.message, 'success');
    verifyAuthWithBackend(false);
  } else if (res) {
    Swal.fire('申請失敗', res.error, 'error');
  }
}

async function enterMainApp() {
  showSection('viewApp');
  document.getElementById('navUserArea').classList.remove('d-none');
  document.getElementById('navUserName').textContent = `${state.user.name} (${state.user.titleClass})`;

  if (state.user.role === 'ADMIN') {
    document.getElementById('navAdminBadge').classList.remove('d-none');
    document.getElementById('navItemAdmin').classList.remove('d-none');
  } else {
    document.getElementById('navAdminBadge').classList.add('d-none');
    document.getElementById('navItemAdmin').classList.add('d-none');
  }

  await refreshData();
}

async function refreshData() {
  const res = await callGasApi('getInitialData');
  if (!res || !res.success) return;

  state.user = res.user;
  state.equipment = res.equipment || [];
  state.myActiveLogs = res.myActiveLogs || [];
  state.myHistoryLogs = res.myHistoryLogs || [];
  state.adminData = res.adminData || null;

  renderCategories();
  renderEquipmentGrid();
  renderCartUI();
  renderMyLogs();

  if (state.user.role === 'ADMIN' && state.adminData) {
    renderAdminPanel();
  }
}

/* ================== 借用器材介面 ================== */

function renderCategories() {
  const categories = ['全部', ...new Set(state.equipment.filter(e => e.active).map(e => e.category))];
  const container = document.getElementById('categoryFilterGroup');
  container.innerHTML = categories.map(cat => {
    const activeCls = state.selectedCategory === cat ? 'btn-primary' : 'btn-outline-secondary bg-white';
    return `<button type="button" class="btn btn-sm ${activeCls} rounded-pill px-3" onclick="selectCategory('${escapeHtml(cat)}')">${escapeHtml(cat)}</button>`;
  }).join('');
}

window.selectCategory = function (cat) {
  state.selectedCategory = cat;
  renderCategories();
  renderEquipmentGrid();
};

function renderEquipmentGrid() {
  const grid = document.getElementById('equipmentGrid');
  const filtered = state.equipment.filter(eq => {
    if (!eq.active) return false;
    const matchCat = state.selectedCategory === '全部' || eq.category === state.selectedCategory;
    const matchSearch = !state.searchKeyword ||
      eq.name.toLowerCase().includes(state.searchKeyword) ||
      eq.location.toLowerCase().includes(state.searchKeyword);
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="col-12 text-center py-5 text-muted">沒有符合條件的器材</div>`;
    return;
  }

  grid.innerHTML = filtered.map(eq => {
    const inCartQty = state.cart[eq.id] || 0;
    const isOut = eq.availableQty <= 0;
    const badgeColor = eq.availableQty === 0 ? 'bg-danger' : (eq.availableQty <= 3 ? 'bg-warning text-dark' : 'bg-success');

    return `
      <div class="col-12 col-sm-6 col-lg-4">
        <div class="card eq-card border-0 shadow-sm h-100">
          <div class="card-body d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <span class="badge bg-primary bg-opacity-10 text-primary">${escapeHtml(eq.category)}</span>
                <span class="badge eq-stock-badge ${badgeColor}">可借 ${eq.availableQty} / ${eq.totalQty} ${escapeHtml(eq.unit)}</span>
              </div>
              <h5 class="card-title fw-bold mb-1">${escapeHtml(eq.name)}</h5>
              <p class="text-muted small mb-1"><i class="bi bi-geo-alt-fill text-secondary me-1"></i>位置：${escapeHtml(eq.location || '未標示')}</p>
              ${eq.note ? `<p class="text-secondary small mb-2"><i class="bi bi-info-circle me-1"></i>${escapeHtml(eq.note)}</p>` : ''}
            </div>

            <div class="mt-3 pt-2 border-top d-flex align-items-center justify-content-between">
              ${isOut ? `<span class="text-danger small fw-bold w-100 text-center">目前已全數借出</span>` :
                inCartQty > 0 ? `
                  <div class="input-group input-group-sm w-100">
                    <button class="btn btn-outline-primary fw-bold" onclick="updateCart('${eq.id}', -1)"><i class="bi bi-dash"></i></button>
                    <input type="number" class="form-control text-center fw-bold" value="${inCartQty}" min="0" max="${eq.availableQty}" onchange="setCartExact('${eq.id}', this.value)">
                    <button class="btn btn-outline-primary fw-bold" onclick="updateCart('${eq.id}', 1)"><i class="bi bi-plus"></i></button>
                  </div>
                ` : `
                  <button class="btn btn-outline-primary btn-sm w-100 fw-bold" onclick="updateCart('${eq.id}', 1)">
                    <i class="bi bi-plus-circle me-1"></i> 加入借用清單
                  </button>
                `
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.updateCart = function (eqId, delta) {
  const eq = state.equipment.find(e => e.id === eqId);
  if (!eq) return;
  const current = state.cart[eqId] || 0;
  const next = current + delta;

  if (next <= 0) {
    delete state.cart[eqId];
  } else if (next > eq.availableQty) {
    Swal.fire({ toast: true, position: 'top', icon: 'warning', title: `最多僅剩 ${eq.availableQty} ${eq.unit}`, showConfirmButton: false, timer: 1800 });
    return;
  } else {
    state.cart[eqId] = next;
  }
  renderEquipmentGrid();
  renderCartUI();
};

window.setCartExact = function (eqId, val) {
  const eq = state.equipment.find(e => e.id === eqId);
  if (!eq) return;
  let num = parseInt(val, 10);
  if (isNaN(num) || num <= 0) {
    delete state.cart[eqId];
  } else {
    if (num > eq.availableQty) {
      num = eq.availableQty;
      Swal.fire({ toast: true, position: 'top', icon: 'warning', title: `已自動調整為最大可借數 ${eq.availableQty}`, showConfirmButton: false, timer: 1800 });
    }
    state.cart[eqId] = num;
  }
  renderEquipmentGrid();
  renderCartUI();
};

function renderCartUI() {
  const keys = Object.keys(state.cart);
  const totalTypes = keys.length;
  const floatingBtn = document.getElementById('floatingCartBtn');
  document.getElementById('cartCount').textContent = totalTypes;

  if (totalTypes > 0) {
    floatingBtn.classList.remove('d-none');
  } else {
    floatingBtn.classList.add('d-none');
  }

  const listEl = document.getElementById('cartItemsList');
  if (totalTypes === 0) {
    listEl.innerHTML = `<p class="text-muted text-center my-4">尚未選擇任何器材</p>`;
    return;
  }

  listEl.innerHTML = keys.map(eqId => {
    const eq = state.equipment.find(e => e.id === eqId);
    if (!eq) return '';
    return `
      <div class="d-flex justify-content-between align-items-center border-bottom py-2">
        <div>
          <div class="fw-bold small">${escapeHtml(eq.name)}</div>
          <div class="text-muted" style="font-size: 0.75rem;">剩餘可借：${eq.availableQty} ${escapeHtml(eq.unit)}</div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="badge bg-primary rounded-pill">${state.cart[eqId]} ${escapeHtml(eq.unit)}</span>
          <button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="setCartExact('${eq.id}', 0)"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

async function handleBorrowSubmit(e) {
  e.preventDefault();
  const items = Object.keys(state.cart).map(eqId => ({ eqId, qty: state.cart[eqId] }));
  if (!items.length) return;

  const classUsed = document.getElementById('borrowClassUsed').value.trim();
  const expectedReturn = document.getElementById('borrowExpectedReturn').value;

  const res = await callGasApi('borrowItems', { items, classUsed, expectedReturn });
  if (res && res.success) {
    state.cart = {};
    document.getElementById('formBorrowSubmit').reset();
    const offcanvasEl = document.getElementById('cartOffcanvas');
    const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasEl);
    if (offcanvasInstance) offcanvasInstance.hide();

    await Swal.fire('借用成功', res.message, 'success');
    await refreshData();
  } else if (res) {
    Swal.fire('借用失敗', res.error, 'error');
    await refreshData();
  }
}

/* ================== 我的借還介面 ================== */

function renderMyLogs() {
  const badge = document.getElementById('badgeMyBorrowCount');
  if (state.myActiveLogs.length > 0) {
    badge.textContent = state.myActiveLogs.length;
    badge.classList.remove('d-none');
  } else {
    badge.classList.add('d-none');
  }

  const activeList = document.getElementById('myActiveLogsList');
  if (state.myActiveLogs.length === 0) {
    activeList.innerHTML = `<div class="col-12"><div class="alert alert-success border-0 shadow-sm small mb-0"><i class="bi bi-check-circle me-1"></i>您目前沒有尚未歸還的器材。</div></div>`;
  } else {
    activeList.innerHTML = state.myActiveLogs.map(log => `
      <div class="col-12 col-md-6">
        <div class="card border-start border-4 border-danger border-0 shadow-sm">
          <div class="card-body d-flex justify-content-between align-items-center">
            <div>
              <h6 class="fw-bold mb-1">${escapeHtml(log.eqName)} <span class="badge bg-danger ms-1">${log.qty} ${escapeHtml(log.unit)}</span></h6>
              <div class="text-muted small">用途：${escapeHtml(log.classUsed)} | 預計：${escapeHtml(log.expectedReturn)}</div>
              <div class="text-secondary" style="font-size:0.75rem;">借出時間：${escapeHtml(log.borrowTime)}</div>
            </div>
            <button class="btn btn-success btn-sm fw-bold px-3 text-nowrap ms-2" onclick="promptReturn('${log.logId}', '${escapeHtml(log.eqName)}', ${log.qty}, '${escapeHtml(log.unit)}')">
              <i class="bi bi-box-arrow-in-down"></i> 歸還
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  const historyTbody = document.getElementById('myHistoryLogsTable');
  if (state.myHistoryLogs.length === 0) {
    historyTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">尚無歷史歸還紀錄</td></tr>`;
  } else {
    historyTbody.innerHTML = state.myHistoryLogs.map(l => `
      <tr>
        <td class="fw-bold">${escapeHtml(l.eqName)}</td>
        <td>${l.qty} ${escapeHtml(l.unit)}</td>
        <td>${escapeHtml(l.classUsed)}</td>
        <td>${escapeHtml(l.borrowTime)}</td>
        <td>${escapeHtml(l.returnTime)}</td>
        <td>
          ${l.status === 'ISSUE_HOLD'
            ? `<span class="badge bg-warning text-dark">異常待修</span> <small class="text-danger">${escapeHtml(l.conditionNote)}</small>`
            : `<span class="badge bg-success">已歸還</span> ${l.conditionNote ? `<small class="text-muted">(${escapeHtml(l.conditionNote)})</small>` : ''}`
          }
        </td>
      </tr>
    `).join('');
  }
}

window.promptReturn = async function (logId, eqName, qty, unit) {
  const { value: formValues } = await Swal.fire({
    title: `歸還：${eqName} (${qty} ${unit})`,
    html: `
      <div class="text-start">
        <label class="form-label small fw-bold">器材狀況備註 (選填)</label>
        <input id="swalReturnNote" class="form-control form-control-sm mb-3" placeholder="正常免填；若有破損/漏氣請註明">
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="swalHoldStock">
          <label class="form-check-label small text-danger fw-bold" for="swalHoldStock">
            器材遺失或嚴重損壞（暫不加回可借庫存，交由體育組處理）
          </label>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '確認歸還',
    cancelButtonText: '取消',
    confirmButtonColor: '#198754',
    preConfirm: () => ({
      conditionNote: document.getElementById('swalReturnNote').value.trim(),
      holdStock: document.getElementById('swalHoldStock').checked
    })
  });

  if (!formValues) return;

  const res = await callGasApi('returnItem', {
    logId,
    conditionNote: formValues.conditionNote,
    holdStock: formValues.holdStock
  });

  if (res && res.success) {
    Swal.fire('完成', res.message, 'success');
    await refreshData();
  } else if (res) {
    Swal.fire('操作失敗', res.error, 'error');
  }
};

/* ================== 體育組管理後台 ================== */

function renderAdminPanel() {
  const { users, allActiveLogs, recentAllLogs } = state.adminData;
  const pendingCount = users.filter(u => u.status === 'PENDING').length;

  ['badgePendingUsers', 'subBadgePending'].forEach(id => {
    const el = document.getElementById(id);
    if (pendingCount > 0) {
      el.textContent = pendingCount;
      el.classList.remove('d-none');
    } else {
      el.classList.add('d-none');
    }
  });

  // 1. 教師審核列表 (待審核排最前面)
  const sortedUsers = [...users].sort((a, b) => (a.status === 'PENDING' ? -1 : 1));
  document.getElementById('adminUsersTable').innerHTML = sortedUsers.map(u => {
    const statusBadge = u.status === 'APPROVED' ? '<span class="badge bg-success">已核准</span>'
      : (u.status === 'PENDING' ? '<span class="badge bg-warning text-dark">待審核</span>' : '<span class="badge bg-danger">已停權/拒絕</span>');

    return `
      <tr>
        <td>
          <div class="fw-bold">${escapeHtml(u.name)}</div>
          <div class="text-muted">${escapeHtml(u.titleClass)}</div>
        </td>
        <td>
          <div>${escapeHtml(u.email)}</div>
          <div class="text-muted">${escapeHtml(u.phone || '-')}</div>
        </td>
        <td>${u.role === 'ADMIN' ? '<span class="badge bg-primary">管理員</span>' : '老師'}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="btn-group btn-group-sm">
            ${u.status !== 'APPROVED' ? `<button class="btn btn-success" onclick="adminSetUser('${u.email}', 'APPROVED', 'TEACHER')">核准</button>` : ''}
            ${u.status === 'APPROVED' && u.role !== 'ADMIN' ? `<button class="btn btn-outline-primary" onclick="adminSetUser('${u.email}', 'APPROVED', 'ADMIN')">設管理員</button>` : ''}
            ${u.status === 'APPROVED' && u.email !== state.user.email ? `<button class="btn btn-outline-danger" onclick="adminSetUser('${u.email}', 'REJECTED', 'TEACHER')">停權</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // 2. 全校借出中
  const activeTbody = document.getElementById('adminActiveLogsTable');
  if (allActiveLogs.length === 0) {
    activeTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">目前全校無借出中器材</td></tr>`;
  } else {
    activeTbody.innerHTML = allActiveLogs.map(l => `
      <tr>
        <td class="fw-bold">${escapeHtml(l.teacherName)}</td>
        <td>${escapeHtml(l.eqName)}</td>
        <td><span class="badge bg-danger">${l.qty} ${escapeHtml(l.unit)}</span></td>
        <td>${escapeHtml(l.classUsed)}<br><small class="text-muted">預計：${escapeHtml(l.expectedReturn)}</small></td>
        <td>${escapeHtml(l.borrowTime)}</td>
        <td>
          <button class="btn btn-sm btn-outline-success fw-bold" onclick="promptReturn('${l.logId}', '${escapeHtml(l.eqName)}', ${l.qty}, '${escapeHtml(l.unit)}')">
            協助歸還
          </button>
        </td>
      </tr>
    `).join('');
  }

  // 3. 近期全部紀錄
  document.getElementById('adminAllLogsTable').innerHTML = recentAllLogs.map(l => `
    <tr>
      <td>${escapeHtml(l.teacherName)}</td>
      <td>${escapeHtml(l.eqName)}</td>
      <td>${l.qty} ${escapeHtml(l.unit)}</td>
      <td>${escapeHtml(l.borrowTime)}</td>
      <td>${escapeHtml(l.returnTime || '-')}</td>
      <td>
        ${l.status === 'BORROWED' ? '<span class="badge bg-danger">借出中</span>'
          : (l.status === 'ISSUE_HOLD' ? '<span class="badge bg-warning text-dark">異常待修</span>' : '<span class="badge bg-success">已歸還</span>')}
        <small class="text-muted">${escapeHtml(l.conditionNote || '')}</small>
      </td>
    </tr>
  `).join('');

  // 4. 器材庫存管理表
  document.getElementById('adminEqTable').innerHTML = state.equipment.map(eq => `
    <tr class="${eq.active ? '' : 'table-secondary text-muted'}">
      <td><small class="text-muted">${escapeHtml(eq.id)}</small><br><strong>${escapeHtml(eq.name)}</strong></td>
      <td>${escapeHtml(eq.category)}</td>
      <td><strong>${eq.availableQty}</strong> / ${eq.totalQty} ${escapeHtml(eq.unit)}</td>
      <td>${escapeHtml(eq.location)}</td>
      <td>${eq.active ? '<span class="badge bg-success">開放</span>' : '<span class="badge bg-secondary">停用</span>'}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick="openEqModal('${eq.id}')">編輯</button>
      </td>
    </tr>
  `).join('');
}

window.adminSetUser = async function (targetEmail, newStatus, newRole) {
  const res = await callGasApi('adminApproveUser', { targetEmail, newStatus, newRole });
  if (res && res.success) {
    Swal.fire({ toast: true, position: 'top', icon: 'success', title: res.message, showConfirmButton: false, timer: 1500 });
    await refreshData();
  } else if (res) {
    Swal.fire('操作失敗', res.error, 'error');
  }
};

window.openEqModal = function (eqId = null) {
  if (eqId) {
    const eq = state.equipment.find(e => e.id === eqId);
    if (!eq) return;
    document.getElementById('eqModalTitle').textContent = `編輯器材 (${eq.id})`;
    document.getElementById('eqEditId').value = eq.id;
    document.getElementById('eqEditName').value = eq.name;
    document.getElementById('eqEditUnit').value = eq.unit;
    document.getElementById('eqEditCategory').value = eq.category;
    document.getElementById('eqEditLocation').value = eq.location;
    document.getElementById('eqEditTotal').value = eq.totalQty;
    document.getElementById('eqEditAvailable').value = eq.availableQty;
    document.getElementById('eqEditNote').value = eq.note;
    document.getElementById('eqEditActive').checked = eq.active;
  } else {
    document.getElementById('eqModalTitle').textContent = '新增器材';
    document.getElementById('formEqSave').reset();
    document.getElementById('eqEditId').value = '';
    document.getElementById('eqEditActive').checked = true;
  }
  eqModalInstance.show();
};

async function handleEqSaveSubmit(e) {
  e.preventDefault();
  const equipment = {
    id: document.getElementById('eqEditId').value || null,
    name: document.getElementById('eqEditName').value,
    unit: document.getElementById('eqEditUnit').value,
    category: document.getElementById('eqEditCategory').value,
    location: document.getElementById('eqEditLocation').value,
    totalQty: document.getElementById('eqEditTotal').value,
    availableQty: document.getElementById('eqEditAvailable').value,
    note: document.getElementById('eqEditNote').value,
    active: document.getElementById('eqEditActive').checked
  };

  const res = await callGasApi('adminSaveEquipment', { equipment });
  if (res && res.success) {
    eqModalInstance.hide();
    Swal.fire('成功', res.message, 'success');
    await refreshData();
  } else if (res) {
    Swal.fire('儲存失敗', res.error, 'error');
  }
}

/* ================== 輔助函式 ================== */

function showSection(sectionId) {
  ['viewLogin', 'viewApply', 'viewPending', 'viewApp'].forEach(id => {
    document.getElementById(id).classList.toggle('d-none', id !== sectionId);
  });
}

function logout() {
  sessionStorage.removeItem('pe_id_token');
  state.idToken = '';
  state.user = null;
  state.cart = {};
  document.getElementById('navUserArea').classList.add('d-none');
  document.getElementById('floatingCartBtn').classList.add('d-none');
  showSection('viewLogin');
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
}

function toggleLoader(show) {
  document.getElementById('globalLoader').classList.toggle('d-none', !show);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
