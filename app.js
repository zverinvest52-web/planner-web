// State
// Helper for safe parsing
function safeParse(key, def) {
    try {
        return JSON.parse(localStorage.getItem(key)) || def;
    } catch (e) {
        return def;
    }
}

const defaultCategories = ['ОБЩИЕ', 'РАБОТА', 'ДОМ', 'ЛИЧНЫЕ'];

// Data Repair Logic
function validateAndRepairData() {
    let t = safeParse('planner_tasks', []);
    let c = safeParse('planner_categories', defaultCategories);

    // Fix Categories
    if (!Array.isArray(c) || c.length === 0) c = defaultCategories;
    c = c.filter(item => typeof item === 'string' && item.trim() !== '');

    // Fix Tasks
    if (!Array.isArray(t)) t = [];
    t = t.filter(task => task && task.id && task.title);

    // Save back fixed data
    localStorage.setItem('planner_tasks', JSON.stringify(t));
    localStorage.setItem('planner_categories', JSON.stringify(c));

    return { tasks: t, categories: c };
}

const data = validateAndRepairData();
let tasks = data.tasks;
let categories = data.categories;

// Emergency Reset
window.resetApp = () => {
    localStorage.clear();
    location.reload();
};

// DOM Elements
const stackContainer = document.getElementById('category-stack');
const modalAdd = document.getElementById('modal-add-task');
const inputDateNative = document.getElementById('input-date-native');
const labelDate = document.getElementById('label-date');
let selectedDate = null;
let selectedCategory = 'ОБЩИЕ';
let expandedCategory = null;
let currentPhotos = [];
const HEADER_HEIGHT_PX = 50;
const HEADER_HEIGHT_REM = 3;
const TOP_OFFSET_PX = 10;

// Init
document.addEventListener('DOMContentLoaded', () => {
    updateHeaderDate();
    initSync(); // Start Sync
    renderStack();
    renderStack();
    setupEventListeners();
    console.log("App v25.0 loaded successfully");
});

// Firebase Init
const firebaseConfig = {
    apiKey: "AIzaSyDm1OtrN4y6xzxiSwxEe6fWBQbxPF-_2W4",
    authDomain: "planer-a8373.firebaseapp.com",
    databaseURL: "https://planer-a8373-default-rtdb.firebaseio.com",
    projectId: "planer-a8373",
    storageBucket: "planer-a8373.firebasestorage.app",
    messagingSenderId: "605434976950",
    appId: "1:605434976950:web:aaa57c2c90a36d495c6417",
    measurementId: "G-2578HLN9LR"
};
let db = null;
let tgUserId = null;

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    console.log("Firebase initialized");
} catch (e) {
    console.error("Firebase init failed:", e);
}

function initSync() {
    // 1. Try to get Telegram User ID
    try {
        if (window.Telegram?.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            if (tg.initDataUnsafe?.user?.id) {
                tgUserId = tg.initDataUnsafe.user.id.toString();
                console.log("TG User ID found:", tgUserId);
            }
        }
    } catch (e) {
        console.warn("TG Init failed", e);
    }

    const statusEl = document.getElementById('cloud-status');

    if (tgUserId && db) {
        // Minified Status: Green Dot
        if (statusEl) statusEl.innerHTML = `<i class="fas fa-circle" style="color:#34C759; font-size:6px;"></i>`;

        // Cloud Mode: Listen to changes
        const ref = db.ref('users/' + tgUserId + '/monitor');

        // Initial Check: If Cloud is empty, push Local
        ref.once('value').then(snapshot => {
            const val = snapshot.val();
            if (!val && tasks.length > 0) {
                console.log("Cloud empty, pushing local data...");
                save(); // Force push
            }
        });

        ref.on('value', (snapshot) => {
            const val = snapshot.val();
            if (val) {
                // Merge or Overwrite? For now Overwrite from cloud to be safe sync.
                // In a real app we might merge.
                if (val.tasks) tasks = val.tasks;
                if (val.categories) categories = val.categories;

                // Update Local Storage as backup
                localStorage.setItem('planner_tasks', JSON.stringify(tasks));
                localStorage.setItem('planner_categories', JSON.stringify(categories));

                renderStack();
                console.log("Synced from Cloud");
            }
        });
    } else {
        // Offline Status: Red Dot
        if (statusEl) statusEl.innerHTML = `<i class="fas fa-circle" style="color:#FF3B30; font-size:6px;"></i>`;
        console.log("Offline Mode (No TG ID or Firebase)");
    }
}

function setupEventListeners() {
    // Add Button
    document.getElementById('nav-add').onclick = () => {
        currentEditingTaskId = null;
        document.getElementById('modal-title').innerText = "НОВАЯ ЗАДАЧА";
        document.getElementById('btn-save-task').innerText = "СОЗДАТЬ";
        const btnDelete = document.getElementById('btn-delete-task');
        if (btnDelete) btnDelete.classList.add('hidden');

        document.getElementById('input-title').value = '';
        document.getElementById('input-desc').value = '';
        document.getElementById('input-tags').value = '';
        document.getElementById('input-time').value = '';
        selectedDate = null;
        updateDateLabel();
        updateDateLabel();
        selectedCategory = expandedCategory || categories[0];
        document.getElementById('label-cat').innerText = selectedCategory;

        // Reset Photos
        currentPhotos = [];
        renderPhotoPreviews();

        modalAdd.classList.remove('hidden');
    };

    // Close Modal
    document.getElementById('close-add-task').onclick = () => {
        modalAdd.classList.add('hidden');
    };

    // Save Task
    document.getElementById('btn-save-task').onclick = () => {
        const title = document.getElementById('input-title').value.trim();
        if (!title) return;

        if (currentEditingTaskId) {
            // Edit
            const taskIndex = tasks.findIndex(t => t.id === currentEditingTaskId);
            if (taskIndex > -1) {
                tasks[taskIndex] = {
                    ...tasks[taskIndex],
                    title: title,
                    description: document.getElementById('input-desc').value,
                    category: selectedCategory,
                    tags: document.getElementById('input-tags').value,
                    time: document.getElementById('input-time').value,
                    date: selectedDate,
                    photos: currentPhotos // Save photos
                };
            }
        } else {
            // Create
            const newTask = {
                id: Date.now().toString(),
                title: title,
                description: document.getElementById('input-desc').value,
                category: selectedCategory,
                tags: document.getElementById('input-tags').value,
                time: document.getElementById('input-time').value,
                date: selectedDate,
                photos: currentPhotos, // Save photos
                completed: false
            };
            tasks.push(newTask);
        }

        save();
        modalAdd.classList.add('hidden');
    };

    // Photo Handlers
    const btnAddPhoto = document.getElementById('btn-add-photo');
    const inputPhoto = document.getElementById('input-photo-native');

    if (btnAddPhoto && inputPhoto) {
        btnAddPhoto.onclick = () => inputPhoto.click();

        inputPhoto.onchange = (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;

            // Limit total photos to prevent storage overflow (max 3 for now)
            if (currentPhotos.length + files.length > 5) {
                alert("Максимум 5 фото");
                return;
            }

            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    // Simple compression by not touching it? LocalStorage has 5MB limit. 
                    // ideally we should resize. For now raw base64.
                    currentPhotos.push(evt.target.result);
                    renderPhotoPreviews();
                };
                reader.readAsDataURL(file);
            });
            inputPhoto.value = ''; // Reset
        };
    }

    // Delete Task Button
    const btnDelete = document.getElementById('btn-delete-task');
    if (btnDelete) {
        btnDelete.onclick = () => {
            if (currentEditingTaskId) {
                tasks = tasks.filter(t => t.id !== currentEditingTaskId);
                save();
                modalAdd.classList.add('hidden');
            }
        };
    }

    // Modal Date Pickers
    document.getElementById('btn-pick-date').onclick = () => {
        document.getElementById('modal-datepicker').classList.remove('hidden');
    };
    document.getElementById('btn-cancel-date').onclick = () => {
        document.getElementById('modal-datepicker').classList.add('hidden');
    };
    document.getElementById('btn-confirm-date').onclick = () => {
        const val = inputDateNative.value;
        if (val) selectedDate = val;
        updateDateLabel();
        document.getElementById('modal-datepicker').classList.add('hidden');
    };
    document.getElementById('btn-clear-date').onclick = (e) => {
        e.stopPropagation();
        selectedDate = null;
        updateDateLabel();
    };

    // Category Picker
    const btnPickCat = document.getElementById('btn-pick-cat');
    if (btnPickCat) {
        btnPickCat.onclick = () => {
            const dd = document.getElementById('dropdown-cat');
            dd.classList.toggle('hidden');
            dd.innerHTML = '';
            categories.forEach(cat => {
                const item = document.createElement('div');
                item.className = 'dropdown-item';
                item.innerText = cat;
                item.onclick = () => {
                    selectedCategory = cat;
                    document.getElementById('label-cat').innerText = cat;
                    dd.classList.add('hidden');
                };
                dd.appendChild(item);
            });
        };
    }

    // Dock: Home
    const navHome = document.getElementById('nav-home');
    if (navHome) {
        navHome.onclick = () => {
            expandedCategory = null; // Collapse all
            renderStack();
        };
    }

    // Dock: Categories (Manage)
    const navCats = document.getElementById('nav-cats');
    const modalCats = document.getElementById('modal-manage-cats');

    if (navCats && modalCats) {
        navCats.onclick = () => {
            renderManageCats();
            modalCats.classList.remove('hidden');
        };

        document.getElementById('close-manage-cats').onclick = () => {
            modalCats.classList.add('hidden');
        };

        document.getElementById('btn-add-cat').onclick = () => {
            const inp = document.getElementById('input-new-cat');
            const val = inp.value.trim();
            if (val && !categories.includes(val)) {
                categories.push(val);
                inp.value = '';
                save();
                renderManageCats();
                renderStack(); // Update background
            }
        };
    }

    // Search Toggle
    const btnSearch = document.getElementById('btn-search-toggle');
    if (btnSearch) {
        btnSearch.onclick = (e) => {
            e.stopPropagation(); // Prevent document click from closing immediately
            const sb = document.getElementById('search-bar-container');
            sb.classList.toggle('hidden');
            if (!sb.classList.contains('hidden')) {
                document.getElementById('global-search').focus();
            }
        };
    }

    // Close search on click outside
    document.addEventListener('click', (e) => {
        const sb = document.getElementById('search-bar-container');
        const btn = document.getElementById('btn-search-toggle');
        if (sb && !sb.classList.contains('hidden')) {
            if (!sb.contains(e.target) && !btn.contains(e.target)) {
                sb.classList.add('hidden');
            }
        }
    });
}

function renderManageCats() {
    const list = document.getElementById('cats-list-container');
    if (!list) return;
    list.innerHTML = '';

    categories.forEach((cat, idx) => {
        const row = document.createElement('div');
        row.className = 'input-row';
        row.style.justifyContent = 'space-between';

        // Enable Drag
        row.draggable = true;
        row.dataset.index = idx;

        // Visual content
        row.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <i class="fas fa-bars" style="color:#ccc; cursor:grab;"></i>
                <span style="font-weight:500; font-size:16px;">${cat}</span>
            </div>
            <button class="btn-icon-small" onclick="deleteCat('${cat}')">
                <i class="fas fa-trash"></i>
            </button>
        `;

        // Desktop Drag Events
        row.addEventListener('dragstart', handleDragStart);
        row.addEventListener('dragover', handleDragOver);
        row.addEventListener('drop', handleDrop);
        row.addEventListener('dragend', handleDragEnd);

        // Mobile Touch Events
        row.addEventListener('touchstart', handleTouchStart, { passive: false });
        row.addEventListener('touchmove', handleTouchMove, { passive: false });
        row.addEventListener('touchend', handleTouchEnd);

        list.appendChild(row);
    });
}

// --- DRAG & DROP LOGIC ---
let dragSrcEl = null;

function handleDragStart(e) {
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.classList.add('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    if (dragSrcEl !== this) {
        const srcIdx = parseInt(dragSrcEl.dataset.index);
        const targetIdx = parseInt(this.dataset.index);
        moveCatItem(srcIdx, targetIdx);
    }
    return false;
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
}

// Touch Logic
let touchSrcIdx = null;

function handleTouchStart(e) {
    touchSrcIdx = parseInt(this.dataset.index);
    this.classList.add('dragging');
}

function handleTouchMove(e) {
    e.preventDefault(); // Prevent scrolling while dragging
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const row = target ? target.closest('.input-row') : null;

    // Optional: Add visual feedback for "hover"
}

function handleTouchEnd(e) {
    this.classList.remove('dragging');
    const touch = e.changedTouches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetRow = target ? target.closest('.input-row') : null;

    if (targetRow && touchSrcIdx !== null) {
        const targetIdx = parseInt(targetRow.dataset.index);
        if (!isNaN(targetIdx) && targetIdx !== touchSrcIdx) {
            moveCatItem(touchSrcIdx, targetIdx);
        }
    }
    touchSrcIdx = null;
}

function moveCatItem(fromIndex, toIndex) {
    const item = categories[fromIndex];
    categories.splice(fromIndex, 1);
    categories.splice(toIndex, 0, item);
    save();
    renderManageCats();
    renderStack();
}

// Old moveCat removed in favor of moveCatItem
// window.moveCat = ...

window.deleteCat = (cat) => {
    if (confirm('Удалить папку "' + cat + '" и ВСЕ задачи в ней? Это действие нельзя отменить.')) {
        categories = categories.filter(c => c !== cat);
        // Delete tasks permanently
        tasks = tasks.filter(t => t.category !== cat);

        save();
        renderManageCats();
        renderStack();
    }
};

function updateHeaderDate() {
    const options = { month: 'long', day: 'numeric' };
    const dateStr = new Date().toLocaleDateString('ru-RU', options);
    document.getElementById('header-date').innerText = dateStr;
}

function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

function save() {
    // Local Save (Always backup)
    localStorage.setItem('planner_tasks', JSON.stringify(tasks));
    localStorage.setItem('planner_categories', JSON.stringify(categories));

    // Cloud Save
    if (tgUserId && db) {
        db.ref('users/' + tgUserId + '/monitor').set({
            tasks: tasks,
            categories: categories,
            last_updated: Date.now()
        }).catch(err => console.error("Cloud Save Error:", err));
    }

    renderStack();
}

function renderStack() {
    try {
        if (!stackContainer) return;
        stackContainer.innerHTML = '';

        // Repair expandedCategory
        if (!expandedCategory || !categories.includes(expandedCategory)) {
            expandedCategory = categories[0] || (categories.length > 0 ? categories[0] : null);
        }

        if (!expandedCategory) return; // No categories at all?

        const expIndex = categories.indexOf(expandedCategory);
        const total = categories.length;

        categories.forEach((cat, index) => {
            if (!cat) return;
            const card = document.createElement('div');
            card.className = 'category-card';

            const isAfterExpanded = index > expIndex;

            if (!isAfterExpanded) {
                // Stack at TOP
                const topPos = TOP_OFFSET_PX + (index * HEADER_HEIGHT_PX);
                card.style.top = `${topPos}px`;
            } else {
                // Stack at BOTTOM
                const cardsBelow = total - index;
                // Boost overlap safe zone - increased to 220px (User Request for strict limit)
                const bottomOffset = 220 + (cardsBelow * HEADER_HEIGHT_PX);
                card.style.top = `calc(100dvh - ${bottomOffset}px)`;
            }

            card.style.zIndex = 10 + index; // Lower base index

            if (expandedCategory === cat) {
                card.classList.add('expanded');
            } else {
                card.classList.remove('expanded');
            }

            const catTasks = tasks.filter(t => t.category === cat);
            const count = catTasks.filter(t => !t.completed).length;

            card.innerHTML = `
                <div class="card-header">
                    <h2>${cat}</h2>
                    <div class="counter-badge">${count > 0 ? count : ''}</div>
                </div>
                <div class="task-list" id="list-${cat}"></div>
            `;

            card.querySelector('.card-header').addEventListener('click', () => {
                toggleCard(cat);
            });

            stackContainer.appendChild(card);

            const listEl = card.querySelector(`#list-${cat}`);
            renderTasksForCategory(listEl, catTasks);
        });
    } catch (e) {
        console.error(e);
        alert("Render Error: " + e.message);
    }
}

function renderTasksForCategory(container, taskList) {
    const today = getTodayStr();

    taskList.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return 0;
    });

    taskList.forEach(task => {
        const isCompleted = task.completed;
        const isOverdue = !isCompleted && task.date && task.date < today;
        const isToday = !isCompleted && task.date && task.date === today;
        const isCritical = isOverdue || isToday;

        let infoText = '';
        if (task.time && isToday) infoText = task.time;
        else if (task.date && !isToday && !isOverdue) {
            const d = new Date(task.date);
            infoText = `до ${d.getDate()}.${d.getMonth() + 1}`;
        }
        else if (task.time) infoText = task.time;

        const div = document.createElement('div');
        div.className = `task-item ${isCompleted ? 'completed' : ''} ${isCritical ? 'critical' : ''}`;

        div.innerHTML = `
            <div class="task-checkbox-area">
                <div class="checkbox-circle"></div>
            </div>
            <div class="task-content">
                <div class="task-title">${task.title}</div>
                <div class="meta-row">
                    ${isCritical && isOverdue ? '<div class="critical-label">ПРОСРОЧЕНО</div>' : ''}
                    ${isCritical && isToday ? '<div class="critical-label">СЕГОДНЯ</div>' : ''}
                    ${task.photos && task.photos.length > 0 ? '<div class="critical-label" style="color:var(--text-gray);"><i class="fas fa-paperclip"></i> ' + task.photos.length + '</div>' : ''}
                </div>
            </div>
            ${infoText ? `<div class="info-pill">${infoText}</div>` : ''}
        `;

        const checkboxArea = div.querySelector('.task-checkbox-area');
        checkboxArea.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTask(task.id);
        });

        const contentArea = div.querySelector('.task-content');
        contentArea.addEventListener('click', (e) => {
            e.stopPropagation();
            openTaskDetails(task);
        });

        container.appendChild(div);
    });
}

// Logic Actions
function toggleTask(id) {
    const t = tasks.find(x => x.id === id);
    if (t) {
        t.completed = !t.completed;
        save();
    }
}

function toggleCard(cat) {
    if (expandedCategory !== cat) {
        expandedCategory = cat;
        renderStack();
    }
}

// Global Exports
let currentEditingTaskId = null;
window.toggleCard = toggleCard;
window.toggleTask = toggleTask;
window.validateAndRepairData = validateAndRepairData;

// Logic Actions needed for openTaskDetails to be available?
// It was defined inside the scope in previous versions, let's make it global or hoist properly.
// The above structure has openTaskDetails missing? 
// No, I missed copying it in the manual rewrite above.
// Wait, I need to include openTaskDetails + updateDateLabel + formattingUtils.

function updateDateLabel() {
    const btnClear = document.getElementById('btn-clear-date');
    if (selectedDate) {
        labelDate.innerText = formatDate(selectedDate);
        labelDate.classList.add('text-accent');
        btnClear.classList.remove('hidden');
    } else {
        labelDate.innerText = "Без дедлайна";
        labelDate.classList.remove('text-accent');
        btnClear.classList.add('hidden');
    }
}

function formatDate(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function openTaskDetails(task) {
    currentEditingTaskId = task.id;
    const modalTitle = document.getElementById('modal-title');
    const btnSave = document.getElementById('btn-save-task');
    const btnDelete = document.getElementById('btn-delete-task');

    modalTitle.innerText = "РЕДАКТИРОВАНИЕ";
    btnSave.innerText = "СОХРАНИТЬ";
    if (btnDelete) btnDelete.classList.remove('hidden');

    document.getElementById('input-title').value = task.title;
    document.getElementById('input-desc').value = task.description || '';
    document.getElementById('input-tags').value = (task.tags || []).toString();
    document.getElementById('input-time').value = task.time || '';

    selectedCategory = task.category;
    document.getElementById('label-cat').innerText = selectedCategory;
    selectedDate = task.date;

    // Load photos
    currentPhotos = task.photos || [];
    renderPhotoPreviews();

    updateDateLabel();

    modalAdd.classList.remove('hidden');
}

function renderPhotoPreviews() {
    const container = document.getElementById('photos-preview-container');
    if (!container) return;
    container.innerHTML = '';

    currentPhotos.forEach((src, idx) => {
        const thumb = document.createElement('div');
        thumb.style.cssText = `
            width: 60px; height: 60px; flex-shrink:0; 
            border-radius: 8px; background-image: url('${src}'); 
            background-size: cover; background-position: center;
            position: relative;
        `;

        const btnDel = document.createElement('button');
        btnDel.innerHTML = '<i class="fas fa-times"></i>';
        btnDel.style.cssText = `
            position: absolute; top: -5px; right: -5px;
            width: 20px; height: 20px; border-radius: 50%;
            background: red; color: white; border: none;
            font-size: 10px; display: flex; align-items: center; justify-content: center;
            cursor: pointer;
        `;
        btnDel.onclick = (e) => {
            e.stopPropagation(); // prevent modal close logic if any
            currentPhotos.splice(idx, 1);
            renderPhotoPreviews();
        };

        thumb.appendChild(btnDel);
        container.appendChild(thumb);
    });
}

window.openTaskDetails = openTaskDetails;
